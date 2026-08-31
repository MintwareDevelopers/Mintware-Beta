// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// =============================================================================
// MWAmAmmRedTeam - adversarial economic sweep of the DeFi pair-vault am-AMM path.
//
// The treasury JIT hook had am-AMM shelved; the DeFi hook (MWHookCoordinator, flags
// 0xAC8) still carries the manager-fee skim (`POOL_MANAGER.take` + non-zero
// `toBeforeSwapDelta`) and the beforeSwapReturnDelta bit. This suite attacks the four
// theses the invariant tests (which run against a MOCK pool manager, never a real V4
// swap) cannot reach:
//   T1  skim delta mis-accounting - pool/vault left short, or exact-output leak
//   T2  auction griefing - revert-on-receive manager blocks eviction/promotion
//   T3  rent -> LP accounting - rent skipped-not-deferred on a reverting sink
//   T4  ordering / value conservation across a real managed swap
//
// Built on the same real-PoolManager harness as MWHookCoordinatorAmAmm.t.sol.
// =============================================================================

import {Test} from "forge-std/Test.sol";

import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback}     from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}        from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams}          from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}            from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary}        from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IERC20}              from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}           from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {HookMiner}               from "../src/lib/HookMiner.sol";
import {MWHookCoordinator}       from "../src/hooks/MWHookCoordinator.sol";
import {MWAmAuction, IAmAmmRentSink} from "../src/hooks/MWAmAuction.sol";
import {AmParams}                from "../src/hooks/MWAmAuctionLib.sol";
import {MintwareDeFiPairVault}   from "../src/vaults/MintwareDeFiPairVault.sol";
import {PoolProfile, LockTier}   from "../src/vaults/VaultTypes.sol";

import {MockERC20}      from "./mocks/MockERC20.sol";
import {TestSwapRouter} from "./helpers/TestSwapRouter.sol";

