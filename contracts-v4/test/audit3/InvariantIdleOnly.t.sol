// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {Audit3FlakySource, Audit3Stub} from "./InvariantMocks.sol";
import {MockSlot0PoolManager} from "../mocks/MockSlot0PoolManager.sol";

/// @title  Round-3 stateful invariant fuzzing — LP gateway PositionManager, IDLE-ONLY rig (Suite A)
/// @notice The prior audit rounds were scenario tests; nobody had run STATEFUL invariant fuzzing on the PM.
///         This suite drives the PRODUCTION share-math path (PM -> Staging -> MintwareERC4626YieldAdapter ->
///         an adversarial 4626) with a bounded multi-actor handler and checks the scope-§6 share-accounting
///         invariants (1, 2, 4, 5, 9, 11) plus solvency / conservation, at high run counts. `tokenId` stays 0
///         (no deploy) so v4 is never called — the LP-leg invariants are Suite B (`InvariantForkLP.t.sol`).
///
///         Handler design:
///           - 4 actors; every PM call is a low-level call whose revert SELECTOR is compared against a
///             prediction computed from pre-state (fail-on-revert = false; unexpected selectors are RECORDED).
///           - Ghost variables: per-actor deposited / withdrawn / pro-rata yield credit / last-holder sweep, and
///             two global rounding slacks (value that rounding leaves IN the pool for anyone to capture; value that
///             rounding takes FROM holders). Each slack term is derived from the contract math, not tuned.
///           - Block progression is a handler-owned counter (`blk`) — never `block.number + 1` (via-IR CSE trap).
///
///         Post-fix (2026-09-08) harness deltas — this suite now models the ROUND-3-FIXED source:
///           - `StageShortfall` predicted from the source's own mint/redeem math (XR-3 / F2 closed);
///           - exit entitlement = ONE virtual offset on the whole claim, capped at what exists (F1 closed) — in the
///             idle-only rig `claimTotal == fromIdle`; the refusal `!idleOk && liqToRemove == 0` fires again (F1-b);
///           - A4 compares against the actor's WHOLE pre-exit claim (the pinned check compared remaining-vs-withdrawn
///             and could only pass on full exits) and asserts `nPhantomReCredits == 0` directly;
///           - A2b's rounding bound is scaled by NAV growth (a deficit is a ratio under proportional accounting);
///           - the FEE source's retained exit fee is credited as yield to remaining holders;
///           - (second pass, R3-INV-1 per-leg re-credit) a ZERO-VALUE exit — `fromIdle == 0`, i.e. the S shares are
///             worth < 1 raw unit (empty / fee-drained source) — now returns every share ("nothing delivered ⇒ keep the
///             whole claim") instead of burning them for nothing; the F1 phantom detector only judges exits that had
///             something to deliver (`nZeroValueExits` witnesses the branch).
///           The idle-path rig uses `MockSlot0PoolManager` (the constructor now reads slot0 / anchors the follower).
contract IdleOnlyHandler is Test {
    uint256 internal constant V = 1e6; // PM VIRTUAL
    uint256 internal constant N = 4;

    MintwareLpGatewayPositionManager public pm;
    MintwareLpGatewayStaging public staging;
    MintwareERC4626YieldAdapter public adapter;
    Audit3FlakySource public src;
    MockERC20 public usdg;

    address[4] public actors = [address(0xA11CE), address(0xB0B), address(0xCA201), address(0xDA7E)];
    uint256 public blk; // handler-owned block counter (mirrors block.number after our own vm.roll)
    mapping(address => uint256) internal lastAct; // mirror of the PM's `_lastActionBlock`

    // ── ghosts ──────────────────────────────────────────────────────────────────────────────
    mapping(address => uint256) public deposited; // quote paid in
    mapping(address => uint256) public withdrawn; // quote received
    mapping(address => uint256) public yieldCredit; // pro-rata (by sharesOf/totalShares, CEIL) share of donations + compounds
    mapping(address => uint256) public swept; // virtual-offset dust collected as LAST holder (idle - pro-rata entitlement)
    mapping(address => uint256) public ownLoss; // rounding this actor's OWN ops can cost them (floor on mint / redeem / re-credit)
    uint256 public globalSlack; // rounding value left IN the pool by anyone's ops (capturable by any holder)
    uint256 public globalLossSlack; // rounding value taken FROM the pool by anyone's ops (borne by all holders)
    // Bound on the ABSOLUTE below-par deficit `totalShares − NAV` (A2b). Post-fix harness delta: a rounding deficit
    // is PRESERVED AS A RATIO by proportional share accounting — every later deposit at a below-par price mints
    // `B·(ts+V)/(nav+V)` shares for `B` assets, so the absolute gap scales by `(nav_after+V)/(nav_before+V)` (nobody
    // gains: the depositor's claim is exactly `B`). The un-scaled `globalLossSlack` was therefore an unsound bound
    // for the absolute form (the fixed source showed a 29-unit stage-rounding loss scaled to 13.9M units by a 528k
    // USDG deposit). This ghost applies that exact scaling on every deposit; new losses add as before.
    uint256 public deficitBound;
    uint256 public feeRetainedTotal; // exit fees the FEE source keeps → accrue to remaining source holders (yield)
    uint256 public donatedTotal;
    uint256 public compoundedTotal;

    // ── violation counters (each invariant asserts its counter is 0) ────────────────────────
    uint256 public unexpectedReverts;
    bytes4 public lastUnexpectedSelector;
    string public lastUnexpectedAction;
    uint256 public expectedRevertButSucceeded;
    string public lastExpectedButOkAction;
    bytes4 public lastExpectedButOkSelector;
    uint256 public predictionMismatch; // deposit minted a different share count than the pre-state formula
    uint256 public reCreditViolations; // claim_after + delivered > claim_before + tol
    uint256 public sharesIncreasedOnWithdraw;
    uint256 public dilutionViolations; // an existing holder's claim fell by more than fee-term + rounding on someone else's deposit
    uint256 public maxDilutionObserved; // largest per-holder claim drop on a deposit (quote units) — L-05 quantification

    // ── witnesses ───────────────────────────────────────────────────────────────────────────
    uint256 public nDeposits;
    uint256 public nWithdraws;
    uint256 public nDonations;
    uint256 public nOutageAttempts; // withdraw attempted while previewRedeem reverts
    uint256 public nCappedWithdraws; // idle leg short (per-block cap or stalled source) -> re-credit path
    uint256 public nLastHolderExits;
    uint256 public nReCredits;
    uint256 public nStageShortfalls; // deposits refused because the source would credit < amount·(1 − 50 bps) (XR-3)
    uint256 public maxOverDelivery; // largest (delivered - entitlement) — the adapter's ceil-shares redeem rounding
    uint256 public maxPhantomReCredit; // largest share re-credit observed on an exit whose idle leg was paid IN FULL
    uint256 public nPhantomReCredits;
    uint256 public nZeroValueExits; // fromIdle == 0: nothing to deliver, every share returned (value-neutral)
    uint256 public zeroValueExitViolations; // ...but the contract burned some anyway

    function init(
        MintwareLpGatewayPositionManager pm_,
        MintwareLpGatewayStaging staging_,
        MintwareERC4626YieldAdapter adapter_,
        Audit3FlakySource src_,
        MockERC20 usdg_
    ) external {
        pm = pm_;
        staging = staging_;
        adapter = adapter_;
        src = src_;
        usdg = usdg_;
        blk = block.number;
        for (uint256 i; i < N; ++i) {
            vm.prank(actors[i]);
            usdg.approve(address(pm), type(uint256).max);
        }
        usdg.approve(address(pm), type(uint256).max);
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────

    function _roll(uint256 n) internal {
        blk += n;
        vm.roll(blk);
    }

    function _readable() internal view returns (bool ok, uint256 idle) {
        try staging.stagedAssets() returns (uint256 v) {
            return (true, v);
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

    /// PM share -> assets at (nav, ts) exactly as `_withdraw` sizes a non-last-holder idle entitlement.
    function _toAssets(uint256 shares, uint256 nav, uint256 ts) internal pure returns (uint256) {
        return Math.mulDiv(shares, nav + V, ts + V);
    }

    /// ceil(price-per-share) of the PM at (nav, ts) — the most one PM share can be worth (rounding unit).
    function _pmPriceCeil(uint256 nav, uint256 ts) internal pure returns (uint256) {
        return Math.ceilDiv(nav + V, ts + V);
    }

    /// ceil(assets-per-share) of the 4626 source (OZ offset 0 -> +1 virtual) — the adapter's rounding unit.
    function _srcPriceCeil() internal view returns (uint256) {
        return Math.ceilDiv(src.totalAssets() + 1, src.totalSupply() + 1);
    }

    /// Mirror of the source's fee-net `previewRedeem` at an arbitrary (tA, tS): floor(shares·(tA+1)/(tS+1)) − fee.
    function _srcNetAt(uint256 shares, uint256 tA, uint256 tS) internal view returns (uint256) {
        uint256 gross = Math.mulDiv(shares, tA + 1, tS + 1);
        return gross - Math.mulDiv(gross, src.exitFeeBps(), 10_000);
    }

    /// Round-3 XR-3 harness delta: predict `StageShortfall`. The PM requires the staged reserve (fee-net
    /// `previewRedeem(adapterShares)`) to grow by ≥ amt·(1 − STAGE_TOLERANCE_BPS). The source mints
    /// floor(amt·(tS+1)/(tA+1)) shares (OZ offset 0) — against a donation-pumped, near-empty source that is 0 (F2).
    function _predictStageShortfall(uint256 amt, uint256 idleBefore) internal view returns (bool) {
        uint256 tA = src.totalAssets();
        uint256 tS = src.totalSupply();
        uint256 m = src.previewDeposit(amt);
        uint256 idleAfter = _srcNetAt(src.balanceOf(address(adapter)) + m, tA + amt, tS + m);
        uint256 need = idleBefore + amt - (amt * pm.STAGE_TOLERANCE_BPS()) / 10_000;
        return idleAfter < need;
    }

    /// Exit fee the FEE source retains when the adapter burns `burnedSrcShares` at pre-state (tA, tS): the gross
    /// value of those shares minus what was paid out. It stays in the source → accrues to the remaining holders.
    function _feeRetained(uint256 burnedSrcShares, uint256 tA, uint256 tS) internal view returns (uint256) {
        if (burnedSrcShares == 0 || src.exitFeeBps() == 0) return 0;
        uint256 gross = Math.mulDiv(burnedSrcShares, tA + 1, tS + 1);
        return Math.mulDiv(gross, src.exitFeeBps(), 10_000);
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

    function actorCount() external pure returns (uint256) {
        return N;
    }

    function _creditYield(uint256 amount) internal {
        uint256 ts = pm.totalShares();
        if (ts == 0) return; // unowned: lands on the virtual slice / next depositor's price (tracked via `swept`)
        for (uint256 i; i < N; ++i) {
            uint256 s = pm.sharesOf(actors[i]);
            if (s > 0) yieldCredit[actors[i]] += Math.mulDiv(amount, s, ts, Math.Rounding.Ceil);
        }
    }

    function _record(string memory action, bytes4 got, bytes4 expect) internal {
        if (got != expect) {
            unexpectedReverts++;
            lastUnexpectedSelector = got;
            lastUnexpectedAction = action;
        }
    }

    function _recordUnexpectedSuccess(string memory action, bytes4 expect) internal {
        expectedRevertButSucceeded++;
        lastExpectedButOkAction = action;
        lastExpectedButOkSelector = expect;
    }

    // ── actions ─────────────────────────────────────────────────────────────────────────────

    /// deposit / depositWithMin. `minMode % 3`: 0 plain, 1 min == predicted (must pass), 2 min == predicted + 1 (must revert).
    function deposit(uint256 aSeed, uint256 amtSeed, bool sameBlock, uint8 minMode) external {
        address a = actors[aSeed % N];
        uint256 amt = bound(amtSeed, 0, 2_000_000e6);
        if (!sameBlock) _roll(1);

        (bool readable, uint256 nav) = _readable();
        uint256 ts = pm.totalShares();
        uint256 pred = readable ? Math.mulDiv(amt, ts + V, nav + V) : 0;
        bool useMin = minMode % 3 != 0;
        uint256 minOut = useMin ? (minMode % 3 == 2 ? pred + 1 : pred) : 0;
        uint256 srcP = readable ? _srcPriceCeil() : 0;
        uint256 feeBps = src.exitFeeBps();

        bytes4 expect;
        if (pm.paused()) expect = MintwareLpGatewayPositionManager.DepositsPaused.selector;
        else if (amt == 0) expect = MintwareLpGatewayPositionManager.ZeroAmount.selector;
        else if (lastAct[a] == blk) expect = MintwareLpGatewayPositionManager.SameBlockAction.selector;
        else if (!readable) expect = MintwareLpGatewayPositionManager.SourceUnavailable.selector;
        else if (pred == 0) expect = MintwareLpGatewayPositionManager.ZeroShares.selector;
        else if (useMin && pred < minOut) expect = MintwareLpGatewayPositionManager.SlippageExceeded.selector;
        else if (_predictStageShortfall(amt, nav)) expect = MintwareLpGatewayPositionManager.StageShortfall.selector;

        // Pre-state claims of the OTHER holders (dilution check — scope invariant 5 / L-05).
        uint256[4] memory claimsBefore;
        if (readable) {
            for (uint256 i; i < N; ++i) {
                claimsBefore[i] = _toAssets(pm.sharesOf(actors[i]), nav, ts);
            }
        }

        usdg.mint(a, amt);
        bytes memory cd = useMin
            ? abi.encodeWithSelector(pm.depositWithMin.selector, amt, minOut)
            : abi.encodeWithSelector(pm.deposit.selector, amt);
        vm.prank(a);
        (bool ok, bytes memory ret) = address(pm).call(cd);

        if (!ok) {
            _record("deposit", _sel(ret), expect);
            if (_sel(ret) == MintwareLpGatewayPositionManager.StageShortfall.selector) nStageShortfalls++;
            return;
        }
        if (expect != bytes4(0)) _recordUnexpectedSuccess("deposit", expect);
        uint256 got = abi.decode(ret, (uint256));
        if (got != pred) predictionMismatch++;

        deposited[a] += amt;
        lastAct[a] = blk;
        nDeposits++;
        uint256 p = _pmPriceCeil(nav, ts);
        globalSlack += p; // floor on the share mint leaves < 1 PM share of value in the pool
        ownLoss[a] += p + 1;
        globalLossSlack += srcP; // the 4626 floors the source-share mint: NAV rises by < amt by up to 1 source share
        {
            // A2b: the pre-existing absolute deficit scales with the NAV growth of this deposit (see `deficitBound`).
            (, uint256 navNow) = _readable();
            deficitBound = Math.mulDiv(deficitBound, navNow + V, nav + V, Math.Rounding.Ceil) + srcP;
        }

        // Dilution of existing holders by this deposit: bounded by the fee term (fee-net NAV vs par mint) + rounding.
        (bool ok2, uint256 navAfter) = _readable();
        uint256 tsAfter = pm.totalShares();
        if (ok2) {
            for (uint256 i; i < N; ++i) {
                if (actors[i] == a) continue;
                uint256 s = pm.sharesOf(actors[i]);
                if (s == 0) continue;
                uint256 after_ = _toAssets(s, navAfter, tsAfter);
                if (after_ < claimsBefore[i]) {
                    uint256 drop = claimsBefore[i] - after_;
                    if (drop > maxDilutionObserved) maxDilutionObserved = drop;
                    uint256 feeTerm = Math.mulDiv(Math.mulDiv(amt, feeBps, 10_000, Math.Rounding.Ceil), s, tsAfter + V, Math.Rounding.Ceil);
                    if (drop > feeTerm + srcP + 2) dilutionViolations++;
                }
            }
        }
    }

    /// withdraw / withdrawWithMin. `minMode % 3`: 0 plain, 1 min == predicted delivery (must pass),
    /// 2 min == predicted + 2·srcPrice + 2 (must revert SlippageExceeded — above the adapter's max over-delivery, F3).
    function withdraw(uint256 aSeed, uint256 shSeed, bool sameBlock, uint8 minMode) external {
        address a = actors[aSeed % N];
        uint256 bal = pm.sharesOf(a);
        uint256 shares = bound(shSeed, 0, bal + 1);
        if (!sameBlock) _roll(1);

        (bool readable, uint256 idle) = _readable();
        uint256 ts = pm.totalShares();
        bool lastHolder = shares > 0 && shares == ts;
        // Post-fix (F1) entitlement: ONE virtual offset on the whole claim, capped at what exists. Idle-only rig
        // → navW == idle, so claimTotal == fromIdle and there is no LP leg to split against.
        uint256 proRata = readable ? Math.min(_toAssets(shares, idle, ts), idle) : 0;
        uint256 fromIdle = lastHolder ? idle : proRata; // the contract's entitlement
        uint256 maxW = readable ? adapter.maxWithdrawable() : 0;
        uint256 predDeliv = src.failWithdrawals() ? 0 : (fromIdle < maxW ? fromIdle : maxW);
        uint256 srcP = readable ? _srcPriceCeil() : 0;
        bool useMin = minMode % 3 != 0;
        // mode 2 sits TWO source shares + 2 wei above the prediction: the adapter's ceil-shares/floor-redeem path can
        // over-deliver up to one source share (F3, accepted) and a second rounding step appears on rare seeds.
        uint256 minOut = useMin ? (minMode % 3 == 2 ? predDeliv + 2 * srcP + 2 : predDeliv) : 0;
        if (!readable) nOutageAttempts++;

        bytes4 expect;
        if (shares == 0) expect = MintwareLpGatewayPositionManager.ZeroAmount.selector;
        else if (shares > bal) expect = MintwareLpGatewayPositionManager.InsufficientShares.selector;
        else if (lastAct[a] == blk) expect = MintwareLpGatewayPositionManager.SameBlockAction.selector;
        else if (!readable) expect = MintwareLpGatewayPositionManager.SourceUnavailable.selector; // idle-only: liqToRemove == 0 (F1-b: fires again)
        else if (useMin && minMode % 3 == 2) expect = MintwareLpGatewayPositionManager.SlippageExceeded.selector;

        // Scope inv. 2 baseline = the actor's WHOLE pre-exit claim (all `bal` shares), not just the S withdrawn.
        // (The pinned round-3 run compared the post-exit claim of the REMAINING shares against the entitlement of the
        // WITHDRAWN shares — a check that can only pass on a full exit; the replay witness fired it on 315/315
        // withdraws. Its failure was mis-attributed to F1; the F1 detector proper is `nPhantomReCredits`.)
        // A last holder sweeps the offset dust (A-2 clean state) — their pre-exit claim is the whole reserve.
        uint256 claimBefore = !readable ? 0 : (lastHolder ? idle : _toAssets(bal, idle, ts));
        uint256 balBefore = usdg.balanceOf(a);
        uint256 srcTA = src.totalAssets();
        uint256 srcTS = src.totalSupply();

        bytes memory cd = useMin
            ? abi.encodeWithSelector(pm.withdrawWithMin.selector, shares, minOut, uint256(0))
            : abi.encodeWithSelector(pm.withdraw.selector, shares);
        vm.prank(a);
        (bool ok, bytes memory ret) = address(pm).call(cd);

        if (!ok) {
            _record("withdraw", _sel(ret), expect);
            return;
        }
        if (expect != bytes4(0)) _recordUnexpectedSuccess("withdraw", expect);
        (uint256 q, uint256 p) = abi.decode(ret, (uint256, uint256));
        if (p != 0) unexpectedReverts++; // idle-only: no paired leg can ever be paid
        if (usdg.balanceOf(a) - balBefore != q) predictionMismatch++;

        uint256 newShares = pm.sharesOf(a);
        if (newShares > bal) sharesIncreasedOnWithdraw++;
        withdrawn[a] += q;
        lastAct[a] = blk;
        nWithdraws++;
        if (q < fromIdle) {
            nReCredits++;
            nCappedWithdraws++;
        } else if (fromIdle == 0) {
            // Zero-value exit: the S shares are worth < 1 raw unit (or the reserve is empty). Nothing can be delivered,
            // so the contract's "nothing delivered => keep the whole claim" rule returns every share — burning them would
            // strand < 1 unit of value on the exiter. Not a phantom (no cash left, no claim grew): asserted exact.
            nZeroValueExits++;
            if (newShares != bal) zeroValueExitViolations++;
        } else {
            if (q - fromIdle > maxOverDelivery) maxOverDelivery = q - fromIdle;
            // Idle leg paid in full and there is no LP leg: ANY share re-credit here is unbacked (phantom).
            uint256 burned = bal - newShares;
            if (burned < shares) {
                nPhantomReCredits++;
                if (shares - burned > maxPhantomReCredit) maxPhantomReCredit = shares - burned;
            }
        }
        if (lastHolder) {
            nLastHolderExits++;
            if (q > proRata) swept[a] += q - proRata;
        }

        // FEE source: the exit fee the source kept on the burned source shares is yield to whoever still holds
        // (incl. the exiter's remaining shares). Credit it pro-rata on POST-exit balances.
        uint256 feeKept = _feeRetained(srcTS - src.totalSupply(), srcTA, srcTS);
        if (feeKept > 0) {
            feeRetainedTotal += feeKept;
            _creditYield(feeKept);
        }

        // Scope invariant 2: the post-exit claim never exceeds the pre-exit claim minus what was delivered.
        // tol = the adapter's ceil-shares redeem can hand back up to (srcPrice - 1) extra raw units + 2 floors
        //       + (fee source) the exiter's own pro-rata slice of the fee they just paid into the source.
        (bool ok2, uint256 idleAfter) = _readable();
        if (ok2) {
            uint256 tsAfter = pm.totalShares();
            uint256 claimAfter = _toAssets(newShares, idleAfter, tsAfter);
            uint256 ownFeeShare = feeKept == 0 ? 0 : Math.mulDiv(feeKept, newShares, tsAfter, Math.Rounding.Ceil) + 1;
            if (claimAfter + q > claimBefore + srcP + 2 + ownFeeShare) reCreditViolations++;
        }
        uint256 pmP = _pmPriceCeil(idle, ts);
        globalSlack += srcP + 1; // adapter over-delivery + entitlement floor
        globalLossSlack += srcP; // that over-delivery is borne by the remaining holders
        deficitBound += srcP;
        ownLoss[a] += pmP + 1; // re-credit floors (< 1 PM share) + entitlement floor
    }

    /// Donation straight into the 4626 SOURCE by an actor (inflation-attack primitive / accrued yield).
    function donate(uint256 aSeed, uint256 amtSeed) external {
        address donor = actors[aSeed % N];
        uint256 amt = bound(amtSeed, 1, 5_000_000e6);
        usdg.mint(donor, amt);
        vm.prank(donor);
        usdg.approve(address(src), amt);
        vm.prank(donor);
        src.simulateYield(amt);
        donatedTotal += amt;
        nDonations++;
        _creditYield(amt);
    }

    /// Owner compound: pure accretion (no share mint).
    function compound(uint256 amtSeed) external {
        uint256 amt = bound(amtSeed, 1, 200_000e6);
        usdg.mint(address(this), amt);
        (bool readable,) = _readable();
        bytes4 expect = readable ? bytes4(0) : MintwareLpGatewayPositionManager.SourceUnavailable.selector;
        (bool ok, bytes memory ret) = address(pm).call(abi.encodeWithSelector(pm.compoundQuote.selector, amt));
        if (!ok) {
            _record("compound", _sel(ret), expect);
            return;
        }
        if (expect != bytes4(0)) _recordUnexpectedSuccess("compound", expect);
        compoundedTotal += amt;
        _creditYield(amt);
        globalLossSlack += _srcPriceCeil(); // source-share mint floors
        deficitBound += _srcPriceCeil();
    }

    function setPaused(bool p) external {
        pm.setPaused(p);
    }

    /// Adapter per-block withdraw cap: 0 = unlimited, else a cap that can bite a large exit.
    function setCap(uint256 capSeed) external {
        uint256 cap = capSeed % 3 == 0 ? 0 : bound(capSeed, 1, 500_000e6);
        adapter.setPerBlockWithdrawCap(cap);
    }

    function setFailWithdrawals(bool f) external {
        src.setFailWithdrawals(f);
    }

    function setRevertPreview(bool r) external {
        src.setRevertPreview(r);
    }

    function roll(uint8 n) external {
        _roll(bound(uint256(n), 1, 5));
    }
}

/// @notice Suite A — fee-free adversarial source. Scope §6 invariants 1, 2, 4, 5(inflation), 9(idle-only slice), 11.
/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 128
/// forge-config: default.invariant.fail-on-revert = false
contract InvariantIdleOnlyTest is Test {
    uint256 internal constant V = 1e6;

    IdleOnlyHandler internal h;
    MintwareLpGatewayPositionManager internal pm;
    MintwareLpGatewayStaging internal staging;
    MintwareERC4626YieldAdapter internal adapter;
    Audit3FlakySource internal src;
    MockERC20 internal usdg;

    function _feeBps() internal pure virtual returns (uint256) {
        return 0;
    }

    function setUp() public {
        h = new IdleOnlyHandler();
        usdg = new MockERC20("USD Global", "USDG", 6);
        MockERC20 pons = new MockERC20("Pons", "PONS", 18);
        src = new Audit3FlakySource(IERC20(address(usdg)));
        if (_feeBps() > 0) src.setExitFeeBps(_feeBps());
        adapter = new MintwareERC4626YieldAdapter(address(usdg), address(src), address(0), address(h));
        staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        vm.prank(address(h));
        adapter.setVault(address(staging));

        (address c0, address c1) =
            address(usdg) < address(pons) ? (address(usdg), address(pons)) : (address(pons), address(usdg));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        address stub = address(new Audit3Stub());
        pm = new MintwareLpGatewayPositionManager(
            IPoolManager(address(new MockSlot0PoolManager())), IPositionManager(stub), IPermit2Minimal(stub),
            key, IERC20(address(usdg)), -600, 600, staging, address(h), address(0x5151), 2000,
            type(uint256).max // IA-11 principal cap: uncapped -- this test predates/is unrelated to the cap
        );
        staging.setController(address(pm));
        h.init(pm, staging, adapter, src, usdg);

        bytes4[] memory sel = new bytes4[](10);
        sel[0] = IdleOnlyHandler.deposit.selector;
        sel[1] = IdleOnlyHandler.withdraw.selector;
        sel[2] = IdleOnlyHandler.deposit.selector; // weight deposits/withdraws 2x
        sel[3] = IdleOnlyHandler.withdraw.selector;
        sel[4] = IdleOnlyHandler.donate.selector;
        sel[5] = IdleOnlyHandler.compound.selector;
        sel[6] = IdleOnlyHandler.setPaused.selector;
        sel[7] = IdleOnlyHandler.setCap.selector;
        sel[8] = IdleOnlyHandler.setFailWithdrawals.selector;
        sel[9] = IdleOnlyHandler.setRevertPreview.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
        targetContract(address(h));
    }

    // (1) share conservation: the actors are the only depositors.
    function invariant_A1_sumSharesEqualsTotal() public view {
        assertEq(h.sumShares(), pm.totalShares(), "sum(sharesOf) != totalShares");
    }

    // (2) solvency at the current NAV: every holder's floor claim is covered, up to the VIRTUAL dust bound
    //     (Σ floor(s·(nav+V)/(ts+V)) < nav + V by the offset algebra; the strict `<= nav` form is A2b).
    function invariant_A2_solvency_claimsCoveredByNav() public view {
        assertLe(h.sumClaims(), pm.totalNav() + V, "sum(claims) > NAV + VIRTUAL");
    }

    // (2b) par-or-better: totalShares <= NAV up to the source's own mint-rounding (1 source share per stage),
    //      with each historical rounding loss SCALED by the NAV growth of every later deposit (`deficitBound` —
    //      proportional accounting preserves a deficit as a RATIO, so the absolute form needs the scaled bound).
    //      This is the strict solvency form — Σ claims <= NAV follows from it. Fee-free source only.
    function invariant_A2b_sharesNeverExceedNav_moduloSourceRounding() public view virtual {
        if (!pm.sourceReadable()) return;
        assertLe(pm.totalShares(), pm.totalNav() + h.deficitBound(), "totalShares > NAV + scaled source rounding slack");
    }

    // (3) no value creation: withdrawn + claim <= deposited + pro-rata yield + last-holder sweep + rounding left in pool.
    function invariant_A3_noValueCreation_perActor() public view {
        for (uint256 i; i < h.actorCount(); ++i) {
            address a = h.actors(i);
            assertLe(
                h.withdrawn(a) + h.claimOf(a),
                h.deposited(a) + h.yieldCredit(a) + h.swept(a) + h.globalSlack(),
                "actor extracted more than deposits + pro-rata yield + sweep + rounding"
            );
        }
    }

    // (4) scope inv. 2 — re-credit never mints value; a withdraw never raises the caller's share balance; and the
    //     direct F1 detector: an exit whose idle leg was paid IN FULL (no LP leg exists) re-credits ZERO shares.
    function invariant_A4_reCreditNeverMintsValue() public view {
        assertEq(h.reCreditViolations(), 0, "claim_after + delivered > claim_before + tol");
        assertEq(h.sharesIncreasedOnWithdraw(), 0, "sharesOf rose on a withdraw");
        assertEq(h.zeroValueExitViolations(), 0, "a zero-value exit burned shares against a zero claim");
        assertEq(h.nPhantomReCredits(), 0, "shares re-credited on a fully-paid idle-only exit (F1 phantom)");
    }

    // (5) scope inv. 4 — inflation defense / no principal loss: donations to the source (by anyone, any size,
    //     any time) never let another actor take an honest holder's principal beyond rounding.
    function invariant_A5_noPrincipalLoss_perActor() public view virtual {
        for (uint256 i; i < h.actorCount(); ++i) {
            address a = h.actors(i);
            assertGe(
                h.withdrawn(a) + h.claimOf(a) + h.ownLoss(a) + h.globalLossSlack(),
                h.deposited(a),
                "actor lost principal beyond rounding"
            );
        }
    }

    // (6) scope inv. 9 (idle-only slice) — deposit reverts iff paused / zero / same-block / source unreadable /
    //     zero shares / min not met; withdraw reverts ONLY for ZeroAmount / InsufficientShares / SameBlockAction /
    //     SourceUnavailable-with-zero-LP / SlippageExceeded. The set of unexpected selectors must be empty, and a
    //     predicted revert must actually revert.
    function invariant_A6_revertSetIsExact() public view {
        assertEq(h.unexpectedReverts(), 0, string.concat("unexpected revert in ", h.lastUnexpectedAction()));
        assertEq(
            h.expectedRevertButSucceeded(),
            0,
            string.concat("a predicted revert did not revert in ", h.lastExpectedButOkAction())
        );
        assertEq(h.predictionMismatch(), 0, "minted shares / delivered quote differ from the pre-state formula");
    }

    // (7) scope inv. 11 — lastKnownIdle never over-states the live reserve while the source is readable.
    function invariant_A7_lastKnownIdleConservative() public view {
        if (!pm.sourceReadable()) return;
        assertLe(pm.lastKnownIdle(), staging.stagedAssets(), "lastKnownIdle > live stagedAssets");
    }

    // (8) scope inv. 5 quantified — an existing holder's claim can fall on someone else's deposit by at most
    //     the fee term (fee-net NAV vs par mint: amt·fee·s/(ts'+V)) plus source rounding. Fee-free: rounding only.
    function invariant_A8_depositDilutionBounded() public view {
        assertEq(h.dilutionViolations(), 0, "existing holder diluted beyond fee-term + rounding");
    }

    // NOTE: no `afterInvariant` non-vacuity ASSERT on purpose — the shrinker treats ANY failing candidate as
    // "still failing", so a vacuity assert makes every counterexample shrink to a meaningless 1-call sequence.
    // Coverage is witnessed by the deterministic long replay below (its logs print with -vv; invariant-campaign
    // logs do not) + the concrete regressions in InvariantRegressions.t.sol.

    /// One long pseudo-random run over the SAME handler (3,000 calls) — reports which states were reached.
    function test_witness_deterministicReplay_3000calls() public {
        // Prefix: the F2 shape (donation into the EMPTY source, then a dust deposit) so the XR-3 `StageShortfall`
        // prediction is provably exercised — the random tail rarely donates before the first deposit.
        h.donate(0, 3000);
        h.deposit(0, 1000, false, 0); // floor(1000·1/3001) = 0 source shares → must revert StageShortfall
        assertEq(h.nStageShortfalls(), 1, "prefix reached StageShortfall");
        assertEq(h.unexpectedReverts(), 0, "StageShortfall was predicted");
        uint256 seed = 0xA3;
        for (uint256 i; i < 3000; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 op = seed % 12;
            uint256 x = uint256(keccak256(abi.encode(seed, 1)));
            bool b = (seed >> 4) & 1 == 1;
            bool rare = (seed >> 5) % 4 == 0; // toggles ON only 25% of the time so the rig is not mostly degraded
            bytes memory cd;
            if (op < 3) cd = abi.encodeWithSelector(IdleOnlyHandler.deposit.selector, seed >> 8, x, b, uint8(seed >> 16));
            else if (op < 6) cd = abi.encodeWithSelector(IdleOnlyHandler.withdraw.selector, seed >> 8, x, b, uint8(seed >> 16));
            else if (op == 6) cd = abi.encodeWithSelector(IdleOnlyHandler.donate.selector, seed >> 8, x);
            else if (op == 7) cd = abi.encodeWithSelector(IdleOnlyHandler.compound.selector, x);
            else if (op == 8) cd = abi.encodeWithSelector(IdleOnlyHandler.setPaused.selector, rare);
            else if (op == 9) cd = abi.encodeWithSelector(IdleOnlyHandler.setCap.selector, x);
            else if (op == 10) cd = abi.encodeWithSelector(IdleOnlyHandler.setFailWithdrawals.selector, rare);
            else cd = abi.encodeWithSelector(IdleOnlyHandler.setRevertPreview.selector, rare);
            (bool ok,) = address(h).call(cd);
            ok;
        }
        console2.log("deposits / withdraws / donations", h.nDeposits(), h.nWithdraws(), h.nDonations());
        console2.log("stage-shortfall refusals (XR-3) / fee retained by source (raw)", h.nStageShortfalls(), h.feeRetainedTotal());
        console2.log("capped-or-stalled withdraws / last-holder exits / outage attempts", h.nCappedWithdraws(), h.nLastHolderExits(), h.nOutageAttempts());
        console2.log("phantom re-credits (count / max shares) / max adapter over-delivery", h.nPhantomReCredits(), h.maxPhantomReCredit(), h.maxOverDelivery());
        console2.log("zero-value exits (all shares returned) / violations", h.nZeroValueExits(), h.zeroValueExitViolations());
        console2.log("violations: unexpectedReverts / expectedButOk / predictionMismatch", h.unexpectedReverts(), h.expectedRevertButSucceeded(), h.predictionMismatch());
        console2.log("violations: reCredit / dilution / max dilution observed", h.reCreditViolations(), h.dilutionViolations(), h.maxDilutionObserved());
        assertGt(h.nDeposits(), 100, "replay reached deposits");
        assertGt(h.nWithdraws(), 100, "replay reached withdraws");
    }
}

/// @notice Suite A' — same handler over a FEE-CHARGING source (10 bps exit fee, XyloVault/L-05 shape).
///         The lower-bound invariant A5 is not expected to hold verbatim (the fee IS a loss); A8 quantifies it.
/// forge-config: default.invariant.runs = 128
/// forge-config: default.invariant.depth = 96
/// forge-config: default.invariant.fail-on-revert = false
contract InvariantIdleOnlyFeeSourceTest is InvariantIdleOnlyTest {
    function _feeBps() internal pure override returns (uint256) {
        return 10;
    }

    // Fee-net NAV sits below par by construction; the strict form does not apply. Solvency (A2) still must.
    function invariant_A2b_sharesNeverExceedNav_moduloSourceRounding() public view override {}

    // The fee is a real, one-directional loss; A8 bounds it per deposit. Keep a fee-adjusted lower bound: the
    // whole system's haircut is fee x (everything that ever entered the source), and no actor can lose more
    // than that plus rounding. (Loose but sound; the per-deposit sharp bound is A8.)
    function invariant_A5_noPrincipalLoss_perActor() public view override {
        uint256 entered = h.donatedTotal() + h.compoundedTotal();
        for (uint256 i; i < h.actorCount(); ++i) {
            entered += h.deposited(h.actors(i));
        }
        uint256 feeLoss = Math.mulDiv(entered, _feeBps(), 10_000, Math.Rounding.Ceil);
        for (uint256 i; i < h.actorCount(); ++i) {
            address a = h.actors(i);
            assertGe(
                h.withdrawn(a) + h.claimOf(a) + h.ownLoss(a) + h.globalLossSlack() + feeLoss,
                h.deposited(a),
                "actor lost more than fee + rounding"
            );
        }
    }
}
