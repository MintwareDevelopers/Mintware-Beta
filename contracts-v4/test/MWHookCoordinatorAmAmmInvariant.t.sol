// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, StdInvariant} from "forge-std/Test.sol";

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

contract InvSink2 is IAmAmmRentSink {
    function fundRent(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }
}

/// @dev Fuzzes random swap × bid × roll × claim sequences through the LIVE coordinator+auction.
///      Every path catches reverts so it no-ops (e.g. a swap that runs out of range) — the
///      auction must stay solvent regardless of the sequence.
contract AmAmmSwapHandler is Test {
    MWHookCoordinator public coord;
    MWAmAuction public auction;
    TestSwapRouter public router;
    PoolKey public key;
    PoolId  public id;
    address public c0;
    address public c1;
    address[3] public actors;

    constructor(MWHookCoordinator _c, MWAmAuction _a, TestSwapRouter _r, PoolKey memory _k, MockERC20 t0, MockERC20 t1) {
        coord = _c; auction = _a; router = _r; key = _k; id = PoolIdLibrary.toId(_k);
        c0 = Currency.unwrap(_k.currency0); c1 = Currency.unwrap(_k.currency1);
        actors = [makeAddr("s0"), makeAddr("s1"), makeAddr("s2")];
        for (uint256 i; i < 3; i++) { t0.mint(actors[i], 1_000_000e6); t1.mint(actors[i], 1_000_000e6); }
    }

    function _actor(uint256 s) internal view returns (address) { return actors[s % 3]; }

    function actBid(uint256 s, uint24 feePips, uint128 rent) public {
        address a = _actor(s);
        rent = uint128(bound(rent, 100, 100_000));
        feePips = uint24(bound(feePips, 0, 30_000));
        uint128 deposit = rent * 10; // rent*K exactly
        vm.startPrank(a);
        IERC20(c0).approve(address(auction), deposit); // bidToken == c0
        try auction.bid(id, feePips, rent, deposit) {} catch {}
        vm.stopPrank();
    }

    function actSwap(uint256 s, bool zeroForOne, uint256 amt) public {
        address a = _actor(s);
        amt = bound(amt, 1e6, 3_000e6);
        address tin = zeroForOne ? c0 : c1;
        vm.startPrank(a);
        IERC20(tin).approve(address(router), amt);
        try router.swap(key, zeroForOne, amt) {} catch {}
        vm.stopPrank();
    }

    function actRoll(uint16 n) public { vm.roll(block.number + bound(n, 1, 50)); }

    function actClaim(uint256 s, bool tokenZero) public {
        address a = _actor(s);
        vm.prank(a);
        try auction.claim(tokenZero ? c0 : c1) {} catch {}
    }

    function sumOwed(address token) external view returns (uint256 t) {
        for (uint256 i; i < 3; i++) t += auction.owed(actors[i], token);
    }
}

/// @notice Swap-path solvency invariants for the live am-AMM hook. The auction's balance of each
///         token must always equal the escrowed bids (bidToken only) plus the unclaimed pull
///         ledger — i.e. no swap-driven skim, rent charge, or bid churn can conjure or lose funds.
///         Migrated onto the go-forward `MintwareDeFiPairVault` (the vault only supplies resting
///         liquidity; the auction solvency invariant is vault-independent). Phase 0.
contract MWHookCoordinatorAmAmmInvariantTest is StdInvariant, Test {
    using PoolIdLibrary for PoolKey;

    MWHookCoordinator internal coord;
    MWAmAuction internal auction;
    AmAmmSwapHandler internal handler;
    MintwareDeFiPairVault internal vault;
    MockERC20 internal usdc; MockERC20 internal proj;
    PoolKey internal poolKey; PoolId internal poolId;
    address internal c0; address internal c1;

    uint160 constant INIT_SQRT_PRICE = 79228162514264337593543950336;

    function setUp() public {
        PoolManager pm = new PoolManager(address(this));
        TestSwapRouter router = new TestSwapRouter(IPoolManager(address(pm)));
        InvSink2 sink = new InvSink2();

        usdc = new MockERC20("USD Coin", "USDC", 18);
        proj = new MockERC20("Project", "PROJ", 18);

        bytes memory args = abi.encode(IPoolManager(address(pm)), address(0), address(this));
        (address expected, bytes32 salt) =
            HookMiner.find(address(this), uint160(0xAC8), type(MWHookCoordinator).creationCode, args);
        coord = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), address(this));
        require(address(coord) == expected, "addr");

        (Currency cc0, Currency cc1) = address(usdc) < address(proj)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(proj)))
            : (Currency.wrap(address(proj)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({currency0: cc0, currency1: cc1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(coord))});
        poolId  = poolKey.toId();
        c0 = Currency.unwrap(cc0); c1 = Currency.unwrap(cc1);

        vault = new MintwareDeFiPairVault(address(pm), poolKey, PoolProfile.EMERGING, makeAddr("t"), address(this), address(this));
        coord.setVault(address(vault));
        vault.setHook(address(coord));
        vault.initializePool(INIT_SQRT_PRICE);

        // Balanced dual-sided liquidity so the fuzzed swaps trade.
        usdc.mint(address(this), 5_000_000e18);
        proj.mint(address(this), 5_000_000e18);
        IERC20(c0).approve(address(vault), type(uint256).max);
        IERC20(c1).approve(address(vault), type(uint256).max);
        vault.deposit(2_000_000e18, 2_000_000e18, 0, LockTier.Flex);

        coord.configurePool(poolId, 3000, 100000, 0, 0, false, false, 60, 6000, 10);
        auction = new MWAmAuction(address(this));
        auction.setCoordinator(address(coord));
        coord.setAuction(address(auction));
        coord.setAmAmmEnabled(poolId, true);
        auction.configurePool(poolId, address(sink), AmParams({
            enabled: true, bidToken: c0, feeMaxPips: 30_000, defaultFeePips: 3000,
            minRent: 100, K: 10, minBidMultBps: 11_000        }));
        vm.roll(1000);

        handler = new AmAmmSwapHandler(coord, auction, router, poolKey, MockERC20(c0), MockERC20(c1));
        targetContract(address(handler));
    }

    /// bidToken (c0): balance == escrowed bids + unclaimed c0 ledger.
    function invariant_c0_solvency() public view {
        (,,,, uint128 topDep) = auction.topBid(poolId);
        (,,,, uint128 nextDep) = auction.nextBid(poolId);
        assertEq(
            IERC20(c0).balanceOf(address(auction)),
            uint256(topDep) + uint256(nextDep) + handler.sumOwed(c0),
            "c0 solvent"
        );
    }

    /// c1 holds only skimmed manager fees (no escrows) → balance == unclaimed c1 ledger.
    function invariant_c1_solvency() public view {
        assertEq(IERC20(c1).balanceOf(address(auction)), handler.sumOwed(c1), "c1 solvent");
    }
}
