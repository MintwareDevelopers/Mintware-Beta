// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {Audit3FlakySource, Audit3FailableToken} from "./InvariantMocks.sol";

/// @title  Round-3 invariant-fuzzing counterexamples that need the REAL v4 stack (Suite B) — POST-FIX (2026-09-08)
/// @notice Self-skips without `LP_FORK_RPC_URL`.
///
///         F1-c  FIXED. The per-leg VIRTUAL double count in the DEPLOYED state at the production pairing (6-dp quote):
///               pre-fix `lpEntitled = S·(lpVal+V)/(ts+V)` over-stated the LP leg by S·V/(ts+V) (≈ 500,000 raw here)
///               while the liquidity removed only over-delivered V L-units (~0 quote) → 333,330 phantom shares kept
///               after a fully-paid exit. Fixed source: one offset on the whole claim → 0 shares kept.
///         F3-b  ACCEPTED (wei-level). `deploy` checks the cost-basis cap on the REQUESTED quote but increments
///               `deployedPrincipal` by the quote the mint consumed, sized from the adapter's delivery, which can exceed
///               the request by < 1 source share (F3). 2 wei over the cap on the pinned sequence; unchanged by design.
///         R3-INV-1 FIXED (second pass). The E-2 exit weight `w = holderMark(spot)` was EXITER-favourable when the LP
///               leg was the undelivered one (idle cash paid in full, the failed LP leg re-credited at the HIGH mark, so
///               only `S·idle/nav_w` shares burned for cash worth `S·idle/nav_spot` shares). The re-credit is now PER
///               LEG: a failed LP leg is re-credited against the claim at the LOW mark `min(spot, ref)`, so the exiter
///               burns `S·idle/nav_low ≥` the spot value of the cash. Numbers kept as evidence in the flipped test.
///         R3-INV-2 FIXED (second pass). Quote parked by a deferred re-stage is INSIDE `_idle()` (priced into every NAV),
///               paid FIRST on the idle leg of an exit (no source read needed) and consumed FIRST by the next deploy.
///         R3-INV-3 — NEW residual (this pass, real, in the fixed source): `_entryHigh()` reads an UNSET entry bucket
///               as a price. `_marksHigher(a, b)` guards only `b == 0`; with `a == 0` it returns `0 < b` — TRUE on a
///               quote-is-currency0 pool. A gateway created in an EVEN entry period populates bucket A only, so until
///               the first action of the next period `_entryHigh()` == 0 and `_holderMark()` == 0: the LP leg is
///               marked at sqrtPrice 0 = its RANGE-EDGE MAXIMUM quote content. Deposits in that window (≤ 300 blocks,
///               after the first deploy) are under-minted materially; the exit weight is 0 too. Reproduced below.
contract InvariantForkRegressionsTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant RH_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 constant V = 1e6;
    uint256 constant Q96 = 0x1000000000000000000000000;

    bool live;
    IPoolManager poolManager;
    IPositionManager posm;
    PoolModifyLiquidityTest lpRouter;
    PoolSwapTest swapper;
    MintwareLpGatewayPositionManager pm;
    MintwareLpGatewayStaging staging;
    MintwareERC4626YieldAdapter adapter;
    Audit3FlakySource src;
    Audit3FailableToken quote;
    Audit3FailableToken paired;
    PoolKey key;
    int24 tl;
    int24 tu;
    bool q0;
    uint256 blk;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address RECIP = address(0xFEE5);

    function setUp() public {
        string memory rpc = vm.envOr("LP_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        blk = block.number;
        poolManager = IPoolManager(RH_POOL_MANAGER);
        posm = IPositionManager(RH_POSITION_MANAGER);
        lpRouter = new PoolModifyLiquidityTest(poolManager);
        swapper = new PoolSwapTest(poolManager);
    }

    /// Default rig: creation at the START of an ODD entry-memory period (the spec path — see `_buildAt`).
    function _build(uint8 dec) internal {
        _buildAt(dec, false, false);
    }

    /// Roll to the start of the next entry-memory period of the requested parity BEFORE the PM is constructed. The
    /// PM's two entry-high buckets alternate on `block.number / ENTRY_MEMORY_BLOCKS` parity, and R3-INV-3 lives in
    /// the EVEN-creation × quote-is-currency0 corner; a live fork block would pick the parity at random per run.
    /// `forceQ0` re-rolls both token addresses (CREATE2, running salt) until `quote < paired`.
    function _buildAt(uint8 dec, bool evenPeriod, bool forceQ0) internal {
        {
            uint256 period = vm.getBlockNumber() / 300 + 1; // always roll forward
            if ((period % 2 == 0) != evenPeriod) period += 1;
            vm.roll(period * 300);
            blk = vm.getBlockNumber();
        }
        quote = new Audit3FailableToken("Quote", "Q", dec);
        paired = new Audit3FailableToken("Paired", "P", 18);
        if (forceQ0) {
            // CREATE2 with a running salt re-rolls BOTH addresses per try (a very high plain-CREATE quote address
            // would otherwise never be undercut); ~50 % per try.
            for (uint256 i; i < 64 && !(address(quote) < address(paired)); ++i) {
                quote = new Audit3FailableToken{salt: keccak256(abi.encode("q", i))}("Quote", "Q", dec);
                paired = new Audit3FailableToken{salt: keccak256(abi.encode("p", i))}("Paired", "P", 18);
            }
            require(address(quote) < address(paired), "could not place quote as currency0");
        }
        q0 = address(quote) < address(paired);
        (address c0, address c1) = q0 ? (address(quote), address(paired)) : (address(paired), address(quote));
        key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        int24 center = dec == 18 ? int24(0) : (q0 ? int24(276_300) : int24(-276_300));
        tl = center - 23_040;
        tu = center + 23_040;
        uint160 sqrtInit = TickMath.getSqrtPriceAtTick(center);
        poolManager.initialize(key, sqrtInit);

        src = new Audit3FlakySource(IERC20(address(quote)));
        adapter = new MintwareERC4626YieldAdapter(address(quote), address(src), address(0), address(this));
        staging = new MintwareLpGatewayStaging(IERC20(address(quote)), adapter);
        adapter.setVault(address(staging));
        pm = new MintwareLpGatewayPositionManager(
            poolManager, posm, IPermit2Minimal(PERMIT2), key, IERC20(address(quote)), tl, tu, staging, address(this), RECIP, 500
        );
        assertEq(pm.ENTRY_MEMORY_BLOCKS(), 300, "entry-period constant drifted - re-pin the parity roll");
        staging.setController(address(pm));

        uint256 unit = 10 ** uint256(dec);
        uint256 pAmt = 1_500_000e18;
        (uint256 a0, uint256 a1) = q0 ? (1_500_000 * unit, pAmt) : (pAmt, 1_500_000 * unit);
        uint128 L = LiquidityAmounts.getLiquidityForAmounts(
            sqrtInit, TickMath.getSqrtPriceAtTick(tl), TickMath.getSqrtPriceAtTick(tu), a0, a1
        );
        quote.mint(address(this), 100_000_000 * unit);
        paired.mint(address(this), 100_000_000e18);
        quote.approve(address(lpRouter), type(uint256).max);
        paired.approve(address(lpRouter), type(uint256).max);
        quote.approve(address(swapper), type(uint256).max);
        paired.approve(address(swapper), type(uint256).max);
        lpRouter.modifyLiquidity(key, ModifyLiquidityParams({tickLower: tl, tickUpper: tu, liquidityDelta: int256(uint256(L)), salt: 0}), "");
        quote.approve(address(pm), type(uint256).max);
        paired.approve(address(pm), type(uint256).max);
        quote.approve(address(src), type(uint256).max);
        address[2] memory us = [alice, bob];
        for (uint256 i; i < 2; ++i) {
            quote.mint(us[i], 10_000_000 * unit);
            vm.prank(us[i]);
            quote.approve(address(pm), type(uint256).max);
        }
    }

    function _roll() internal {
        blk += 1;
        vm.roll(blk);
    }

    function _spot() internal view returns (uint160 s) {
        (s,,,) = poolManager.getSlot0(key.toId());
    }

    function _p2q(uint256 pairedAmt, uint160 s) internal view returns (uint256) {
        if (pairedAmt == 0) return 0;
        if (q0) return FullMath.mulDiv(FullMath.mulDiv(pairedAmt, Q96, s), Q96, s);
        return FullMath.mulDiv(FullMath.mulDiv(pairedAmt, s, Q96), s, Q96);
    }

    /// Mirror of `_deployedQuoteValueAt` (branch by sqrtPrice, rounds down).
    function _lpVal(uint160 s) internal view returns (uint256) {
        uint128 liq = posm.getPositionLiquidity(pm.tokenId());
        if (liq == 0) return 0;
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tl);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tu);
        uint256 a0;
        uint256 a1;
        if (s <= sqrtA) a0 = SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, liq, false);
        else if (s < sqrtB) {
            a0 = SqrtPriceMath.getAmount0Delta(s, sqrtB, liq, false);
            a1 = SqrtPriceMath.getAmount1Delta(sqrtA, s, liq, false);
        } else a1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, liq, false);
        (uint256 qLeg, uint256 pLeg) = q0 ? (a0, a1) : (a1, a0);
        return qLeg + _p2q(pLeg, s);
    }

    /// Mirror of `_holderMark`: max over spot / follower / entry memory (direction-aware).
    function _holderMark(uint160 spot) internal view returns (uint160 m) {
        (uint160 ref,, uint160 high) = pm.referencePrice();
        m = spot;
        if (_marksHigher(ref, m)) m = ref;
        if (_marksHigher(high, m)) m = high;
    }

    function _marksHigher(uint160 a, uint160 b) internal view returns (bool) {
        if (b == 0) return a != 0;
        return q0 ? a < b : a > b;
    }

    /// Sell `amt` paired into the pool (pushes the paired price DOWN → the LP leg marks lower at spot).
    function _dumpPaired(uint256 amt) internal {
        bool zeroForOne = !q0; // paired is currency0 when quote is currency1
        paired.mint(address(this), amt);
        swapper.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amt),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    /// Sell quote until the pool sits just PAST the all-quote range edge (position would be one-sided: all quote).
    function _pushToAllQuoteEdge() internal {
        // quote = currency0 → all-c0 below tickLower (sqrtP <= sqrtA); quote = currency1 → all-c1 above tickUpper.
        bool zeroForOne = q0;
        uint160 limit = q0 ? TickMath.getSqrtPriceAtTick(tl) - 1 : TickMath.getSqrtPriceAtTick(tu) + 1;
        uint256 amt = 50_000_000 * 10 ** uint256(quote.decimals());
        quote.mint(address(this), amt);
        swapper.swap(
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amt), sqrtPriceLimitX96: limit}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    // ── F1-c FIXED: a fully-paid exit with a live LP leg, 6-dp quote, keeps ZERO shares ─────────────────────────
    //    Pre-fix: phantom LP entitlement 499,997 raw; bob kept 333,330 shares worth 499,992 raw after a fully-paid exit.

    function test_R3_F1c_deployedState_6dpQuote_fullyPaidExit_keepsZeroShares_FIXED() public {
        if (!live) return;
        _build(6);
        vm.prank(alice);
        pm.deposit(100_000e6);
        vm.prank(bob);
        pm.deposit(100_000e6);
        pm.deploy(100_000e6, 100_000e18, 0, block.timestamp); // 50% of principal at cost → cap full
        _roll();

        uint256 ts = pm.totalShares();
        uint256 idle = staging.stagedAssets();
        uint160 spot = _spot();
        uint160 w = _holderMark(spot);
        assertEq(w, spot, "no price move since creation: the holder mark IS spot");
        uint256 lpVal = _lpVal(w);
        uint256 S = pm.sharesOf(bob); // bob exits fully but is NOT the last holder
        uint256 fair = Math.mulDiv(S, idle + lpVal + V, ts + V); // ONE offset — the same NAV the deposit side prices against
        uint256 aliceClaimBefore = Math.mulDiv(pm.sharesOf(alice), idle + lpVal + V, ts + V);

        uint256 bQ = quote.balanceOf(bob);
        uint256 bP = paired.balanceOf(bob);
        vm.prank(bob);
        (uint256 qOut, uint256 pOut) = pm.withdraw(S);
        uint256 delivered = qOut + _p2q(pOut, w);
        assertEq(quote.balanceOf(bob) - bQ, qOut);
        assertEq(paired.balanceOf(bob) - bP, pOut);

        // Paid the single-offset claim (to the wei of two mulDiv floors per leg) — and keeps NOTHING.
        assertApproxEqAbs(delivered, fair, 4, "delivered == single-offset claim at the exit weight");
        assertEq(pm.sharesOf(bob), 0, "zero re-credit on a fully-paid exit (F1-c FIXED)");
        // Alice, who did nothing, is whole.
        uint256 navAfter = staging.stagedAssets() + _lpVal(spot);
        uint256 aliceClaimAfter = Math.mulDiv(pm.sharesOf(alice), navAfter + V, pm.totalShares() + V);
        assertGe(aliceClaimAfter + 4, aliceClaimBefore, "co-depositor's claim untouched");
        // Cost basis left with the LIQUIDITY fraction f = claimTotal/nav_w = (S/ts)*(1 + V/nav_w)/(1 + V/ts): half the
        // position, skewed from exactly 1/2 by V*(1/nav - 1/ts) (83,333 raw here, nav = 300k > ts = 200k because the
        // harness owner DONATES the paired leg at deploy, so LP value = 2x cost).
        assertApproxEqAbs(pm.deployedPrincipal(), 50_000e6, 1e6, "deployedPrincipal ~halved with the slice (offset skew < $1)");
        emit log_named_uint("delivered (raw USDG @ w)", delivered);
        emit log_named_uint("single-offset claim (raw USDG)", fair);
    }

    // ── F3-b ACCEPTED: deploy increments deployedPrincipal by the adapter's over-delivery, past the checked cap ──
    //    Bounded by ONE source share (F3); the cap is otherwise intact. Kept as evidence, unchanged by design.

    function test_R3_F3b_deployCostBasisExceedsRequest_viaAdapterOverDelivery_ACCEPTED() public {
        if (!live) return;
        _build(18);
        // Owner accretion with ts == 0 (no depositors yet) lands in the source and mints an ODD number of source
        // shares; a donation lifts the offset-0 share price so ceil/floor stop cancelling on a cap-sized request.
        pm.compoundQuote(10_000e18 + 1);
        src.simulateYield(27_000e18); // source price ≈ 3.7 quote per source share
        uint256 srcPrice = Math.ceilDiv(src.totalAssets() + 1, src.totalSupply() + 1);
        assertGt(srcPrice, 2, "offset-0 source price above 2 after the donation");

        uint256 q = (staging.stagedAssets() * pm.MAX_DEPLOY_BPS()) / 10_000; // exactly the cap
        uint256 predicted = src.previewRedeem(src.previewWithdraw(q));
        assertGt(predicted, q, "the cap-sized request is over-delivered by the adapter");
        pm.deploy(q, 2 * q, 0, block.timestamp);

        uint256 dp = pm.deployedPrincipal();
        assertGt(dp, q, "deployedPrincipal rose by MORE than the requested (cap-checked) quote");
        assertLe(dp - q, srcPrice, "excess is bounded by one source share (F3 over-delivery)");
        uint256 principal = staging.stagedAssets() + dp;
        assertGt(dp, (principal * pm.MAX_DEPLOY_BPS()) / 10_000, "cost basis sits ABOVE MAX_DEPLOY_BPS of principal (wei-level, accepted)");
        assertLe(dp - (principal * pm.MAX_DEPLOY_BPS()) / 10_000, srcPrice, "...by less than one source share");
        emit log_named_uint("requested quote (wei)", q);
        emit log_named_uint("deployedPrincipal after (wei)", dp);
        emit log_named_uint("cost basis over the cap (wei)", dp - (principal * pm.MAX_DEPLOY_BPS()) / 10_000);
    }

    // ── R3-INV-1 FIXED: LP leg deferred + exit weight above spot → idle cash is now priced at the LOW mark ────────
    //    Sequence (6-dp quote, the production shape): two depositors; deploy 50 %; the paired token dumps (a third
    //    party — or the exiter, before the outage); the paired token is PAUSED by its issuer (the F-02 / RT-6 case the
    //    best-effort LP leg exists for); bob withdraws half his shares.
    //    Pre-fix: reCredit = S·lpVal_w/nav_w (HIGH mark) → burned 16,666,666,667 shares for 24,999,958,333 raw of idle
    //    cash worth 18,985,010,765 shares at spot → 2,318,344,098 excess shares kept, bob +$1,665 / alice −$1,665.
    //    Fixed: the failed LP leg is re-credited at min(spot, ref) → reCredit = S·lpEntLow/(fromIdle + lpEntLow), so
    //    burned = S·idle/nav_low ≥ the spot value of the cash (18,985,019,568 ≥ 18,985,010,765 in the lead's run).

    function test_R3_INV1_lpLegDeferred_exitWeightAboveSpot_idleLegPricedAtLowMark_FIXED() public {
        if (!live) return;
        _build(6);
        vm.prank(alice);
        pm.deposit(100_000e6);
        vm.prank(bob);
        pm.deposit(100_000e6);
        pm.deploy(100_000e6, 100_000e18, 0, block.timestamp);
        _roll();

        // Paired dumps ~40 %: spot moves, the follower/memory keep the pre-dump mark (no gateway action stepped it).
        _dumpPaired(500_000e18);
        uint160 spot = _spot();
        uint160 w = _holderMark(spot);
        assertTrue(w != spot, "holder mark above spot after the dump");
        uint256 lpValW = _lpVal(w);
        uint256 lpValS = _lpVal(spot);
        assertGt(lpValW, lpValS, "LP leg marks higher at w than at spot");
        (uint160 ref,,) = pm.referencePrice();
        uint256 lpValLow = Math.min(lpValS, _lpVal(ref)); // the contract's LOW mark for a failed LP leg
        assertEq(lpValLow, lpValS, "after a dump the low mark is spot");

        // Issuer pauses the paired token → the LP leg of every exit fails and is re-credited (by design, F-02 / RT-6).
        paired.setPaused(true);

        uint256 ts = pm.totalShares();
        uint256 idle = staging.stagedAssets() + quote.balanceOf(address(pm)); // `_idle()` incl. parked (0 here)
        uint256 bal = pm.sharesOf(bob);
        uint256 S = bal / 2;
        uint256 navS = idle + lpValS;
        uint256 navW = idle + lpValW;
        uint256 claimBalS = Math.mulDiv(bal, navS + V, ts + V); // bob's whole claim at SPOT before
        uint256 aliceBeforeS = Math.mulDiv(pm.sharesOf(alice), navS + V, ts + V);

        uint256 bQ = quote.balanceOf(bob);
        vm.prank(bob);
        (uint256 qOut, uint256 pOut) = pm.withdraw(S);
        assertEq(pOut, 0, "LP leg deferred (paired paused)");
        assertEq(quote.balanceOf(bob) - bQ, qOut);
        // Idle cash = claimTotal_w · idle / nav_w — the SPLIT is still at the holder mark (unchanged by design).
        uint256 claimTotalW = Math.mulDiv(S, navW + V, ts + V);
        uint256 fromIdle = FullMath.mulDiv(claimTotalW, idle, navW);
        assertEq(qOut, fromIdle, "idle leg paid per the w-weighted split");

        // Per-leg re-credit: the failed LP leg is sized at the LOW mark → exact shadow of the fixed formula.
        uint256 lpEntLow = FullMath.mulDiv(claimTotalW, lpValLow, navW);
        uint256 reCreditExpected = FullMath.mulDiv(S, lpEntLow, fromIdle + lpEntLow);
        uint256 burned = bal - pm.sharesOf(bob);
        assertEq(burned, S - reCreditExpected, "re-credit == S*lpEntLow/(fromIdle + lpEntLow) (per-leg, low mark)");
        // ...which is at least what the SAME cash is worth at spot: bob is no longer favoured.
        uint256 fairBurnAtSpot = Math.mulDiv(qOut, ts + V, navS + V, Math.Rounding.Ceil);
        assertGe(burned, fairBurnAtSpot, "bob burns >= the spot value of his idle cash (R3-INV-1 FIXED)");
        // The excess is the VIRTUAL-offset term only — burned/fair = nav_w(nav_s+V)/(nav_s(nav_w+V)), i.e.
        // fair·V·(nav_w − nav_s)/(nav_s·nav_w) ≈ 8,803 shares ($0.0088) here — pool-favourable and immaterial.
        uint256 offsetTerm = FullMath.mulDiv(fairBurnAtSpot, (navW - navS) * V, navS * navW);
        assertApproxEqAbs(burned - fairBurnAtSpot, offsetTerm, 16, "...and only the virtual-offset term more");
        // Evidence numbers (lead's run: 18,985,019,568 burned vs 18,985,010,765 fair — 8,803 apart; pre-fix burn
        // was 16,666,666,667, i.e. 2,318,344,098 shares short of the spot value).
        assertApproxEqAbs(burned, 18_985_019_568, 64, "burn matches the recorded fixed-source number");
        assertApproxEqAbs(fairBurnAtSpot, 18_985_010_765, 64, "fair burn matches the recorded number");

        // Scope inv. 2 at spot: bob's post-exit claim + cash never exceeds his whole pre-exit claim; alice is whole.
        uint256 navAfterS = staging.stagedAssets() + quote.balanceOf(address(pm)) + _lpVal(spot);
        uint256 tsAfter = pm.totalShares();
        uint256 bobAfterS = Math.mulDiv(pm.sharesOf(bob), navAfterS + V, tsAfter + V);
        assertLe(bobAfterS + qOut, claimBalS + 4, "bob's spot claim + cash <= his whole pre-exit spot claim");
        uint256 aliceAfterS = Math.mulDiv(pm.sharesOf(alice), navAfterS + V, tsAfter + V);
        assertGe(aliceAfterS + 4, aliceBeforeS, "alice (no action) is not diluted");
        emit log_named_uint("idle cash out (raw USDG)", qOut);
        emit log_named_uint("shares burned (per-leg re-credit, low mark)", burned);
        emit log_named_uint("shares that cash is worth at spot", fairBurnAtSpot);
        emit log_named_uint("pre-fix burn (S*idle/nav_w, high mark)", FullMath.mulDiv(S, fromIdle, claimTotalW));
        emit log_named_uint("alice's spot claim before / after", aliceBeforeS);
        emit log_named_uint("  ...after", aliceAfterS);
        emit log_named_uint("lpVal at w / at spot (raw USDG)", lpValW);
        emit log_named_uint("  ...at spot", lpValS);
    }

    // ── Invariant 15 guard (new): a one-sided mint at the range edge is refused DeployNotTwoSided ────────────────
    //    The economic-model worst case for a compromised owner seat: walk the follower to the range edge (one bounded
    //    step per block — `poke()` is permissionless) and mint an ALL-QUOTE position, then dump into it. In-range mints
    //    are balanced by construction (`getLiquidityForAmounts` takes the binding leg), so the guard only ever bites
    //    out of range — which is exactly the attack shape. Not reachable by the 8x24 campaign (needs ~25 follower
    //    steps); pinned here.

    function test_R3_INV15_outOfRangeDeploy_allQuoteMint_refused_DeployNotTwoSided() public {
        if (!live) return;
        _build(6);
        vm.prank(alice);
        pm.deposit(100_000e6);
        _roll();
        _pushToAllQuoteEdge();
        uint160 spot = _spot();
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tl);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tu);
        assertTrue(q0 ? spot <= sqrtA : spot >= sqrtB, "pool sits past the all-quote edge");

        // Band check first: the follower is ~3x away (sqrtPrice), so an immediate deploy is OUT OF BAND (A-3).
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployPriceOutOfBand.selector);
        pm.deploy(10_000e6, 0, 0, block.timestamp);

        // Walk the follower onto spot: one 5 % step per block via the permissionless poke.
        for (uint256 i; i < 40; ++i) {
            _roll();
            pm.poke();
        }
        (uint160 ref,,) = pm.referencePrice();
        uint160 diff = spot > ref ? spot - ref : ref - spot;
        assertLe(diff, (uint256(ref) * 500) / 10_000, "follower walked into band");

        // Now the band passes and the mint would be ALL QUOTE (paired leg 0) → refused by invariant 15.
        _roll();
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployNotTwoSided.selector);
        pm.deploy(10_000e6, 0, 0, block.timestamp);
        // ...also when the owner OFFERS paired: it is not used out of range, and the check is on USED amounts.
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployNotTwoSided.selector);
        pm.deploy(10_000e6, 10_000e18, 0, block.timestamp);
        assertEq(pm.tokenId(), 0, "no position minted");
        assertEq(pm.deployedPrincipal(), 0);
        assertEq(staging.stagedAssets(), 100_000e6, "staged capital untouched (the failed deploy reverted the unstage)");
    }

    // ── R3-2 deferred re-stage → R3-INV-2 FIXED: the parked leftover is INSIDE NAV, paid first, consumed first ────
    //    The live RH-mainnet state (Morpho `maxDeposit == 0`) used to DoS every deploy. The LP add now succeeds and the
    //    leftover waits in the PM. Pre-fix it sat OUTSIDE NAV until the next deploy re-staged it: a depositor entering
    //    then was priced cheap and gained 6,534,014,548 raw (his ⅓ of the 19,927,837,633 parked) when it landed; an
    //    exiter forfeited their slice. Fixed: `_idle()` = staged + parked, so (a) `totalNav` counts it, (b) an exit's
    //    idle leg is paid FROM the parked quote first (no source read — pays even during an outage), (c) a depositor
    //    is priced against the parked-inclusive NAV and gains nothing when it is re-staged (lead's run: 277,664,919 raw
    //    = his share of the owner's DONATED paired leg on the 1k deploy, vs the 4,979,971,247 pre-fix floor), (d) the
    //    next deploy consumes the parked quote before touching the reserve.

    function test_R3_R32_restageDeferred_leftoverParked_insideNav_paidFirst_consumedFirst_FIXED() public {
        if (!live) return;
        _build(6);
        vm.prank(alice);
        pm.deposit(100_000e6);
        _roll();
        // Source closes at its cap (Morpho maxDeposit == 0). NB: `deploy` UNSTAGES first, which re-opens exactly that
        // much headroom under a balance-pegged cap — so close it HARD (absolute 1) to model a source that stays full.
        src.setSupplyCap(1);
        assertEq(src.maxDeposit(address(adapter)), 0);
        // Deploy 50k quote but only 30k of paired → the balanced mint uses ~30k of each; ~20k quote is left over.
        pm.deploy(50_000e6, 30_000e18, 0, block.timestamp);
        uint256 parked = quote.balanceOf(address(pm));
        assertGt(parked, 15_000e6, "leftover parked in the PM (RestageDeferred)");
        assertLt(parked, 25_000e6);
        uint256 dp = pm.deployedPrincipal();
        assertApproxEqAbs(dp, 50_000e6 - parked, 2, "cost basis = quote that actually went into the LP");
        // (a) NAV INCLUDES the parked quote (R3-INV-2 FIXED): staged + parked + LP.
        uint256 staged = staging.stagedAssets();
        assertEq(pm.totalNav(), staged + parked + _lpVal(_spot()), "totalNav == staged + parked + LP at spot");
        _roll();

        // (b) An exiter's idle leg is paid from the PARKED quote first — with the source unreadable (RT-5f outage) the
        //     idle leg still delivers from it. Paired paused too, so the exit is idle-only and the accounting exact.
        src.setRevertPreview(true);
        paired.setPaused(true);
        {
            uint256 ts = pm.totalShares();
            uint256 S = pm.sharesOf(alice) / 10;
            uint256 idleHaircut = (pm.lastKnownIdle() * (10_000 - pm.OUTAGE_HAIRCUT_BPS())) / 10_000; // R3-1 fallback
            uint256 aQ = quote.balanceOf(alice);
            vm.prank(alice);
            (uint256 qOut, uint256 pOut) = pm.withdraw(S);
            assertEq(pOut, 0, "LP leg deferred (paired paused)");
            assertGt(qOut, 0, "idle leg DELIVERED during the outage - from the parked quote");
            assertEq(quote.balanceOf(alice) - aQ, qOut);
            assertEq(parked - quote.balanceOf(address(pm)), qOut, "paid entirely out of the parked quote");
            assertLe(qOut, idleHaircut * S / ts + 2, "sized off the haircut fallback, as an outage exit must be");
            emit log_named_uint("outage exit: idle cash paid from parked quote (raw USDG)", qOut);
            parked = quote.balanceOf(address(pm));
        }
        src.setRevertPreview(false);
        paired.setPaused(false);
        _roll();

        // (c) A depositor entering while ~19k is still parked is priced against the parked-INCLUSIVE NAV (the source
        //     re-opens with room for his deposit only — the leftover is not re-staged until the next deploy)...
        src.setSupplyCap(src.totalAssets() + 50_000e6);
        uint256 navBefore = pm.totalNav();
        uint256 tsBefore = pm.totalShares();
        vm.prank(bob);
        uint256 bobShares = pm.deposit(50_000e6);
        assertEq(quote.balanceOf(address(pm)), parked, "deposit does not pick the leftover up");
        assertEq(bobShares, Math.mulDiv(50_000e6, tsBefore + V, navBefore + V), "priced against NAV incl. parked");
        uint256 sharesIfExcluded = Math.mulDiv(50_000e6, tsBefore + V, navBefore - parked + V);
        assertGt(sharesIfExcluded, bobShares + bobShares / 10, "pre-fix (parked outside NAV) would have minted >10% more");
        uint256 bobClaimParked = Math.mulDiv(bobShares, pm.totalNav() + V, pm.totalShares() + V);
        assertApproxEqAbs(bobClaimParked, 50_000e6, 4, "priced at the stated NAV");
        _roll();

        // (d) ...the source re-opens and the next deploy CONSUMES the parked quote first (nothing unstaged for it),
        //     re-stages the rest, and bob's claim moves only by his share of the deploy's own value change (the
        //     harness owner DONATES the paired leg) — never by his share of the parked quote.
        src.setSupplyCap(0);
        uint256 stagedBefore = staging.stagedAssets();
        uint256 lpBefore = _lpVal(_spot());
        pm.deploy(1_000e6, 1_000e18, 0, block.timestamp);
        assertEq(quote.balanceOf(address(pm)), 0, "leftover re-staged by the next deploy (source open)");
        uint256 stagedAfter = staging.stagedAssets();
        assertGe(stagedAfter + 2, stagedBefore + parked - 1_000e6, "the deploy's quote came from the parked leftover, not the reserve");
        assertLe(stagedAfter, stagedBefore + parked - 1_000e6 + 2);
        uint256 bobClaimAfter = Math.mulDiv(pm.sharesOf(bob), pm.totalNav() + V, pm.totalShares() + V);
        uint256 gain = bobClaimAfter > bobClaimParked ? bobClaimAfter - bobClaimParked : 0;
        uint256 lpGain = _lpVal(_spot()) - lpBefore; // value the owner's donated paired leg added
        assertLe(gain, Math.mulDiv(lpGain, pm.sharesOf(bob), pm.totalShares()) + 4, "gain bounded by his share of the donated leg");
        assertLt(gain, Math.mulDiv(parked, bobShares, pm.totalShares()) / 10, "NOT his fraction of the parked quote (R3-INV-2 FIXED)");
        emit log_named_uint("parked leftover (raw USDG)", parked);
        emit log_named_uint("bob's claim while parked / after re-stage (raw USDG)", bobClaimParked);
        emit log_named_uint("  ...after re-stage", bobClaimAfter);
        emit log_named_uint("bob's gain (owner-donated leg only; pre-fix floor 4,979,971,247)", gain);
        emit log_named_uint("pre-fix mint if parked were outside NAV / actual", sharesIfExcluded);
        emit log_named_uint("  ...actual", bobShares);
    }

    // ── R3-INV-3 (NEW residual, this pass): an UNSET entry bucket is read as the extreme mark on a q0 pool ─────────
    //    `_marksHigher(a, b)` returns `a < b` when quote is currency0 and only guards `b == 0`. A gateway created in an
    //    EVEN entry period (`block.number / ENTRY_MEMORY_BLOCKS`) writes bucket A only; `_entryHigh()` then compares
    //    `_marksHigher(_entryHighB == 0, A)` → TRUE → returns 0, and `_holderMark()` does the same against spot → 0.
    //    sqrtPrice 0 marks the LP leg at its range-edge MAXIMUM quote content (~2.1× spot value on this ±23,040-tick
    //    range), so until the first action of the next period every deposit after the first deploy is under-minted
    //    and every exit is weighted at 0. Window ≤ 300 blocks; hits ~¼ of gateways (even parity × quote < paired).

    /// FIXED (round-3 R3-INV-3): `_marksHigher` treats 0 as "unset, not a price" on both sides, so a gateway created in
    /// an EVEN period (only bucket A written) no longer reads the empty odd bucket as sqrtPrice 0 on a quote-is-currency0
    /// pool. Pre-fix (same rig): entryHigh == 0 for the whole first period, the LP leg marked at its range-edge maximum
    /// (~2x), bob minted 38,727,404,218 shares vs 66,666,888,888 at spec (-42 %), alice gained 30,209,449,569.
    function test_R3_INV3_entryMemoryUnsetBucket_zeroHolderMark_quoteIsCurrency0_depositsUnderMinted_FIXED() public {
        if (!live) return;
        _buildAt(6, true, true); // EVEN creation period, quote is currency0
        assertTrue(q0, "quote is currency0");
        (uint160 ref0,, uint160 high0) = pm.referencePrice();
        assertTrue(ref0 != 0, "follower anchored at creation");
        assertEq(high0, ref0, "entryHigh == the anchored reference right after creation (unset bucket ignored)");

        vm.prank(alice);
        pm.deposit(100_000e6);
        _roll();
        pm.deploy(50_000e6, 50_000e18, 0, block.timestamp);
        _roll();
        (uint160 ref,, uint160 high1) = pm.referencePrice();
        uint160 spot = _spot();
        assertEq(ref, spot);
        assertEq(high1, spot, "memory holds a real price, never 0");

        // Bob deposits 100k: minted against NAV(idle + lpSpot) — the spec mark (no price move ⇒ spot == ref == memory).
        uint256 idle = staging.stagedAssets() + quote.balanceOf(address(pm));
        uint256 ts = pm.totalShares();
        uint256 predSpec = Math.mulDiv(100_000e6, ts + V, idle + _lpVal(spot) + V);
        uint256 aliceBefore = Math.mulDiv(pm.sharesOf(alice), pm.totalNav() + V, ts + V);
        vm.prank(bob);
        uint256 bobShares = pm.deposit(100_000e6);
        assertEq(bobShares, predSpec, "minted against the spec mark");
        uint256 bobClaim = Math.mulDiv(bobShares, pm.totalNav() + V, pm.totalShares() + V);
        uint256 aliceAfter = Math.mulDiv(pm.sharesOf(alice), pm.totalNav() + V, pm.totalShares() + V);
        assertApproxEqAbs(bobClaim, 100_000e6, 2e6, "bob's spot claim is what he paid (offset dust)");
        assertApproxEqAbs(aliceAfter, aliceBefore, 2e6, "alice neither gains nor loses from bob's entry");
    }

    /// Boundary: the same q0 pool created in an ODD period has no window — bucket B is written first and
    /// `_marksHigher(B, 0)` takes the `b == 0` guard. (And a quote-is-currency1 pool never has one: `0 > x` is false.)
    function test_R3_INV3_oddCreationPeriod_noZeroMarkWindow() public {
        if (!live) return;
        _buildAt(6, false, true);
        assertTrue(q0);
        (,, uint160 high) = pm.referencePrice();
        assertTrue(high != 0, "odd creation period: entryHigh populated from creation");
        vm.prank(alice);
        pm.deposit(100_000e6);
        _roll();
        pm.deploy(50_000e6, 50_000e18, 0, block.timestamp);
        _roll();
        uint160 spot = _spot();
        assertEq(_holderMark(spot), spot, "holder mark == spec mark");
        uint256 idle = staging.stagedAssets() + quote.balanceOf(address(pm));
        uint256 pred = Math.mulDiv(100_000e6, pm.totalShares() + V, idle + _lpVal(spot) + V);
        vm.prank(bob);
        assertEq(pm.deposit(100_000e6), pred, "deposit priced at the spec mark");
    }
}
