// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {SeniorSharesMath} from "../lib/SeniorSharesMath.sol";
import {MintwareLpGatewayStaging} from "./MintwareLpGatewayStaging.sol";

/// @dev The one Permit2 call the official V4 PositionManager needs from us: it pulls settled tokens
///      via Permit2 on SETTLE_PAIR, so we pre-authorize it. Declared locally to avoid a permit2 remap.
interface IPermit2Minimal {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @title  MintwareLpGatewayPositionManager
/// @notice The **LP** product (docs/developers/lp-gateway-earn-vs-lp-decision.md, 2026-09-08): one aggregate
///         Uniswap V4 position per pool, wrapping the OFFICIAL V4 PositionManager periphery. Depositors get
///         entry-NAV shares (mark-to-market at deposit; no fee-growth checkpoint accounting). Quote-asset
///         (USDG) briefly sits in the staging reserve — a doorway, not a feature — between a user's deposit
///         and the owner's next `deploy()`, which converts the FULL committed amount (no held-back buffer;
///         MAX_DEPLOY_BPS = 10000) into a two-sided position by swapping part of it INTO the paired leg
///         atomically, in-contract. Harvest collects fees via a zero-liquidity-delta call — principal is
///         never touched.
/// @dev    Deliberately thin: all LP-position math is Uniswap's audited periphery (PositionManager +
///         LiquidityAmounts) and pool state is read via StateLibrary; the ONLY swap logic this contract owns
///         is the zap (`deploy()`'s quote→paired conversion + its leftover-paired cleanup swap), executed via
///         the standard V4 unlock/settle round-trip. NAV values the deployed leg at the current pool (spot)
///         price — an LP position is IL-exposed by construction, and **100% of that IL is the user's** —
///         Mintware supplies no capital to any position and bears none of it. This is the honest mark; NO par
///         or guaranteed-value claim is made or implied anywhere. Earn (lending, no IL, no pairing) is a
///         SEPARATE product (`MintwareERC4626YieldAdapter`), never fused with this one. Separate product
///         surface: touches none of the vault / JIT / YPN-treasury contracts.
contract MintwareLpGatewayPositionManager is Ownable2Step, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 private constant VIRTUAL = 1e6;
    uint256 private constant Q96 = 0x1000000000000000000000000;
    // Bound on the fraction of depositor PRINCIPAL (cost basis, not marked value) that may sit in the LP at
    // once (re-audit A-3; red-team RT-9a). **Earn-vs-LP decision (docs/developers/lp-gateway-earn-vs-lp-
    // decision.md, 2026-09-08): the "hold half back" SIZE POLICY is retired** — LP is now a single, separate
    // product where the user's ENTIRE committed capital is deployed (no held-back buffer to "earn" on while
    // idle; Earn is its own opt-in, no-IL lending product, gated on real ERC-4626 capacity, never fused with
    // LP). `MAX_DEPLOY_BPS = 10000` (100%) so this constant now only guards against overdrawing MORE quote
    // than total principal — an accounting sanity check, not a risk-sizing lever. Cost basis never falls with
    // price, so the guard itself stays meaningful even though the ratio it bounds no longer is. Constant (not
    // owner-settable) by design.
    uint16 public constant MAX_DEPLOY_BPS = 10_000;

    /// @notice IA-11 hardening: the honest ceiling on TOTAL DEPOSITOR-SUPPLIED value this gateway will ever
    ///         admit at once, in the SAME cost-basis terms as `deployedPrincipal` (never moves with price).
    ///         Round-4 audit fix (documentation-only — reconciles this comment with `compoundQuote()`'s own,
    ///         which was always correct): this bounds new EXPOSURE — deposits and the depositor value that
    ///         changes form via `deploy()`'s zap — never yield ACCRETION to holders who are already inside the
    ///         cap. `compoundQuote()` deliberately has no principalCap check: it only ever restakes real
    ///         harvested fee income pro-rata to EXISTING shareholders (no new share mint, no new depositor),
    ///         so it cannot admit anyone above the risk they already carry — it can only grow the pie every
    ///         existing holder already owns a fixed slice of. A cap check there would gate legitimate yield
    ///         to depositors who have already cleared underwriting, not protect against new unbounded exposure.
    ///         `MAX_DEPLOY_BPS` above answers a DIFFERENT question ("what fraction of CURRENT principal may sit
    ///         in the illiquid/IL-exposed LP leg") and was never a size cap — deploying reduces idle and grows
    ///         `deployedPrincipal` by the same amount, so MAX_DEPLOY_BPS's own denominator (idle + deployedPrincipal)
    ///         reopens headroom every time capital moves into the LP, letting repeated deploy-then-refill cycles
    ///         admit unbounded cumulative depositor quote over time; and the owner's PAIRED-leg top-up in
    ///         `deploy()` (subsidised from the owner's own balance, matched against the depositor's quote leg)
    ///         was NEVER counted against anything at all, adding free, unbounded NAV on every deploy. `deposit`
    ///         and `deploy` both now revert `PrincipalCapExceeded` rather than push
    ///         `idle + deployedPrincipal + deployedPairedValue` above this — a live, monotone-with-real-value
    ///         figure, not a per-cycle fraction, so no sequence of deploy/refill/redeploy can ever exceed it.
    ///         Owner-adjustable like the idle adapter's own `depositCap` (mirrors it 1:1 for an idle-mode rig,
    ///         wired from the SAME `LP_GATEWAY_DEPOSIT_CAP` env value by the deploy script) — 0 at construction
    ///         closes growth until explicitly raised, matching that adapter's fail-closed default. Lowering it
    ///         only blocks further growth; it never forces a withdrawal or touches funds already held.
    ///         **Earn-vs-LP decision (2026-09-08):** the owner-subsidy path this paragraph describes is now
    ///         DELETED outright (see `deployedPairedValue` below) — `principalCap` remains as the real,
    ///         absolute TVL-at-risk bound regardless, since it is still the only thing standing between "an
    ///         unaudited pilot" and "no size limit at all."
    uint256 public principalCap;
    /// @notice Cost-basis quote-equivalent value of the paired leg currently in the LP. **Earn-vs-LP decision
    ///         (2026-09-08):** no longer an owner subsidy — the owner-funded `deploy()` path is deleted
    ///         outright, so every wei this tracks is 100% USER USDG that changed form through the in-contract
    ///         zap swap. Mirrors `deployedPrincipal`'s discipline exactly: priced once at deploy time (never
    ///         re-marked with price), incremented in `deploy()`, decremented pro-rata by the SAME liquidity
    ///         fraction as `deployedPrincipal` on every withdrawal. Still bounded by `principalCap` (IA-11) —
    ///         a rounding/consistency guard now rather than a defense against unbounded owner-injected value.
    uint256 public deployedPairedValue;

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IPermit2Minimal public immutable permit2;
    MintwareLpGatewayStaging public immutable staging;

    IERC20 public immutable quoteAsset;
    IERC20 public immutable pairedAsset;
    bool public immutable quoteIsCurrency0;

    PoolKey internal _poolKey;
    int24 public immutable tickLower;
    int24 public immutable tickUpper;

    uint256 public tokenId; // 0 until the first deploy mints the aggregate position
    /// @notice Quote principal currently in the LP at COST (what `deploy` pulled from staging, reduced pro-rata
    ///         as shares exit). Never moves with price — the base of the MAX_DEPLOY_BPS cap (RT-9a).
    uint256 public deployedPrincipal;
    /// @notice Minimum delay between proposing a new harvest recipient and it taking effect (F-02 rec. 3).
    uint256 public constant HARVEST_RECIPIENT_DELAY = 48 hours;

    // Manipulation-resistant valuation for the spot-priced LP leg (findings C1 / H-03). Hookless pools have
    // no on-chain TWAP, so we keep a CLAMPED-FOLLOWER reference sqrtPrice (`_refSqrtPrice`) that tracks spot
    // by at most `maxDeviationBps` per block (`_anchorFollow`). NAV is then marked CONSERVATIVELY per
    // direction: a withdrawal values the LP leg at min(spot, ref), a deposit at max(spot, ref) — so a
    // single-block price pump can neither inflate a withdrawal claim nor cheapen a deposit. Neither path
    // reverts on price, so withdrawals never brick (finding M-01); the follower + conservative mark do the
    // work, and there is no owner `pokePrice` that could re-anchor to a manipulated price (finding M-02).
    // Residual: a patient CROSS-block manipulator on a THIN pool can still walk the follower (bounded by the
    // per-block step) — deep-pool curation + a capped deploy fraction are the economic backstop, audit-gated.
    uint16 public immutable maxDeviationBps;
    uint160 internal _refSqrtPrice;
    uint64 internal _refBlock;
    mapping(address => uint256) internal _lastActionBlock; // no deposit+withdraw in one block per user

    mapping(address => uint256) public sharesOf;
    uint256 public totalShares;

    // Owner circuit-breaker (item 13). Blocks NEW deposits only — withdraw is ALWAYS allowed, so a pause
    // can never trap depositor funds. Set by the operator (or the keeper on a sustained out-of-range alert).
    bool public paused;

