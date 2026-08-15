// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}        from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IERC20}              from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HookMiner}               from "../src/lib/HookMiner.sol";
import {MWHookCoordinator}       from "../src/hooks/MWHookCoordinator.sol";
import {MWAmAuction, IAmAmmRentSink} from "../src/hooks/MWAmAuction.sol";
import {AmParams}                from "../src/hooks/MWAmAuctionLib.sol";
import {MintwareDeFiPairVault}   from "../src/vaults/MintwareDeFiPairVault.sol";
import {PoolProfile, LockTier}   from "../src/vaults/VaultTypes.sol";

import {MockERC20}      from "./mocks/MockERC20.sol";
import {TestSwapRouter} from "./helpers/TestSwapRouter.sol";

contract SinkStub is IAmAmmRentSink {
    function fundRent(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }
}

/// @notice Integration proof for the am-AMM manager-fee skim in MWHookCoordinator.beforeSwap
///         against a real V4 PoolManager. Proves the delta accounting nets to zero (the swap
///         settles), the manager fee reaches the auction, and exact-output is rejected in v1.
///         Migrated onto the go-forward `MintwareDeFiPairVault` (the coordinator's skim path is
///         vault-independent; the vault only supplies resting liquidity). Phase 0.
contract MWHookCoordinatorAmAmmTest is Test {
    using PoolIdLibrary for PoolKey;

    address internal deployer = address(this); // owner + provider
    address internal alice    = makeAddr("alice");   // LP + trader
    address internal mgr      = makeAddr("mgr");      // am-AMM manager
    address internal treasury = makeAddr("treasury");

    PoolManager    internal pm;
    TestSwapRouter internal swapRouter;
    MWHookCoordinator internal coord;
    MWAmAuction    internal auction;
    SinkStub       internal sink;
    MintwareDeFiPairVault internal vault;

    MockERC20 internal usdc;
    MockERC20 internal proj;

    PoolKey internal poolKey;
    PoolId  internal poolId;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    uint24  internal constant MGR_FEE_PIPS = 10_000; // 1%

    function setUp() public {
        pm         = new PoolManager(deployer);
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        sink       = new SinkStub();

        usdc = new MockERC20("USD Coin", "USDC", 18);
        proj = new MockERC20("Project", "PROJ", 18);

        bytes memory args = abi.encode(IPoolManager(address(pm)), address(0), deployer);
        (address expected, bytes32 salt) =
            HookMiner.find(deployer, uint160(0xAC8), type(MWHookCoordinator).creationCode, args);
        coord = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), deployer);
        require(address(coord) == expected, "coord addr");

        // DYNAMIC-FEE pool so the LP-fee override takes effect.
        (Currency c0, Currency c1) = address(usdc) < address(proj)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(proj)))
            : (Currency.wrap(address(proj)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(coord))});
        poolId  = poolKey.toId();

        vault = new MintwareDeFiPairVault(address(pm), poolKey, PoolProfile.EMERGING, treasury, deployer, deployer);
        coord.setVault(address(vault));
        vault.setHook(address(coord));
        vault.initializePool(INIT_SQRT_PRICE);

        // Liquidity via the pair vault (balanced dual-sided).
        usdc.mint(alice, 5_000_000e18);
        proj.mint(alice, 5_000_000e18);
        usdc.mint(mgr, 100_000e18);
        vm.startPrank(alice);
        IERC20(Currency.unwrap(c0)).approve(address(vault), type(uint256).max);
        IERC20(Currency.unwrap(c1)).approve(address(vault), type(uint256).max);
        vault.deposit(2_000_000e18, 2_000_000e18, 0, LockTier.Flex);
        vm.stopPrank();

        // Guard OFF (isolate the skim); the am-AMM branch supplies the fee for enrolled pools.
        coord.configurePool(poolId, 3000, 100000, 0, 0, false, false, 60, 6000, 10);

        // Wire the auction + enroll the pool.
        auction = new MWAmAuction(deployer);
        auction.setCoordinator(address(coord));
        coord.setAuction(address(auction));
        coord.setAmAmmEnabled(poolId, true);
        auction.configurePool(poolId, address(sink), AmParams({
            enabled: true, bidToken: address(usdc), feeMaxPips: 30_000, defaultFeePips: 3000,
            minRent: 100, K: 10, minBidMultBps: 11_000        }));

        vm.roll(1000);
    }

    function _seatManager() internal {
        vm.startPrank(mgr);
        usdc.approve(address(auction), 1000);
        auction.bid(poolId, MGR_FEE_PIPS, 100, 1000); // rent 100, deposit 1000 = rent*K
        vm.stopPrank();
        vm.roll(block.number + 10); // past K → next swap's poke promotes mgr
    }

    function _swapExactIn(bool zeroForOne, uint256 amountIn) internal {
        vm.startPrank(alice);
        (zeroForOne ? IERC20(Currency.unwrap(poolKey.currency0)) : IERC20(Currency.unwrap(poolKey.currency1)))
            .approve(address(swapRouter), amountIn);
        swapRouter.swap(poolKey, zeroForOne, amountIn);
        vm.stopPrank();
    }

    // ── the manager fee is skimmed to the auction; the swap settles (net-zero delta) ──

    function test_exactInput_zeroForOne_skims_manager_fee() public {
        _seatManager();
        address spec = Currency.unwrap(poolKey.currency0); // exact-in zeroForOne → specified = c0
        uint256 amountIn = 10_000e18;
        uint256 expectFee = (amountIn * MGR_FEE_PIPS) / 1_000_000; // 1% = 100e18

        uint256 auctBefore = IERC20(spec).balanceOf(address(auction));
        _swapExactIn(true, amountIn); // must not revert => hook netted zero
        uint256 gained = IERC20(spec).balanceOf(address(auction)) - auctBefore;

        assertEq(gained, expectFee, "manager fee reached the auction in the specified token");
        assertEq(auction.owed(mgr, spec), expectFee, "manager credited in the ledger");
    }

    function test_exactInput_oneForZero_skims_other_token() public {
        _seatManager();
        address spec = Currency.unwrap(poolKey.currency1); // exact-in oneForZero → specified = c1
        uint256 amountIn = 5_000e18;
        uint256 expectFee = (amountIn * MGR_FEE_PIPS) / 1_000_000;

        uint256 auctBefore = IERC20(spec).balanceOf(address(auction));
        _swapExactIn(false, amountIn);
        assertEq(IERC20(spec).balanceOf(address(auction)) - auctBefore, expectFee, "fee in token1");
        assertEq(auction.owed(mgr, spec), expectFee, "manager credited (token1)");
    }

    // ── unmanaged enrolled pool: no skim, swap still settles ──

    function test_unmanaged_pool_no_skim() public {
        // No manager seated. Enrolled + auction wired, but poke returns address(0).
        address spec = Currency.unwrap(poolKey.currency0);
        uint256 auctBefore = IERC20(spec).balanceOf(address(auction));
        _swapExactIn(true, 10_000e18); // must still settle
        assertEq(IERC20(spec).balanceOf(address(auction)), auctBefore, "no skim without a manager");
    }

    // ── a non-enrolled pool is completely unaffected (regression) ──

    function test_manager_can_claim_skimmed_fees() public {
        _seatManager();
        address spec = Currency.unwrap(poolKey.currency0);
        _swapExactIn(true, 10_000e18);
        uint256 owed = auction.owed(mgr, spec);
        assertGt(owed, 0, "fee accrued");
        uint256 before = IERC20(spec).balanceOf(mgr);
        vm.prank(mgr);
        auction.claim(spec);
        assertEq(IERC20(spec).balanceOf(mgr) - before, owed, "manager claimed the skim");
    }
}
