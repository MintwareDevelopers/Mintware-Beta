// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}        from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IERC20}              from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HookMiner}               from "../src/lib/HookMiner.sol";
import {MWHookCoordinator}       from "../src/hooks/MWHookCoordinator.sol";
import {MWAmAuction}             from "../src/hooks/MWAmAuction.sol";
import {AmParams}                from "../src/hooks/MWAmAuctionLib.sol";
import {MintwareDeFiPairVault}   from "../src/vaults/MintwareDeFiPairVault.sol";
import {MintwareWeightedDistributor} from "../src/MintwareWeightedDistributor.sol";
import {PoolProfile, LockTier}   from "../src/vaults/VaultTypes.sol";

import {MockERC20}      from "./mocks/MockERC20.sol";
import {TestSwapRouter} from "./helpers/TestSwapRouter.sol";

/// @notice FORK proof of the full World-B ULV loop against the REAL deployed Base Sepolia V4
///         PoolManager — the exact chain we deploy to. Stands up the bundled stack
///         (dynamic-fee MintwareDeFiPairVault + mined MWHookCoordinator + MWAmAuction, wired the
///         way deploy-pair-full-testnet wires it) and asserts, end-to-end:
///           deposit(both tokens) → shares/liquidity
///           swap → am-AMM manager-fee SKIM to the auction (proves the dynamic-fee override works
///                  on the real PoolManager)
///           rent charged on poke → fundRent → pair-vault LP accumulator → LP claimFees pays out
///
///         Run:  forge test --fork-url $BASE_SEPOLIA_RPC_URL \
///                 --match-path contracts-v4/test/MWPairVaultAmAmmFork.t.sol -vv
///         Without --fork-url the PoolManager address has no code → the test self-skips.
contract MWPairVaultAmAmmForkTest is Test {
    using PoolIdLibrary for PoolKey;

    // Base Sepolia (84532) V4 PoolManager — same address deploy-pair-full-testnet targets.
    address internal constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;

    address internal deployer = address(this); // owner + provider
    address internal treasury = makeAddr("treasury");
    address internal alice    = makeAddr("alice");  // LP
    address internal mgr      = makeAddr("mgr");     // am-AMM manager
    address internal trader   = makeAddr("trader");  // swapper

    IPoolManager   internal pm;
    TestSwapRouter internal swapRouter;
    MWHookCoordinator internal coord;
    MWAmAuction    internal auction;
    MintwareDeFiPairVault internal vault;

    PoolKey internal poolKey;
    PoolId  internal poolId;
    bool    internal forked;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    uint24  internal constant MGR_FEE_PIPS = 10_000; // 1%
    uint128 internal constant RENT   = 1e15;
    uint128 internal constant DEP    = 1e16;  // rent * K (K=10)

    function setUp() public {
        if (POOL_MANAGER.code.length == 0) { forked = false; return; } // not forked → tests self-skip
        forked = true;
        pm = IPoolManager(POOL_MANAGER);
        swapRouter = new TestSwapRouter(pm);

        MockERC20 tokenA = new MockERC20("Token A", "AAA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "BBB", 18);
        (Currency c0, Currency c1) = address(tokenA) < address(tokenB)
            ? (Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)))
            : (Currency.wrap(address(tokenB)), Currency.wrap(address(tokenA)));

        // Mine + CREATE2-deploy the hook (dynamic-fee override needs the 0xAC8 bits).
        bytes memory args = abi.encode(pm, address(0), deployer);
        (address expected, bytes32 salt) =
            HookMiner.find(deployer, uint160(0xAC8), type(MWHookCoordinator).creationCode, args);
        coord = new MWHookCoordinator{salt: salt}(pm, address(0), deployer);
        require(address(coord) == expected, "coord addr");

        // DYNAMIC-FEE pool (delta #1): required for the hook fee override.
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(coord))});
        poolId  = poolKey.toId();

        vault = new MintwareDeFiPairVault(POOL_MANAGER, poolKey, PoolProfile.EMERGING, treasury, deployer, deployer);
        coord.setVault(address(vault));
        vault.initializePool(INIT_SQRT_PRICE);

        // Fund actors.
        MockERC20(Currency.unwrap(c0)).mint(alice, 200_000e18);
        MockERC20(Currency.unwrap(c1)).mint(alice, 200_000e18);
        MockERC20(Currency.unwrap(c0)).mint(trader, 1_000_000e18);
        MockERC20(Currency.unwrap(c1)).mint(trader, 1_000_000e18);
        MockERC20(Currency.unwrap(c0)).mint(mgr, 1e18); // bid token (currency0)

        // am-AMM wiring (delta #2: rentSink = vault; vault.setRentFunder(auction)).
        auction = new MWAmAuction(deployer);
        auction.setCoordinator(address(coord));
        coord.setAuction(address(auction));
        vault.setRentFunder(address(auction));
        auction.configurePool(poolId, address(vault), AmParams({
            enabled: true, bidToken: Currency.unwrap(c0), feeMaxPips: 30_000, defaultFeePips: 3000,
            minRent: 1e14, K: 10, minBidMultBps: 11_000
        }));
        coord.setAmAmmEnabled(poolId, true);

        vm.roll(1000);
    }

    function _t0() internal view returns (address) { return Currency.unwrap(poolKey.currency0); }

    function _deposit(address who, uint256 a0, uint256 a1) internal returns (uint256 s) {
        vm.startPrank(who);
        IERC20(Currency.unwrap(poolKey.currency0)).approve(address(vault), a0);
        IERC20(Currency.unwrap(poolKey.currency1)).approve(address(vault), a1);
        s = vault.deposit(a0, a1, 0, LockTier.Flex);
        vm.stopPrank();
    }

    function _seatManager() internal {
        vm.startPrank(mgr);
        IERC20(_t0()).approve(address(auction), DEP);
        auction.bid(poolId, MGR_FEE_PIPS, RENT, DEP); // rent*K deposit
        vm.stopPrank();
        vm.roll(block.number + 11); // past K → next swap's poke promotes mgr
    }

    function _swap(bool zeroForOne, uint256 amountIn) internal {
        vm.startPrank(trader);
        IERC20(zeroForOne ? Currency.unwrap(poolKey.currency0) : Currency.unwrap(poolKey.currency1))
            .approve(address(swapRouter), amountIn);
        swapRouter.swap(poolKey, zeroForOne, amountIn);
        vm.stopPrank();
    }

    function test_full_ulv_loop_on_fork() public {
        if (!forked) { vm.skip(true); return; }

        // 1. Deposit both tokens → shares + pool liquidity.
        uint256 shares = _deposit(alice, 100_000e18, 100_000e18);
        assertGt(shares, 0, "shares minted");
        assertGt(vault.totalLiquidity(), 0, "pool has liquidity on the real PoolManager");

        // 2. Seat a manager, then swap → manager fee is SKIMMED (proves dynamic-fee override on the fork).
        _seatManager();
        address t0 = _t0();
        uint256 owedBefore = auction.owed(mgr, t0);
        _swap(true, 20_000e18); // exact-in zeroForOne → specified = currency0
        uint256 owedAfterSwap1 = auction.owed(mgr, t0);
        assertGt(owedAfterSwap1, owedBefore, "manager fee skimmed to the auction");

        // 3. Accrue RENT: roll blocks, swap again → poke charges rent → fundRent → LP accumulator.
        vm.roll(block.number + 5);
        uint256 aliceBefore = IERC20(t0).balanceOf(alice);
        _swap(true, 20_000e18);

        // 4. LP claims — the rent reached the pair-vault LP through fundRent.
        vm.prank(alice);
        vault.claimFees();
        uint256 aliceGained = IERC20(t0).balanceOf(alice) - aliceBefore;
        assertGt(aliceGained, 0, "am-AMM rent reached the LP via pair-vault fundRent");

        // 5. Manager can pull the skimmed fees.
        uint256 owed = auction.owed(mgr, t0);
        assertGt(owed, 0, "manager fee accrued");
        uint256 mgrBefore = IERC20(t0).balanceOf(mgr);
        vm.prank(mgr);
        auction.claim(t0);
        assertEq(IERC20(t0).balanceOf(mgr) - mgrBefore, owed, "manager claimed the skim");
    }

    // ── Rail B rewards wiring — the exact sequence the deploy route runs (regression for the
    //    double-register bug that broke the first live fire: 0x49d8266e VaultAlreadyRegistered). ──

    function test_rewards_wiring_corrected() public {
        if (!forked) { vm.skip(true); return; }
        // MintwareWeightedDistributor(oracleSigner, owner)
        MintwareWeightedDistributor dist = new MintwareWeightedDistributor(deployer, deployer);
        // Authorize the vault as a registrar, then wire — setWeightedDistributor registers the pair
        // DUAL-sided ITSELF. Correct route does NOT pre-register.
        dist.setAuthorizedRegistrar(address(vault), true);
        vault.setWeightedDistributor(address(dist), keccak256("rewards"));
        assertEq(vault.weightedDistributor(), address(dist), "distributor wired without double-register");
    }

    function test_rewards_double_register_reverts() public {
        if (!forked) { vm.skip(true); return; }
        MintwareWeightedDistributor dist = new MintwareWeightedDistributor(deployer, deployer);
        bytes32 dvid = keccak256("rewards");
        // The OLD (buggy) route pre-registered here → setWeightedDistributor's internal registerVault
        // then reverts VaultAlreadyRegistered. Prove that failure mode so it can't regress.
        dist.registerVault(dvid, Currency.unwrap(poolKey.currency0), Currency.unwrap(poolKey.currency1));
        dist.setAuthorizedRegistrar(address(vault), true);
        vm.expectRevert();
        vault.setWeightedDistributor(address(dist), dvid);
    }
}