    // ── storage appended AFTER `paused` (audit closeout 2026-09-08) so the slots above — in particular
    //    `_refSqrtPrice` at slot 7, which test/audit/RedTeamOnchainFork probes via vm.load — do not shift. ──

    // Harvest fee recipient (F-02 rec. 3 / consolidated §4). Was `immutable` — which meant a USDG issuer freeze of
    // the operator hot wallet (F-02b) had NO on-chain recovery. It is now rotatable, but ONLY through a 48h
    // timelock: `proposeHarvestRecipient` → wait `HARVEST_RECIPIENT_DELAY` → `acceptHarvestRecipient`. Every
    // sweep in that window still pays the CURRENT recipient, so a compromised owner key cannot redirect an
    // in-flight fee stream instantly — the operator has 48h to see the `HarvestRecipientProposed` event and
    // cancel / rotate the key. (Packs with `paused` in the same slot.)
    address public harvestRecipient;
    address public pendingHarvestRecipient;
    uint64 public harvestRecipientEta; // earliest timestamp `acceptHarvestRecipient` succeeds (0 = no rotation)

    /// @notice The idle (staged) quote balance from the LAST SUCCESSFUL read of `staging.stagedAssets()` (C-10 /
    ///         RT-5f). Refreshed by every state-changing path that reads the reserve. Used ONLY when the yield
    ///         source stops answering, to size the idle entitlement a withdrawer is re-credited for — see `_withdraw`.
    uint256 public lastKnownIdle;

    // ── Round-3 exploit replay (2026-09-08) — storage appended after `lastKnownIdle` ──────────────────────
    // Entry-mark MEMORY (XR-1 Gamma replay / E-1). The follower alone has a one-block memory: a dump *held*
    // for ~7 blocks (or, atomically, a one-step dump + permissionless `poke()`) walks `ref` onto the dumped
    // spot and `max(spot, ref)` no longer protects entry. Deposits are therefore ALSO marked against the most
    // holder-favourable follower value recorded over the current and previous `ENTRY_MEMORY_BLOCKS` periods
    // (two alternating buckets — the older one is only ever REPLACED, never expired, so a quiet gap can't empty
    // the memory). A held dump now has to survive 1–2 h of dip-buyers/arbitrage instead of 90 s. Direction-aware:
    // "higher" means the LP leg marks higher (paired dearer in quote) — sqrtPrice-DOWN when quote is currency0,
    // sqrtPrice-UP when it is currency1 (see `_marksHigher`).
    uint256 public constant ENTRY_MEMORY_BLOCKS = 300; // ≈ 1 h at the L1-block cadence `block.number` follows here
    uint160 internal _entryHighA;
    uint64 internal _entryPeriodA;
    uint160 internal _entryHighB;
    uint64 internal _entryPeriodB;
    /// @notice R3-1: during a source OUTAGE the idle entitlement is sized off `lastKnownIdle` haircut by this, so a
    ///         loss realised in the unreadable source (stale-HIGH `lastKnownIdle`) can't be offloaded by an
    ///         outage-time exiter onto remaining holders. The blind exiter keeps fewer shares than a live read
    ///         would give (bounded by the haircut) — waiting for the source to recover is always the exact path.
    uint16 public constant OUTAGE_HAIRCUT_BPS = 2000;
    /// @notice XR-3 (Sonne-class at the SOURCE layer): a deposit must grow the staged reserve by ≥ this fraction of
    ///         the amount, or the source is eating principal (empty-vault inflation / undisclosed entry fee).
    uint16 public constant STAGE_TOLERANCE_BPS = 50;
    /// @notice Invariant 15 (owner worst case): a deploy must be TWO-SIDED on the amounts actually minted — the
    ///         paired leg's quote value within [½×, 2×] of the quote leg — so a compromised seat cannot mint an
    ///         all-quote position at the range edge and dump into it.
    uint16 public constant MIN_TWO_SIDED_BPS = 5000;

    error ZeroAmount();
    error ZeroShares();
    error ZeroAddress();
    error QuoteNotInPool();
    error InsufficientShares();
    error NotDeployed();
    error SameBlockAction();
    error BadDeviationBand();
    error MinLiquidityNotMet();
    error RenounceDisabled();
    error DepositsPaused();
    error DeployCapExceeded(); // A-3: total deployed would exceed MAX_DEPLOY_BPS of NAV
    error DeployPriceOutOfBand(); // A-3: spot too far from the clamped-follower reference (sandwich guard)
    error HookedPoolUnsupported(); // A-6: the no-callback / conservative-mark model assumes a hookless pool
    error BadTicks(); // A-8: tickLower >= tickUpper or not aligned to tickSpacing
    error SlippageExceeded(); // depositWithMin / withdrawWithMin bound not met (RT-1a / F-01)
    error NotSelf(); // lpLegExit is an internal-only self-call surface
    error SourceUnavailable(); // C-10: the yield source can't be read — entry can't be priced / nothing to deliver
    error RotationNotReady(); // harvest-recipient rotation: 48h delay not elapsed
    error NoPendingRotation(); // harvest-recipient rotation: nothing proposed
    error PoolNotInitialized(); // XR-2 / X-7: gateways are created only for pools that already exist (anchor at creation)
    error StageShortfall(); // XR-3: the source credited less than STAGE_TOLERANCE_BPS allows — principal would be eaten
    error DeployNotTwoSided(); // invariant 15: minted amounts are one-sided beyond MIN_TWO_SIDED_BPS
    error PrincipalCapExceeded(); // IA-11: idle + deployedPrincipal + deployedPairedValue would exceed principalCap
    error OnlyPoolManager(); // unlockCallback is only ever legitimately called by the pool manager itself
    error SwapExceedsQuote(); // earn-vs-lp decision: deploy()'s swapAmount can never exceed quoteToDeploy
    error InsufficientStaged(); // round-4 audit fix: staging.unstage() under-delivered vs. what swapAmount needs
    error DeployPriceMovedOutOfBand(); // round-4 audit fix: the swap-consumed post-swap price left the band

    event Deposited(address indexed user, uint256 quoteIn, uint256 sharesMinted);
    event Withdrawn(address indexed user, uint256 sharesBurned, uint256 quoteOut, uint256 pairedOut);
    event Deployed(uint256 indexed tokenId, uint256 quoteUsed, uint256 pairedUsed, uint128 liquidity);
    event Harvested(uint256 quoteFees, uint256 pairedFees, address indexed recipient);
    event PriceAnchored(uint160 sqrtPriceX96, uint256 blockNumber);
    event PausedSet(bool paused);
    event PrincipalCapSet(uint256 cap);
    event Compounded(uint256 quoteAmount);
    /// @dev IA-4: the yield source (idle-adapter `depositCap` or a real 4626's supply cap) was full, so the
    ///      harvested quote stayed parked in this contract's own balance instead of being staged — `_idle()`
    ///      already counts it, so NAV was still lifted for every holder; the next `deploy()` (whose re-stage
    ///      sweeps this contract's ENTIRE quote balance, not just its own leftover) picks it up once headroom
    ///      exists. Purely informational for the harvest cron.
    event CompoundDeferred(uint256 amount);
    /// @dev The LP leg of a withdrawal could not execute (paired token paused/blacklisted, recipient frozen, …).
    ///      The withdrawer received the idle leg and was re-credited shares for the LP leg (F-02 / RT-6).
    event LpLegUnavailable(address indexed user, uint128 liquidityRequested);
    /// @dev The yield source could not be read during a withdrawal (C-10). Only the LP leg was delivered; the idle
    ///      entitlement (sized off `lastKnownIdle`) was re-credited as shares.
    event IdleLegUnavailable(address indexed user, uint256 idleEntitledLastKnown);
    /// @dev Round-4 audit fix: the idle-leg quote was successfully pulled from the reserve but could not be
    ///      DELIVERED to the withdrawer (e.g. the withdrawer's own address is frozen/blacklisted by the quote
    ///      asset's issuer — a real, documented capability for USDG). The pulled amount stays in this contract's
    ///      own balance (already counted by `_idle()`) and the withdrawer is re-credited shares for it.
    event IdleLegDeliveryFailed(address indexed user, uint256 amountPulled);
    event HarvestRecipientProposed(address indexed current, address indexed proposed, uint256 eta);
    event HarvestRecipientRotated(address indexed previous, address indexed current);
    event HarvestRecipientRotationCancelled(address indexed proposed);
    /// @dev R3-2: leftover quote after a mint could not be re-staged (source at supply cap). It stays in the PM and
    ///      is picked up by the next deploy; nothing is lost and the LP add itself succeeded.
    event RestageDeferred(uint256 quoteLeft);

