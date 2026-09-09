// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
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

/// @dev No-op target so a non-live (no RPC) run has something to fuzz and every invariant self-skips.
contract Audit3NoopTarget {
    function noop(uint256) external {}
}

/// @title  Round-3 stateful invariant fuzzing — LP gateway PositionManager on the REAL v4 stack (Suite B)
/// @notice Robinhood-testnet fork (self-skips without `LP_FORK_RPC_URL`). The handler owns the PM + adapter (owner
///         seat), drives 4 depositors, third-party swaps + external LP through the official v4 test routers, the
///         adapter cap, source outage / stall / donation, a pausable paired token and a freezable fee recipient.
///         Every gateway call is predicted from pre-state and its revert selector compared; every successful
///         withdraw / deploy / harvest is checked against a SHADOW computation (pro-rata liquidity slice, accrued
///         fees from feeGrowthInside, principal amounts from SqrtPriceMath, cost basis, clamped follower via slot 7).
///         Scope-§6 invariants encoded: 1, 2, 3, 6, 7, 9 (LP leg), 10, 16 (+ solvency / share conservation).
///
///         Post-fix (2026-09-08) harness deltas — models the ROUND-3-FIXED source:
///           - follower anchored at CREATION (`_folPost` no longer expects "no reference without a position");
///           - deposit shares priced with the LP leg at the HOLDER mark `max(spot, ref, entryHigh)` (direction-aware,
///             read from `referencePrice()`), and `StageShortfall` / the source's `ERC4626ExceededMaxDeposit` predicted;
///           - exit: ONE virtual offset on the whole claim at weight `w = holderMark(spot)`, capped at what exists,
///             legs split by un-offset weights, `liqToRemove = min(liq, liq·lpEntitled/lpVal_w)`, cost basis leaves by
///             the LIQUIDITY fraction; outage → idle entitlement = 80 % of `lastKnownIdle` (R3-1 haircut);
///           - deploy: `DeployNotTwoSided` predicted from the round-up mint amounts; leftover re-stage into a
///             supply-capped source → `RestageDeferred` (quote parked in the PM, outside NAV, until the next deploy);
///           - B2 compares against the actor's WHOLE pre-exit claim (the pinned check compared remaining-vs-withdrawn).
///
///         Second post-fix pass (R3-INV-1 / R3-INV-2 fixed in the source) — harness deltas:
///           - idle / NAV INCLUDE the quote parked in the PM by a deferred re-stage (`_idle()` = staged + balance);
///             deploy consumes the parked quote FIRST; the exit's idle leg is paid from parked first (also during an
///             outage), and the principal-slice check credits `parkedOut` next to `srcOut`;
///           - exact PER-LEG re-credit shadow (idle shortfall at the HIGH mark `w`, a failed LP leg at the LOW mark
///             `min(spot, ref)`, everything back when nothing was delivered, capped at `shares`) — B2 asserts it;
///           - a third-party token failure INSIDE a v4 take (paused paired, fees > 0) surfaces as ERC-7751
///             `WrappedError` (v4-core `CurrencyLibrary.transfer`), not `Error(string)` — harvest / deploy predict it;
///           - block clock: `_roll` re-syncs from `vm.getBlockNumber()` and every action re-reads it first. A handler
///             FRAME that reverted after `_roll` used to roll `blk` back while the cheatcode's `block.number` stayed
///             advanced (B7 "stepped wrong" / B9 `SameBlockAction` mispredictions were this, not the source); the
///             witness now asserts no handler frame ever reverts;
///           - R3-INV-3 (NEW, real — see InvariantForkRegressions): `_entryHigh()` returns 0 when only bucket A is
///             populated on a quote-is-currency0 pool (`_marksHigher(0, x)` is true there), so `_holderMark` == 0 ⇒
///             the LP leg is marked at its range-edge MAXIMUM. The mirror reproduces it (predictions still match);
///             `_p2q(x, 0)` is guarded; B8 asserts mark == spec mark; the rig is built at a deterministic ODD entry
///             period (spec path) — `A3_FORK_PERIOD_PARITY=even` builds it in the residual's window instead.
contract ForkLpHandler is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 internal constant V = 1e6;
    uint256 internal constant Q96 = 0x1000000000000000000000000;
    uint256 internal constant Q128 = 0x100000000000000000000000000000000;
    uint256 internal constant N = 4;
    bytes4 internal constant ERROR_STRING = 0x08c379a0;
    /// ERC-7751 wrap v4-core puts around a failing token call inside `take`/`settle` (`CustomRevert.bubbleUpAndRevertWith`).
    /// Earn-vs-lp decision (2026-09-08): the paired leg now comes from an in-contract pool swap whose output
    /// this harness cannot compute without re-implementing v4's swap math, so a ZAPPING deploy's MINT outcome is
    /// deliberately unpredicted. Every other prediction on the deploy path (cap, band, source outage, paused /
    /// frozen third-party tokens) stays exact, and a NON-zapping deploy (swapAmount == 0) stays exactly predicted.
    /// TODO(needs review): restoring an exact mint prediction needs a swap-output model (a v4 quoter read against
    /// the same `sqrtPriceLimitX96` the PM uses) -- worth doing before the external audit relies on this harness
    /// for the zap path.
    bytes4 internal constant UNPREDICTABLE = 0xfffffffe;
    bytes4 internal constant WRAPPED = bytes4(keccak256("WrappedError(address,bytes4,bytes,bytes)"));
    bytes4 internal constant SRC_CAP = bytes4(keccak256("ERC4626ExceededMaxDeposit(address,uint256,uint256)")); // OZ 4626 supply cap

    IPoolManager public poolManager;
    IPositionManager public posm;
    MintwareLpGatewayPositionManager public pm;
    MintwareLpGatewayStaging public staging;
    MintwareERC4626YieldAdapter public adapter;
    Audit3FlakySource public src;
    Audit3FailableToken public quote;
    Audit3FailableToken public paired;
    PoolKey internal key;
    PoolSwapTest public swapper;
    PoolModifyLiquidityTest public lpRouter;
    address public recip;
    int24 public tl;
    int24 public tu;
    bool public q0;
    uint8 public quoteDec;
    uint16 public band;

    address[4] public actors = [address(0xA11CE), address(0xB0B), address(0xCA201), address(0xDA7E)];
    uint256 public blk;
    mapping(address => uint256) internal lastAct;
    int256 internal extLiq; // handler's own third-party liquidity (salt 1)

    // shadows
    uint256 public dpShadow;

    // violation counters
    uint256 public unexpectedReverts;
    string public lastUnexpectedAction;
    bytes4 public lastUnexpectedSelector;
    uint256 public expectedRevertButSucceeded;
    string public lastExpectedButOkAction;
    uint256 public predictionMismatch;
    uint256 public proRataViolations;
    uint256 public lpLegFailedUnexpectedly;
    uint256 public feeOrderingViolations;
    uint256 public principalSliceViolations;
    uint256 public capViolations;
    uint256 public dpDriftViolations;
    uint256 public followerViolations;
    uint256 public reCreditViolations;
    uint256 public valueConservationViolations;
    uint256 public lastHolderViolations;
    uint256 public pairedToQuoteReverts;

    // witnesses
    uint256 public nDeposits;
    uint256 public nWithdraws;
    uint256 public nWithdrawsWithLp;
    uint256 public nDeploys;
    uint256 public nHarvests;
    uint256 public nSwaps;
    uint256 public nPokes;
    uint256 public nLastHolderExits;
    uint256 public nLpLegDeferred; // LP leg re-credited under a third-party failure (paused paired / frozen recipient)
    uint256 public nOutageWithdraws;
    uint256 public nFollowerSteps;
    uint256 public maxPhantomReCredit;
    uint256 public nStageShortfalls;
    uint256 public nSourceCapRefusals; // deposit/compound refused by the capped source (ERC4626ExceededMaxDeposit)
    uint256 public nTwoSidedRefusals; // deploy refused DeployNotTwoSided
    uint256 public nRestageDeferred; // deploy left quote parked in the PM (source at cap)
    uint256 public maxStuckQuote; // largest quote balance parked in the PM outside NAV
    uint256 public nEntryMarkAboveSpot; // deposits where the holder mark (ref / memory) beat spot
    uint256 public nExitWeightAboveSpot;
    uint256 public stuckViolations; // quote parked in the PM although the source had room (or vice versa)
    // B2 attribution (post-fix residual R3-INV-1): violations that coincide with a DEFERRED LP leg + `w != spot`.
    uint256 public reCreditViolLpDeferredWeightGap;
    uint256 public reCreditViolOther;
    uint256 public maxReCreditExcess; // largest (claimAfter + delivered) − claimBal, quote units at spot
    // second pass
    uint256 public reCreditShadowViolations; // re-credited shares != the per-leg formula (R3-INV-1 fix, exact)
    uint256 public markSpecViolations; // contract holder mark != spec mark max(spot, ref, entryHigh≠0) (R3-INV-3)
    uint256 public nZeroMarkDeposits; // deposits priced at holder mark 0 (R3-INV-3 window)
    uint256 public nZeroMarkExits; // exits weighted at holder mark 0 (R3-INV-3 window)
    uint256 public nParkedPaid; // exits whose idle leg was (partly) paid from the PM's parked quote
    uint256 public nDeployFromParked; // deploys that consumed parked quote before unstaging
    uint256 public nOutageParkedPaid; // outage exits that still delivered idle from parked quote
    uint256 public nZeroValueExits; // claimTotal == 0 exits: nothing to deliver, every share returned (value-neutral)
    // diagnostics — the LAST violation of each class, so a witness run can name the call instead of a count
    bytes4 public lastExpectedSelector; // what the handler predicted for `lastUnexpectedAction`
    bytes4 public lastExpectedButOkSelector; // the revert that was predicted but did not happen
    string public lastMismatchAction;
    uint256 public lastMismatchGot;
    uint256 public lastMismatchPred;
    string public lastFollowerAction;
    uint160 public lastFolRefBefore;
    uint160 public lastFolRefAfter;
    uint160 public lastFolExpected;
    uint160 public lastFolSpot;
    uint64 public lastFolRefBlockBefore;
    uint64 public lastFolRefBlockAfter;
    uint64 public lastFolBlk;

    struct Rig {
        IPoolManager poolManager;
        IPositionManager posm;
        MintwareLpGatewayPositionManager pm;
        MintwareLpGatewayStaging staging;
        MintwareERC4626YieldAdapter adapter;
        Audit3FlakySource src;
        Audit3FailableToken quote;
        Audit3FailableToken paired;
        PoolKey key;
        PoolSwapTest swapper;
        PoolModifyLiquidityTest lpRouter;
        address recip;
        int24 tl;
        int24 tu;
        uint8 quoteDec;
        uint16 band;
    }

    function init(Rig memory r) external {
        poolManager = r.poolManager;
        posm = r.posm;
        pm = r.pm;
        staging = r.staging;
        adapter = r.adapter;
        src = r.src;
        quote = r.quote;
        paired = r.paired;
        key = r.key;
        swapper = r.swapper;
        lpRouter = r.lpRouter;
        recip = r.recip;
        tl = r.tl;
        tu = r.tu;
        quoteDec = r.quoteDec;
        band = r.band;
        q0 = Currency.unwrap(key.currency0) == address(quote);
        blk = vm.getBlockNumber();
        quote.approve(address(pm), type(uint256).max);
        paired.approve(address(pm), type(uint256).max);
        quote.approve(address(swapper), type(uint256).max);
        paired.approve(address(swapper), type(uint256).max);
        quote.approve(address(lpRouter), type(uint256).max);
        paired.approve(address(lpRouter), type(uint256).max);
        quote.approve(address(src), type(uint256).max);
        for (uint256 i; i < N; ++i) {
            vm.prank(actors[i]);
            quote.approve(address(pm), type(uint256).max);
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────

    /// Block clock. `blk` mirrors `block.number` but is re-synced from the cheatcode on every roll, and `_tick`
    /// re-reads it at the start of every gateway action: a handler FRAME that reverts after a `_roll` has its storage
    /// (`blk`) rolled back while the `vm.roll` env change persists, so a plain `blk += n` counter drifts one block
    /// behind the chain forever (that drift produced the B7 / B9 `SameBlockAction` false alarms). `vm.getBlockNumber()`
    /// is an external call, so via-IR cannot CSE it across `vm.roll` the way it can `block.number`.
    function _roll(uint256 n) internal {
        blk = vm.getBlockNumber() + n;
        vm.roll(blk);
    }

    function _tick(bool sameBlock) internal {
        blk = vm.getBlockNumber();
        if (!sameBlock) _roll(1);
    }

    /// Quote parked in the PM by a deferred re-stage (R3-2) — depositor principal, inside NAV since R3-INV-2.
    function _parked() internal view returns (uint256) {
        return quote.balanceOf(address(pm));
    }

    /// Spec holder mark (scope inv. 8 / XR-1): the holder-favourable extreme of spot, the follower and a POPULATED
    /// entry memory. An unset bucket (0) is not a price. Compared against the contract's own `_holderMark` mirror.
    function _specMark(uint160 spot) internal view returns (uint160 m) {
        (uint160 ref,, uint160 high) = _refView();
        m = spot;
        if (ref != 0 && _marksHigher(ref, m)) m = ref;
        if (high != 0 && _marksHigher(high, m)) m = high;
    }

    function _unit() internal view returns (uint256) {
        return 10 ** uint256(quoteDec);
    }

    function _spot() internal view returns (uint160 s) {
        (s,,,) = poolManager.getSlot0(key.toId());
    }

    /// `_refSqrtPrice` (uint160) + `_refBlock` (uint64) pack in slot 7 — probed via vm.load.
    function _refRaw() internal view returns (uint160 ref, uint64 refBlock) {
        uint256 raw = uint256(vm.load(address(pm), bytes32(uint256(7))));
        ref = uint160(raw);
        refBlock = uint64(raw >> 160);
    }

    function _liq() internal view returns (uint128) {
        uint256 id = pm.tokenId();
        if (id == 0) return 0;
        return posm.getPositionLiquidity(id);
    }

    /// Mirror of the PM's `_idle()`: staged reserve + quote parked in the PM (R3-INV-2), or unreadable.
    function _readable() internal view returns (bool ok, uint256 idle) {
        try staging.stagedAssets() returns (uint256 v) {
            return (true, v + _parked());
        } catch {
            return (false, 0);
        }
    }

    function _sel(bytes memory ret) internal pure returns (bytes4 s) {
        if (ret.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            s := mload(add(ret, 32))
        }
    }

    function _srcPriceCeil() internal view returns (uint256) {
        return Math.ceilDiv(src.totalAssets() + 1, src.totalSupply() + 1);
    }

    /// Mirror of the source's fee-net `previewRedeem` at an arbitrary (tA, tS).
    function _srcNetAt(uint256 shares, uint256 tA, uint256 tS) internal view returns (uint256) {
        uint256 gross = Math.mulDiv(shares, tA + 1, tS + 1);
        return gross - Math.mulDiv(gross, src.exitFeeBps(), 10_000);
    }

    /// XR-3: the staged reserve must grow by ≥ amt·(1 − STAGE_TOLERANCE_BPS) or the PM reverts `StageShortfall`.
    function _predictStageShortfall(uint256 amt, uint256 idleBefore) internal view returns (bool) {
        uint256 tA = src.totalAssets();
        uint256 tS = src.totalSupply();
        uint256 m = src.previewDeposit(amt);
        uint256 idleAfter = _srcNetAt(src.balanceOf(address(adapter)) + m, tA + amt, tS + m);
        return idleAfter < idleBefore + amt - (amt * pm.STAGE_TOLERANCE_BPS()) / 10_000;
    }

    /// The follower + entry-mark memory as the PM exposes them (`referencePrice()`).
    function _refView() internal view returns (uint160 ref, uint64 refBlock, uint160 high) {
        (ref, refBlock, high) = pm.referencePrice();
    }

    /// Mirror of `_marksHigher`: `a` values the LP leg higher than `b` (quote = currency0 ⇒ lower sqrtPrice is dearer).
    function _marksHigher(uint160 a, uint160 b) internal view returns (bool) {
        if (b == 0) return a != 0;
        return q0 ? a < b : a > b;
    }

    /// Mirror of `_holderMark`: the most holder-favourable of spot, the follower and the entry memory.
    function _holderMark(uint160 spot) internal view returns (uint160 m) {
        (uint160 ref,, uint160 high) = _refView();
        m = spot;
        if (_marksHigher(ref, m)) m = ref;
        if (_marksHigher(high, m)) m = high;
    }

    /// v4-core mint amounts for `liq` at the current tick — rounded UP (what SETTLE_PAIR actually pulls).
    function _amountsByTickUp(uint160 sqrtP, int24 tick, uint128 liq) internal view returns (uint256 amount0, uint256 amount1) {
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tl);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tu);
        if (liq == 0) return (0, 0);
        if (tick < tl) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, liq, true);
        } else if (tick < tu) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtP, sqrtB, liq, true);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtP, liq, true);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, liq, true);
        }
    }

    /// Mirror of the PM's `_amountsForLiquidity` (rounds down).
    function _amounts(uint160 sqrtP, uint128 liq) internal view returns (uint256 amount0, uint256 amount1) {
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tl);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tu);
        if (liq == 0) return (0, 0);
        if (sqrtP <= sqrtA) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, liq, false);
        } else if (sqrtP < sqrtB) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtP, sqrtB, liq, false);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtP, liq, false);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, liq, false);
        }
    }

    /// v4-core's own branch selection uses the CURRENT TICK, not the sqrtPrice — mirror it for the principal-slice check.
    function _amountsByTick(uint160 sqrtP, int24 tick, uint128 liq) internal view returns (uint256 amount0, uint256 amount1) {
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tl);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tu);
        if (liq == 0) return (0, 0);
        if (tick < tl) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, liq, false);
        } else if (tick < tu) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtP, sqrtB, liq, false);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtP, liq, false);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, liq, false);
        }
    }

    function _p2q(uint256 pairedAmt, uint160 s) internal view returns (uint256) {
        if (pairedAmt == 0) return 0;
        if (q0) {
            uint256 inter = FullMath.mulDiv(pairedAmt, Q96, s);
            return FullMath.mulDiv(inter, Q96, s);
        } else {
            uint256 inter = FullMath.mulDiv(pairedAmt, s, Q96);
            return FullMath.mulDiv(inter, s, Q96);
        }
    }

    /// Quote-value of the whole position at `s` (mirror of `_deployedQuoteValueAt`).
    function _lpVal(uint160 s) internal view returns (uint256) {
        uint128 liq = _liq();
        if (liq == 0) return 0;
        (uint256 a0, uint256 a1) = _amounts(s, liq);
        (uint256 qLeg, uint256 pLeg) = q0 ? (a0, a1) : (a1, a0);
        return qLeg + _p2q(pLeg, s);
    }

    /// Accrued, uncollected fees of the gateway position (quote, paired) — the shadow for H-02.
    function _accruedFees() internal view returns (uint256 feeQ, uint256 feeP) {
        uint256 id = pm.tokenId();
        if (id == 0) return (0, 0);
        PoolId pid = key.toId();
        (uint128 liq, uint256 fg0Last, uint256 fg1Last) =
            poolManager.getPositionInfo(pid, address(posm), tl, tu, bytes32(id));
        if (liq == 0) return (0, 0);
        (uint256 fg0, uint256 fg1) = poolManager.getFeeGrowthInside(pid, tl, tu);
        uint256 d0;
        uint256 d1;
        unchecked {
            d0 = fg0 - fg0Last;
            d1 = fg1 - fg1Last;
        }
        uint256 f0 = FullMath.mulDiv(d0, liq, Q128);
        uint256 f1 = FullMath.mulDiv(d1, liq, Q128);
        (feeQ, feeP) = q0 ? (f0, f1) : (f1, f0);
    }

    function _toAssets(uint256 shares, uint256 total, uint256 ts) internal pure returns (uint256) {
        return Math.mulDiv(shares, total + V, ts + V);
    }

    function claimOf(address a) public view returns (uint256) {
        uint256 ts = pm.totalShares();
        if (ts == 0) return 0;
        return _toAssets(pm.sharesOf(a), pm.totalNav(), ts);
    }

    function sumShares() public view returns (uint256 s) {
        for (uint256 i; i < N; ++i) {
            s += pm.sharesOf(actors[i]);
        }
    }

    function sumClaims() public view returns (uint256 s) {
        for (uint256 i; i < N; ++i) {
            s += claimOf(actors[i]);
        }
    }

    function _record(string memory action, bytes4 got, bytes4 expect) internal {
        if (expect == UNPREDICTABLE) return; // zapping deploy: any outcome is admissible (see UNPREDICTABLE)
        if (got != expect) {
            unexpectedReverts++;
            lastUnexpectedAction = action;
            lastUnexpectedSelector = got;
            lastExpectedSelector = expect;
        }
    }

    function _recordOk(string memory action, bytes4 expect) internal {
        if (expect == UNPREDICTABLE) return;
        if (expect != bytes4(0)) {
            expectedRevertButSucceeded++;
            lastExpectedButOkAction = action;
            lastExpectedButOkSelector = expect;
        }
    }

    function _mismatch(string memory action, uint256 got, uint256 pred) internal {
        predictionMismatch++;
        lastMismatchAction = action;
        lastMismatchGot = got;
        lastMismatchPred = pred;
    }

    // ── follower (scope inv. 7) ─────────────────────────────────────────────────────────────

    struct Fol {
        uint160 ref;
        uint64 refBlock;
        uint256 tokenId;
    }

    function _folPre() internal view returns (Fol memory f) {
        (f.ref, f.refBlock) = _refRaw();
        f.tokenId = pm.tokenId();
    }

    /// After any successful gateway path: exactly one clamped step toward spot, at most once per block. Post-fix
    /// (XR-2): the reference is anchored at CREATION and the follower runs from creation — there is never an unset
    /// reference, with or without a position (the old "no reference without a position" rule is gone).
    function _folPost(Fol memory f, string memory action) internal {
        (uint160 refA, uint64 refBlockA) = _refRaw();
        uint160 spot = _spot();
        if (f.ref == 0 || refA == 0) {
            _folViolation(action, f, refA, refBlockA, 0, spot); // never unset after construction
            return;
        }
        if (f.refBlock == uint64(blk)) {
            if (refA != f.ref) _folViolation(action, f, refA, refBlockA, f.ref, spot); // at most one step per block
            return;
        }
        uint160 maxStep = uint160((uint256(f.ref) * band) / 10_000);
        uint160 expected;
        if (spot > f.ref) expected = (spot - f.ref) > maxStep ? f.ref + maxStep : spot;
        else expected = (f.ref - spot) > maxStep ? f.ref - maxStep : spot;
        if (refA != expected || refBlockA != uint64(blk)) _folViolation(action, f, refA, refBlockA, expected, spot);
        if (refA != f.ref) nFollowerSteps++;
    }

    function _folViolation(string memory action, Fol memory f, uint160 refA, uint64 refBlockA, uint160 expected, uint160 spot)
        internal
    {
        followerViolations++;
        lastFollowerAction = action;
        lastFolRefBefore = f.ref;
        lastFolRefAfter = refA;
        lastFolExpected = expected;
        lastFolSpot = spot;
        lastFolRefBlockBefore = f.refBlock;
        lastFolRefBlockAfter = refBlockA;
        lastFolBlk = uint64(blk);
    }

    // ── actions: depositors ─────────────────────────────────────────────────────────────────

    function deposit(uint256 aSeed, uint256 amtSeed, bool sameBlock, uint8 minMode) external {
        address a = actors[aSeed % N];
        uint256 amt = bound(amtSeed, 0, 500_000 * _unit());
        _tick(sameBlock);
        (bool readable, uint256 idle) = _readable(); // staged + parked (R3-INV-2)
        uint256 ts = pm.totalShares();
        uint256 pred;
        if (readable) {
            uint256 navDep = idle;
            if (pm.tokenId() != 0) {
                // Post-fix: LP leg at the HOLDER mark — max over spot, the clamped follower AND the entry-mark memory
                // (XR-1 / E-1), direction-aware. Mirrors `_navDepositStrict` → `_holderMark(_spot())`.
                uint160 spot = _spot();
                uint160 m = _holderMark(spot);
                if (m != spot) nEntryMarkAboveSpot++;
                if (m == 0) nZeroMarkDeposits++; // R3-INV-3: unset entry bucket read as the extreme mark
                if (m != _specMark(spot)) markSpecViolations++;
                navDep += _lpVal(m);
            }
            pred = Math.mulDiv(amt, ts + V, navDep + V);
        }
        bool useMin = minMode % 3 != 0;
        uint256 minOut = useMin ? (minMode % 3 == 2 ? pred + 1 : pred) : 0;

        bytes4 expect;
        if (pm.paused()) expect = MintwareLpGatewayPositionManager.DepositsPaused.selector;
        else if (amt == 0) expect = MintwareLpGatewayPositionManager.ZeroAmount.selector;
        else if (lastAct[a] == blk) expect = MintwareLpGatewayPositionManager.SameBlockAction.selector;
        else if (!readable) expect = MintwareLpGatewayPositionManager.SourceUnavailable.selector;
        else if (pred == 0) expect = MintwareLpGatewayPositionManager.ZeroShares.selector;
        else if (useMin && pred < minOut) expect = MintwareLpGatewayPositionManager.SlippageExceeded.selector;
        else if (amt > src.maxDeposit(address(adapter))) expect = SRC_CAP; // source at cap: stage reverts
        else if (_predictStageShortfall(amt, idle - _parked())) expect = MintwareLpGatewayPositionManager.StageShortfall.selector;

        Fol memory f = _folPre();
        uint256 dp = pm.deployedPrincipal();
        quote.mint(a, amt);
        bytes memory cd = useMin
            ? abi.encodeWithSelector(pm.depositWithMin.selector, amt, minOut)
            : abi.encodeWithSelector(pm.deposit.selector, amt);
        vm.prank(a);
        (bool ok, bytes memory ret) = address(pm).call(cd);
        if (!ok) {
            _record("deposit", _sel(ret), expect);
            if (_sel(ret) == MintwareLpGatewayPositionManager.StageShortfall.selector) nStageShortfalls++;
            if (_sel(ret) == SRC_CAP) nSourceCapRefusals++;
            return;
        }
        _recordOk("deposit", expect);
        if (abi.decode(ret, (uint256)) != pred) _mismatch("deposit shares", abi.decode(ret, (uint256)), pred);
        lastAct[a] = blk;
        nDeposits++;
        if (pm.deployedPrincipal() != dp) dpDriftViolations++;
        _folPost(f, "deposit");
    }

    struct WPre {
        address a;
        uint256 bal;
        uint256 shares;
        bool readable;
        uint256 idle;
        uint256 ts;
        bool lastHolder;
        uint160 spot;
        uint160 w; // exit weight = holder mark (post-fix E-2)
        int24 tick;
        uint128 liq;
        uint256 lpSpotVal; // LP leg valued at `w` (the contract's `lpSpotVal` variable is the value AT THE WEIGHT)
        uint256 claimTotal; // the contract's claim (at w)
        uint256 lpValS; // LP leg valued at SPOT — the value checks (B2 / B16) are done at spot
        uint256 claimTotalS; // spot-valued claim of the S withdrawn shares
        uint256 claimBalS; // spot-valued claim of the actor's WHOLE balance — the B2 baseline
        uint256 fromIdle;
        uint256 lpEntitled;
        uint128 liqToRemove;
        uint256 dp;
        uint256 feeQ;
        uint256 feeP;
        uint256 aQ;
        uint256 aP;
        uint256 rQ;
        uint256 rP;
        uint256 srcBal;
        uint256 srcP;
        uint256 pmQ; // quote parked in the PM before the exit (paid out FIRST on the idle leg — R3-INV-2)
        uint160 ref; // follower BEFORE the call — the re-credit's low mark reads it before `_anchorFollow` steps
    }

    function withdraw(uint256 aSeed, uint256 shSeed, bool sameBlock) external {
        WPre memory w;
        w.a = actors[aSeed % N];
        w.bal = pm.sharesOf(w.a);
        w.shares = bound(shSeed, 0, w.bal + 1);
        _tick(sameBlock);

        (w.readable, w.idle) = _readable(); // staged + parked (R3-INV-2)
        if (!w.readable) {
            // R3-1: outage → the idle entitlement is sized off `lastKnownIdle` HAIRCUT by OUTAGE_HAIRCUT_BPS.
            w.idle = (pm.lastKnownIdle() * (10_000 - pm.OUTAGE_HAIRCUT_BPS())) / 10_000;
            nOutageWithdraws++;
        }
        w.ts = pm.totalShares();
        w.lastHolder = w.shares > 0 && w.shares == w.ts;
        if (pm.tokenId() != 0) {
            (w.spot, w.tick,,) = poolManager.getSlot0(key.toId());
            w.w = _holderMark(w.spot);
            if (w.w != w.spot) nExitWeightAboveSpot++;
            if (w.w == 0) nZeroMarkExits++; // R3-INV-3 window: the LP leg is weighted at its range-edge maximum
            if (w.w != _specMark(w.spot)) markSpecViolations++;
            w.liq = _liq();
            w.lpSpotVal = _lpVal(w.w);
            w.lpValS = _lpVal(w.spot);
        }
        // Post-fix F1 entitlement: ONE offset on the whole claim at the weight, capped at what exists; legs split by
        // un-offset weights; the liquidity slice is the SAME fraction of the position as the LP value slice.
        {
            uint256 navW = w.idle + w.lpSpotVal;
            w.claimTotal = w.lastHolder ? navW : Math.min(navW, _toAssets(w.shares, navW, w.ts));
            uint256 navS = w.idle + w.lpValS;
            w.claimTotalS = w.lastHolder ? navS : Math.min(navS, _toAssets(w.shares, navS, w.ts));
            w.claimBalS = w.lastHolder ? navS : Math.min(navS, _toAssets(w.bal, navS, w.ts));
            w.fromIdle = w.lastHolder ? w.idle : (navW == 0 ? 0 : FullMath.mulDiv(w.claimTotal, w.idle, navW));
            w.lpEntitled = w.claimTotal - w.fromIdle;
            w.liqToRemove = w.lastHolder
                ? w.liq
                : (w.lpSpotVal == 0 ? 0 : uint128(Math.min(uint256(w.liq), FullMath.mulDiv(w.liq, w.lpEntitled, w.lpSpotVal))));
        }
        w.dp = pm.deployedPrincipal();
        (w.feeQ, w.feeP) = _accruedFees();
        w.aQ = quote.balanceOf(w.a);
        w.aP = paired.balanceOf(w.a);
        w.rQ = quote.balanceOf(recip);
        w.rP = paired.balanceOf(recip);
        w.srcBal = quote.balanceOf(address(src));
        w.srcP = w.readable ? _srcPriceCeil() : 0;
        w.pmQ = _parked();
        (w.ref,) = _refRaw();

        bytes4 expect;
        if (w.shares == 0) expect = MintwareLpGatewayPositionManager.ZeroAmount.selector;
        else if (w.shares > w.bal) expect = MintwareLpGatewayPositionManager.InsufficientShares.selector;
        else if (lastAct[w.a] == blk) expect = MintwareLpGatewayPositionManager.SameBlockAction.selector;
        else if (!w.readable && w.liqToRemove == 0) expect = MintwareLpGatewayPositionManager.SourceUnavailable.selector;
        // Everything else MUST succeed — paired paused, recipient frozen, source stalled, adapter capped (scope inv. 9).

        Fol memory f = _folPre();
        bytes memory cd = abi.encodeWithSelector(pm.withdraw.selector, w.shares);
        vm.prank(w.a);
        (bool ok, bytes memory ret) = address(pm).call(cd);
        if (!ok) {
            _record("withdraw", _sel(ret), expect);
            return;
        }
        _recordOk("withdraw", expect);
        (uint256 qOut, uint256 pOut) = abi.decode(ret, (uint256, uint256));
        lastAct[w.a] = blk;
        nWithdraws++;
        _folPost(f, "withdraw");
        _checkWithdraw(w, qOut, pOut);
    }

    function _checkWithdraw(WPre memory w, uint256 qOut, uint256 pOut) internal {
        uint256 newShares = pm.sharesOf(w.a);
        uint128 liqAfter = _liq();
        uint128 removed = w.liq - liqAfter;
        bool lpSucceeded = w.liqToRemove > 0 && removed > 0;
        bool thirdPartyDown = paired.paused() || quote.frozen(recip) || paired.frozen(w.a);

        if (w.liqToRemove > 0) {
            nWithdrawsWithLp++;
            if (!lpSucceeded) {
                if (thirdPartyDown || w.liqToRemove > w.liq) nLpLegDeferred++;
                else lpLegFailedUnexpectedly++;
            }
        }
        // (1) pro-rata: the liquidity removed is EXACTLY the share-fraction slice, independent of spot.
        if (lpSucceeded && removed != w.liqToRemove) proRataViolations++;
        if (!lpSucceeded && removed != 0) proRataViolations++;

        // (10) H-02: recipient receives exactly the accrued fees (swept inside the LP leg), else nothing.
        uint256 dRQ = quote.balanceOf(recip) - w.rQ;
        uint256 dRP = paired.balanceOf(recip) - w.rP;
        if (lpSucceeded) {
            if (dRQ != w.feeQ || dRP != w.feeP) feeOrderingViolations++;
        } else if (dRQ != 0 || dRP != 0) {
            feeOrderingViolations++;
        }

        // (10) withdrawer gets the principal slice only: quote = idle outflow (source unstage + parked quote paid
        //      FIRST, R3-INV-2) + amount(removed), paired = amount(removed).
        uint256 dAQ = quote.balanceOf(w.a) - w.aQ;
        uint256 dAP = paired.balanceOf(w.a) - w.aP;
        uint256 srcOut = w.srcBal - quote.balanceOf(address(src));
        uint256 pmQAfter = _parked();
        uint256 parkedOut = w.pmQ > pmQAfter ? w.pmQ - pmQAfter : 0;
        if (parkedOut > 0) {
            nParkedPaid++;
            if (!w.readable) nOutageParkedPaid++; // parked quote needs no source read — pays even in an outage
        }
        (uint256 a0, uint256 a1) = _amountsByTick(w.spot, w.tick, removed);
        (uint256 lpQ, uint256 lpP) = q0 ? (a0, a1) : (a1, a0);
        if (dAQ != srcOut + parkedOut + lpQ || dAP != lpP) principalSliceViolations++;
        if (dAQ != qOut || dAP != pOut) _mismatch("withdraw return vs balance delta", dAQ, qOut);
        uint256 idleGot = srcOut + parkedOut;

        // Exact PER-LEG re-credit shadow (the R3-INV-1 fix): an undelivered idle remainder is re-credited against the
        // claim at the HIGH mark w (denominator = fromIdle + lpEntitled_w); a FAILED LP leg against the claim at the
        // LOW mark min(spot, ref) (lpEntLow = claimTotal·lpValLow/nav_w, denominator = fromIdle + lpEntLow); nothing
        // delivered at all ⇒ every share comes back; total capped at `shares`.
        {
            bool lpFailed = w.liqToRemove > 0 && !lpSucceeded;
            uint256 reCredit;
            if (idleGot == 0 && (lpFailed || w.liqToRemove == 0)) {
                reCredit = w.shares;
            } else {
                uint256 denomHigh = w.fromIdle + w.lpEntitled;
                if (w.fromIdle > idleGot && denomHigh > 0) reCredit = FullMath.mulDiv(w.shares, w.fromIdle - idleGot, denomHigh);
                if (lpFailed) {
                    uint256 navW = w.idle + w.lpSpotVal;
                    uint256 lpValLow = Math.min(_lpVal(w.spot), _lpVal(w.ref == 0 ? w.spot : w.ref)); // liq unchanged: leg failed
                    uint256 lpEntLow = navW == 0 ? 0 : FullMath.mulDiv(w.claimTotal, lpValLow, navW);
                    uint256 denomLow = w.fromIdle + lpEntLow;
                    if (denomLow > 0) reCredit += FullMath.mulDiv(w.shares, lpEntLow, denomLow);
                }
                if (reCredit > w.shares) reCredit = w.shares;
            }
            if (newShares != w.bal - w.shares + reCredit) reCreditShadowViolations++;
        }

        // (6) cost basis leaves with the LIQUIDITY fraction of the slice (post-fix: no per-leg offset), only when the
        //     LP leg executed.
        uint256 dpAfter = pm.deployedPrincipal();
        uint256 dpExpect = w.dp;
        if (lpSucceeded) dpExpect = w.lastHolder ? 0 : w.dp - FullMath.mulDiv(w.dp, w.liqToRemove, w.liq);
        if (dpAfter != dpExpect) dpDriftViolations++;
        dpShadow = dpAfter;

        // (3) last holder leaves a clean position.
        if (w.lastHolder) {
            nLastHolderExits++;
            if (lpSucceeded && (liqAfter != 0 || dpAfter != 0)) lastHolderViolations++;
        }

        // (2) + (16): valued at SPOT (the cached price; the slice's composition is whatever v4 returned at spot —
        //     valuing it at `w` would over-state it by convexity): value out never exceeds the spot claim of the
        //     WITHDRAWN shares, and the post-exit spot claim of the REMAINING shares + value out never exceeds the
        //     actor's WHOLE pre-exit spot claim. tol = adapter ceil-shares over-delivery (< 1 source share) + 4
        //     rounding units (two mulDiv floors per leg).
        uint256 deliveredValue = qOut + _p2q(pOut, w.spot);
        uint256 tol = w.srcP + 4;
        if (deliveredValue > w.claimTotalS + tol) valueConservationViolations++;
        (bool ok2, uint256 idleAfter) = _readable();
        if (ok2) {
            uint256 navAfter = idleAfter + _lpVal(w.spot);
            uint256 claimAfter = _toAssets(newShares, navAfter, pm.totalShares());
            if (claimAfter + deliveredValue > w.claimBalS + tol) {
                reCreditViolations++;
                uint256 excess = claimAfter + deliveredValue - w.claimBalS;
                if (excess > maxReCreditExcess) maxReCreditExcess = excess;
                if (!lpSucceeded && w.liqToRemove > 0 && w.w != w.spot) reCreditViolLpDeferredWeightGap++;
                else reCreditViolOther++;
            }
        }
        // Direct F1 detector, at the CONTRACT's weight: an exit whose delivery (valued at w, as the contract does)
        // covered the whole claim re-credits nothing. In the R3-INV-3 window the weight is 0 (the paired leg would be
        // "worth" ∞ quote — `_p2q` divides by it); value it at spot there, which only makes the detector stricter.
        // A ZERO-VALUE exit (claimTotal == 0: the S shares are worth < 1 raw unit) has nothing to deliver and — by the
        // per-leg rule "nothing delivered => keep the whole claim" — returns every share; the exact shadow above
        // asserts that. It is not a phantom (no cash left, no claim grew), so the detector skips it.
        if (w.claimTotal == 0) nZeroValueExits++;
        else {
            uint256 deliveredW = qOut + _p2q(pOut, w.w == 0 ? w.spot : w.w);
            uint256 burned = w.bal - newShares;
            if (deliveredW >= w.claimTotal && w.shares > burned) {
                reCreditViolations++;
                if (w.shares - burned > maxPhantomReCredit) maxPhantomReCredit = w.shares - burned;
            }
        }
        if (newShares > w.bal) reCreditViolations++;
    }

    // ── actions: owner ──────────────────────────────────────────────────────────────────────

    struct DPre {
        bool readable;
        uint256 idle;
        uint256 dp;
        uint256 q;
        uint256 p;
        uint160 spot;
        uint160 ref;
        uint256 feeQ;
        uint256 feeP;
        uint256 rQ;
        uint256 rP;
        uint256 srcP;
        uint256 stuck; // quote parked in the PM (deferred re-stage) before this deploy
        uint256 quoteGot;
        uint256 quoteUsed;
        uint256 pairedUsed;
    }

    /// Predict the deploy outcome past the cap/band checks: mint liquidity, round-up amounts pulled, two-sidedness.
    /// R3-INV-2: the quote parked in the PM is consumed FIRST; only the remainder is unstaged (best-effort).
    function _predictMint(DPre memory d) internal view returns (bytes4 expect) {
        uint256 fromParked = Math.min(d.stuck, d.q);
        uint256 rest = d.q - fromParked;
        d.quoteGot = fromParked + (src.failWithdrawals() || rest == 0 ? 0 : Math.min(rest, adapter.maxWithdrawable()));
        // A zap's paired output is decided by a real pool swap inside `deploy` -- not modellable here.
        if (d.p > 0) return UNPREDICTABLE;
        // swapAmount == 0 -> no paired at all: the mint is all-quote and invariant 15 refuses it (or L is 0).
        (uint256 a0, uint256 a1) = q0 ? (d.quoteGot, uint256(0)) : (uint256(0), d.quoteGot);
        uint128 L = LiquidityAmounts.getLiquidityForAmounts(
            d.spot, TickMath.getSqrtPriceAtTick(tl), TickMath.getSqrtPriceAtTick(tu), a0, a1
        );
        if (L == 0) return MintwareLpGatewayPositionManager.ZeroShares.selector;
        (, int24 tick,,) = poolManager.getSlot0(key.toId());
        (uint256 u0, uint256 u1) = _amountsByTickUp(d.spot, tick, L);
        (d.quoteUsed, d.pairedUsed) = q0 ? (u0, u1) : (u1, u0);
        uint256 pairedUsedVal = _p2q(d.pairedUsed, d.spot);
        uint256 bps = pm.MIN_TWO_SIDED_BPS();
        if (pairedUsedVal < (d.quoteUsed * bps) / 10_000 || d.quoteUsed < (pairedUsedVal * bps) / 10_000) {
            return MintwareLpGatewayPositionManager.DeployNotTwoSided.selector;
        }
        return bytes4(0);
    }

    function deploy(uint256 qSeed, uint256 pSeed, bool sameBlock) external {
        _tick(sameBlock);
        DPre memory d;
        (d.readable, d.idle) = _readable(); // staged + parked (R3-INV-2) — the cap's `principal` reads the same
        d.dp = pm.deployedPrincipal();
        uint256 principal = d.idle + d.dp;
        uint256 capTotal = (principal * pm.MAX_DEPLOY_BPS()) / 10_000;
        uint256 room = capTotal > d.dp ? capTotal - d.dp : 0;
        d.q = bound(qSeed, 0, room + room / 4 + 1);
        // Earn-vs-lp decision: `d.p` is now `swapAmount` -- QUOTE taken out of `d.q` and zapped into the paired
        // leg in-contract -- not an owner-supplied paired amount. `swapAmount > quoteToDeploy` is its own revert
        // (`SwapExceedsQuote`), so bound it just past `d.q` to exercise that edge too.
        d.p = bound(pSeed, 0, d.q + 1);
        d.spot = _spot();
        (d.ref,) = _refRaw();
        (d.feeQ, d.feeP) = _accruedFees();
        d.rQ = quote.balanceOf(recip);
        d.rP = paired.balanceOf(recip);
        d.srcP = d.readable ? _srcPriceCeil() : 0;
        d.stuck = quote.balanceOf(address(pm));

        bytes4 expect;
        if (d.q == 0) expect = MintwareLpGatewayPositionManager.ZeroAmount.selector;
        else if (d.p > d.q) expect = MintwareLpGatewayPositionManager.SwapExceedsQuote.selector;
        else if (!d.readable) expect = MintwareLpGatewayPositionManager.SourceUnavailable.selector;
        else if (d.dp + d.q > capTotal) expect = MintwareLpGatewayPositionManager.DeployCapExceeded.selector;
        // Third-party token failures, in the order the contract meets them: the H-02 sweep's TAKE of paired fees runs
        // INSIDE v4 (TOKEN_PAUSED → ERC-7751 `WrappedError`), then the sweep FORWARDS quote fees to the recipient
        // (ADDRESS_FROZEN → `Error(string)`), then the PM pulls the paired leg itself (TOKEN_PAUSED → `Error(string)`).
        else if (paired.paused() && d.feeP > 0) expect = WRAPPED;
        else if (quote.frozen(recip) && d.feeQ > 0) expect = ERROR_STRING;
        else if (paired.paused() && d.p > 0) expect = UNPREDICTABLE; // the zap's own take/settle of a paused token
        else {
            // Post-fix XR-2: a reference ALWAYS exists (anchored at creation) — the band applies to the first deploy too.
            uint160 diff = d.spot > d.ref ? d.spot - d.ref : d.ref - d.spot;
            if (d.ref == 0 || diff > uint160((uint256(d.ref) * band) / 10_000)) {
                expect = MintwareLpGatewayPositionManager.DeployPriceOutOfBand.selector;
            } else {
                expect = _predictMint(d); // ZeroShares / DeployNotTwoSided / ok
            }
        }

        // No handler-side paired mint any more: the PM never pulls a paired token from the caller.
        Fol memory f = _folPre();
        (bool ok, bytes memory ret) = address(pm).call(
            abi.encodeWithSelector(pm.deploy.selector, d.q, d.p, uint256(0), uint128(0), block.timestamp)
        );
        if (!ok) {
            _record("deploy", _sel(ret), expect);
            if (_sel(ret) == MintwareLpGatewayPositionManager.DeployNotTwoSided.selector) nTwoSidedRefusals++;
            return;
        }
        _recordOk("deploy", expect);
        nDeploys++;
        _folPost(f, "deploy");

        // (6) cost-basis cap right after a successful deploy, on the requested amount and on the resulting state.
        uint256 dpAfter = pm.deployedPrincipal();
        (, uint256 idleAfter) = _readable();
        if (dpAfter < d.dp || dpAfter - d.dp > d.q + d.srcP) capViolations++; // F3-b ACCEPTED: ≤ 1 source share of over-delivery
        if (d.dp + d.q > capTotal) capViolations++;
        if (dpAfter > ((idleAfter + dpAfter) * pm.MAX_DEPLOY_BPS()) / 10_000 + 2 * d.srcP + 2) capViolations++;
        // R3-2 deferred re-stage: leftover quote may be PARKED in the PM when the source is at its cap. Since
        // R3-INV-2 it is INSIDE NAV (`_idle()` counts it) and the next deploy consumes it first. It must be parked
        // ONLY when the source had no room for it.
        uint256 stuckAfter = _parked();
        if (d.stuck > 0 && d.q > 0) nDeployFromParked++;
        if (stuckAfter > 0) {
            nRestageDeferred++;
            if (stuckAfter > maxStuckQuote) maxStuckQuote = stuckAfter;
            if (stuckAfter <= src.maxDeposit(address(adapter))) stuckViolations++; // it would have fitted
        }
        // quote-principal conservation across the deploy (idle incl. parked -> LP at cost): |Δ(idle + dp)| <= rounding.
        uint256 before = d.idle + d.dp;
        uint256 after_ = idleAfter + dpAfter;
        uint256 drift = before > after_ ? before - after_ : after_ - before;
        if (drift > 2 * d.srcP + 2) capViolations++;
        dpShadow = dpAfter;
        // (10) H-02 on deploy: fees swept to the recipient BEFORE the increase.
        if (quote.balanceOf(recip) - d.rQ != d.feeQ || paired.balanceOf(recip) - d.rP != d.feeP) feeOrderingViolations++;
    }

    function harvest(bool sameBlock) external {
        _tick(sameBlock);
        (uint256 feeQ, uint256 feeP) = _accruedFees();
        uint256 rQ = quote.balanceOf(recip);
        uint256 rP = paired.balanceOf(recip);
        uint128 liqBefore = _liq();
        uint256 dp = pm.deployedPrincipal();
        bytes4 expect;
        if (pm.tokenId() == 0) expect = MintwareLpGatewayPositionManager.NotDeployed.selector;
        else if (paired.paused() && feeP > 0) expect = WRAPPED; // the TAKE of paired fees fails inside v4 (ERC-7751 wrap)
        else if (quote.frozen(recip) && feeQ > 0) expect = ERROR_STRING; // the PM's own forward to the frozen recipient

        Fol memory f = _folPre();
        (bool ok, bytes memory ret) = address(pm).call(abi.encodeWithSelector(pm.harvest.selector, block.timestamp));
        if (!ok) {
            _record("harvest", _sel(ret), expect);
            return;
        }
        _recordOk("harvest", expect);
        nHarvests++;
        _folPost(f, "harvest");
        (uint256 gotQ, uint256 gotP) = abi.decode(ret, (uint256, uint256));
        if (gotQ != feeQ || gotP != feeP) feeOrderingViolations++;
        if (quote.balanceOf(recip) - rQ != feeQ || paired.balanceOf(recip) - rP != feeP) feeOrderingViolations++;
        if (_liq() != liqBefore) principalSliceViolations++; // harvest never touches principal
        if (pm.deployedPrincipal() != dp) dpDriftViolations++;
    }

    function poke(bool sameBlock) external {
        _tick(sameBlock);
        Fol memory f = _folPre();
        uint256 dp = pm.deployedPrincipal();
        (bool ok, bytes memory ret) = address(pm).call(abi.encodeWithSelector(pm.poke.selector));
        if (!ok) {
            _record("poke", _sel(ret), bytes4(0));
            return;
        }
        nPokes++;
        _folPost(f, "poke");
        if (pm.deployedPrincipal() != dp) dpDriftViolations++;
    }

    function setPaused(bool p) external {
        pm.setPaused(p);
    }

    function compound(uint256 amtSeed) external {
        uint256 amt = bound(amtSeed, 1, 10_000 * _unit());
        quote.mint(address(this), amt);
        (bool readable,) = _readable();
        bytes4 expect;
        if (amt > src.maxDeposit(address(adapter))) expect = SRC_CAP; // stage reverts first
        else if (!readable) expect = MintwareLpGatewayPositionManager.SourceUnavailable.selector;
        uint256 dp = pm.deployedPrincipal();
        (bool ok, bytes memory ret) = address(pm).call(abi.encodeWithSelector(pm.compoundQuote.selector, amt));
        if (!ok) {
            _record("compound", _sel(ret), expect);
            if (_sel(ret) == SRC_CAP) nSourceCapRefusals++;
            return;
        }
        _recordOk("compound", expect);
        if (pm.deployedPrincipal() != dp) dpDriftViolations++;
    }

    // ── actions: third parties ──────────────────────────────────────────────────────────────

    /// External swap through the official PoolSwapTest router. `buyPaired` pushes the paired price up.
    function swap(bool buyPaired, uint256 amtSeed) external {
        bool zeroForOne = buyPaired ? q0 : !q0;
        uint256 amt = buyPaired ? bound(amtSeed, _unit() / 100 + 1, 400_000 * _unit()) : bound(amtSeed, 1e16, 400_000e18);
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        if (buyPaired) quote.mint(address(this), amt);
        else paired.mint(address(this), amt);
        (uint160 refB,) = _refRaw();
        uint256 dp = pm.deployedPrincipal();
        try swapper.swap(
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amt), sqrtPriceLimitX96: limit}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        ) {
            nSwaps++;
        } catch {}
        // Third-party activity never moves the follower or the cost basis.
        (uint160 refA,) = _refRaw();
        if (refA != refB) followerViolations++;
        if (pm.deployedPrincipal() != dp) dpDriftViolations++;
    }

    /// Third-party LP add/remove in the same range (handler-owned position, salt 1).
    function externalLp(bool add, uint256 amtSeed) external {
        int256 delta;
        if (add) {
            delta = int256(bound(amtSeed, 1e12, 500_000e18));
            quote.mint(address(this), 1_000_000 * _unit());
            paired.mint(address(this), 1_000_000e18);
        } else {
            if (extLiq == 0) return;
            delta = -int256(bound(amtSeed, 1, uint256(extLiq)));
        }
        try lpRouter.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: tl, tickUpper: tu, liquidityDelta: delta, salt: bytes32(uint256(1))}), ""
        ) {
            extLiq += delta;
        } catch {}
    }

    function setCap(uint256 capSeed) external {
        uint256 cap = capSeed % 3 == 0 ? 0 : bound(capSeed, 1, 50_000 * _unit());
        adapter.setPerBlockWithdrawCap(cap);
    }

    function setFailWithdrawals(bool f) external {
        src.setFailWithdrawals(f);
    }

    function setRevertPreview(bool r) external {
        src.setRevertPreview(r);
    }

    function setPairedPaused(bool p) external {
        paired.setPaused(p);
    }

    function setRecipientFrozen(bool f) external {
        quote.setFrozen(recip, f);
    }

    /// Source supply cap (R3-2 lever). `mode % 4`: 0/1 → uncapped; 2 → HARD CLOSED (absolute cap 1: every stage
    /// reverts, every leftover re-stage defers — a balance-pegged cap would re-open by exactly what `deploy` unstages);
    /// 3 → tight (room for ~1,000 quote units only).
    function setSourceSupplyCap(uint8 mode) external {
        uint256 m = mode % 4;
        if (m < 2) src.setSupplyCap(0);
        else if (m == 2) src.setSupplyCap(1);
        else src.setSupplyCap(src.totalAssets() + 1_000 * _unit());
    }

    function donate(uint256 amtSeed) external {
        uint256 amt = bound(amtSeed, 1, 100_000 * _unit());
        quote.mint(address(this), amt);
        src.simulateYield(amt);
    }

    function roll(uint8 n) external {
        _roll(bound(uint256(n), 1, 4));
    }
}

