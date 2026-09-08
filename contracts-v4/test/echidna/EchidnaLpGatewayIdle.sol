// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

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
import {MockSlot0PoolManager} from "../mocks/MockSlot0PoolManager.sol";
import {Audit3FlakySource, Audit3Stub} from "../audit3/InvariantMocks.sol";

/// @dev Depositor stand-in. Echidna / Medusa drive the HARNESS, which routes every gateway call through one of
///      these so `msg.sender` at the PM is a distinct account with its own `sharesOf` and `_lastActionBlock`.
///      Deliberately dumb: no logic that could mask a PM bug.
contract GwActor {
    function approve(IERC20 t, address spender) external {
        t.approve(spender, type(uint256).max);
    }

    function call(address target, bytes calldata data) external returns (bool ok, bytes memory ret) {
        (ok, ret) = target.call(data);
    }
}

/// @title  Echidna / Medusa property harness — LP gateway PositionManager, IDLE-ONLY rig
/// @notice Independent-engine port of the highest-value subset of the round-3 Foundry invariants
///         (`contracts-v4/test/audit3/InvariantIdleOnly.t.sol`, `docs/developers/audits/round3/invariant-fuzzing.md`).
///         The point is NOT to restate Foundry's result — it is to hit the same state space with a different
///         engine (different corpus, mutation strategy, sender model, and — critically — a block/timestamp
///         schedule the engine itself chooses rather than one the handler drives with `vm.roll`).
///
/// @dev    Rig: PRODUCTION share math end to end —
///           PM -> MintwareLpGatewayStaging -> MintwareERC4626YieldAdapter -> Audit3FlakySource (adversarial 4626).
///         `tokenId` stays 0 (no `deploy`: the position manager is a codeless-behaviour stub), so v4 is never
///         entered and the LP-leg terms drop out of every formula. That makes the withdraw share math EXACTLY
///         reproducible from pre-state, which is what lets this harness assert a *bit-exact shadow* of both
///         `_deposit` and `_withdraw` rather than an inequality with a tuned slack. The follower
///         (`_anchorFollow`) IS fully live here — it only reads `poolManager.getSlot0`, which
///         `MockSlot0PoolManager` answers — so the band property is faithful, not vacuous.
///
///         No cheatcodes, no `forge-std`: every property is plain Solidity so both engines can run it.
///         Block progression is the ENGINE's (Echidna `blockNumberDelay`, Medusa `blockNumberDelayMax`) —
///         a genuinely different schedule from the Foundry handler's own `blk` counter.
///
///         Properties encoded (task priorities 1, 2 and 4; priority 3 lives in the sibling deploy rig):
///           P1  `echidna_shares_conserved`        Σ sharesOf(actor) == totalShares                      (exact)
///           P2  `echidna_solvent`                 Σ floor-claims <= NAV + VIRTUAL                       (exact)
///           P3  `echidna_token_conservation`      totalNav + Σ withdrawn <= Σ deposited + Σ donated     (exact)
///           P4  `echidna_mint_shadow`             every mint == mulDiv(amt, ts+V, nav+V) from pre-state (exact)
///           P5  `echidna_exit_shadow`             every burn/re-credit == the `_withdraw` formula        (exact)
///           P6  `echidna_no_free_lunch`           per-actor: out + claim <= in + yield entitlement + tol
///           P7  `echidna_follower_band`           |Δ_refSqrtPrice| <= ref*maxDeviationBps/1e4, <=1/block (exact)
///           P8  `echidna_last_known_idle`         lastKnownIdle <= live idle whenever the source answers
///           P9  `echidna_no_unexpected_revert`    the revert SET matches a pre-state prediction
///          P10  `echidna_no_phantom_recredit`     an exit paid in full burns every share it asked to
contract EchidnaLpGatewayIdle {
    uint256 internal constant V = 1e6; // PM VIRTUAL
    uint256 internal constant N = 4;
    uint160 internal constant SQRT_ONE = 0x1000000000000000000000000; // 2**96
    uint16 internal constant DEV_BPS = 2000;

    MintwareLpGatewayPositionManager public pm;
    MintwareLpGatewayStaging public staging;
    MintwareERC4626YieldAdapter public adapter;
    Audit3FlakySource public src;
    MockERC20 public usdg;
    MockSlot0PoolManager public mockPool;

    GwActor[4] public actors;

    // ── ghosts ──────────────────────────────────────────────────────────────────────────────
    mapping(address => uint256) public depositedOf;
    mapping(address => uint256) public withdrawnOf;
    /// Upper bound on the yield an actor is entitled to: at every donation / compound, each holder is credited
    /// CEIL(amount * sharesOf / totalShares). Ceil + per-actor accumulation makes this an over-estimate, which is
    /// the safe direction for a "no value creation" check (it can only mask, never fabricate, a violation).
    mapping(address => uint256) public yieldCreditOf;
    /// Rounding an actor's OWN operations can legitimately hand them: one PM price-unit per op, plus the
    /// virtual-offset dust a LAST holder legitimately sweeps. Derived from the contract math, not tuned to fit.
    mapping(address => uint256) public slackOf;
    mapping(address => uint256) internal lastAct; // mirror of PM `_lastActionBlock` (updated on success only)

    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public totalDonated;

    // ── violation counters (each property asserts its counter is 0) ─────────────────────────
    uint256 public mintShadowViolations;
    uint256 public exitShadowViolations;
    uint256 public freeLunchViolations;
    uint256 public followerBandViolations;
    uint256 public followerStepViolations; // moved more than once in a block, or to the wrong value
    uint256 public staleIdleViolations;
    uint256 public unexpectedReverts;
    uint256 public expectedRevertButSucceeded;
    uint256 public phantomReCredits;
    uint256 public sharesUpOnWithdraw;

    // ── diagnostics for the shrunk counterexample ───────────────────────────────────────────
    bytes4 public lastUnexpectedSelector;
    uint256 public lastExitExpectedBurn;
    uint256 public lastExitActualBurn;
    uint256 public lastMintExpected;
    uint256 public lastMintActual;
    uint160 public lastRefBefore;
    uint160 public lastRefAfter;

    // ── witnesses (campaign evidence — read out of the corpus / a replay) ───────────────────
    uint256 public nDeposits;
    uint256 public nWithdraws;
    uint256 public nDonations;
    uint256 public nOutageAttempts;
    uint256 public nShortWithdraws; // idle leg served less than the entitlement -> re-credit path
    uint256 public nLastHolderExits;
    uint256 public nZeroValueExits;
    uint256 public nStageShortfalls;
    uint256 public nFollowerSteps;
    uint256 public nRevertsSeen;

    constructor() {
        usdg = new MockERC20("Mock USDG", "tUSDG", 6);
        src = new Audit3FlakySource(IERC20(address(usdg)));
        adapter = new MintwareERC4626YieldAdapter(address(usdg), address(src), address(0), address(this));
        staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        adapter.setVault(address(staging));

        mockPool = new MockSlot0PoolManager();
        Audit3Stub stub = new Audit3Stub();

        MockERC20 paired = new MockERC20("Mock PAIRED", "tPAIR", 18);
        // quote is currency0 iff its address sorts first — record which, the follower's direction semantics
        // (`_marksHigher`) depend on it and we want both orders reachable across runs.
        (address c0, address c1) = address(usdg) < address(paired)
            ? (address(usdg), address(paired))
            : (address(paired), address(usdg));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        pm = new MintwareLpGatewayPositionManager(
            IPoolManager(address(mockPool)),
            IPositionManager(address(stub)),
            IPermit2Minimal(address(stub)),
            key,
            IERC20(address(usdg)),
            -23040,
            23040,
            staging,
            address(this), // owner: the harness drives setPaused / compoundQuote
            address(0xFEE), // harvest recipient
            DEV_BPS
        );
        staging.setController(address(pm));

        for (uint256 i; i < N; ++i) {
            actors[i] = new GwActor();
            usdg.mint(address(actors[i]), 1_000_000_000e6);
            actors[i].approve(IERC20(address(usdg)), address(pm));
        }
        // harness float for donations / compounds
        usdg.mint(address(this), 1_000_000_000e6);
        usdg.approve(address(src), type(uint256).max);
        usdg.approve(address(pm), type(uint256).max);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // helpers
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function _actor(uint8 seed) internal view returns (GwActor a, address addr) {
        a = actors[seed % N];
        addr = address(a);
    }

    function _sel(bytes memory ret) internal pure returns (bytes4 s) {
        if (ret.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            s := mload(add(ret, 32))
        }
    }

    /// The PM's `_idle()` — staged reserve plus quote parked in the PM — and whether the source answered.
    function _idle() internal view returns (bool ok, uint256 idle) {
        try staging.stagedAssets() returns (uint256 v) {
            return (true, v + usdg.balanceOf(address(pm)));
        } catch {
            return (false, 0);
        }
    }

    /// The exact idle figure `_withdraw` sizes its entitlement off, including the R3-1 outage haircut.
    function _withdrawIdle() internal view returns (bool ok, uint256 idle) {
        (ok, idle) = _idle();
        if (!ok) idle = (pm.lastKnownIdle() * (10_000 - uint256(pm.OUTAGE_HAIRCUT_BPS()))) / 10_000;
    }

    /// Mirror of the PM's `_predictStageShortfall` condition (XR-3): would the reserve fail to grow by
    /// ~`amt`?  Computed entirely from the source's own pre-state mint/redeem math.
    function _predictStageShortfall(uint256 amt, uint256 idleBefore) internal view returns (bool) {
        uint256 tA = src.totalAssets();
        uint256 tS = src.totalSupply();
        uint256 m = src.previewDeposit(amt);
        uint256 sharesAfter = src.balanceOf(address(adapter)) + m;
        uint256 gross = Math.mulDiv(sharesAfter, tA + amt + 1, tS + m + 1);
        uint256 net = gross - Math.mulDiv(gross, src.exitFeeBps(), 10_000);
        uint256 idleAfter = net + usdg.balanceOf(address(pm));
        uint256 need = idleBefore + amt - (amt * uint256(pm.STAGE_TOLERANCE_BPS())) / 10_000;
        return idleAfter < need;
    }

    function claimOf(address a) public view returns (uint256) {
        uint256 ts = pm.totalShares();
        if (ts == 0) return 0;
        return Math.mulDiv(pm.sharesOf(a), pm.totalNav() + V, ts + V);
    }

    function sumShares() public view returns (uint256 s) {
        for (uint256 i; i < N; ++i) s += pm.sharesOf(address(actors[i]));
    }

    /// One PM share is worth at most `ceil((nav+V)/(ts+V))` — the rounding unit an actor's own op can cost
    /// or hand them.
    function _pmPriceCeil() internal view returns (uint256) {
        (, uint256 idle) = _idle();
        return Math.ceilDiv(idle + V, pm.totalShares() + V);
    }

    /// Credit every current holder a CEIL pro-rata slice of `amount` (donation / compound). Over-estimates on
    /// purpose — the free-lunch check must never fire on honest yield.
    function _creditYield(uint256 amount) internal {
        uint256 ts = pm.totalShares();
        if (ts == 0) return;
        for (uint256 i; i < N; ++i) {
            address a = address(actors[i]);
            uint256 sh = pm.sharesOf(a);
            if (sh > 0) yieldCreditOf[a] += Math.ceilDiv(amount * sh, ts);
        }
    }

    /// Snapshot the follower, run `body`, then assert the clamped-follower contract:
    ///   - it moves at most ONE bounded step, and only when `block.number > _refBlock`;
    ///   - the value it moves to is EXACTLY `spot` clamped to `ref ± ref*maxDeviationBps/1e4`.
    /// Every gateway entry point calls `_anchorFollow`, so this runs on all of them.
    function _checkFollower(uint160 refBefore, uint64 refBlockBefore) internal {
        (uint160 refAfter, uint64 refBlockAfter,) = pm.referencePrice();
        lastRefBefore = refBefore;
        lastRefAfter = refAfter;
        if (refAfter == refBefore) return;
        ++nFollowerSteps;

        // A step is only legal in a block strictly after the one the reference last moved in.
        if (!(block.number > refBlockBefore) || refBlockAfter != uint64(block.number)) {
            ++followerStepViolations;
            return;
        }
        uint160 spot = mockPool.sqrtPrice();
        uint160 maxStep = uint160((uint256(refBefore) * DEV_BPS) / 10_000);
        uint160 expected;
        if (spot > refBefore) {
            expected = (spot - refBefore) > maxStep ? refBefore + maxStep : spot;
        } else {
            expected = (refBefore - spot) > maxStep ? refBefore - maxStep : spot;
        }
        if (refAfter != expected) ++followerStepViolations;

        uint256 delta = refAfter > refBefore ? refAfter - refBefore : refBefore - refAfter;
        if (delta > maxStep) ++followerBandViolations; // P7 proper: never more than the band in one call
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // fuzz entry points
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function deposit(uint8 who, uint256 amtSeed) public {
        _deposit(who, amtSeed, 0, false);
    }

    function depositWithMin(uint8 who, uint256 amtSeed, uint256 minSeed) public {
        _deposit(who, amtSeed, minSeed, true);
    }

    // Prediction/observation state is carried in MEMORY structs: the handlers otherwise hold ~20 live
    // locals across an external call, which trips solc's via-IR StackTooDeep (crytic-compile drives solc
    // directly rather than through Foundry's standard-json settings, so the limit bites here).
    struct DepCtx {
        address addr;
        uint256 amt;
        uint256 ts;
        uint256 idleBefore;
        uint256 expShares;
        uint256 minOut;
        bool idleOk;
        bool expShortfall;
        bool expSrcDown;
        bool expectedRevert;
        uint160 refB;
        uint64 refBlkB;
    }

    struct WdCtx {
        address addr;
        uint256 bal;
        uint256 shares;
        uint256 ts;
        uint256 idle;
        uint256 fromIdle;
        uint256 minQ;
        uint256 balBefore;
        bool idleOk;
        bool lastHolder;
        bool expectedRevert;
        uint160 refB;
        uint64 refBlkB;
    }

    /// Everything the deposit spec says about this call, computed from PRE-state only.
    function _predictDeposit(uint8 who, uint256 amtSeed, uint256 minSeed, bool withMin)
        internal
        view
        returns (DepCtx memory c)
    {
        (, c.addr) = _actor(who);
        c.amt = amtSeed % 500_000e6; // 0 reachable on purpose — ZeroAmount is part of the revert set
        uint256 bal = usdg.balanceOf(c.addr);
        if (c.amt > bal) c.amt = bal;

        (c.idleOk, c.idleBefore) = _idle();
        c.ts = pm.totalShares();
        c.expShares = c.idleOk ? Math.mulDiv(c.amt, c.ts + V, c.idleBefore + V) : 0;

        bool expZero = c.amt == 0;
        bool expZeroShares = c.idleOk && !expZero && c.expShares == 0;
        c.minOut = withMin ? (minSeed % (c.expShares + 2)) : 0;
        bool expSlippage = c.idleOk && !expZero && !expZeroShares && c.expShares < c.minOut;
        uint256 srcRoom = src.maxDeposit(address(adapter));
        bool expSrcCap = c.idleOk && !expZero && c.amt > srcRoom;
        c.expShortfall = c.idleOk && !expZero && !expZeroShares && !expSlippage && !expSrcCap
            && _predictStageShortfall(c.amt, c.idleBefore);
        c.expSrcDown = !c.idleOk;

        c.expectedRevert = pm.paused() || expZero || (lastAct[c.addr] == block.number) || c.expSrcDown
            || expZeroShares || expSlippage || c.expShortfall || expSrcCap;

        (c.refB, c.refBlkB,) = pm.referencePrice();
    }

    function _deposit(uint8 who, uint256 amtSeed, uint256 minSeed, bool withMin) internal {
        DepCtx memory c = _predictDeposit(who, amtSeed, minSeed, withMin);
        GwActor a = actors[who % N];

        (bool ok, bytes memory ret) = a.call(
            address(pm),
            withMin
                ? abi.encodeWithSelector(pm.depositWithMin.selector, c.amt, c.minOut)
                : abi.encodeWithSelector(pm.deposit.selector, c.amt)
        );

        if (!ok) {
            ++nRevertsSeen;
            if (c.expShortfall) ++nStageShortfalls;
            if (c.expSrcDown) ++nOutageAttempts;
            if (!c.expectedRevert) {
                ++unexpectedReverts;
                lastUnexpectedSelector = _sel(ret);
            }
            return;
        }
        if (c.expectedRevert) {
            ++expectedRevertButSucceeded;
            return;
        }

        // ── shadow: the mint is EXACT ──
        uint256 minted = abi.decode(ret, (uint256));
        lastMintExpected = c.expShares;
        lastMintActual = minted;
        if (minted != c.expShares) ++mintShadowViolations;

        ++nDeposits;
        lastAct[c.addr] = block.number;
        depositedOf[c.addr] += c.amt;
        totalDeposited += c.amt;
        slackOf[c.addr] += Math.ceilDiv(c.idleBefore + c.amt + V, c.ts + minted + V);
        _checkFollower(c.refB, c.refBlkB);
    }

    function withdraw(uint8 who, uint256 shareSeed) public {
        _withdraw(who, shareSeed, false, 0);
    }

    function withdrawWithMin(uint8 who, uint256 shareSeed, uint256 minSeed) public {
        _withdraw(who, shareSeed, true, minSeed);
    }

    /// The closed form of `_withdraw` in the idle-only rig (tokenId == 0 ⇒ navW == idle, lpSpotVal == 0,
    /// liqToRemove == 0), computed from PRE-state only.
    function _predictWithdraw(uint8 who, uint256 shareSeed, bool withMin, uint256 minSeed)
        internal
        view
        returns (WdCtx memory c)
    {
        (, c.addr) = _actor(who);
        c.bal = pm.sharesOf(c.addr);
        c.shares = c.bal == 0 ? (shareSeed % 3) : (shareSeed % (c.bal + 2)); // over-balance reachable
        c.ts = pm.totalShares();

        bool expZero = c.shares == 0;
        bool expInsufficient = !expZero && c.shares > c.bal;
        bool expSameBlock = !expZero && !expInsufficient && lastAct[c.addr] == block.number;

        (c.idleOk, c.idle) = _withdrawIdle();
        c.lastHolder = c.shares == c.ts && c.ts != 0;

        if (!expZero && !expInsufficient && c.ts != 0) {
            uint256 claimTotal = c.lastHolder ? c.idle : Math.mulDiv(c.shares, c.idle + V, c.ts + V);
            if (claimTotal > c.idle) claimTotal = c.idle;
            c.fromIdle = claimTotal; // navW == idle ⇒ the whole claim is the idle leg
        }

        // `!idleOk && liqToRemove == 0` ⇒ SourceUnavailable (F1-b: the refusal is live again)
        c.expectedRevert = expZero || expInsufficient || expSameBlock
            || (!expZero && !expInsufficient && !expSameBlock && !c.idleOk);

        c.minQ = withMin ? (minSeed % (c.fromIdle + 2)) : 0;
        c.balBefore = usdg.balanceOf(c.addr);
        (c.refB, c.refBlkB,) = pm.referencePrice();
    }

    function _withdraw(uint8 who, uint256 shareSeed, bool withMin, uint256 minSeed) internal {
        WdCtx memory c = _predictWithdraw(who, shareSeed, withMin, minSeed);
        GwActor a = actors[who % N];

        (bool ok, bytes memory ret) = a.call(
            address(pm),
            withMin
                ? abi.encodeWithSelector(pm.withdrawWithMin.selector, c.shares, c.minQ, uint256(0))
                : abi.encodeWithSelector(pm.withdraw.selector, c.shares)
        );

        if (!ok) {
            ++nRevertsSeen;
            if (!c.idleOk) ++nOutageAttempts;
            // SlippageExceeded is legal whenever the caller's floor could not be met by the reserve on hand.
            bool slippagePossible = withMin && c.minQ > 0;
            if (!c.expectedRevert && !slippagePossible) {
                ++unexpectedReverts;
                lastUnexpectedSelector = _sel(ret);
            }
            return;
        }
        if (c.expectedRevert) {
            ++expectedRevertButSucceeded;
            return;
        }

        _scoreWithdraw(c, ret);
    }

    /// Split out purely to keep the stack shallow across the external call.
    function _scoreWithdraw(WdCtx memory c, bytes memory ret) internal {
        (uint256 quoteOut,) = abi.decode(ret, (uint256, uint256));
        uint256 delivered = usdg.balanceOf(c.addr) - c.balBefore;
        uint256 balAfter = pm.sharesOf(c.addr);

        if (balAfter > c.bal) ++sharesUpOnWithdraw;
        uint256 burned = c.bal - balAfter;

        // ── shadow: the burn / re-credit is EXACT (idle-only closed form of `_withdraw`) ──
        // reCredit = shares                                   if nothing was delivered
        //          = mulDiv(shares, fromIdle - got, fromIdle)  otherwise (denomHigh == fromIdle, lpEntitled == 0)
        uint256 expReCredit;
        if (delivered == 0) {
            expReCredit = c.shares;
        } else if (c.fromIdle > delivered) {
            expReCredit = Math.mulDiv(c.shares, c.fromIdle - delivered, c.fromIdle);
        }
        if (expReCredit > c.shares) expReCredit = c.shares;
        uint256 expBurn = c.shares - expReCredit;
        lastExitExpectedBurn = expBurn;
        lastExitActualBurn = burned;
        if (burned != expBurn) ++exitShadowViolations;
        if (quoteOut != delivered) ++exitShadowViolations;

        // ── P10: an exit whose entitlement was delivered IN FULL must burn every share it asked to ──
        if (c.fromIdle > 0 && delivered >= c.fromIdle && burned != c.shares) ++phantomReCredits;
        if (c.fromIdle == 0) {
            ++nZeroValueExits;
            if (burned != 0) ++phantomReCredits; // nothing to deliver ⇒ every share comes back
        }
        if (delivered < c.fromIdle) ++nShortWithdraws;
        if (c.lastHolder) ++nLastHolderExits;

        ++nWithdraws;
        lastAct[c.addr] = block.number;
        withdrawnOf[c.addr] += delivered;
        totalWithdrawn += delivered;
        // One PM price-unit of rounding per op, plus (last holder only) the virtual-offset dust the final exit
        // legitimately sweeps — both derived from the contract's own math, not tuned to fit an observation.
        slackOf[c.addr] += Math.ceilDiv(c.idle + V, c.ts + V);
        if (c.lastHolder && delivered > 0) slackOf[c.addr] += V;
        _checkFollower(c.refB, c.refBlkB);
    }

    /// Yield / donation into the source: assets-per-share rises for the adapter (accrual, or an inflation attack
    /// on a near-empty source — the F2 shape).
    function donate(uint256 amtSeed) public {
        uint256 amt = amtSeed % 100_000e6;
        if (amt == 0) return;
        if (amt > usdg.balanceOf(address(this))) return;
        uint256 before = staging.stagedAssets();
        try src.simulateYield(amt) {
            uint256 gained = staging.stagedAssets() - before;
            _creditYield(gained);
            totalDonated += amt;
            ++nDonations;
        } catch {}
    }

    /// Owner-gated accretion: stage quote back into the reserve, lifting NAV for everyone with no mint.
    function compound(uint256 amtSeed) public {
        uint256 amt = amtSeed % 50_000e6;
        if (amt == 0) return;
        if (amt > usdg.balanceOf(address(this))) return;
        uint256 before = staging.stagedAssets();
        (uint160 refB, uint64 refBlkB,) = pm.referencePrice();
        try pm.compoundQuote(amt) {
            _creditYield(staging.stagedAssets() - before);
            totalDonated += amt;
            _checkFollower(refB, refBlkB);
        } catch {}
    }

    // ── adversarial levers on the third-party source ────────────────────────────────────────

    function setStall(bool f) public {
        src.setFailWithdrawals(f);
    }

    function setPreviewRevert(bool r) public {
        src.setRevertPreview(r);
    }

    function setExitFee(uint16 bps) public {
        src.setExitFeeBps(bps % 1000); // < 10%
    }

    function setSupplyCap(uint256 capSeed) public {
        // 0 = uncapped; otherwise a cap at or near the current level so `RestageDeferred` / cap refusals bite.
        src.setSupplyCap(capSeed % 4 == 0 ? 0 : src.totalAssets() + (capSeed % 200_000e6));
    }

    function setPerBlockCap(uint256 capSeed) public {
        adapter.setPerBlockWithdrawCap(capSeed % 3 == 0 ? 0 : (capSeed % 200_000e6) + 1);
    }

    function setPaused(bool p) public {
        pm.setPaused(p);
    }

    // ── price / follower levers ─────────────────────────────────────────────────────────────

    /// Move the pool's spot sqrtPrice anywhere in a wide but valid band, then let the next gateway action (or
    /// `pokeFollower`) try to walk the clamped follower onto it. This is the attacker's only price lever.
    function setSpot(uint256 seed) public {
        uint160 s = uint160(SQRT_ONE / 64 + (seed % (uint256(SQRT_ONE) * 64)));
        if (s == 0) s = 1;
        mockPool.setSqrtPrice(s);
    }

    /// Permissionless follower liveness — the exact surface an attacker uses to walk `ref` toward a dumped spot.
    function pokeFollower() public {
        (uint160 refB, uint64 refBlkB,) = pm.referencePrice();
        pm.poke();
        _checkFollower(refB, refBlkB);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // properties  (Echidna: `echidna_` prefix. Medusa points `testPrefixes` at the same names.)
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// P1 — share conservation. All shares are held by our four actors, so this is exact, no slack.
    function echidna_shares_conserved() public view returns (bool) {
        return sumShares() == pm.totalShares();
    }

    /// P2 — solvency: the sum of every holder's floor-rounded claim can never exceed NAV (+ one virtual offset).
    function echidna_solvent() public view returns (bool) {
        uint256 ts = pm.totalShares();
        if (ts == 0) return true;
        uint256 nav = pm.totalNav();
        uint256 total;
        for (uint256 i; i < N; ++i) {
            total += Math.mulDiv(pm.sharesOf(address(actors[i])), nav + V, ts + V);
        }
        return total <= nav + V;
    }

    /// P3 — hard token conservation: value can leave the system through rounding but never be created.
    /// `totalNav` is fee-net (`previewRedeem`) so it can only understate what backs it.
    function echidna_token_conservation() public view returns (bool) {
        return pm.totalNav() + totalWithdrawn <= totalDeposited + totalDonated;
    }

    /// P4 — every deposit minted EXACTLY the pre-state formula's share count.
    function echidna_mint_shadow() public view returns (bool) {
        return mintShadowViolations == 0;
    }

    /// P5 — every withdrawal burned/re-credited EXACTLY what `_withdraw`'s closed form prescribes.
    function echidna_exit_shadow() public view returns (bool) {
        return exitShadowViolations == 0 && sharesUpOnWithdraw == 0;
    }

    /// P6 — no actor can end up with more than they put in plus their (over-estimated) yield entitlement.
    ///      This is the property class that caught F1 in the Foundry campaign.
    function echidna_no_free_lunch() public view returns (bool) {
        for (uint256 i; i < N; ++i) {
            address a = address(actors[i]);
            uint256 got = withdrawnOf[a] + claimOf(a);
            uint256 entitled = depositedOf[a] + yieldCreditOf[a] + slackOf[a];
            if (got > entitled) return false;
        }
        return freeLunchViolations == 0;
    }

    /// P7 — the clamped follower never moves more than `maxDeviationBps` of itself in one call, never moves
    ///      twice in a block, and lands on exactly the clamped value. (Task priority 4.)
    function echidna_follower_band() public view returns (bool) {
        return followerBandViolations == 0 && followerStepViolations == 0;
    }

    /// P8 — `lastKnownIdle` is conservative: whenever the source answers, the cached figure never exceeds live.
    function echidna_last_known_idle() public view returns (bool) {
        (bool ok, uint256 idle) = _idle();
        if (!ok) return true;
        return pm.lastKnownIdle() <= idle && staleIdleViolations == 0;
    }

    /// P9 — the revert SET is exactly the specified one (scope invariant 9).
    function echidna_no_unexpected_revert() public view returns (bool) {
        return unexpectedReverts == 0 && expectedRevertButSucceeded == 0;
    }

    /// P10 — no phantom re-credit: an exit whose entitlement was delivered in full burns every share.
    function echidna_no_phantom_recredit() public view returns (bool) {
        return phantomReCredits == 0;
    }

    /// Structural: `deployedPrincipal` must stay 0 in a rig that never deploys — a guard that this harness is
    /// actually exercising the idle path and not silently entering v4 (the deploy cap lives in the sibling rig).
    function echidna_idle_rig_never_deploys() public view returns (bool) {
        return pm.tokenId() == 0 && pm.deployedPrincipal() == 0;
    }
}