    constructor(
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        IPermit2Minimal permit2_,
        PoolKey memory poolKey_,
        IERC20 quoteAsset_,
        int24 tickLower_,
        int24 tickUpper_,
        MintwareLpGatewayStaging staging_,
        address owner_,
        address harvestRecipient_,
        uint16 maxDeviationBps_,
        uint256 principalCap_
    ) Ownable(owner_) {
        if (
            address(poolManager_) == address(0) || address(positionManager_) == address(0)
                || address(permit2_) == address(0) || address(staging_) == address(0)
                || address(quoteAsset_) == address(0) || harvestRecipient_ == address(0)
        ) revert ZeroAddress();
        // Band on the spot-vs-anchor sqrtPrice deviation: must be a real, non-trivial guard (>0) and
        // not so wide it never fires (<=50%). 2000 bps (20% sqrtPrice ≈ 44% price move between anchors)
        // is the sane meme-pool default the factory passes.
        if (maxDeviationBps_ == 0 || maxDeviationBps_ > 5000) revert BadDeviationBand();

        address c0 = Currency.unwrap(poolKey_.currency0);
        address c1 = Currency.unwrap(poolKey_.currency1);
        bool q0 = c0 == address(quoteAsset_);
        if (!q0 && c1 != address(quoteAsset_)) revert QuoteNotInPool();
        // Re-audit A-6/A-8 invariants. Hookless only: a hook that reverts in before/afterRemoveLiquidity or
        // returns an afterAddLiquidity delta would brick every LP withdraw / deploy, and the reentrancy and
        // conservative-mark reasoning both assume no callbacks. Native-ETH pools (paired == address(0)) are
        // unsupported (safeTransferFrom/balanceOf on address(0) revert). Ticks must be ordered + aligned or
        // the first deploy reverts TickMisaligned with capital already staged.
        if (address(poolKey_.hooks) != address(0)) revert HookedPoolUnsupported();
        if ((q0 ? c1 : c0) == address(0)) revert ZeroAddress();
        if (
            tickLower_ >= tickUpper_ || tickLower_ % poolKey_.tickSpacing != 0
                || tickUpper_ % poolKey_.tickSpacing != 0
        ) revert BadTicks();

        poolManager = poolManager_;
        positionManager = positionManager_;
        permit2 = permit2_;
        staging = staging_;
        quoteAsset = quoteAsset_;
        quoteIsCurrency0 = q0;
        pairedAsset = IERC20(q0 ? c1 : c0);
        _poolKey = poolKey_;
        tickLower = tickLower_;
        tickUpper = tickUpper_;
        harvestRecipient = harvestRecipient_;
        maxDeviationBps = maxDeviationBps_;
        principalCap = principalCap_;
        emit PrincipalCapSet(principalCap_);

        // Round-3 XR-2 (Cork) / X-7: v4 `initialize` is permissionless and nothing used to check the pool existed,
        // so the FIRST deploy had no reference and anchored the follower at whatever spot an attacker had set. A
        // gateway is now only creatable for an INITIALISED pool, and the follower is anchored at creation — so the
        // first deploy is banded exactly like every later one (the cron's independent-price check covers a held
        // pre-deploy walk; see lib/gateway/deploy.ts).
        (uint160 s,,,) = poolManager_.getSlot0(poolKey_.toId());
        if (s == 0) revert PoolNotInitialized();
        _refSqrtPrice = s;
        _refBlock = uint64(block.number);
        _recordEntryHigh(s);
        emit PriceAnchored(s, block.number);
    }

    /// @notice The clamped-follower reference, the block it last moved, and the entry-mark memory (the most
    ///         holder-favourable reference recorded over the current + previous `ENTRY_MEMORY_BLOCKS` periods).
    ///         Off-chain deploy pre-flight reads this to see whether spot is inside the band before sending.
    function referencePrice() external view returns (uint160 sqrtPriceX96, uint64 atBlock, uint160 entryHighSqrtPriceX96) {
        return (_refSqrtPrice, _refBlock, _entryHigh());
    }

    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    /// @notice Disabled — renouncing ownership would strip the deploy/harvest operator and leave the
    ///         deployed position unmanageable. Ownership moves via the two-step transfer instead. (M-01/L-06)
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ── owner: timelocked harvest-recipient rotation (F-02 rec. 3) ───────────────────────────