/// @notice Suite B base — builds the fork rig; concrete contracts pick the decimal pairing.
abstract contract InvariantForkLPBase is Test {
    using PoolIdLibrary for PoolKey;

    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant RH_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint16 constant BAND = 500;
    uint256 constant V = 1e6;
    uint256 constant ENTRY_MEMORY_BLOCKS = 300; // must equal the PM's constant (asserted after construction)

    bool internal live;
    ForkLpHandler internal h;
    MintwareLpGatewayPositionManager internal pm;

    function _quoteDecimals() internal pure virtual returns (uint8);

    function setUp() public {
        string memory rpc = vm.envOr("LP_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            Audit3NoopTarget noop = new Audit3NoopTarget();
            targetContract(address(noop));
            return;
        }
        vm.createSelectFork(rpc);
        live = true;

        h = new ForkLpHandler();
        ForkLpHandler.Rig memory r;
        r.poolManager = IPoolManager(vm.envOr("LP_POOL_MANAGER", RH_POOL_MANAGER));
        r.posm = IPositionManager(vm.envOr("LP_POSITION_MANAGER", RH_POSITION_MANAGER));
        r.quoteDec = _quoteDecimals();
        r.quote = new Audit3FailableToken("Quote", "Q", r.quoteDec);
        r.paired = new Audit3FailableToken("Paired", "P", 18);
        bool q0 = address(r.quote) < address(r.paired);
        (address c0, address c1) = q0 ? (address(r.quote), address(r.paired)) : (address(r.paired), address(r.quote));
        r.key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        // ~1:1 VALUE price for the decimal pairing: price(token1/token0 raw) = 10^(dec1 - dec0).
        int24 center = 0;
        if (r.quoteDec != 18) {
            // ln(1e12)/ln(1.0001) = 276,324 -> aligned to tickSpacing 60
            center = q0 ? int24(276_300) : int24(-276_300);
        }
        r.tl = center - 23_040;
        r.tu = center + 23_040;
        uint160 sqrtInit = TickMath.getSqrtPriceAtTick(center);
        r.poolManager.initialize(r.key, sqrtInit);

        r.src = new Audit3FlakySource(IERC20(address(r.quote)));
        r.adapter = new MintwareERC4626YieldAdapter(address(r.quote), address(r.src), address(0), address(h));
        r.staging = new MintwareLpGatewayStaging(IERC20(address(r.quote)), r.adapter);
        vm.prank(address(h));
        r.adapter.setVault(address(r.staging));
        r.recip = address(0xFEE5);
        // Deterministic ENTRY-MEMORY PERIOD at creation (R3-INV-3). The PM's two entry-high buckets alternate on
        // `block.number / ENTRY_MEMORY_BLOCKS` parity; created in an EVEN period on a quote-is-currency0 pool,
        // `_entryHigh()` reads the unset odd bucket as the extreme mark until the first action of the next period.
        // The live fork block would pick the parity at random per run (≈ hourly flips) — build at the START of an
        // ODD period by default (the spec path, 300 blocks of room — the campaign never crosses a period), or at an
        // EVEN one with `A3_FORK_PERIOD_PARITY=even` to run the whole campaign inside the residual's window.
        {
            bool even = keccak256(bytes(vm.envOr("A3_FORK_PERIOD_PARITY", string("odd")))) == keccak256("even");
            uint256 period = vm.getBlockNumber() / ENTRY_MEMORY_BLOCKS + 1; // always roll FORWARD
            if ((period % 2 == 0) != even) period += 1;
            vm.roll(period * ENTRY_MEMORY_BLOCKS);
        }
        r.pm = new MintwareLpGatewayPositionManager(
            r.poolManager, r.posm, IPermit2Minimal(PERMIT2), r.key, IERC20(address(r.quote)), r.tl, r.tu, r.staging,
            address(h), r.recip, BAND,
            type(uint256).max // IA-11 principal cap: uncapped -- this test predates/is unrelated to the cap
        );
        assertEq(r.pm.ENTRY_MEMORY_BLOCKS(), ENTRY_MEMORY_BLOCKS, "entry-period constant drifted - re-pin the parity roll");
        r.staging.setController(address(r.pm));
        r.swapper = new PoolSwapTest(r.poolManager);
        r.lpRouter = new PoolModifyLiquidityTest(r.poolManager);
        r.band = BAND;
        pm = r.pm;

        // External depth: ~1.5M quote-equivalent per side so the gateway is a minority of the pool.
        {
            uint256 unit = 10 ** uint256(r.quoteDec);
            uint256 qAmt = 1_500_000 * unit;
            uint256 pAmt = 1_500_000e18;
            (uint256 a0, uint256 a1) = q0 ? (qAmt, pAmt) : (pAmt, qAmt);
            uint128 L = LiquidityAmounts.getLiquidityForAmounts(
                sqrtInit, TickMath.getSqrtPriceAtTick(r.tl), TickMath.getSqrtPriceAtTick(r.tu), a0, a1
            );
            r.quote.mint(address(this), 10 * qAmt);
            r.paired.mint(address(this), 10 * pAmt);
            r.quote.approve(address(r.lpRouter), type(uint256).max);
            r.paired.approve(address(r.lpRouter), type(uint256).max);
            r.lpRouter.modifyLiquidity(
                r.key, ModifyLiquidityParams({tickLower: r.tl, tickUpper: r.tu, liquidityDelta: int256(uint256(L)), salt: 0}), ""
            );
        }
        h.init(r);

        bytes4[] memory sel = new bytes4[](20);
        sel[19] = ForkLpHandler.setSourceSupplyCap.selector;
        sel[0] = ForkLpHandler.deposit.selector;
        sel[1] = ForkLpHandler.deposit.selector;
        sel[2] = ForkLpHandler.withdraw.selector;
        sel[3] = ForkLpHandler.withdraw.selector;
        sel[4] = ForkLpHandler.deploy.selector;
        sel[5] = ForkLpHandler.deploy.selector;
        sel[6] = ForkLpHandler.harvest.selector;
        sel[7] = ForkLpHandler.poke.selector;
        sel[8] = ForkLpHandler.swap.selector;
        sel[9] = ForkLpHandler.swap.selector;
        sel[10] = ForkLpHandler.externalLp.selector;
        sel[11] = ForkLpHandler.setCap.selector;
        sel[12] = ForkLpHandler.setFailWithdrawals.selector;
        sel[13] = ForkLpHandler.setRevertPreview.selector;
        sel[14] = ForkLpHandler.setPairedPaused.selector;
        sel[15] = ForkLpHandler.setRecipientFrozen.selector;
        sel[16] = ForkLpHandler.donate.selector;
        sel[17] = ForkLpHandler.compound.selector;
        sel[18] = ForkLpHandler.setPaused.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
        targetContract(address(h));
    }

    // share conservation + solvency at spot
    function invariant_B0_sharesAndSolvency() public view {
        if (!live) return;
        assertEq(h.sumShares(), pm.totalShares(), "sum(sharesOf) != totalShares");
        assertLe(h.sumClaims(), pm.totalNav() + V, "sum(claims) > NAV + VIRTUAL");
    }

    // scope inv. 1 — pro-rata exit: liquidity removed == floor(shares·(liq+V)/(ts+V)) (all when last holder),
    // computed WITHOUT any price; the LP leg only ever fails under a third-party failure.
    function invariant_B1_proRataExitPriceNeutral() public view {
        if (!live) return;
        assertEq(h.proRataViolations(), 0, "liquidity removed != share-fraction slice");
        assertEq(h.lpLegFailedUnexpectedly(), 0, "LP leg deferred with no third-party failure");
    }

    // scope inv. 2 — re-credit never mints value (claim_after + delivered <= claim_before + tol; shares never rise);
    // and the re-credit is EXACTLY the per-leg formula (idle shortfall at w, failed LP leg at min(spot, ref)).
    function invariant_B2_reCreditNeverMintsValue() public view {
        if (!live) return;
        assertEq(h.reCreditViolations(), 0, "post-exit claim + delivered exceeds pre-exit claim");
        assertEq(h.reCreditShadowViolations(), 0, "re-credited shares differ from the per-leg formula");
    }

    // scope inv. 8 — the holder mark is max(spot, follower, POPULATED entry memory), on every deposit and exit.
    // Fails inside the R3-INV-3 window (`A3_FORK_PERIOD_PARITY=even`): an unset entry bucket is read as mark 0.
    function invariant_B8_holderMarkIsSpec() public view {
        if (!live) return;
        assertEq(h.markSpecViolations(), 0, "contract holder mark != spec mark (unset entry bucket read as a price)");
    }

    // scope inv. 3 — last holder leaves liquidity == 0 and deployedPrincipal == 0 (when the LP leg executes).
    function invariant_B3_lastHolderCleanState() public view {
        if (!live) return;
        assertEq(h.lastHolderViolations(), 0, "last holder left liquidity or cost basis behind");
    }

    // scope inv. 6 — cost-basis cap monotone / un-reopenable (F3-b: ≤ 1 source share of adapter over-delivery is
    // ACCEPTED); deployedPrincipal moves only in deploy + withdraw; principal (idle + LP-at-cost + parked leftover)
    // conserved across deploy; leftover parked ONLY when the source had no room (R3-2).
    function invariant_B6_costBasisCap() public view {
        if (!live) return;
        assertEq(h.capViolations(), 0, "deploy breached MAX_DEPLOY_BPS on cost basis, or principal not conserved");
        assertEq(h.dpDriftViolations(), 0, "deployedPrincipal changed outside deploy/withdraw or not pro-rata");
        assertEq(h.stuckViolations(), 0, "leftover quote parked in the PM although the source had room");
        assertEq(pm.deployedPrincipal(), h.dpShadow(), "deployedPrincipal drifted from the shadow");
    }

    // scope inv. 7 — follower: <= band per block, toward spot, once per block, first anchor == spot, untouched by swaps.
    function invariant_B7_followerBand() public view {
        if (!live) return;
        assertEq(h.followerViolations(), 0, "clamped follower stepped wrong");
    }

    // scope inv. 9 — the revert set is exactly the documented one; withdraw never reverts on third-party failure.
    function invariant_B9_revertSetIsExact() public view {
        if (!live) return;
        assertEq(h.unexpectedReverts(), 0, string.concat("unexpected revert in ", h.lastUnexpectedAction()));
        assertEq(
            h.expectedRevertButSucceeded(),
            0,
            string.concat("a predicted revert did not revert in ", h.lastExpectedButOkAction())
        );
        assertEq(h.predictionMismatch(), 0, "shares minted / amounts delivered differ from the shadow");
    }

    // scope inv. 10 — H-02: recipient delta == accrued fees on every liquidity change; withdrawer gets principal only.
    function invariant_B10_feeOrdering() public view {
        if (!live) return;
        assertEq(h.feeOrderingViolations(), 0, "recipient delta != accrued fees");
        assertEq(h.principalSliceViolations(), 0, "withdrawer received other than the principal slice");
    }

    // scope inv. 16 — value conservation at the decimal pairing: value out <= pre-exit claim + rounding.
    function invariant_B16_valueConservation() public view {
        if (!live) return;
        assertEq(h.valueConservationViolations(), 0, "delivered value exceeds the pre-exit claim");
    }

    /// Coverage witness: one long pseudo-random run over the SAME handler (800 calls) — invariant-campaign logs are
    /// not printed by forge, a plain test's are. Reports which states were reached + the violation counters.
    function test_witness_deterministicReplay_800calls() public {
        if (!live) return;
        uint256 seed = 0xB3;
        uint256 stopAt = vm.envOr("A3_WITNESS_STOP", uint256(800));
        uint256 frameReverts;
        // Deterministic PARKED-QUOTE prefix (R3-INV-2): the random tail rarely lands a deferred re-stage, so force
        // one — stage 200k, hard-close the source, deploy 60k quote against 30k paired (≈ 30k parked), then exercise
        // the three fixed paths on the parked state: an exit paid from parked quote, a deposit priced against the
        // parked-inclusive NAV, and a deploy that consumes parked quote first. Every call goes through the handler,
        // so each is predicted + shadow-checked like any other; the counters below witness the paths were reached.
        {
            h.deposit(0, 200_000 * 10 ** uint256(_quoteDecimals()), false, 0); // alice
            h.setSourceSupplyCap(2); // hard-closed (absolute 1)
            // Earn-vs-lp decision: arg 2 is `swapAmount` in QUOTE units, taken out of arg 1. 60k staged with 30k
            // zapped mints ~30k quote + ~30k paired and parks ~30k -- the same shape as the old (60k, 30k paired).
            h.deploy(60_000 * 10 ** uint256(_quoteDecimals()), 30_000 * 10 ** uint256(_quoteDecimals()), false);
            assertGt(h.nRestageDeferred(), 0, "prefix: deploy parked its leftover (RestageDeferred)");
            h.withdraw(0, 5_000 * 10 ** uint256(_quoteDecimals()), false); // alice exits a slice: idle leg from parked first
            assertGt(h.nParkedPaid(), 0, "prefix: exit paid from parked quote");
            h.setSourceSupplyCap(3); // tight: room for ~1,000 quote only
            h.deposit(1, 900 * 10 ** uint256(_quoteDecimals()), false, 1); // bob, minMode 1 = exact predicted min
            h.setSourceSupplyCap(0); // uncapped again
            h.deploy(10_000 * 10 ** uint256(_quoteDecimals()), 5_000 * 10 ** uint256(_quoteDecimals()), false); // consumes parked first, re-stages the rest
            assertGt(h.nDeployFromParked(), 0, "prefix: deploy consumed parked quote");
            assertEq(h.unexpectedReverts() + h.expectedRevertButSucceeded() + h.predictionMismatch(), 0, "prefix: predictions exact");
            assertEq(h.principalSliceViolations() + h.capViolations() + h.reCreditShadowViolations(), 0, "prefix: shadows exact");
        }
        for (uint256 i; i < stopAt; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 op = seed % 20;
            uint256 x = uint256(keccak256(abi.encode(seed, 1)));
            bool b = (seed >> 4) & 1 == 1;
            bool rare = (seed >> 5) % 4 == 0;
            bytes memory cd;
            if (op < 4) cd = abi.encodeWithSelector(ForkLpHandler.deposit.selector, seed >> 8, x, b, uint8(seed >> 16));
            else if (op < 8) cd = abi.encodeWithSelector(ForkLpHandler.withdraw.selector, seed >> 8, x, b);
            else if (op < 11) cd = abi.encodeWithSelector(ForkLpHandler.deploy.selector, seed >> 8, x, b);
            else if (op == 11) cd = abi.encodeWithSelector(ForkLpHandler.harvest.selector, b);
            else if (op == 12) cd = abi.encodeWithSelector(ForkLpHandler.poke.selector, b);
            else if (op < 15) cd = abi.encodeWithSelector(ForkLpHandler.swap.selector, b, x);
            else if (op == 15) cd = abi.encodeWithSelector(ForkLpHandler.externalLp.selector, b, x);
            else if (op == 16) cd = abi.encodeWithSelector(ForkLpHandler.setCap.selector, x);
            else if (op == 17) {
                uint256 t = (seed >> 24) % 4;
                if (t == 0) cd = abi.encodeWithSelector(ForkLpHandler.setFailWithdrawals.selector, rare);
                else if (t == 1) cd = abi.encodeWithSelector(ForkLpHandler.setRevertPreview.selector, rare);
                else if (t == 2) cd = abi.encodeWithSelector(ForkLpHandler.setPairedPaused.selector, rare);
                else cd = abi.encodeWithSelector(ForkLpHandler.setRecipientFrozen.selector, rare);
            } else if (op == 18) cd = abi.encodeWithSelector(ForkLpHandler.donate.selector, x);
            else if ((seed >> 40) % 3 == 0) cd = abi.encodeWithSelector(ForkLpHandler.setSourceSupplyCap.selector, uint8(seed >> 48));
            else cd = abi.encodeWithSelector(ForkLpHandler.compound.selector, x);
            (bool ok,) = address(h).call(cd);
            // A handler FRAME must never revert: it wastes depth and — because `vm.roll` survives the revert while
            // `blk` does not — desyncs the block clock (the pre-fix B7/B9 false alarms). Counted, asserted below.
            if (!ok) {
                frameReverts++;
                console2.log("  HANDLER FRAME REVERT at call / op", i, op);
            }
        }
        console2.log("block.number at end / h.blk / handler frame reverts", vm.getBlockNumber(), h.blk(), frameReverts);
        console2.log("deposits / withdraws / withdraws-with-LP-leg", h.nDeposits(), h.nWithdraws(), h.nWithdrawsWithLp());
        console2.log("deploys / harvests / swaps / pokes", h.nDeploys(), h.nHarvests(), h.nSwaps());
        console2.log("last-holder exits / LP-leg deferred (3rd-party down) / outage withdraws", h.nLastHolderExits(), h.nLpLegDeferred(), h.nOutageWithdraws());
        console2.log("follower steps / pokes / max phantom re-credit (shares)", h.nFollowerSteps(), h.nPokes(), h.maxPhantomReCredit());
        console2.log("post-fix paths: stage-shortfalls / source-cap refusals / two-sided refusals", h.nStageShortfalls(), h.nSourceCapRefusals(), h.nTwoSidedRefusals());
        console2.log("post-fix paths: restage deferred / max parked quote / entry-mark>spot / exit-weight>spot", h.nRestageDeferred(), h.maxStuckQuote(), h.nEntryMarkAboveSpot());
        console2.log("  ...exit weight above spot / stuck violations", h.nExitWeightAboveSpot(), h.stuckViolations());
        console2.log("B2 attribution: LP-leg-deferred & w!=spot / other / max excess (quote @spot)", h.reCreditViolLpDeferredWeightGap(), h.reCreditViolOther(), h.maxReCreditExcess());
        console2.log("violations: unexpectedReverts / expectedButOk / predictionMismatch", h.unexpectedReverts(), h.expectedRevertButSucceeded(), h.predictionMismatch());
        console2.log("violations: proRata / lpLegUnexpected / feeOrdering", h.proRataViolations(), h.lpLegFailedUnexpectedly(), h.feeOrderingViolations());
        console2.log("violations: principalSlice / cap / dpDrift", h.principalSliceViolations(), h.capViolations(), h.dpDriftViolations());
        console2.log("violations: follower", h.followerViolations());
        console2.log("  ...reCredit / valueConservation / lastHolder", h.reCreditViolations(), h.valueConservationViolations(), h.lastHolderViolations());
        if (h.unexpectedReverts() > 0) {
            console2.log("  DIAG unexpected revert in", h.lastUnexpectedAction());
            console2.logBytes4(h.lastUnexpectedSelector());
            console2.logBytes4(h.lastExpectedSelector());
        }
        if (h.expectedRevertButSucceeded() > 0) {
            console2.log("  DIAG predicted revert did not revert in", h.lastExpectedButOkAction());
            console2.logBytes4(h.lastExpectedButOkSelector());
        }
        if (h.predictionMismatch() > 0) {
            console2.log("  DIAG mismatch in", h.lastMismatchAction(), h.lastMismatchGot(), h.lastMismatchPred());
        }
        if (h.followerViolations() > 0) {
            console2.log("  DIAG follower after", h.lastFollowerAction());
            console2.log("    ref before / after / expected", h.lastFolRefBefore(), h.lastFolRefAfter(), h.lastFolExpected());
            console2.log("    spot / refBlock before / after", h.lastFolSpot(), h.lastFolRefBlockBefore(), h.lastFolRefBlockAfter());
            console2.log("    handler blk", h.lastFolBlk());
        }
        console2.log("second pass: parked-paid exits / outage parked-paid / deploys from parked", h.nParkedPaid(), h.nOutageParkedPaid(), h.nDeployFromParked());
        console2.log("second pass: zero-mark deposits / zero-mark exits / mark-spec violations", h.nZeroMarkDeposits(), h.nZeroMarkExits(), h.markSpecViolations());
        console2.log("second pass: re-credit shadow violations / zero-value exits", h.reCreditShadowViolations(), h.nZeroValueExits());
        assertGt(h.nDeploys(), 0, "replay reached deploy");
        assertGt(h.nWithdrawsWithLp(), 0, "replay reached an LP-leg exit");
        assertEq(frameReverts, 0, "a handler frame reverted (block clock would desync)");
        assertEq(vm.getBlockNumber(), h.blk(), "handler block counter out of sync with the chain");
        // R3-INV-1 FIXED: the per-leg re-credit leaves NO scope-inv.-2 violation of any class, and the shadow matches.
        assertEq(h.reCreditViolLpDeferredWeightGap(), 0, "R3-INV-1 class re-credit violation (should be FIXED)");
        assertEq(h.reCreditViolOther(), 0, "a re-credit violation outside the R3-INV-1 class");
        assertEq(h.reCreditShadowViolations(), 0, "re-credit differs from the per-leg formula");
        assertEq(h.maxPhantomReCredit(), 0, "no F1 phantom re-credit");
        // R3-INV-3: outside its window (odd creation period, the default) the mark is the spec mark everywhere.
        bool even = keccak256(bytes(vm.envOr("A3_FORK_PERIOD_PARITY", string("odd")))) == keccak256("even");
        if (!even) assertEq(h.markSpecViolations(), 0, "holder mark != spec mark outside the R3-INV-3 window");
    }
}

/// @notice 18-dp quote x 18-dp paired (the round-2 harness pairing).
/// forge-config: default.invariant.runs = 8
/// forge-config: default.invariant.depth = 24
/// forge-config: default.invariant.fail-on-revert = false
contract InvariantForkLP18Test is InvariantForkLPBase {
    function _quoteDecimals() internal pure override returns (uint8) {
        return 18;
    }
}

/// @notice 6-dp quote (USDG shape) x 18-dp paired — scope inv. 16.
/// forge-config: default.invariant.runs = 8
/// forge-config: default.invariant.depth = 24
/// forge-config: default.invariant.fail-on-revert = false
contract InvariantForkLP6x18Test is InvariantForkLPBase {
    function _quoteDecimals() internal pure override returns (uint8) {
        return 6;
    }
}