/// @dev Passive rent sink that actually pulls the rent (mirrors the pair vault's fundRent intake).
contract PullSink is IAmAmmRentSink {
    using SafeERC20 for IERC20;
    function fundRent(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
}

/// @dev Sink that reverts on the rent push - models a paused / hostile pair-vault fundRent.
contract RevertingSink is IAmAmmRentSink {
    bool public reverting = true;
    function setReverting(bool v) external { reverting = v; }
    function fundRent(address token, uint256 amount) external {
        if (reverting) revert("sink down");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }
}

/// @dev A manager that is a CONTRACT with no value-receiving fallback - used to prove
///      refunds are pull-based and can never brick eviction/promotion.
contract HostileManager {
    function place(MWAmAuction a, PoolId id, IERC20 t, uint24 fee, uint128 rent, uint128 dep) external {
        t.approve(address(a), dep);
        a.bid(id, fee, rent, dep);
    }
    // deliberately no receive()/fallback that accepts value; reverts on ETH.
}

/// @dev Minimal exact-OUTPUT router (TestSwapRouter is exact-input only). amountSpecified > 0.
contract ExactOutRouter is IUnlockCallback {
    using SafeERC20 for IERC20;
    IPoolManager public immutable pm;
    struct D { PoolKey key; bool zeroForOne; int256 amountOut; address caller; }
    constructor(IPoolManager _pm) { pm = _pm; }

    function swapExactOut(PoolKey memory key, bool zeroForOne, uint256 amountOut, uint256 maxIn)
        external returns (BalanceDelta delta)
    {
        Currency tin = zeroForOne ? key.currency0 : key.currency1;
        IERC20(Currency.unwrap(tin)).safeTransferFrom(msg.sender, address(this), maxIn);
        bytes memory res = pm.unlock(abi.encode(D(key, zeroForOne, int256(amountOut), msg.sender)));
        delta = abi.decode(res, (BalanceDelta));
        uint256 leftover = IERC20(Currency.unwrap(tin)).balanceOf(address(this));
        if (leftover > 0) IERC20(Currency.unwrap(tin)).safeTransfer(msg.sender, leftover);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "only pm");
        D memory d = abi.decode(data, (D));
        SwapParams memory p = SwapParams({
            zeroForOne: d.zeroForOne,
            amountSpecified: d.amountOut, // POSITIVE => exact output
            sqrtPriceLimitX96: d.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
        BalanceDelta delta = pm.swap(d.key, p, "");
        _settle(d.key.currency0, delta.amount0(), d.caller);
        _settle(d.key.currency1, delta.amount1(), d.caller);
        return abi.encode(delta);
    }

    function _settle(Currency c, int128 amt, address recipient) internal {
        if (amt < 0) {
            pm.sync(c);
            IERC20(Currency.unwrap(c)).safeTransfer(address(pm), uint256(uint128(-amt)));
            pm.settle();
        } else if (amt > 0) {
            pm.take(c, recipient, uint256(uint128(amt)));
        }
    }
}

contract MWAmAmmRedTeamTest is Test {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    address internal deployer = address(this);
    address internal alice    = makeAddr("alice");
    address internal mgr      = makeAddr("mgr");
    address internal attacker = makeAddr("attacker");
    address internal treasury = makeAddr("treasury");

    PoolManager    internal pm;
    TestSwapRouter internal swapRouter;
    ExactOutRouter internal outRouter;
    MWHookCoordinator internal coord;
    MWAmAuction    internal auction;
    PullSink       internal sink;
    MintwareDeFiPairVault internal vault;

    MockERC20 internal usdc;
    MockERC20 internal proj;

    PoolKey internal poolKey;
    PoolId  internal poolId;
    Currency internal c0;
    Currency internal c1;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    uint24  internal constant MGR_FEE_PIPS = 10_000; // 1%

    function setUp() public {
        pm         = new PoolManager(deployer);
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        outRouter  = new ExactOutRouter(IPoolManager(address(pm)));
        sink       = new PullSink();

        usdc = new MockERC20("USD Coin", "USDC", 18);
        proj = new MockERC20("Project", "PROJ", 18);

        bytes memory args = abi.encode(IPoolManager(address(pm)), address(0), deployer);
        (address expected, bytes32 salt) =
            HookMiner.find(deployer, uint160(0xAC8), type(MWHookCoordinator).creationCode, args);
        coord = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), deployer);
        require(address(coord) == expected, "coord addr");

        (c0, c1) = address(usdc) < address(proj)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(proj)))
            : (Currency.wrap(address(proj)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(coord))});
        poolId  = poolKey.toId();

        vault = new MintwareDeFiPairVault(address(pm), poolKey, PoolProfile.EMERGING, treasury, deployer, deployer);
        coord.setVault(address(vault));
        vault.setHook(address(coord));
        vault.initializePool(INIT_SQRT_PRICE);

        usdc.mint(alice, 5_000_000e18);
        proj.mint(alice, 5_000_000e18);
        usdc.mint(mgr, 1_000_000e18);
        usdc.mint(attacker, 1_000_000e18);
        proj.mint(attacker, 1_000_000e18);
        vm.startPrank(alice);
        IERC20(Currency.unwrap(c0)).approve(address(vault), type(uint256).max);
        IERC20(Currency.unwrap(c1)).approve(address(vault), type(uint256).max);
        vault.deposit(2_000_000e18, 2_000_000e18, 0, LockTier.Flex);
        vm.stopPrank();

        // guard OFF to isolate the skim
        coord.configurePool(poolId, 3000, 100000, 0, 0, false, false, 60, 6000, 10);

        auction = new MWAmAuction(deployer);
        auction.setCoordinator(address(coord));
        coord.setAuction(address(auction));
        coord.setAmAmmEnabled(poolId, true);
        auction.configurePool(poolId, address(sink), AmParams({
            enabled: true, bidToken: address(usdc), feeMaxPips: 30_000, defaultFeePips: 3000,
            minRent: 100, K: 10, minBidMultBps: 11_000
        }));

        vm.roll(1000);
    }

    function _seatManager() internal {
        vm.startPrank(mgr);
        usdc.approve(address(auction), 1000);
        auction.bid(poolId, MGR_FEE_PIPS, 100, 1000); // rent 100, deposit 1000 = rent*K
        vm.stopPrank();
        vm.roll(block.number + 10);
    }

    function _swapExactIn(address who, bool zeroForOne, uint256 amountIn) internal {
        vm.startPrank(who);
        (zeroForOne ? IERC20(Currency.unwrap(c0)) : IERC20(Currency.unwrap(c1)))
            .approve(address(swapRouter), amountIn);
        swapRouter.swap(poolKey, zeroForOne, amountIn);
        vm.stopPrank();
    }

    // ===================================================================
    // T1 / T4 - value conservation on a REAL managed exact-input swap.
    //   The existing integration test only checks the auction gained `fee`.
    //   Here we prove the POOL IS NOT LEFT SHORT: the trader pays the FULL
    //   input (incl. the skim), the PoolManager's input reserve rises by
    //   exactly amountIn - fee, and NO token is conjured anywhere.
    // ===================================================================
    function test_T1_exactInput_pool_not_shorted_full_conservation() public {
        _seatManager();
        address specTok = Currency.unwrap(c0); // exact-in zeroForOne => specified = c0
        address outTok  = Currency.unwrap(c1);
        uint256 amountIn = 10_000e18;
        uint256 fee = (amountIn * MGR_FEE_PIPS) / 1_000_000;

        uint256 pmSpecBefore  = IERC20(specTok).balanceOf(address(pm));
        uint256 pmOutBefore   = IERC20(outTok).balanceOf(address(pm));
        uint256 auctBefore    = IERC20(specTok).balanceOf(address(auction));
        uint256 traderSpecB   = IERC20(specTok).balanceOf(alice);
        uint256 traderOutB    = IERC20(outTok).balanceOf(alice);

        _swapExactIn(alice, true, amountIn);

        uint256 traderPaid    = traderSpecB - IERC20(specTok).balanceOf(alice);
        uint256 traderGot     = IERC20(outTok).balanceOf(alice) - traderOutB;
        uint256 auctGained    = IERC20(specTok).balanceOf(address(auction)) - auctBefore;
        uint256 pmSpecGained  = IERC20(specTok).balanceOf(address(pm)) - pmSpecBefore;
        uint256 pmOutPaid     = pmOutBefore - IERC20(outTok).balanceOf(address(pm));

        assertEq(traderPaid, amountIn, "trader pays full input incl skim");
        assertEq(auctGained, fee, "auction got exactly the skim");
        assertEq(pmSpecGained, amountIn - fee, "pool input reserve = amountIn - fee (not shorted)");
        assertEq(pmOutPaid, traderGot, "pool output == trader received (nothing conjured)");
        assertEq(traderPaid, auctGained + pmSpecGained, "specified-token conservation");
    }

    // ===================================================================
    // T1 - the DEFAULT guard: exact-output is rejected on a managed pool.
    // ===================================================================
    function test_T1_exactOutput_rejected_by_default() public {
        _seatManager();
        vm.startPrank(attacker);
        IERC20(Currency.unwrap(c0)).approve(address(outRouter), type(uint256).max);
        vm.expectRevert(); // ExactOutputNotSupported bubbles up through the unlock
        outRouter.swapExactOut(poolKey, true, 1_000e18, 2_000e18);
        vm.stopPrank();
    }

    // ===================================================================
    // T1 - the UN-FUZZED path: owner flips allowExactOutput ON. Prove the
    //   exact-output skim still conserves (auction gains exactly the fee in
    //   the OUTPUT token; pool not short; nothing conjured). If this leaks,
    //   it is a CONFIRMED finding on an owner-flippable config.
    // ===================================================================
    function test_T1_exactOutput_enabled_conserves() public {
        _seatManager();
        coord.setAllowExactOutput(poolId, true);

        // exact-out zeroForOne => specified currency = c1 (the OUTPUT). skim is in c1.
        address specTok = Currency.unwrap(c1);
        address inTok   = Currency.unwrap(c0);
        uint256 amountOut = 1_000e18;
        uint256 fee = (amountOut * MGR_FEE_PIPS) / 1_000_000;

        uint256 auctBefore   = IERC20(specTok).balanceOf(address(auction));
        uint256 pmInBefore   = IERC20(inTok).balanceOf(address(pm));
        uint256 pmOutBefore  = IERC20(specTok).balanceOf(address(pm));
        uint256 trInBefore   = IERC20(inTok).balanceOf(attacker);
        uint256 trOutBefore  = IERC20(specTok).balanceOf(attacker);

        vm.startPrank(attacker);
        IERC20(inTok).approve(address(outRouter), type(uint256).max);
        outRouter.swapExactOut(poolKey, true, amountOut, 5_000e18);
        vm.stopPrank();

        uint256 auctGain = IERC20(specTok).balanceOf(address(auction)) - auctBefore;
        uint256 pmInGain = IERC20(inTok).balanceOf(address(pm)) - pmInBefore;
        uint256 pmOutPaid = pmOutBefore - IERC20(specTok).balanceOf(address(pm));
        uint256 trInPaid = trInBefore - IERC20(inTok).balanceOf(attacker);
        uint256 trOutGot = IERC20(specTok).balanceOf(attacker) - trOutBefore;

        assertEq(auctGain, fee, "exact-out skim == fee in output token");
        assertEq(trOutGot, amountOut, "trader gets full requested output");
        assertEq(pmOutPaid, trOutGot + auctGain, "pool paid output = trader + skim");
        assertEq(trInPaid, pmInGain, "input conserved: trader paid == pool gained");
    }

    // ===================================================================
    // T4 - attacker cannot self-manage to skim their OWN swap for free.
    //   The attacker seats as manager, trades their own pool at 0 LP fee,
    //   reclaims their own skim, and pays only rent. Proves NO value is
    //   conjured: total token holdings (sum, ~1:1 price at init) can only
    //   DROP by the pool spread + rent - never rise.
    // ===================================================================
    function test_T4_self_manager_cannot_extract() public {
        vm.startPrank(attacker);
        usdc.approve(address(auction), 1000);
        auction.bid(poolId, MGR_FEE_PIPS, 100, 1000);
        vm.stopPrank();
        vm.roll(block.number + 10);

        uint256 sumBefore = usdc.balanceOf(attacker) + proj.balanceOf(attacker);

        _swapExactIn(attacker, true, 50_000e18); // exact-in c0; skim is in c0

        // reclaim whichever token the skim landed in (c0)
        vm.prank(attacker);
        auction.claim(Currency.unwrap(c0));

        uint256 sumAfter = usdc.balanceOf(attacker) + proj.balanceOf(attacker);
        // Value conservation (init price ~1:1): a self-manager cannot end with MORE tokens
        // than they started - the skim is refunded but it was paid by them as the trader.
        assertLe(sumAfter, sumBefore, "self-manager cannot net-extract value");
    }

    // ===================================================================
    // T2 - a CONTRACT manager cannot grief eviction/promotion.
    // ===================================================================
    function test_T2_hostile_contract_manager_evicted_and_replaced() public {
        HostileManager hm = new HostileManager();
        usdc.mint(address(hm), 1000);
        vm.prank(address(hm));
        hm.place(auction, poolId, IERC20(address(usdc)), MGR_FEE_PIPS, 100, 1000); // 10 blocks of rent
        vm.roll(2000);

        _swapExactIn(alice, true, 1_000e18); // promotes hm
        (address topMgr,,,,) = auction.topBid(poolId);
        assertEq(topMgr, address(hm), "hostile contract manager seated");

        // Seat an honest challenger that out-bids hm BEFORE hm depletes (hm still top here).
        vm.startPrank(mgr);
        usdc.approve(address(auction), 2000);
        auction.bid(poolId, MGR_FEE_PIPS, 200, 2000); // 200 > 100*1.1 => valid challenger
        vm.stopPrank();
        (address chal,,,,) = auction.nextBid(poolId);
        assertEq(chal, address(mgr), "honest challenger queued");

        // Let hm's prepaid rent deplete AND the challenger's K-notice elapse.
        vm.roll(2100);

        // A swap now must NOT brick: it evicts the depleted hostile contract manager and
        // promotes the honest challenger. Refunds are pull-based so hm's contract-ness is moot.
        _swapExactIn(alice, true, 1_000e18);
        (address newTop,,,,) = auction.topBid(poolId);
        assertEq(newTop, address(mgr), "honest manager promoted; hostile contract did not brick the auction");
    }

    // ===================================================================
    // T2 - displaced-challenger deposit cannot be stolen; auction stays solvent.
    // ===================================================================
    function test_T2_displaced_deposit_not_stealable() public {
        _seatManager(); // mgr is top (rent 100)

        vm.startPrank(alice);
        usdc.mint(alice, 10_000);
        usdc.approve(address(auction), 2000);
        auction.bid(poolId, MGR_FEE_PIPS, 200, 2000);
        vm.stopPrank();

        vm.startPrank(attacker);
        usdc.approve(address(auction), 3000);
        auction.bid(poolId, MGR_FEE_PIPS, 300, 3000);
        vm.stopPrank();

        assertEq(auction.owed(alice, address(usdc)), 2000, "displaced escrow credited to owner");
        assertEq(auction.owed(attacker, address(usdc)), 0, "attacker credited nothing");

        vm.prank(attacker);
        vm.expectRevert(MWAmAuction.NothingToClaim.selector);
        auction.claim(address(usdc));

        uint256 b = usdc.balanceOf(alice);
        vm.prank(alice);
        auction.claim(address(usdc));
        assertEq(usdc.balanceOf(alice) - b, 2000, "honest challenger recovers exactly its escrow");

        (,,,, uint128 topDep)  = auction.topBid(poolId);
        (,,,, uint128 nextDep) = auction.nextBid(poolId);
        uint256 owedMgr  = auction.owed(mgr, address(usdc));
        uint256 owedAtt  = auction.owed(attacker, address(usdc));
        assertEq(
            usdc.balanceOf(address(auction)),
            uint256(topDep) + uint256(nextDep) + owedMgr + owedAtt,
            "auction solvent after displacement"
        );
    }

    // ===================================================================
    // T3 (FIX) - rent -> LP: on a reverting sink the M7 rollback now DEFERS the
    //   rent (rolls `lastCharged` BACK) instead of skipping it. On sink recovery
    //   the whole held window is charged and paid to the LP. Scope: only reachable
    //   via a reverting sink (paused/hostile pair vault) - NOT attacker-triggerable.
    // ===================================================================
    function test_T3_reverting_sink_defers_rent_charged_on_recovery() public {
        RevertingSink rsink = new RevertingSink();
        rsink.setReverting(false); // start healthy
        MWAmAuction a2 = new MWAmAuction(deployer);
        a2.setCoordinator(deployer); // deployer acts as coordinator for direct poke() calls
        a2.configurePool(poolId, address(rsink), AmParams({
            enabled: true, bidToken: address(usdc), feeMaxPips: 30_000, defaultFeePips: 3000,
            minRent: 100, K: 10, minBidMultBps: 11_000
        }));

        usdc.mint(mgr, 2000);
        vm.startPrank(mgr);
        usdc.approve(address(a2), 2000);
        a2.bid(poolId, MGR_FEE_PIPS, 100, 2000); // rent 100/block, deposit 2000 = 20 blocks
        vm.stopPrank();

        // Promote at block 2000 (past K); clock resets to 2000.
        vm.roll(2000);
        a2.poke(poolId);
        (address top,,,, uint128 depPromote) = a2.topBid(poolId);
        assertEq(top, mgr, "seated");
        assertEq(depPromote, 2000, "full deposit at promotion");
        assertEq(a2.lastCharged(poolId), 2000, "clock at promotion block");

        // --- SINK DOWN for the window [2000, 2005]. Poke at 2005: rent 500 owed, push fails, rolled back.
        rsink.setReverting(true);
        vm.roll(2005);
        a2.poke(poolId);
        (,,,, uint128 depDown) = a2.topBid(poolId);
        assertEq(depDown, 2000, "M7: rent rolled back while sink down (deposit intact)");
        // FIX: lastCharged is rolled BACK to 2000 - the un-charged window is DEFERRED, not lost.
        assertEq(a2.lastCharged(poolId), 2000, "lastCharged rolled back (rent deferred, not skipped)");

        // --- SINK RECOVERS. Poke at 2010: the WHOLE held window [2000,2010] (1000) is now chargeable.
        rsink.setReverting(false);
        uint256 lpBefore = usdc.balanceOf(address(rsink));
        vm.roll(2010);
        a2.poke(poolId);
        (,,,, uint128 depFinal) = a2.topBid(poolId);
        uint256 lpGot = usdc.balanceOf(address(rsink)) - lpBefore;

        // The manager held the slot for 10 blocks [2000,2010] and pays rent for ALL 10 - deferred, not skipped.
        assertEq(lpGot, 1000, "LP receives the FULL rent for the whole window (deferred outage rent recovered)");
        assertEq(uint256(depPromote) - uint256(depFinal), 1000, "manager charged 1000 for the full 10 blocks held");
    }
}