    /// @notice Propose a new harvest recipient. Takes effect only via `acceptHarvestRecipient` after
    ///         `HARVEST_RECIPIENT_DELAY` (48h). Until then every sweep keeps paying the current recipient — an
    ///         in-flight fee stream can never be redirected instantly. Re-proposing overwrites + restarts the clock.
    function proposeHarvestRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        uint64 eta = uint64(block.timestamp + HARVEST_RECIPIENT_DELAY);
        pendingHarvestRecipient = recipient;
        harvestRecipientEta = eta;
        emit HarvestRecipientProposed(harvestRecipient, recipient, eta);
    }

    /// @notice Finalise a proposed rotation once the delay has elapsed. Owner-only (the same seat that proposed).
    function acceptHarvestRecipient() external onlyOwner {
        address next = pendingHarvestRecipient;
        if (next == address(0)) revert NoPendingRotation();
        if (block.timestamp < harvestRecipientEta) revert RotationNotReady();
        address prev = harvestRecipient;
        harvestRecipient = next;
        delete pendingHarvestRecipient;
        delete harvestRecipientEta;
        emit HarvestRecipientRotated(prev, next);
    }

    /// @notice Abort a pending rotation — the operator's reaction to a proposal they did not make.
    function cancelHarvestRecipientRotation() external onlyOwner {
        address pending = pendingHarvestRecipient;
        if (pending == address(0)) revert NoPendingRotation();
        delete pendingHarvestRecipient;
        delete harvestRecipientEta;
        emit HarvestRecipientRotationCancelled(pending);
    }

    // ── C-10: tolerant staged read ────────────────────────────────────────────────────────────

    /// @dev Read the idle reserve WITHOUT letting a misbehaving yield source (a 4626 whose `previewRedeem` /
    ///      `totalAssets` reverts — RT-5f) brick the caller. Returns `(false, 0)` on failure; callers decide:
    ///      deposits REVERT (`SourceUnavailable` — an entry that can't be priced must not mint), withdrawals go
    ///      LP-leg-only and re-credit the idle leg off `lastKnownIdle`, views fall back to `lastKnownIdle`.
    ///      Round-3 R3-INV-2: the idle reserve INCLUDES quote parked in this contract by a deferred re-stage
    ///      (`RestageDeferred`) — it is depositor principal, so it is priced into every NAV, paid out first on exit
    ///      and consumed first on deploy; nothing depositor-owned ever sits outside NAV.
    /// @dev  Round-4 audit finding (Low, accepted design tradeoff, not fixed): `quoteAsset.balanceOf(address(this))`
    ///       is an unauthenticated raw balance — anyone can `transfer()` directly to this contract with no
    ///       `deposit()` call and no shares minted, and that donation counts toward `principalCap`'s
    ///       `idle + deployedPrincipal + deployedPairedValue` check, which can grief legitimate deposits closed
    ///       until the owner raises the cap or sweeps the donation away via `deploy()`/`compoundQuote()`. The
    ///       donor gets no shares and (per the virtual-offset math) can only reclaim a fraction back even
    ///       holding shares themselves, so this is a real-cost griefing vector, not a free one. Tracking only
    ///       `staging.stagedAssets()` and dropping the balance term would break the R3-INV-2 invariant this
    ///       same function already relies on (parked deferred-re-stage dust must stay priced into NAV) — so
    ///       the mitigation is operational, not on-chain: monitor for principalCap headroom consumed with no
    ///       matching `Deposited` event, and raise the cap or trigger a sweep.
    function _idle() internal view returns (bool ok, uint256 idle) {
        try staging.stagedAssets() returns (uint256 v) {
            return (true, v + quoteAsset.balanceOf(address(this)));
        } catch {
            return (false, 0);
        }
    }

    /// @dev Strict read for paths that must not proceed blind (deposit, and the post-stage refresh). Also
    ///      refreshes `lastKnownIdle`, so every successful state-changing read keeps the fallback current.
    function _syncIdle() internal returns (uint256 idle) {
        bool ok;
        (ok, idle) = _idle();
        if (!ok) revert SourceUnavailable();
        lastKnownIdle = idle;
    }

    /// @notice Whether the yield source currently answers a NAV read. Off-chain surfaces should show
    ///         `totalNav` as STALE (it falls back to `lastKnownIdle`) while this is false.
    function sourceReadable() external view returns (bool ok) {
        (ok,) = _idle();
    }

    /// @dev Clamped-follower reference. Moves `_refSqrtPrice` toward current spot by at most
    ///      `maxDeviationBps` per block, so it tracks a legitimate trend over a few blocks while a
    ///      single-block flash pump can only nudge it one step (never onto the manipulated price). Called
    ///      after every deposit / withdraw / deploy / harvest / poke. Never reverts — availability first (M-01).
    ///      Runs from creation (round-3 XR-2: the reference is anchored in the constructor, so the follower
    ///      tracks legitimate pre-deploy drift and the FIRST deploy is banded too).
    function _anchorFollow() internal {
        uint160 spot = _spot();
        uint160 ref = _refSqrtPrice;
        if (ref == 0) {
            _refSqrtPrice = spot;
            _refBlock = uint64(block.number);
            _recordEntryHigh(spot);
            emit PriceAnchored(spot, block.number);
            return;
        }
        if (block.number <= _refBlock) return; // at most one follow-step per block
        uint160 maxStep = uint160((uint256(ref) * maxDeviationBps) / 10_000);
        uint160 next;
        if (spot > ref) {
            next = (spot - ref) > maxStep ? ref + maxStep : spot;
        } else {
            next = (ref - spot) > maxStep ? ref - maxStep : spot;
        }
        _refSqrtPrice = next;
        _refBlock = uint64(block.number);
        _recordEntryHigh(next);
        emit PriceAnchored(next, block.number);
    }

    /// @dev The reference sqrtPrice for a conservative mark — the follower if set, else current spot.
    function _refOrSpot(uint160 spot) internal view returns (uint160) {
        uint160 ref = _refSqrtPrice;
        return ref == 0 ? spot : ref;
    }

    /// @dev True when marking the LP leg at `a` values it HIGHER (holder-favourable) than at `b`; `b == 0` = unset.
    ///      sqrtPriceX96 = √(currency1 / currency0). Quote as currency0 ⇒ paired (currency1) is dearer in quote when
    ///      sqrtPrice is LOWER (`_pairedToQuote` divides by it twice); quote as currency1 ⇒ dearer when HIGHER.
    ///      Zero is "unset", never a price (round-3 R3-INV-3: an unset bucket compared as sqrtPrice 0 marked the LP leg
    ///      at its range-edge maximum on quote-is-currency0 pools for the first entry period after creation).
    function _marksHigher(uint160 a, uint160 b) internal view returns (bool) {
        if (a == 0) return false;
        if (b == 0) return true;
        return quoteIsCurrency0 ? a < b : a > b;
    }

    /// @dev Record a follower value into the entry-mark memory bucket for the current period (XR-1 / E-1).
    ///      A bucket is RESET when its period changes and otherwise keeps the holder-favourable extreme.
    function _recordEntryHigh(uint160 ref) internal {
        uint64 period = uint64(block.number / ENTRY_MEMORY_BLOCKS);
        if (period % 2 == 0) {
            if (_entryPeriodA != period || _entryHighA == 0) { _entryPeriodA = period; _entryHighA = ref; }
            else if (_marksHigher(ref, _entryHighA)) _entryHighA = ref;
        } else {
            if (_entryPeriodB != period || _entryHighB == 0) { _entryPeriodB = period; _entryHighB = ref; }
            else if (_marksHigher(ref, _entryHighB)) _entryHighB = ref;
        }
    }

    /// @dev The holder-favourable extreme across BOTH buckets (current + the last recorded period, however old).
    function _entryHigh() internal view returns (uint160 h) {
        h = _entryHighA;
        if (_marksHigher(_entryHighB, h)) h = _entryHighB;
    }

    /// @dev The most holder-favourable of spot, the follower and the entry memory — the price deposits are
    ///      marked at, and the WEIGHT an exit's re-credit is computed at (E-2: a withdrawer's own dump could
    ///      otherwise inflate the idle-leg re-credit under an adapter shortfall).
    function _holderMark(uint160 spot) internal view returns (uint160 m) {
        m = spot;
        uint160 ref = _refSqrtPrice;
        if (_marksHigher(ref, m)) m = ref;
        uint160 high = _entryHigh();
        if (_marksHigher(high, m)) m = high;
    }

    function _spot() internal view returns (uint160 s) {
        (s,,,) = poolManager.getSlot0(_poolKey.toId());
    }

    // ── depositor entry ──────────────────────────────────────────────────────────────────────

    /// @notice Deposit quote-asset; it stages into the yield reserve (earns immediately) and mints
    ///         entry-NAV shares in the aggregate gateway position. Not a deposit/savings product.
    function deposit(uint256 quoteAmount) external nonReentrant returns (uint256 sharesMinted) {
        return _deposit(quoteAmount, 0);
    }

    /// @notice `deposit` with a caller-set floor on the shares minted — bounds a same-block or held pump of the
    ///         paired token that would otherwise price the entry at an inflated LP mark (RT-1a / F-01c).
    function depositWithMin(uint256 quoteAmount, uint256 minSharesOut) external nonReentrant returns (uint256) {
        return _deposit(quoteAmount, minSharesOut);
    }

    function _deposit(uint256 quoteAmount, uint256 minSharesOut) internal returns (uint256 sharesMinted) {
        if (paused) revert DepositsPaused(); // circuit-breaker: no new capital while paused (withdraw stays open)
        if (quoteAmount == 0) revert ZeroAmount();
        if (_lastActionBlock[msg.sender] == block.number) revert SameBlockAction();
        _lastActionBlock[msg.sender] = block.number;
        // Conservative entry NAV (LP leg marked at max(spot, ref)) so a deflated spot can't cheapen entry
        // and dilute existing holders (finding H-03). No revert on PRICE — the conservative mark is the defense.
        // C-10: the idle leg IS strict here — an unreadable yield source means the entry can't be priced, and
        // minting blind would let a depositor buy in at a stale/zero idle mark. `_syncIdle` reverts SourceUnavailable.
        uint256 navBefore = _navDepositStrict();
        uint256 idleBefore = lastKnownIdle; // just refreshed by the strict read above
        sharesMinted = SeniorSharesMath.toShares(quoteAmount, totalShares, navBefore, VIRTUAL, Math.Rounding.Floor);
        if (sharesMinted == 0) revert ZeroShares();
        if (sharesMinted < minSharesOut) revert SlippageExceeded();

        quoteAsset.safeTransferFrom(msg.sender, address(this), quoteAmount);
        quoteAsset.forceApprove(address(staging), quoteAmount);
        staging.stage(quoteAmount);
        uint256 idleAfter = _syncIdle(); // refresh the C-10 fallback with the post-stage reserve
        // Round-3 XR-3 (Sonne / Hundred / Radiant / Onyx at the SOURCE layer): the gateway is a plain depositor
        // into the 4626 under the adapter. Against an empty, offset-less source a seeded-and-donated first deposit
        // mints 0 source shares — the reserve does not grow, the PM would still mint full shares, and the seeder
        // redeems everything. Require the reserve to have grown by ~the amount (tolerance for source rounding).
        if (idleAfter < idleBefore + quoteAmount - (quoteAmount * STAGE_TOLERANCE_BPS) / 10_000) revert StageShortfall();
        // IA-11: bound TOTAL depositor-relevant value at risk, not just what fits in the idle leg right now. A
        // prior deploy can have reopened the idle adapter's own cap (it only gates its own custody) without
        // this gateway's total exposure having gone down at all -- so re-check the live cost-basis total here.
        if (idleAfter + deployedPrincipal + deployedPairedValue > principalCap) revert PrincipalCapExceeded();

        sharesOf[msg.sender] += sharesMinted;
        totalShares += sharesMinted;
        _anchorFollow(); // advance the clamped-follower reference (no-op until deployed)
        emit Deposited(msg.sender, quoteAmount, sharesMinted);
    }

    /// @notice Redeem shares for the pro-rata underlying: your fraction of the idle reserve (quote) and,
    ///         if any is deployed, your fraction of the LP position (both legs). The LP portion is
    ///         subject to the current pool price and impermanent loss — there is no par guarantee.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 quoteOut, uint256 pairedOut) {
        return _withdraw(shares, 0, 0);
    }

    /// @notice `withdraw` with caller-set floors on both legs — bounds any residual sandwich the pro-rata payout
    ///         cannot (the composition of the LP slice moves with spot even though its share does not).
    function withdrawWithMin(uint256 shares, uint256 minQuoteOut, uint256 minPairedOut)
        external
        nonReentrant
        returns (uint256 quoteOut, uint256 pairedOut)
    {
        return _withdraw(shares, minQuoteOut, minPairedOut);
    }

    /// @dev PURE PRO-RATA exit (Hacken F-01 / red-team RT-5). Sourcing is by SHARE FRACTION on both legs — `f` of
    ///      the idle reserve and `f` of the position's liquidity — so the payout is price-neutral by construction:
    ///      no mark is read to size it, a pumped or dumped spot changes only the composition of the LP slice,
    ///      never its size. This retires the withdraw-side `min(spot, ref)` mark, which under pro-rata sourcing
    ///      protected nobody and silently under-paid honest withdrawers whenever spot ran ahead of the follower
    ///      (the forgone slice went to remaining holders — or, for a sole holder, was stranded forever).
    ///      Spot is read ONCE, before any external call, and only ever used as a WEIGHT (RT-2: a paired token
    ///      with transfer hooks could otherwise move spot inside the exit and inflate the re-credit).
    ///      Each leg is BEST-EFFORT and independently re-credited (A-1): an illiquid adapter re-credits the
    ///      unserved idle; a failing LP leg (paused / blacklisting paired token, frozen fee recipient — F-02 /
    ///      RT-6) re-credits the LP slice while the idle leg still pays. Withdrawals never brick (M-01).
    function _withdraw(uint256 shares, uint256 minQuoteOut, uint256 minPairedOut)
        internal
        returns (uint256 quoteOut, uint256 pairedOut)
    {
        uint256 bal = sharesOf[msg.sender];
        if (shares == 0) revert ZeroAmount();
        if (shares > bal) revert InsufficientShares();
        if (_lastActionBlock[msg.sender] == block.number) revert SameBlockAction();
        _lastActionBlock[msg.sender] = block.number;

        uint256 ts = totalShares;
        bool lastHolder = shares == ts; // the final exit also clears the virtual-offset dust (A-2 clean state)
        // C-10 / RT-5f: the staged read is TOLERANT. If the yield source answers, use (and remember) the live
        // value. If it doesn't, size the idle ENTITLEMENT off `lastKnownIdle` — the last value every successful
        // state-changing path refreshed — but never call `unstage` (it would revert through the same source), so
        // the idle leg is "delivered 0 of a claim we sized last time" and the re-credit below hands those shares
        // back. The LP leg still pays. Nothing bricks; the only thing a withdrawer can lose is the yield that
        // accrued in the reserve since the last successful read (they burn marginally more shares per unit
        // delivered than a live read would) — and they can simply wait for the source to recover instead.
        (bool idleOk, uint256 idle) = _idle();
        if (idleOk) lastKnownIdle = idle;
        // Round-3 R3-1: `lastKnownIdle` is only conservative for YIELD. A loss realised in the source while it is
        // unreadable leaves it stale-HIGH, and the re-credit below would hand the blind exiter too many shares
        // (offloading part of the loss onto remaining holders). Haircut the fallback so the exiter bears at least
        // their share of any loss up to OUTAGE_HAIRCUT_BPS; waiting for the source to recover is always exact.
        else idle = (lastKnownIdle * (10_000 - OUTAGE_HAIRCUT_BPS)) / 10_000;
        uint160 spot;
        uint160 w; // valuation weight for the exit (E-2): the holder-favourable mark, never a spot a withdrawer just dumped
        uint128 liq;
        uint256 lpSpotVal;
        if (tokenId != 0) {
            spot = _spot(); // cached ONCE — the only price read in the exit, used purely as a weight
            w = _holderMark(spot);
            liq = positionManager.getPositionLiquidity(tokenId);
            lpSpotVal = _deployedQuoteValueAt(w);
        }

        // Entitlements. Round-3 fuzz F1: the virtual offset is applied ONCE, to the whole claim — the old per-leg
        // `toAssets(shares, leg, ts, VIRTUAL)` added V to EACH leg (and to liquidity in L-units), so every partial
        // exit had `claim > delivered` by ≈ shares·V/(ts+V) and re-credited that many unbacked shares (≈ $1 per exit
        // at 6 dp, repeatable every 2 blocks, paid by the remaining holders). The claim is priced exactly like the
        // deposit side (`toShares(amt, ts, idle + lp, V)`), capped at what exists, and split across the legs by
        // their un-offset weights; the liquidity slice is the SAME fraction of the position as the LP value slice,
        // so it can never exceed the position (E-4) and delivered == entitled to the wei at the weight price.
        uint256 navW = idle + lpSpotVal;
        uint256 claimTotal = lastHolder ? navW : SeniorSharesMath.toAssets(shares, navW, ts, VIRTUAL, Math.Rounding.Floor);
        if (claimTotal > navW) claimTotal = navW; // a near-total loss can push the offset formula above what exists
        uint256 fromIdle = lastHolder ? idle : (navW == 0 ? 0 : FullMath.mulDiv(claimTotal, idle, navW));
        uint256 lpEntitled = claimTotal - fromIdle;
        uint128 liqToRemove = lastHolder
            ? liq
            : (lpSpotVal == 0 ? 0 : uint128(Math.min(uint256(liq), FullMath.mulDiv(liq, lpEntitled, lpSpotVal))));
        // Source down AND no LP leg to deliver → there is nothing this exit can pay; refuse rather than burn
        // shares against a zero claim (the re-credit needs `claim > 0`). State untouched; retry when readable.
        if (!idleOk && liqToRemove == 0) revert SourceUnavailable();

        // Effects before interactions.
        sharesOf[msg.sender] = bal - shares;
        totalShares = ts - shares;

        // Idle leg — best-effort (adapter may be illiquid/paused); shortfall re-credited below. Quote parked in this
        // contract (R3-INV-2) is paid first and needs no source read; the remainder is unstaged only while the
        // source is readable (C-10 — `unstage` would revert through it).
        uint256 idleGot;
        if (fromIdle > 0) {
            uint256 payParked = Math.min(quoteAsset.balanceOf(address(this)), fromIdle);
            uint256 pulled = payParked;
            if (idleOk && fromIdle > payParked) pulled += staging.unstage(fromIdle - payParked);
            if (pulled > 0) {
                // Round-4 audit fix (High): the FINAL payout to the withdrawer used to be a bare `safeTransfer`
                // with no failure isolation — unlike the LP leg (`try this.lpLegExit(...)` below), a revert here
                // propagated and unwound the WHOLE withdraw. If the WITHDRAWER'S OWN address is frozen by the
                // quote asset's issuer (a real, documented, first-party capability for USDG — never a
                // hypothetical third party), the entire exit bricked even though `pulled` was already safely
                // sitting in this contract's own balance. Isolate it the same way the LP leg already is: a
                // self-call + try/catch. On failure, `pulled` simply stays in this contract's balance — `_idle()`
                // already counts it (same pattern as a deferred re-stage, R3-INV-2) — and the existing re-credit
                // math below (keyed on `idleGot < fromIdle`) re-credits the withdrawer shares for it, unchanged.
                try this.idleLegExit(msg.sender, pulled) {
                    idleGot = pulled;
                    quoteOut = idleGot;
                } catch {
                    emit IdleLegDeliveryFailed(msg.sender, pulled);
                }
                (bool ok2, uint256 idleAfter) = _idle(); // reserve shrank OR pulled is now parked here — either way, refresh
                if (ok2) lastKnownIdle = idleAfter;
            }
        }
        if (!idleOk) emit IdleLegUnavailable(msg.sender, fromIdle);

        // LP leg — best-effort via a self-call so a third-party token failure can't take the idle leg down with
        // it. Fees are swept to the recipient FIRST inside the leg (H-02) so the decrease returns principal only.
        bool lpFailed;
        if (liqToRemove > 0) {
            try this.lpLegExit(liqToRemove, msg.sender, block.timestamp) returns (uint256 gotQuote, uint256 gotPaired) {
                quoteOut += gotQuote;
                pairedOut += gotPaired;
                // Cost basis leaves with the slice (RT-9a): the same fraction of deployed principal as of the
                // position's liquidity (F1: no per-leg offset here either).
                uint256 dp = deployedPrincipal;
                deployedPrincipal = lastHolder ? 0 : dp - FullMath.mulDiv(dp, liqToRemove, liq);
                // IA-11: the user's swapped-form paired value leaves with the SAME fraction, so a full exit
                // correctly frees the whole cap back up rather than leaving stale "phantom" value at risk behind.
                uint256 dpv = deployedPairedValue;
                deployedPairedValue = lastHolder ? 0 : dpv - FullMath.mulDiv(dpv, liqToRemove, liq);
            } catch {
                lpFailed = true;
                emit LpLegUnavailable(msg.sender, liqToRemove);
            }
        }

        // Re-credit (A-1): shares for whatever part of the entitlement could not be delivered now. The withdrawer
        // keeps that claim; nothing is stranded, nothing bricks. Round-3 E-2 / R3-INV-1: each leg's re-credit is
        // weighted at the price LEAST favourable to the exiter for THAT failure — an undelivered idle leg against
        // the LP leg marked HIGH (a dump can't inflate it), an undelivered LP leg against the LP leg marked LOW
        // (min over spot and the follower — a pump can't inflate it, and a legitimately lower spot after a dump
        // doesn't hand the exiter idle cash at the high mark). Nothing delivered at all ⇒ every share comes back.
        uint256 sharesBurned = shares;
        {
            uint256 reCredit;
            if (idleGot == 0 && (lpFailed || liqToRemove == 0)) {
                reCredit = shares; // nothing delivered — keep the whole claim
            } else {
                uint256 denomHigh = fromIdle + lpEntitled; // LP at w (holder-favourable / high)
                if (fromIdle > idleGot && denomHigh > 0) reCredit = FullMath.mulDiv(shares, fromIdle - idleGot, denomHigh);
                if (lpFailed) {
                    uint256 lpValLow = Math.min(_deployedQuoteValueAt(spot), _deployedQuoteValueAt(_refOrSpot(spot)));
                    uint256 lpEntLow = navW == 0 ? 0 : FullMath.mulDiv(claimTotal, lpValLow, navW);
                    uint256 denomLow = fromIdle + lpEntLow;
                    if (denomLow > 0) reCredit += FullMath.mulDiv(shares, lpEntLow, denomLow);
                }
                if (reCredit > shares) reCredit = shares;
            }
            if (reCredit > 0) {
                sharesOf[msg.sender] += reCredit;
                totalShares += reCredit;
                sharesBurned = shares - reCredit;
            }
        }
        if (quoteOut < minQuoteOut || pairedOut < minPairedOut) revert SlippageExceeded();

        _anchorFollow(); // advance the clamped-follower reference
        emit Withdrawn(msg.sender, sharesBurned, quoteOut, pairedOut);
    }

    /// @dev The LP leg of an exit, isolated behind a self-call so `_withdraw` can `try` it. Sweeps fees to the
    ///      recipient, then decreases `liquidity` and delivers both legs to `to`. Self-only.
    function lpLegExit(uint128 liquidity, address to, uint256 deadline)
        external
        returns (uint256 gotQuote, uint256 gotPaired)
    {
        if (msg.sender != address(this)) revert NotSelf();
        _sweepFees(deadline); // H-02: fees route to harvestRecipient, never the withdrawer
        return _decreaseAndTake(liquidity, to, deadline);
    }

    /// @dev Round-4 audit fix: the idle leg's final payout, isolated behind a self-call so `_withdraw` can `try`
    ///      it exactly like the LP leg already is — a frozen/blacklisted withdrawer address (a real, documented
    ///      capability of the quote asset's issuer for USDG) can no longer take the WHOLE withdrawal down with
    ///      it. Self-only.
    function idleLegExit(address to, uint256 amount) external {
        if (msg.sender != address(this)) revert NotSelf();
        quoteAsset.safeTransfer(to, amount);
    }

    /// @dev Round-4 audit fix (Medium): self-call wrapper around `_sweepFees`, isolated so `deploy()`'s
    ///      pre-flight sweep can `try` it — mirrors how `lpLegExit` already isolates its OWN internal sweep
    ///      for the withdraw path. Without this, a frozen/blacklisted `harvestRecipient` (the exact scenario
    ///      the 48h-timelocked recipient-rotation mechanism exists to survive) bricked EVERY deploy — not just
    ///      harvest — for the whole rotation window, even though deploy's real job (putting staged capital to
    ///      work) has nothing to do with fee collection. On failure the fees simply stay accrued in the
    ///      position, uncollected, picked up by the next successful sweep. Self-only.
    function sweepFeesExternal(uint256 deadline) external returns (uint256 quoteFees, uint256 pairedFees) {
        if (msg.sender != address(this)) revert NotSelf();
        return _sweepFees(deadline);
    }

    /// @notice Permissionless follower liveness: advance the clamped reference one bounded step toward spot.
    ///         Adds no attack surface — anyone could already do this with a dust deposit — and keeps entry marks
    ///         and the deploy band from going stale on a quiet day (F-01c / F-04).
    function poke() external {
        _anchorFollow();
    }

    // ── owner: deploy staged capital into the pool ───────────────────────────────────────────

    /// @notice Owner-gated: pull `quoteToDeploy` from the staging reserve, swap `swapAmount` of it INTO the
    ///         paired leg ATOMICALLY via the pool itself (in-contract, no keeper custody of user funds
    ///         mid-swap), and add both legs to the aggregate V4 position.
    /// @dev    **Earn-vs-LP decision (docs/developers/lp-gateway-earn-vs-lp-decision.md, 2026-09-08):**
    ///         Mintware supplies NOTHING to any position — the paired leg is 100% user USDG that changed
    ///         form through this swap. The old owner-funded path (`pairedAsset.safeTransferFrom(msg.sender,
    ///         …)`, a `pairedAmount` the CALLER supplied) is deleted outright; there is no code path left
    ///         that accepts an owner-supplied paired token, so "Mintware never provides the pair, never eats
    ///         IL" is enforced on-chain, not promised. `swapAmount` (how much of `quoteToDeploy` to convert)
    ///         is caller-computed off-chain (the deploy cron sizes it for the target ratio at current price)
    ///         and bounded on-chain by `minPairedOut` (the swap's own slippage floor) — the swap itself is
    ///         further bounded by the SAME clamped-follower band that already gated the mint composition, so
    ///         neither the swap nor the mint can be sandwiched independently of the other.
    function deploy(uint256 quoteToDeploy, uint256 swapAmount, uint256 minPairedOut, uint128 minLiquidity, uint256 deadline)
        external
        onlyOwner
        nonReentrant
    {
        if (quoteToDeploy == 0) revert ZeroAmount();
        if (swapAmount > quoteToDeploy) revert SwapExceedsQuote();

        // Re-audit A-3 / RT-9a: guards against overdrawing more quote than total principal. With
        // MAX_DEPLOY_BPS = 10000 (earn-vs-lp decision — no held-back buffer) this is now purely an accounting
        // sanity check, not a risk-sizing lever; cost basis (not marked value) keeps it meaningful regardless.
        {
            // Strict read (C-10): a deploy against an unreadable source can't size the cap → SourceUnavailable.
            uint256 principal = _syncIdle() + deployedPrincipal;
            if (deployedPrincipal + quoteToDeploy > (principal * MAX_DEPLOY_BPS) / 10_000) revert DeployCapExceeded();
        }

        // Sweep the existing position's accrued fees to the buffer BEFORE increasing, so the INCREASE never
        // folds trading fees into the re-stage below (finding H-02). No-op on first deploy. Round-4 audit fix
        // (Medium): isolated behind a self-call + try/catch (`sweepFeesExternal`) — a frozen/blacklisted
        // harvestRecipient no longer bricks deploy() itself; the fees just stay accrued, uncollected, for the
        // next successful sweep.
        try this.sweepFeesExternal(deadline) {} catch {}

        // R3-INV-2: quote parked by an earlier deferred re-stage is consumed before touching the reserve.
        uint256 fromParked = Math.min(quoteAsset.balanceOf(address(this)), quoteToDeploy);
        uint256 quoteGot = fromParked + (quoteToDeploy > fromParked ? staging.unstage(quoteToDeploy - fromParked) : 0);
        // Round-4 audit fix (High): `staging.unstage()` is deliberately best-effort (never reverts for a
        // liquidity reason — it returns what it could actually deliver). The production adapter makes a
        // shortfall routine, not an edge case (a `perBlockWithdrawCap` or a momentarily illiquid underlying
        // 4626 both clamp it). Previously nothing checked `quoteGot` against what was requested before using
        // it to size the swap, so a shortfall surfaced deep inside `_paySwap` as a raw ERC20-insufficient-
        // balance/underflow revert with no named error — and the SAME off-chain sizing would resubmit the
        // identical doomed call forever. Fail loud and cheap instead, before any swap runs.
        if (quoteGot < quoteToDeploy) revert InsufficientStaged();

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(_poolKey.toId());
        // Re-audit A-3 (price): both the swap AND the mint execute only while spot is within the follower
        // band of the clamped reference, so a sandwiched deploy can't manipulate either leg. `sellQuoteLimit`
        // bounds the quote→paired zap; `sellPairedLimit` (the opposite direction) bounds the leftover
        // paired→quote cleanup swap near the end of this function. `ref`/`band` are hoisted to function scope
        // (round-4 audit fix) so the post-swap re-read below can re-verify against the SAME band, not just
        // gate the swap's own execution — see the comment there.
        uint160 sellQuoteLimit = quoteIsCurrency0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        uint160 sellPairedLimit = quoteIsCurrency0 ? TickMath.MAX_SQRT_PRICE - 1 : TickMath.MIN_SQRT_PRICE + 1;
        uint160 ref = _refSqrtPrice;
        uint160 band;
        if (ref != 0) {
            band = uint160((uint256(ref) * maxDeviationBps) / 10_000);
            uint160 diff = sqrtPriceX96 > ref ? sqrtPriceX96 - ref : ref - sqrtPriceX96;
            if (diff > band) revert DeployPriceOutOfBand();
            uint160 lower = ref > band ? ref - band : TickMath.MIN_SQRT_PRICE + 1;
            uint256 upperWide = uint256(ref) + uint256(band);
            uint160 upper = upperWide >= uint256(TickMath.MAX_SQRT_PRICE) - 1 ? TickMath.MAX_SQRT_PRICE - 1 : uint160(upperWide);
            // Selling quote pushes price DOWN if quote is currency0 (zeroForOne), else UP — mirror image
            // for selling paired.
            sellQuoteLimit = quoteIsCurrency0 ? lower : upper;
            sellPairedLimit = quoteIsCurrency0 ? upper : lower;
        }

        uint256 pairedGot;
        if (swapAmount > 0) {
            pairedGot = _executeSwap(quoteIsCurrency0, swapAmount, sellQuoteLimit);
            if (pairedGot < minPairedOut) revert SlippageExceeded();
        }
        uint256 quoteForMint = quoteGot - swapAmount;

        (uint256 amount0, uint256 amount1) = quoteIsCurrency0 ? (quoteForMint, pairedGot) : (pairedGot, quoteForMint);

        (sqrtPriceX96,,,) = poolManager.getSlot0(_poolKey.toId()); // re-read: the swap above may have moved it
        // Round-4 audit fix (High): the pre-swap band check above only ever bounded the swap's OWN
        // `sqrtPriceLimitX96` — it never re-verified the price actually used to size the mint below. V4's
        // `PoolManager.unlock()` lock is a single global "is anything unlocked" boolean, not "is THIS caller
        // the one who opened it" — so a hostile paired token's `transfer` hook (fired by `_executeSwap`'s own
        // `poolManager.take` above, while the pool is still globally unlocked) can interleave an unbounded
        // swap against the SAME pool and move `slot0.sqrtPriceX96` — pool-level state — before returning
        // control here. `DeployNotTwoSided` below is self-referential (it recomputes `pairedUsedVal` from
        // this SAME manipulated price) so it cannot catch this. Re-verify the price actually consumed against
        // the SAME band the swap itself was bounded by, closing the interleaved-swap manipulation window
        // regardless of what a hostile paired token does mid-callback.
        if (ref != 0) {
            uint160 diff2 = sqrtPriceX96 > ref ? sqrtPriceX96 - ref : ref - sqrtPriceX96;
            if (diff2 > band) revert DeployPriceMovedOutOfBand();
        }
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tickUpper);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtA, sqrtB, amount0, amount1);
        if (liquidity == 0) revert ZeroShares();
        if (liquidity < minLiquidity) revert MinLiquidityNotMet(); // caller's slippage floor (finding M-03)

        _permit(quoteAsset, quoteForMint);
        _permit(pairedAsset, pairedGot);

        uint256 quoteBefore = quoteAsset.balanceOf(address(this));
        uint256 pairedBefore = pairedAsset.balanceOf(address(this));

        if (tokenId == 0) {
            uint256 newId = positionManager.nextTokenId();
            _modify(_mintCalls(liquidity, uint128(amount0), uint128(amount1)), deadline);
            tokenId = newId;
        } else {
            _modify(_increaseCalls(liquidity, uint128(amount0), uint128(amount1)), deadline);
        }

        // Revoke any residual Permit2 allowance the mint rounding left dangling (finding L-04).
        _revokePermit(quoteAsset);
        _revokePermit(pairedAsset);

        uint256 quoteLeft = quoteAsset.balanceOf(address(this));
        uint256 pairedLeft = pairedAsset.balanceOf(address(this));
        uint256 quoteUsed = quoteBefore > quoteLeft ? quoteBefore - quoteLeft : 0;
        uint256 pairedUsed = pairedBefore > pairedLeft ? pairedBefore - pairedLeft : 0;
        // Round-3 invariant 15: the position must be TWO-SIDED on what was actually minted. Now a backstop
        // against a badly-chosen `swapAmount` rather than a hostile owner-injected paired token, but the
        // failure mode (a lopsided, range-edge position) is identical, so the same guard still applies.
        uint256 pairedUsedVal = _pairedToQuote(pairedUsed, sqrtPriceX96);
        if (
            pairedUsedVal < (quoteUsed * MIN_TWO_SIDED_BPS) / 10_000
                || quoteUsed < (pairedUsedVal * MIN_TWO_SIDED_BPS) / 10_000
        ) revert DeployNotTwoSided();
        deployedPrincipal += quoteUsed; // cost basis (RT-9a)
        // Cost basis, same discipline as deployedPrincipal — now USER value that changed form via the
        // in-contract swap (earn-vs-lp decision), never an owner subsidy.
        deployedPairedValue += pairedUsedVal;

        // Leftover paired (the mint consumed slightly less than the swap produced) is swapped straight BACK
        // to quote — Mintware never returns a paired-token balance to anyone; every leftover wei stays priced
        // in NAV as quote, exactly like leftover quote already was.
        if (pairedLeft > 0) {
            quoteLeft += _executeSwap(!quoteIsCurrency0, pairedLeft, sellPairedLimit);
        }
        if (quoteLeft > 0) {
            // R3-2: re-staging leftover quote reverts while the source is at its supply cap (Morpho `maxDeposit == 0`
            // — the live mainnet state), which used to DoS every deploy even though the LP add had succeeded.
            // Best-effort: dust that can't be staged stays in the PM and is picked up by the next deploy.
            quoteAsset.forceApprove(address(staging), quoteLeft);
            try staging.stage(quoteLeft) {}
            catch {
                quoteAsset.forceApprove(address(staging), 0);
                emit RestageDeferred(quoteLeft);
            }
        }
        uint256 idleNow = _syncIdle(); // the reserve just shrank by `quoteUsed` — keep the C-10 fallback current
        // IA-11 (principalCap remains the real absolute TVL-at-risk bound, per the earn-vs-lp decision): the
        // quote leg just RELOCATED (idle down, deployedPrincipal up by the same amount — net zero change to
        // the total) and `deployedPairedValue` grew by exactly the user's own converted value — never more
        // than what left `quoteGot` — so this check is now mostly a rounding/consistency guard rather than a
        // defense against unbounded owner-injected value, but it costs nothing to keep.
        if (idleNow + deployedPrincipal + deployedPairedValue > principalCap) revert PrincipalCapExceeded();

        _anchorFollow(); // advance the clamped-follower reference at this owner-set price
        emit Deployed(tokenId, quoteUsed, pairedUsed, liquidity);
    }

    // ── in-contract zap swap (earn-vs-lp decision: the ONLY paired-leg source) ────────────────

    // Transient state for the `unlock`/`unlockCallback` round-trip (mirrors the proven pattern in
    // `MintwareTreasuryFloatSettlement.sol`). Set immediately before `poolManager.unlock`, read immediately
    // after it returns, then zeroed — never holds a value outside a single `_executeSwap` call.
    bool private _swapZeroForOne;
    uint256 private _swapAmountIn;
    uint160 private _swapPriceLimit;
    uint256 private _swapAmountOut;

    /// @dev Pool-manager callback for our own swap unlock. Guarded to the pool manager only; nothing else can
    ///      ever reach `_swapAmountIn`/`_swapPriceLimit` since they are only ever non-zero for the duration of
    ///      the single `poolManager.unlock` call inside `_executeSwap`.
    function unlockCallback(bytes calldata) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _swapAmountOut = _swapExactIn(_swapZeroForOne, _swapAmountIn, _swapPriceLimit);
        return "";
    }

    /// @dev Exact-input swap on THIS gateway's own pool, price-limited, executed via the standard V4
    ///      unlock/settle round-trip. `amountIn` must already be held by this contract (pulled from staging /
    ///      the mint's own leftover balance before this is called — never a caller-supplied token).
    function _executeSwap(bool zeroForOne, uint256 amountIn, uint160 priceLimit) private returns (uint256 out) {
        if (amountIn == 0) return 0;
        _swapZeroForOne = zeroForOne;
        _swapAmountIn = amountIn;
        _swapPriceLimit = priceLimit;
        poolManager.unlock("");
        out = _swapAmountOut;
        _swapZeroForOne = false;
        _swapAmountIn = 0;
        _swapPriceLimit = 0;
        _swapAmountOut = 0;
    }

    function _swapExactIn(bool zeroForOne, uint256 amountIn, uint160 priceLimit) private returns (uint256 out) {
        BalanceDelta delta = poolManager.swap(
            _poolKey,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: priceLimit}),
            ""
        );
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0) _paySwap(_poolKey.currency0, uint256(uint128(-d0)));
        else if (d0 > 0) poolManager.take(_poolKey.currency0, address(this), uint256(uint128(d0)));
        if (d1 < 0) _paySwap(_poolKey.currency1, uint256(uint128(-d1)));
        else if (d1 > 0) poolManager.take(_poolKey.currency1, address(this), uint256(uint128(d1)));
        out = zeroForOne ? (d1 > 0 ? uint256(uint128(d1)) : 0) : (d0 > 0 ? uint256(uint128(d0)) : 0);
    }

    function _paySwap(Currency currency, uint256 amount) private {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    // ── owner: harvest fees (zero-liquidity-delta) → yield-first buffer ───────────────────────

    /// @notice Owner-gated: collect accrued fees WITHOUT touching principal (DECREASE_LIQUIDITY of 0)
    ///         and send them to the harvest recipient. The harvest cron then converts the paired leg
    ///         via the MW router and credits the spend buffer pro-rata. Principal shares are unaffected.
    function harvest(uint256 deadline) external onlyOwner nonReentrant returns (uint256 quoteFees, uint256 pairedFees) {
        if (tokenId == 0) revert NotDeployed();
        (quoteFees, pairedFees) = _sweepFees(deadline);
        _anchorFollow();
    }

    /// @dev Collect ALL accrued position fees (zero-liquidity delta) to `harvestRecipient`. The shared
    ///      fee-collection primitive: used by harvest AND called before any principal decrease (withdraw)
    ///      or increase (deploy) so those paths never hand the position's fees to a depositor (finding H-02).
    function _sweepFees(uint256 deadline) internal returns (uint256 quoteFees, uint256 pairedFees) {
        if (tokenId == 0) return (0, 0);
        // Re-audit A-2: a zero-delta update against an EMPTIED position reverts CannotUpdateEmptyPosition in
        // v4-core, and DECREASE never burns the NFT — so after a full LP drain this would brick deploy,
        // harvest, and every adapter-short withdraw forever. A full decrease already collected all fees, so
        // there is nothing to sweep: return instead of calling into the pool.
        if (positionManager.getPositionLiquidity(tokenId) == 0) return (0, 0);
        (quoteFees, pairedFees) = _decreaseAndTake(0, address(this), deadline);
        if (quoteFees > 0) quoteAsset.safeTransfer(harvestRecipient, quoteFees);
        if (pairedFees > 0) pairedAsset.safeTransfer(harvestRecipient, pairedFees);
        if (quoteFees != 0 || pairedFees != 0) emit Harvested(quoteFees, pairedFees, harvestRecipient);
    }

    // ── owner: circuit-breaker + compound ─────────────────────────────────────────────────────

    /// @notice Owner circuit-breaker (item 13): pause/unpause NEW deposits. Withdraw is NEVER gated, so a
    ///         pause can't trap funds — it only stops fresh capital entering a degrading/out-of-range pool.
    ///         Flipped by the operator, or by the keeper on a sustained out-of-range alert.
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Raise or lower the ceiling on `idle + deployedPrincipal + deployedPairedValue` (IA-11). Takes
    ///         effect immediately — lowering it below the current total simply blocks further growth (a new
    ///         `deposit` or `deploy`), it never forces a withdrawal or touches funds already held. Mirrors the
    ///         idle adapter's `setDepositCap`; for an idle-mode rig, keep both in sync with the same
    ///         `LP_GATEWAY_DEPOSIT_CAP` value so the two caps never drift apart.
    function setPrincipalCap(uint256 cap) external onlyOwner {
        principalCap = cap;
        emit PrincipalCapSet(cap);
    }

    /// @notice Owner-gated compound (item 14 restake destination): stage `amount` quote back into the yield
    ///         reserve, lifting NAV pro-rata for ALL shareholders with NO share mint and NO paired leg —
    ///         pure accretion. The caller (harvest recipient / oracle seat) supplies the net harvested fees.
    /// @dev    Round-3 idle-adapter adversarial pass, IA-4: a capped yield source (the idle adapter's own
    ///         `depositCap`, or a real 4626 at its supply cap) makes `staging.stage` revert `DepositCapExceeded` /
    ///         `ERC4626ExceededMaxDeposit` the moment the source is full — the deliberately-small-cap steady
    ///         state this compound path exists to feed. `deploy()`'s own re-stage got the identical best-effort
    ///         treatment for the identical reason (R3-2). Compounding is pure accretion to EXISTING holders, not
    ///         new depositor exposure, so it is semantically correct — not merely convenient — for it never to
    ///         need the cap at all: on a stage failure the harvested quote simply stays parked in this contract's
    ///         own balance, which `_idle()` already counts fully toward NAV (R3-INV-2's "parked quote counts as
    ///         idle" applies verbatim here), so the compound still lifts NAV pro-rata for every holder — it just
    ///         does so without moving into the source. This call itself only ever stages the amount IT was
    ///         passed, not any previously-deferred dust; the next `deploy()` (whose own re-stage sweeps this
    ///         contract's ENTIRE quote balance once headroom exists, not just its own leftover) is what actually
    ///         picks up anything left parked here. Nothing is ever stranded and no retry loop or repeated
    ///         wasted-gas revert is needed from the harvest cron.
    function compoundQuote(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        quoteAsset.safeTransferFrom(msg.sender, address(this), amount);
        quoteAsset.forceApprove(address(staging), amount);
        try staging.stage(amount) {}
        catch {
            quoteAsset.forceApprove(address(staging), 0);
            emit CompoundDeferred(amount);
        }
        _syncIdle(); // keep the C-10 fallback current
        emit Compounded(amount);
    }

    // ── NAV (quote-asset terms) ──────────────────────────────────────────────────────────────

    /// @notice Spot NAV (quote terms) — for display + as the follower's input. Deposit/withdraw price off
    ///         the direction-conservative marks (max/min of spot vs the follower), not this.
    ///         C-10: never reverts on an unreadable yield source — the idle leg falls back to `lastKnownIdle`
    ///         (check `sourceReadable()`; treat the figure as STALE while it is false).
    function totalNav() public view returns (uint256) {
        (bool ok, uint256 idle) = _idle();
        if (!ok) idle = lastKnownIdle;
        if (tokenId == 0) return idle; // no spot read until deployed
        return idle + _deployedQuoteValueAt(_spot());
    }

    /// @dev NAV that MINTS deposit shares: LP leg at the holder-favourable mark — max over spot, the follower AND
    ///      the entry-mark memory (round-3 XR-1 / E-1) — so neither a flash dump, a one-step dump + `poke()`, nor
    ///      a dump held for less than the memory window can cheapen entry.
    ///      STRICT on the idle leg (C-10): reverts `SourceUnavailable` rather than mint against a stale reserve.
    ///      Not a view — refreshes `lastKnownIdle` as a side effect of the successful read.
    function _navDepositStrict() internal returns (uint256) {
        uint256 idle = _syncIdle();
        if (tokenId == 0) return idle; // idle-only until deployed — no spot read
        return idle + _deployedQuoteValueAt(_holderMark(_spot()));
    }

    /// @dev Deployed-leg quote value with BOTH the composition and the paired-leg valuation taken at
    ///      `price` — so a conservative reference price yields a conservative value. Rounds down.
    function _deployedQuoteValueAt(uint160 price) internal view returns (uint256) {
        if (tokenId == 0) return 0;
        uint128 liq = positionManager.getPositionLiquidity(tokenId);
        if (liq == 0) return 0;
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tickUpper);
        (uint256 amt0, uint256 amt1) = _amountsForLiquidity(price, sqrtA, sqrtB, liq);
        (uint256 quoteLeg, uint256 pairedLeg) = quoteIsCurrency0 ? (amt0, amt1) : (amt1, amt0);
        return quoteLeg + _pairedToQuote(pairedLeg, price);
    }

    // Composed from v4-core SqrtPriceMath (getAmountsForLiquidity isn't in this periphery build). Rounds
    // down — NAV never overstates the position. Standard in-range / out-of-range branch selection.
    function _amountsForLiquidity(uint160 sqrtP, uint160 sqrtA, uint160 sqrtB, uint128 liq)
        internal
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        if (sqrtA > sqrtB) (sqrtA, sqrtB) = (sqrtB, sqrtA);
        if (sqrtP <= sqrtA) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, liq, false);
        } else if (sqrtP < sqrtB) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtP, sqrtB, liq, false);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtP, liq, false);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, liq, false);
        }
    }

    // Value a paired-leg amount in quote terms at spot. token1/token0 price = (sqrtP/2^96)^2.
    function _pairedToQuote(uint256 pairedAmount, uint160 sqrtPriceX96) internal view returns (uint256) {
        if (pairedAmount == 0) return 0;
        if (quoteIsCurrency0) {
            // paired = currency1 → value in currency0: amount * (2^96/sqrtP)^2
            uint256 inter = FullMath.mulDiv(pairedAmount, Q96, sqrtPriceX96);
            return FullMath.mulDiv(inter, Q96, sqrtPriceX96);
        } else {
            // paired = currency0 → value in currency1: amount * (sqrtP/2^96)^2
            uint256 inter = FullMath.mulDiv(pairedAmount, sqrtPriceX96, Q96);
            return FullMath.mulDiv(inter, sqrtPriceX96, Q96);
        }
    }

    // ── internal V4 periphery encoding ───────────────────────────────────────────────────────

    function _permit(IERC20 token, uint256 amount) internal {
        if (amount == 0) return;
        token.forceApprove(address(permit2), amount);
        permit2.approve(address(token), address(positionManager), uint160(amount), uint48(block.timestamp + 1800));
    }

    /// @dev Zero the Permit2 allowance the PositionManager holds for `token` (finding L-04) — the mint
    ///      rounding leaves a small residual approval otherwise.
    function _revokePermit(IERC20 token) internal {
        permit2.approve(address(token), address(positionManager), 0, 0);
    }

    function _modify(bytes memory unlockData, uint256 deadline) internal {
        positionManager.modifyLiquidities(unlockData, deadline);
    }

    function _mintCalls(uint128 liquidity, uint128 amount0Max, uint128 amount1Max)
        internal
        view
        returns (bytes memory)
    {
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            _poolKey, tickLower, tickUpper, uint256(liquidity), amount0Max, amount1Max, address(this), bytes("")
        );
        params[1] = abi.encode(_poolKey.currency0, _poolKey.currency1);
        return abi.encode(actions, params);
    }

    function _increaseCalls(uint128 liquidity, uint128 amount0Max, uint128 amount1Max)
        internal
        view
        returns (bytes memory)
    {
        bytes memory actions = abi.encodePacked(uint8(Actions.INCREASE_LIQUIDITY), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(liquidity), amount0Max, amount1Max, bytes(""));
        params[1] = abi.encode(_poolKey.currency0, _poolKey.currency1);
        return abi.encode(actions, params);
    }

    // DECREASE_LIQUIDITY (liquidity may be 0 → fee-only collect) + TAKE_PAIR. Always takes to self so
    // the collected amounts are measurable, then forwards to `recipient` when it isn't this contract.
    function _decreaseAndTake(uint128 liquidity, address recipient, uint256 deadline)
        internal
        returns (uint256 gotQuote, uint256 gotPaired)
    {
        uint256 qb = quoteAsset.balanceOf(address(this));
        uint256 pb = pairedAsset.balanceOf(address(this));

        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(liquidity), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(_poolKey.currency0, _poolKey.currency1, address(this));
        positionManager.modifyLiquidities(abi.encode(actions, params), deadline);

        gotQuote = quoteAsset.balanceOf(address(this)) - qb;
        gotPaired = pairedAsset.balanceOf(address(this)) - pb;
        if (recipient != address(this)) {
            if (gotQuote > 0) quoteAsset.safeTransfer(recipient, gotQuote);
            if (gotPaired > 0) pairedAsset.safeTransfer(recipient, gotPaired);
        }
    }
}
