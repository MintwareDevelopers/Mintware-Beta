// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math}            from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager}    from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}         from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}        from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath}        from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {IYieldVault}      from "./IYieldVault.sol";
import {IYieldAdapter}    from "../vaults/IYieldAdapter.sol";
import {SeniorSharesMath} from "../lib/SeniorSharesMath.sol";
import {MintwarePairVault}         from "../vaults/MintwarePairVault.sol";
import {MWTimelockedRiskParams}    from "../lib/MWTimelockedRiskParams.sol";
import {MWTreasuryPositionLib}     from "./lib/MWTreasuryPositionLib.sol";

/// @dev The JIT hook's truncated-oracle reference (AUDIT #7/#3). Optional: if the vault's JIT hook
///      doesn't implement it (or none is set), valuation falls back to spot.
interface IJitOracle {
    function oracleTick() external view returns (int24 tick, bool ready);
}

/// @title  MintwareTreasuryVault
/// @notice YPN v2 — the treasury-anchored ULV behind `IYieldVault`. A STRUCTURED TRANCHE vault:
///
///           • SENIOR  = community USDC.  A par + yield, PRICE-FREE, card-spendable claim.
///           • JUNIOR  = the team/treasury's locked native reserve.  First-loss; absorbs price + IL.
///
///         Community USDC idles in Aave (via an `IYieldAdapter`) and — up to a governable fraction —
///         is deployed as two-sided Uniswap-V4 liquidity with the team token. The vault HOLDS the V4
///         position directly (Phase-2 convergence: the old external `MintwareV4LiquidityModule` was
///         folded into this contract via the `MWTreasuryPositionLib` delegatecall library, so there is
///         one fewer contract + one fewer trust boundary). The Gateway settles card charges against the
///         senior side through the *same* `IYieldVault` seam as v1 (`MintwareYieldVault`), so the
///         payment stack is unchanged.
///
/// @dev    STRUCTURE (Phase-2 convergence). `MintwareTreasuryVault is MintwarePairVault,
///         IUnlockCallback, IYieldVault`. From the shared `MintwarePairVault` base it inherits the
///         audited V4 settlement plumbing, the pool identity + range state (`poolKey`/`tickLower`/
///         `tickUpper`), and the Stage-1.4 guardian kill-switch (Ownable + Pausable + a fast-pause
///         `guardian`) plus ReentrancyGuard. It holds the LP itself: `positionLiquidity` + the heavy V4
///         handlers (deploy/recover/collect + valuation) live in `MWTreasuryPositionLib`, delegatecalled
///         from `unlockCallback`. Everything else (the tranche accounting below) is UNCHANGED.
///
/// @dev    REENTRANCY (the #1 correctness point). A redemption is `redeemSenior`/`burnForPayment`
///         (`nonReentrant`) → `_pullUSDC` → `_recoverFromLP` → `poolManager.unlock` → the PoolManager
///         makes an EXTERNAL call BACK to `this.unlockCallback`, MID-`nonReentrant`. `unlockCallback` is
///         therefore guarded by `_onlyPoolManager()` ONLY and MUST NEVER be `nonReentrant` (a
///         `nonReentrant` there would revert every redemption). The Op-dispatch delegatecalls only the
///         stateless library — never a `nonReentrant` external self-function.
///
/// @dev    THE CRUX — the senior claim counts its deployed USDC at PAR, never mark-to-market:
///
///           seniorAssets = adapter.totalAssets()          // idle in Aave (principal + interest)
///                        + (usdcBalance - reservedJuniorUSDC - juniorUsdcBuffer) // free SENIOR buffer
///                        + deployedFromSenior              // senior USDC out in the LP, at PAR
///                        + jitBorrowed                     // senior USDC out in a JIT position, at PAR
///
///         No pool price appears anywhere in the senior NAV. The LP's IL/MTM lands entirely on the
///         junior. Senior share math is lifted verbatim from `MintwareYieldVault` — symmetric virtual
///         offset (`VIRTUAL = 1e6`) inflation defense; mint rounds DOWN, `previewWithdraw` rounds UP,
///         redeem asset-math rounds DOWN — every division toward the vault.
///
/// @dev    JUNIOR COMPOSITION — the junior first-loss reserve is `team ETH + OPTIONAL junior USDC`:
///           • `juniorTokens`     = the team's committed native token (volatile; the LP's junior leg).
///           • `juniorUsdcBuffer` = the team's OPTIONAL committed USDC — rock-solid first-loss coverage
///                                  that does NOT move with the mark. EXCLUDED from every senior view, so
///                                  it never inflates the senior claim, and DRAWN in `_pullUSDC` as the
///                                  last resort before revert. Whatever it never had to absorb is
///                                  returned to the team at `redeemJunior`. Set `juniorUSDC = 0` at
///                                  commit for the pure-ETH tranche.
///
/// @dev    THE SOLVENCY INVARIANT (fuzzed 256×128k):
///           deployedFromSenior <= recoverableUSDC() + juniorUsdcBuffer
///         The position values itself by spending the junior token to make senior USDC whole FIRST
///         (seniority is enforced in `MWTreasuryPositionLib.recover`); `juniorUsdcBuffer` is stable
///         coverage on top. `recoverableUSDC()` is the conservative `min(spot, oracle)` MTM — a flash
///         spot pump can NOT inflate it. Redemptions NEVER underpay the senior: `_pullUSDC` reverts
///         rather than pay < par, trading liveness (not principal) in the tail where the junior is wiped.
///
/// @dev    Idle-first (idleBufferTargetBps, default 8000 = 80%): the LP slice is small, so the Aave
///         buffer serves ~all card spends instantly and the exposed (IL-bearing) fraction stays inside
///         the junior's coverage.
contract MintwareTreasuryVault is MintwarePairVault, IUnlockCallback, IYieldVault, MWTimelockedRiskParams {
    using SafeERC20 for IERC20;
    using Math      for uint256;

    /// @notice Symmetric virtual offset (virtual shares == virtual assets). Inflation defense — see
    ///         `MintwareYieldVault` NatSpec for the full argument; the algebra is identical here.
    /// @dev    1e6 (== 1.0 USDC at 6dp) makes the first-depositor donation attack economically absurd.
    uint256 public constant VIRTUAL = 1e6;

    uint16 public constant BPS = 10_000;
    uint16 public constant MIN_IDLE_TARGET_BPS = 5_000;  // >=50% par-safe in Aave, else senior can't be served
    uint16 public constant MAX_IDLE_TARGET_BPS = 9_500;  // <=95%, else no LP depth
    uint256 public constant MIN_LOCK_DURATION  = 90 days; // hard junior cliff
    uint256 public constant MAX_LOCK_DURATION  = 1460 days;
    uint16  public constant MAX_JIT_PER_BLOCK_BPS = 2_000; // <=20% of senior lendable to JIT per block

    // fee split post-lock (community / team / protocol) in bps — 60/30/10
    uint16 public constant FEE_COMMUNITY_BPS = 6_000;
    uint16 public constant FEE_TEAM_BPS      = 3_000;
    uint16 public constant FEE_PROTOCOL_BPS  = 1_000;

    // ── governed risk-parameter ids + bounds (legal 48h-timelock rail) ─────────────────────────────
    // Every setter below routes through `MWTimelockedRiskParams`: bounded at propose time, instant while
    // pre-activation OR when the change TIGHTENS safety, else 48h-timelocked + disclosed. Ids are public so
    // ops/governance can call `confirmRiskParam`/`cancelRiskParam` and index the disclosure events.
    bytes32 public constant RP_IDLE_BUFFER_TARGET = keccak256("MintwareTreasuryVault.idleBufferTargetBps");
    bytes32 public constant RP_JIT_CAP            = keccak256("MintwareTreasuryVault.jitMaxPerBlockBps");
    bytes32 public constant RP_MIN_COVERAGE       = keccak256("MintwareTreasuryVault.minCoverageBps");
    bytes32 public constant RP_MAX_BURN_PER_BLOCK = keccak256("MintwareTreasuryVault.maxBurnPerBlock");
    bytes32 public constant RP_JIT_MAX_CUM_LOSS   = keccak256("MintwareTreasuryVault.jitMaxCumulativeLoss");
    /// @notice Sanity ceiling on the coverage floor (≤ 500% over-collateralization). Rejects a nonsense floor
    ///         at propose time; the meaningful control is the timelock, not this bound.
    uint256 public constant MAX_MIN_COVERAGE_BPS  = 50_000;
    /// @notice Fat-finger ceilings on the two "0 == off" USDC threshold caps. Decimals-agnostic — they only
    ///         reject an absurd typo; the timelock governs the meaningful (loosening) direction, not a
    ///         numeric economic bound.
    uint256 public constant MAX_BURN_CAP          = type(uint128).max;
    uint256 public constant MAX_JIT_CUM_LOSS_CAP  = type(uint128).max;

    IERC20        public immutable usdc;      // 6dp senior settlement asset
    IERC20        public immutable teamToken; // junior reserve asset
    IYieldAdapter public immutable adapter;   // USDC idle sink (Aave)

    /// @notice Token ordering of the vault's pool (currency0 < currency1 by address). Set at construction.
    bool public immutable usdcIsCurrency0;

    address public gateway;                    // sole burnForPayment caller (set once)
    address public protocolTreasury;           // receives the 10% protocol fee cut post-lock

    /// @notice The vault's live full-range V4 liquidity (`L` units). The senior claim reads value via
    ///         `recoverableUSDC()`, not this raw number. Was `MintwareV4LiquidityModule.positionLiquidity`.
    uint128 public positionLiquidity;

    // ── senior (community) ────────────────────────────────────────────────────────
    mapping(address => uint256) public seniorShares;
    uint256 public totalSeniorShares;
    /// @notice Senior USDC currently out in the LP, valued at PAR (never MTM).
    uint256 public deployedFromSenior;
    /// @notice USDC held by the vault that belongs to the JUNIOR (post-lock team fee cuts), excluded
    ///         from every senior-side view so it can never be redeemed by the senior.
    uint256 public reservedJuniorUSDC;
    /// @notice USDC earmarked for the PROTOCOL fee cut by `fundRent` (Phase 3). Accumulated on the swap
    ///         hot path (no external transfer there — a blacklisting treasury must not be able to brick a
    ///         swap) and paid out OFF-path via `flushProtocol`/`accrueFees`. Excluded from the senior view.
    uint256 public reservedProtocolUSDC;

    // ── junior (team) ─────────────────────────────────────────────────────────────
    address public team;
    uint256 public juniorTokens;       // team token in the reserve (locked)
    /// @notice The team's OPTIONAL committed USDC — idle, stable first-loss coverage.
    uint256 public juniorUsdcBuffer;
    uint256 public lockExpiry;         // junior hard cliff
    uint256 public idleBufferTargetBps = 8_000; // governable per-vault, [MIN,MAX]

    /// @notice Coverage-ratio floor (pre-audit hardening #7b — Idle/Gearbox pattern). When the junior USDC
    ///         first-loss buffer thins below `minCoverageBps` of the deployed-at-risk senior, RISK-INCREASING
    ///         ops are halted (`deployToLP` reverts, JIT no-ops), so senior exposure never outruns the junior
    ///         cushion — PREVENTING a Black-Thursday shortfall proactively rather than relying on the revert
    ///         path at the moment of stress. Only the rock-solid USDC buffer counts; the volatile junior
    ///         token is deliberately NOT valued at spot (manipulable / circular). Default 0 = OFF (behavior
    ///         unchanged); ops-enable per pool tier (thinner junior ⇒ higher floor — see pool-tiering).
    uint256 public minCoverageBps;
    bool    public activated;
    /// @notice True while the junior is locked: 100% of collected LP fees credit the senior.
    bool    public teamFeesRedirected;

    // ── JIT (bounded senior slice lent to the JIT hook per-swap; junior backstops residual) ─────────
    /// @notice The sole caller of `borrowIdleForJit`/`settleJitReturn` — a V4 hook. Set once. Also the
    ///         `min(spot,oracle)` truncated-oracle source read by `recoverableUSDC()`.
    address public jitHook;
    /// @notice Senior USDC currently out in a JIT position, valued at PAR. Bounded to ONE outstanding
    ///         slice at a time; realized PnL across the window is tracked in `jitNetPnl`.
    uint256 public jitBorrowed;
    /// @notice The bounded senior slice lendable to JIT per block, in bps of the senior base (<= MAX).
    uint16  public jitMaxPerBlockBps = 500; // 5% default
    uint256 private jitBlock;               // block of the current per-block accumulator
    uint256 private jitBorrowedThisBlock;   // senior USDC lent to JIT so far this block
    /// @notice AUDIT M3: the vault's USDC balance captured right AFTER lending to the JIT hook. The hook's
    ///         return is BALANCE-VERIFIED against this (not self-reported) — the borrow→settle round is
    ///         atomic within one swap, so the balance can only have moved by the hook's return transfer.
    uint256 private _jitUsdcBaseline;

    /// @notice AUDIT M1: optional per-block ceiling (USDC) on Gateway-driven `burnForPayment`, so even a
    ///         compromised/buggy Gateway can only drain the senior at a BOUNDED rate — giving the guardian
    ///         time to pause. 0 = off (default). Defense in depth on top of the Gateway's own permit caps.
    uint256 public maxBurnPerBlock;
    uint256 private _burnBlock;
    uint256 private _burnedThisBlock;

    /// @notice AUDIT H4: cumulative REALIZED JIT PnL in USDC (signed).
    int256  public jitNetPnl;
    /// @notice Owner-set: if cumulative net JIT loss breaches this (USDC), the breaker trips. 0 = off.
    uint256 public jitMaxCumulativeLoss;
    /// @notice True once the loss breaker has tripped — `borrowIdleForJit` no-ops until reset.
    bool    public jitAutoDisabled;

    // ── am-AMM rent sink (Phase 3 — enrolled blue-chip pools) ───────────────────────────────────
    /// @notice The sole address allowed to PUSH auction rent via `fundRent` — the `MWAmAuction` contract
    ///         (owner-set). On an am-AMM-enrolled pool the auction manager skims the swap fee, so per-block
    ///         rent replaces the LP swap fee as the vault's yield; it is routed exactly like `accrueFees`.
    address public rentFunder;

    /// @dev Op tag for the vault's own PoolManager unlock (dispatched in `unlockCallback`).
    enum Op { DEPLOY, RECOVER, COLLECT }

    event GatewaySet(address indexed gateway);
    event TeamCommitted(address indexed team, uint256 teamTokens, uint256 juniorUsdc, uint256 lockExpiry);
    event JuniorUsdcAbsorbed(uint256 amount);
    event SeniorDeposit(address indexed caller, address indexed to, uint256 assets, uint256 shares);
    event SeniorRedeem(address indexed owner, uint256 shares, uint256 assets);
    event PaymentBurn(address indexed user, address indexed receiver, uint256 shares, uint256 assets);
    event DeployedToLP(uint256 usdc, uint256 teamTokenUsed);
    event RecoveredFromLP(uint256 usdcWanted, uint256 usdcReturned, uint256 teamTokenReturned);
    event FeesAccrued(uint256 total, uint256 toSenior, uint256 toJunior, uint256 toProtocol);
    event JuniorRedeemed(address indexed team, uint256 teamTokens, uint256 usdc);
    event IdleTargetSet(uint16 bps);
    event JitHookSet(address indexed hook);
    event JitCapSet(uint16 bps);
    event JitBorrowed(uint256 lent);
    event JitSettled(uint256 borrowed, uint256 returned, uint256 shortfall);
    event JitBreakerTripped(int256 netPnl);
    event JitBreakerReset(int256 netPnl);
    event JitMaxCumulativeLossSet(uint256 maxLoss);
    event RentFunderSet(address indexed funder);
    event RentFunded(uint256 total, uint256 toSenior, uint256 toJunior, uint256 toProtocol);
    event ProtocolFlushed(uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error AlreadySet();
    error OnlyGateway();
    error OnlyTeam();
    error NotActivated();
    error AlreadyActivated();
    error InsufficientShares();
    error InsufficientIdleLiquidity();
    error StillLocked();
    error CoverageTooLow();

    event MinCoverageSet(uint256 bps);
    event MaxBurnPerBlockSet(uint256 cap);
    error BadParam();
    error BurnRateExceeded();
    error OnlyJitHook();
    error UsdcNotInPool();
    error OnlyRentFunder();
    error RentTokenMismatch();

    modifier onlyGateway() { if (msg.sender != gateway) revert OnlyGateway(); _; }
    modifier onlyJitHook() { if (msg.sender != jitHook) revert OnlyJitHook(); _; }

    /// @param poolManager_ the V4 singleton.
    /// @param key_         the USDC/teamToken pool this vault LPs into (must already be initialized). The
    ///                     team/junior token is the pool currency that is NOT `usdc_`.
    /// @param usdc_        senior settlement asset (USDC); MUST be one of the pool's two currencies.
    /// @param adapter_     Aave idle adapter whose underlying is `usdc_`.
    /// @param owner_       vault owner (wiring, governance, pause).
    /// @param team_        AUDIT M1: the team address bound AT CREATION — the only account that may
    ///                     `commitTeam`. Prevents an activation front-run hijack. Distinct from `owner_`.
    constructor(
        address poolManager_,
        PoolKey memory key_,
        address usdc_,
        address adapter_,
        address owner_,
        address team_
    ) MintwarePairVault(poolManager_, address(0), owner_) {
        if (usdc_ == address(0) || adapter_ == address(0) || team_ == address(0)) revert ZeroAddress();

        address c0 = Currency.unwrap(key_.currency0);
        address c1 = Currency.unwrap(key_.currency1);
        bool isC0 = (usdc_ == c0);
        if (!isC0 && usdc_ != c1) revert UsdcNotInPool();
        usdcIsCurrency0 = isC0;

        usdc      = IERC20(usdc_);
        teamToken = IERC20(isC0 ? c1 : c0);
        adapter   = IYieldAdapter(adapter_);
        team      = team_;

        poolKey = key_;
        // Full-range: the widest tick multiples of the pool's spacing (was the module's constructor).
        int24 spacing = key_.tickSpacing;
        tickLower = (TickMath.MIN_TICK / spacing) * spacing;
        tickUpper = (TickMath.MAX_TICK / spacing) * spacing;
    }

    // ── admin / wiring (set-once) ─────────────────────────────────────────────────

    function setGateway(address gateway_) external onlyOwner {
        if (gateway != address(0)) revert AlreadySet();
        if (gateway_ == address(0)) revert ZeroAddress();
        gateway = gateway_;
        emit GatewaySet(gateway_);
    }

    function setProtocolTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        protocolTreasury = t;
    }

    /// @notice Governed (48h-timelocked) risk param — LOWERING the idle-buffer target deploys MORE senior
    ///         USDC into the IL-bearing LP (risk-increasing → timelocked); RAISING it (safety) is instant.
    ///         Bounded [MIN_IDLE_TARGET_BPS, MAX_IDLE_TARGET_BPS] at propose time. Instant before activation.
    function setIdleBufferTarget(uint16 bps) external onlyOwner {
        _changeRiskParam(RP_IDLE_BUFFER_TARGET, bps, 0);
    }

    /// @notice Wire the JIT hook (set-once). It becomes the sole caller of `borrowIdleForJit`/
    ///         `settleJitReturn`, AND the truncated-oracle source `recoverableUSDC()` reads. The pool must
    ///         be created with this hook baked into its PoolKey.
    function setJitHook(address hook_) external onlyOwner {
        if (jitHook != address(0)) revert AlreadySet();
        if (hook_ == address(0)) revert ZeroAddress();
        jitHook = hook_;
        emit JitHookSet(hook_);
    }

    /// @notice Governed (48h-timelocked) risk param — the bounded senior slice lendable to JIT per block
    ///         (0 disables JIT lending). RAISING the cap exposes more senior to JIT (risk-increasing →
    ///         timelocked); LOWERING it (safety) is instant. Bounded ≤ MAX_JIT_PER_BLOCK_BPS at propose time.
    function setJitCap(uint16 bps) external onlyOwner {
        _changeRiskParam(RP_JIT_CAP, bps, 0);
    }

    /// @notice Governed (48h-timelocked) risk param — the coverage-ratio floor (bps of deployed-at-risk
    ///         senior the junior USDC buffer must cover; 0 = OFF). LOWERING the floor weakens the cushion
    ///         (risk-increasing → timelocked); RAISING it (safety) is instant. Bounded ≤ MAX_MIN_COVERAGE_BPS.
    function setMinCoverage(uint16 bps) external onlyOwner {
        _changeRiskParam(RP_MIN_COVERAGE, bps, 0);
    }

    /// @notice AUDIT M1 — Governed (48h-timelocked) risk param: the per-block `burnForPayment` ceiling in
    ///         USDC (0 = off = unbounded = loosest). RAISING the cap (or setting it to 0) lets the senior
    ///         drain faster (risk-increasing → timelocked); LOWERING a non-zero cap (safety) is instant.
    ///         Bounded ≤ MAX_BURN_CAP at propose time.
    function setMaxBurnPerBlock(uint256 cap) external onlyOwner {
        _changeRiskParam(RP_MAX_BURN_PER_BLOCK, cap, 0);
    }

    /// @notice Wire (or clear) the am-AMM auction that may push rent via `fundRent`. Re-settable by the
    ///         owner (an auction upgrade re-points it); `address(0)` disables rent intake. Only ever lets
    ///         the funder ADD USDC value to the vault, so it carries no set-once restriction.
    function setRentFunder(address funder) external onlyOwner {
        rentFunder = funder;
        emit RentFunderSet(funder);
    }

    /// @notice AUDIT H4 — Governed (48h-timelocked) risk param: the cumulative realized-JIT-loss threshold
    ///         that trips the breaker, in USDC (0 = off = no breaker = loosest). RAISING the threshold (or
    ///         setting it to 0) lets JIT bleed further before auto-disabling (risk-increasing → timelocked);
    ///         LOWERING a non-zero threshold (safety) is instant. Bounded ≤ MAX_JIT_CUM_LOSS_CAP.
    /// @dev    NOTE: this governs only the DELIBERATE tuning of the breaker THRESHOLD. The breaker itself
    ///         (auto-disable in `settleJitReturn`/`forceSettleJit`) fires INSTANTLY and is never timelocked.
    function setJitMaxCumulativeLoss(uint256 maxLoss) external onlyOwner {
        _changeRiskParam(RP_JIT_MAX_CUM_LOSS, maxLoss, 0);
    }

    /// @notice Confirm a 48h-timelocked risk-parameter change once its delay has elapsed (owner-only wrapper
    ///         over `MWTimelockedRiskParams`). `param` is one of the `RP_*` ids.
    function confirmRiskParam(bytes32 param) external onlyOwner { _confirmRiskParam(param); }

    /// @notice Cancel a pending (not-yet-confirmed) risk-parameter change — abort a rogue/superseded proposal.
    function cancelRiskParam(bytes32 param) external onlyOwner { _cancelRiskParam(param); }

    /// @notice AUDIT H4: clear a tripped JIT breaker (owner review) and reset the PnL accumulator.
    function resetJitBreaker() external onlyOwner {
        emit JitBreakerReset(jitNetPnl);
        jitAutoDisabled = false;
        jitNetPnl = 0;
    }

    // ── MWTimelockedRiskParams hooks (describe this vault's governed params) ────────────────────────

    /// @dev The vault is "live" (timelock binds) once the team has committed and deposits are open. Before
    ///      that — deploy wiring + test setUp — every risk-param set is instant (first-set-immediate).
    function _riskParamsLive() internal view override returns (bool) {
        return activated;
    }

    function _validateRiskParam(bytes32 param, uint256 v, uint256 /*v2*/) internal view override {
        if (param == RP_IDLE_BUFFER_TARGET) {
            if (v < MIN_IDLE_TARGET_BPS || v > MAX_IDLE_TARGET_BPS) revert BadParam();
        } else if (param == RP_JIT_CAP) {
            if (v > MAX_JIT_PER_BLOCK_BPS) revert BadParam();
        } else if (param == RP_MIN_COVERAGE) {
            if (v > MAX_MIN_COVERAGE_BPS) revert BadParam();
        } else if (param == RP_MAX_BURN_PER_BLOCK) {
            if (v > MAX_BURN_CAP) revert BadParam();
        } else if (param == RP_JIT_MAX_CUM_LOSS) {
            if (v > MAX_JIT_CUM_LOSS_CAP) revert BadParam();
        } else {
            revert BadParam();
        }
    }

    function _readRiskParam(bytes32 param) internal view override returns (uint256) {
        if (param == RP_IDLE_BUFFER_TARGET) return idleBufferTargetBps;
        if (param == RP_JIT_CAP)            return jitMaxPerBlockBps;
        if (param == RP_MIN_COVERAGE)       return minCoverageBps;
        if (param == RP_MAX_BURN_PER_BLOCK) return maxBurnPerBlock;
        if (param == RP_JIT_MAX_CUM_LOSS)   return jitMaxCumulativeLoss;
        revert BadParam();
    }

    function _writeRiskParam(bytes32 param, uint256 v, uint256 /*v2*/) internal override {
        if (param == RP_IDLE_BUFFER_TARGET)      { idleBufferTargetBps  = uint16(v); emit IdleTargetSet(uint16(v)); }
        else if (param == RP_JIT_CAP)            { jitMaxPerBlockBps    = uint16(v); emit JitCapSet(uint16(v)); }
        else if (param == RP_MIN_COVERAGE)       { minCoverageBps       = v;         emit MinCoverageSet(v); }
        else if (param == RP_MAX_BURN_PER_BLOCK) { maxBurnPerBlock      = v;         emit MaxBurnPerBlockSet(v); }
        else if (param == RP_JIT_MAX_CUM_LOSS)   { jitMaxCumulativeLoss = v;         emit JitMaxCumulativeLossSet(v); }
        else revert BadParam();
    }

    /// @dev Direction gate: instant before activation, else instant only when the change TIGHTENS safety.
    function _riskParamInstant(bytes32 param, uint256 v, uint256 /*v2*/) internal view override returns (bool) {
        if (!activated) return true; // first-set-immediate
        uint256 cur = _readRiskParam(param);
        // higher == stricter → instant on raise/equal: idle-buffer target, coverage floor
        if (param == RP_IDLE_BUFFER_TARGET || param == RP_MIN_COVERAGE) return v >= cur;
        // lower == stricter → instant on lower/equal: JIT per-block cap
        if (param == RP_JIT_CAP) return v <= cur;
        // "0 == off == loosest" caps/thresholds (maxBurnPerBlock, jitMaxCumulativeLoss): stricter == a lower
        // NON-ZERO value; disabling (→ 0) or raising is loosening. Map 0 → +inf, instant iff effNew <= effOld.
        uint256 effNew = v   == 0 ? type(uint256).max : v;
        uint256 effOld = cur == 0 ? type(uint256).max : cur;
        return effNew <= effOld;
    }

    // NOTE: pause()/unpause() are inherited from MintwarePairVault → MWGuardianPausable (guardian may
    // fast-pause, owner unpauses) — the Stage-1.4 kill-switch. The old owner-only pair is superseded.

    // ── junior (team) lifecycle ───────────────────────────────────────────────────

    /// @notice The team commits its native token — plus, optionally, a slug of USDC — as the junior
    ///         first-loss reserve, locks it for `lockDur` (>= 90 days), and opens the vault for deposits.
    function commitTeam(uint256 teamTokens, uint256 juniorUSDC, uint256 lockDur)
        external nonReentrant whenNotPaused
    {
        // AUDIT M1: only the constructor-bound team may commit + activate (no front-run hijack).
        if (msg.sender != team) revert OnlyTeam();
        if (activated) revert AlreadyActivated();
        if (teamTokens == 0) revert ZeroAmount();
        if (lockDur < MIN_LOCK_DURATION || lockDur > MAX_LOCK_DURATION) revert BadParam();

        lockExpiry         = block.timestamp + lockDur;
        teamFeesRedirected = true;
        activated          = true;

        teamToken.safeTransferFrom(msg.sender, address(this), teamTokens);
        juniorTokens += teamTokens;

        if (juniorUSDC > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), juniorUSDC);
            juniorUsdcBuffer += juniorUSDC;
        }

        emit TeamCommitted(msg.sender, teamTokens, juniorUSDC, lockExpiry);
    }

    /// @notice Post-cliff, the team redeems the junior: its remaining token reserve plus any junior USDC.
    function redeemJunior() external nonReentrant {
        if (msg.sender != team) revert OnlyTeam();
        if (block.timestamp < lockExpiry) revert StillLocked();

        teamFeesRedirected = false;

        // AUDIT H3: protected earned income (reservedJuniorUSDC) is always returnable, but the FIRST-LOSS
        // capital (ETH stake + junior USDC buffer) is released only once the senior is fully covered
        // WITHOUT it (LP alone recovers the deployed par + no JIT loan in flight).
        uint256 fees = reservedJuniorUSDC;
        reservedJuniorUSDC = 0;

        uint256 tok;
        uint256 firstLossUsdc;
        if (_seniorFullyCovered()) {
            tok           = juniorTokens;
            firstLossUsdc = juniorUsdcBuffer;
            juniorTokens     = 0;
            juniorUsdcBuffer = 0;
        }

        uint256 cash = fees + firstLossUsdc;
        if (tok > 0)  teamToken.safeTransfer(team, tok);
        if (cash > 0) { _pullUSDC(cash); usdc.safeTransfer(team, cash); }

        emit JuniorRedeemed(team, tok, cash);
    }

    /// @dev The senior tranche no longer needs the junior first-loss capital as a backstop.
    /// @dev AUDIT R2-M4: releasing the junior first-loss (ETH stake + `juniorUsdcBuffer`) requires the
    ///      senior to no longer be LP-EXPOSED — the position fully UNWOUND (`deployedFromSenior == 0`) with
    ///      no JIT loan in flight — NOT merely `recoverableUSDC() >= deployedFromSenior` at this instant.
    ///      The old point-in-time cover let the team pull ALL first-loss while senior USDC was still in the
    ///      LP; a later team-token drop then impaired senior with ZERO backstop. Requiring the LP unwound
    ///      means there is nothing left for the junior to have to backstop. (The team recovers its capital
    ///      by first calling `recoverFromLP` to re-idle the deployed senior, exactly the intended flow.)
    function _seniorFullyCovered() internal view returns (bool) {
        if (jitBorrowed != 0) return false;
        return deployedFromSenior == 0;
    }

    // ── senior views / conversions (price-free) ───────────────────────────────────

    /// @dev USDC on hand that belongs to the SENIOR — the vault balance minus BOTH junior earmarks.
    function _freeSeniorBuffer() internal view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(this));
        uint256 reserved = reservedJuniorUSDC + juniorUsdcBuffer + reservedProtocolUSDC;
        return bal > reserved ? bal - reserved : 0;
    }

    /// @notice The senior claim in USDC — Aave idle + free senior buffer + deployed senior par + any USDC
    ///         currently out in a JIT position (par). NO price. This is the "claim value" used for deposits
    ///         and display; REDEMPTIONS price against the solvency-aware `_redeemNav()` below.
    function totalSeniorAssets() public view returns (uint256) {
        return adapter.totalAssets() + _freeSeniorBuffer() + deployedFromSenior + jitBorrowed;
    }

    /// @notice AUDIT H1 — solvency-aware senior NAV. Identical to `totalSeniorAssets()` whenever the senior
    ///         is fully covered, but values the deployed LP leg at its ACTUAL realizable USDC — the
    ///         conservative `min(spot,oracle)` MTM plus the junior USDC first-loss buffer that backstops it,
    ///         capped at par. It drops BELOW par only in the tail where the LP's recoverable value + junior
    ///         buffer no longer cover the deployed par (junior token wiped by IL). Redemptions price against
    ///         `min(par, realizable)` so any shortfall is shared PRO-RATA across all senior holders — closing
    ///         the first-redeemer run (early exits at par, late exits reverting).
    function seniorRealizableAssets() public view returns (uint256) {
        uint256 lpLeg = deployedFromSenior;
        if (lpLeg != 0) {
            uint256 backed = recoverableUSDC() + juniorUsdcBuffer; // junior first-loss backstops the LP leg
            if (backed < lpLeg) lpLeg = backed;                    // impaired: value at what's actually recoverable
        }
        return adapter.totalAssets() + _freeSeniorBuffer() + lpLeg + jitBorrowed;
    }

    /// @dev The NAV a redemption/settlement prices against: never above par, never above what is realizable.
    ///      In normal (covered) operation this equals par, so the senior redeems 1:1 as before.
    function _redeemNav() internal view returns (uint256) {
        uint256 par  = totalSeniorAssets();
        uint256 real = seniorRealizableAssets();
        return real < par ? real : par;
    }

    /// @dev AUDIT R2-H1: the NAV the MINT path prices against — par (`totalSeniorAssets()`), NEVER the
    ///      solvency-aware `min(spot,oracle)` `_redeemNav()`. Round-1 H1 reused the redeem NAV on mint
    ///      "for fairness", but that NAV is deflatable in-tx by pushing the vault's own pool spot DOWN
    ///      (`recoverableUSDC()` collapses → realizable < par → fewer assets per share → MORE shares
    ///      minted). A depositor could then swap spot back and redeem at restored par, extracting from
    ///      existing senior holders. Par is not downward-manipulable, so pricing mint at par closes it.
    ///      Trade-off (accepted): a depositor into a GENUINELY impaired pool pays par (subsidizes existing
    ///      holders) rather than being protected — the SAFE direction (loss to the new depositor, never to
    ///      the tranche). Redemptions keep `_redeemNav()` — protection from a HIGH spot is still correct.
    function _mintNav() internal view returns (uint256) {
        return totalSeniorAssets();
    }

    /// @dev AUDIT R2-H1: mint-side preview prices at par (non-downward-manipulable), not `_redeemNav()`.
    function previewDeposit(uint256 assets) public view returns (uint256) {
        return _toShares(assets, _mintNav(), Math.Rounding.Floor);
    }

    /// @inheritdoc IYieldVault
    /// @dev Rounds UP so a following `burnForPayment` of the returned shares redeems >= `assets`. Prices at
    ///      the solvency-aware NAV (AUDIT H1) so the Gateway's spend preview reflects the true redeemable.
    function previewWithdraw(uint256 assets) external view returns (uint256) {
        return _toShares(assets, _redeemNav(), Math.Rounding.Ceil);
    }

    /// @dev AUDIT R2-H1: mint-side conversion prices at par (non-downward-manipulable). This view is the
    ///      "shares → assets at deposit terms" quote; the true redeemable (solvency-aware) value is read
    ///      via `redeemSenior`/`previewWithdraw`/`burnForPayment`, which price against `_redeemNav()`.
    function convertToAssets(uint256 shares_) public view returns (uint256) {
        return _toAssets(shares_, _mintNav(), totalSeniorShares, Math.Rounding.Floor);
    }

    /// @inheritdoc IYieldVault
    /// @dev Conservative liquidity gate for the Gateway: USDC redeemable at par RIGHT NOW without
    ///      touching the LP — the free senior buffer plus what Aave can return this block.
    function idleBuffer() external view returns (uint256) {
        uint256 fromAave = Math.min(adapter.totalAssets(), adapter.maxWithdrawable());
        return _freeSeniorBuffer() + fromAave;
    }

    /// @notice The MTM value of the vault's LP position in USDC at `min(spot, oracle)` — the RHS of the
    ///         solvency invariant. The oracle tick is read DIRECTLY from the JIT hook here; the heavy V4
    ///         valuation math is delegatecalled into `MWTreasuryPositionLib` (EIP-170 relief). A flash
    ///         spot pump can NOT inflate it (the truncated oracle lags, `min` picks the lower value);
    ///         falls back to spot if the hook exposes no ready oracle.
    function recoverableUSDC() public view returns (uint256) {
        if (positionLiquidity == 0) return 0;
        (int24 oTick, bool oReady) = _oracleTick();
        return MWTreasuryPositionLib.recoverableUSDC(_posCtx(), oTick, oReady);
    }

    /// @notice Junior USDC first-loss buffer as bps of the deployed-at-risk senior. `>= 10_000` = fully
    ///         covered; `type(uint256).max` when nothing is deployed. Only the USDC buffer counts (the
    ///         volatile junior token is NOT valued here — conservative + non-manipulable). Pre-audit #7b.
    function coverageBps() public view returns (uint256) {
        return deployedFromSenior == 0 ? type(uint256).max : (juniorUsdcBuffer * BPS) / deployedFromSenior;
    }

    /// @dev True iff adding `addlDeploy` of at-risk senior keeps coverage at/above the floor. Division-free
    ///      (no div-by-zero even at zero deployed). Gate OFF (floor 0) ⇒ always true.
    function _coverageOkAfter(uint256 addlDeploy) internal view returns (bool) {
        if (minCoverageBps == 0) return true;
        return juniorUsdcBuffer * BPS >= minCoverageBps * (deployedFromSenior + addlDeploy);
    }

    function _toShares(uint256 assets, uint256 ta, Math.Rounding r) internal view returns (uint256) {
        return SeniorSharesMath.toShares(assets, totalSeniorShares, ta, VIRTUAL, r);
    }

    function _toAssets(uint256 shares_, uint256 ta, uint256 ts, Math.Rounding r) internal pure returns (uint256) {
        return SeniorSharesMath.toAssets(shares_, ta, ts, VIRTUAL, r);
    }

    // ── senior deposit ────────────────────────────────────────────────────────────

    /// @notice Deposit `assets` USDC, credit senior shares to `to`. USDC idles into Aave (idle-first);
    ///         a keeper/team later deploys the LP slice via `deployToLP`. Shares computed against
    ///         totalSeniorAssets measured BEFORE the inflow (no self-mint); mint rounds DOWN.
    function depositUSDC(uint256 assets, uint256 minShares, address to)
        external nonReentrant whenNotPaused returns (uint256 sharesMinted)
    {
        if (!activated) revert NotActivated();
        if (assets == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        uint256 navBefore = _mintNav(); // AUDIT R2-H1: par NAV (non-downward-manipulable), captured BEFORE the inflow (no self-mint)
        usdc.safeTransferFrom(msg.sender, address(this), assets);

        sharesMinted = _toShares(assets, navBefore, Math.Rounding.Floor);
        if (sharesMinted == 0) revert ZeroAmount();
        if (sharesMinted < minShares) revert InsufficientShares();

        // EFFECTS before the external adapter.deposit (CEI).
        seniorShares[to]  += sharesMinted;
        totalSeniorShares += sharesMinted;

        _supplyToAdapter(assets);

        emit SeniorDeposit(msg.sender, to, assets, sharesMinted);
    }

    /// @notice A depositor redeems their OWN senior shares for USDC (par + yield).
    function redeemSenior(uint256 sharesToBurn, uint256 minAssets)
        external nonReentrant whenNotPaused returns (uint256 assetsOut)
    {
        uint256 bal = seniorShares[msg.sender];
        if (sharesToBurn == 0) revert ZeroAmount();
        if (sharesToBurn > bal) revert InsufficientShares();

        // AUDIT H1: price against the solvency-aware NAV (min(par, realizable)) so a tail shortfall is
        // shared pro-rata, not paid at par to whoever redeems first. Equals par when fully covered.
        assetsOut = _toAssets(sharesToBurn, _redeemNav(), totalSeniorShares, Math.Rounding.Floor);
        if (assetsOut < minAssets) revert InsufficientIdleLiquidity();

        seniorShares[msg.sender] = bal - sharesToBurn;
        totalSeniorShares -= sharesToBurn;

        _pullUSDC(assetsOut);
        usdc.safeTransfer(msg.sender, assetsOut);

        emit SeniorRedeem(msg.sender, sharesToBurn, assetsOut);
    }

    // ── payment settlement (Gateway-only) ─────────────────────────────────────────

    /// @inheritdoc IYieldVault
    /// @dev onlyGateway (it verified the user's EIP-712 permit). NAV read on pre-burn totals (round
    ///      DOWN); CEI — burn effects before the external pull + transfer; `_pullUSDC` reverts rather
    ///      than underpay, so the senior is never settled below par.
    function burnForPayment(address user, uint256 sharesToBurn, address receiver)
        external onlyGateway nonReentrant whenNotPaused returns (uint256 assetsRedeemed)
    {
        if (receiver == address(0)) revert ZeroAddress();
        uint256 bal = seniorShares[user];
        if (sharesToBurn == 0) revert ZeroAmount();
        if (sharesToBurn > bal) revert InsufficientShares();

        // AUDIT H1: solvency-aware NAV (min(par, realizable)); equals par when fully covered.
        assetsRedeemed = _toAssets(sharesToBurn, _redeemNav(), totalSeniorShares, Math.Rounding.Floor);

        // AUDIT M1: bound the per-block burn rate so even a compromised Gateway can only drain the senior
        // slowly (guardian has time to pause). Defense in depth over the Gateway's own permit caps. 0 = off.
        if (maxBurnPerBlock != 0) {
            if (block.number != _burnBlock) { _burnBlock = block.number; _burnedThisBlock = 0; }
            _burnedThisBlock += assetsRedeemed;
            if (_burnedThisBlock > maxBurnPerBlock) revert BurnRateExceeded();
        }

        seniorShares[user] = bal - sharesToBurn;
        totalSeniorShares -= sharesToBurn;

        _pullUSDC(assetsRedeemed);
        usdc.safeTransfer(receiver, assetsRedeemed);

        emit PaymentBurn(user, receiver, sharesToBurn, assetsRedeemed);
    }

    // ── engine: LP deploy / recover / fees (self-held V4 position via delegatecall lib) ────────────

    /// @notice Deploy idle senior USDC (down to the idle-buffer target) plus junior token as two-sided
    ///         V4 liquidity. Owner/keeper-driven.
    function deployToLP(uint256 usdcAmount, uint256 maxTeamToken)
        external onlyOwner nonReentrant whenNotPaused
    {
        if (usdcAmount == 0) revert ZeroAmount();
        if (maxTeamToken > juniorTokens) revert ZeroAmount();

        // Enforce idle-first: keep >= target of the senior base in the Aave buffer after deploying.
        uint256 base = totalSeniorAssets();
        uint256 minIdle = base.mulDiv(idleBufferTargetBps, BPS, Math.Rounding.Ceil);
        if (deployedFromSenior + usdcAmount > base - minIdle) revert BadParam();

        // AUDIT #7b (coverage floor): never grow at-risk senior past what the junior USDC buffer covers.
        // `usdcAmount` bounds the actual `usdcUsed`, so gating on it is conservative.
        if (!_coverageOkAfter(usdcAmount)) revert CoverageTooLow();

        // Ensure the USDC is on hand from SENIOR sources only (free senior buffer + Aave). The team leg is
        // already held as the junior reserve; the V4 position is settled from the vault's own balance
        // inside the unlock. AUDIT (pre-audit review): a DEPLOY must NEVER draw the junior USDC buffer or
        // unwind the LP (the redemption `_pullUSDC` does both as last resorts) — else, under Aave
        // illiquidity, junior first-loss capital would be converted into senior-counted `deployedFromSenior`
        // with no loss event. `_pullSeniorForDeploy` reverts rather than spend junior capital.
        _pullSeniorForDeploy(usdcAmount);

        bytes memory out = poolManager.unlock(abi.encode(Op.DEPLOY, usdcAmount, maxTeamToken, int24(0), false));
        (uint256 usdcUsed, uint256 teamUsed, uint128 liqAdded) = abi.decode(out, (uint256, uint256, uint128));

        // EFFECTS: only the BALANCED senior USDC is now in the LP (junior-covered). Leftover USDC stays
        // as free senior buffer, so `deployedFromSenior` never exceeds what the junior backs.
        deployedFromSenior += usdcUsed;
        juniorTokens       -= teamUsed;
        positionLiquidity  += liqAdded;

        emit DeployedToLP(usdcUsed, teamUsed);
    }

    /// @notice Recover senior USDC from the LP back to Aave/buffer (owner-driven rebalance re-idles it).
    function recoverFromLP(uint256 usdcWanted) external onlyOwner nonReentrant whenNotPaused {
        uint256 got = _recoverFromLP(usdcWanted);
        _supplyToAdapter(got);
    }

    /// @notice Collect LP swap fees as USDC. During the lock, 100% credits the senior. Post-lock, split
    ///         60/30/10 — team's 30% is reserved to the junior, protocol's 10% is paid out; community's
    ///         60% stays senior.
    function accrueFees() external nonReentrant whenNotPaused returns (uint256 collected) {
        (int24 oTick, bool oReady) = _oracleTick();
        bytes memory out = poolManager.unlock(abi.encode(Op.COLLECT, uint256(0), uint256(0), oTick, oReady));
        collected = abi.decode(out, (uint256)); // USDC now on hand in this vault
        if (collected == 0) return 0;

        uint256 toJunior;
        uint256 toProtocol;
        if (!teamFeesRedirected) {
            toJunior   = collected.mulDiv(FEE_TEAM_BPS, BPS, Math.Rounding.Floor);
            toProtocol = collected.mulDiv(FEE_PROTOCOL_BPS, BPS, Math.Rounding.Floor);
            reservedJuniorUSDC += toJunior;                 // earmark team's cut out of the senior view
            if (toProtocol > 0 && protocolTreasury != address(0)) {
                usdc.safeTransfer(protocolTreasury, toProtocol);
            } else {
                toProtocol = 0; // no treasury set → leave it in the senior buffer rather than burn it
            }
        }
        // The remainder (100% during lock; 60% community after) stays as senior buffer → lifts NAV.
        // Supply only the FREE senior buffer to Aave — both junior earmarks stay physically on hand.
        uint256 toSenior = collected - toJunior - toProtocol;
        _flushProtocol(); // pay out any rent-earmarked protocol cut (fundRent accrues it off the hot path)
        _supplyToAdapter(_freeSeniorBuffer());

        emit FeesAccrued(collected, toSenior, toJunior, toProtocol);
    }

    /// @notice Pay out the protocol fee cut that `fundRent` earmarked off the swap hot path (Phase 3).
    ///         Permissionless + off-path, so a blacklisting/reverting `protocolTreasury` can never brick a
    ///         swap — it only ever fails this retryable call. Also folded into `accrueFees`.
    function flushProtocol() external nonReentrant returns (uint256 paid) {
        return _flushProtocol();
    }

    function _flushProtocol() internal returns (uint256 paid) {
        paid = reservedProtocolUSDC;
        if (paid == 0 || protocolTreasury == address(0)) return 0;
        reservedProtocolUSDC = 0;
        usdc.safeTransfer(protocolTreasury, paid);
        emit ProtocolFlushed(paid);
    }

    /// @notice `IAmAmmRentSink`: receive am-AMM auction rent (USDC) and route it EXACTLY like `accrueFees`
    ///         — 100% senior while the junior lock is active, else 60/30/10 senior/junior/protocol. On an
    ///         enrolled pool the auction manager skims the swap fee, so rent IS the vault's yield and gets
    ///         identical tranche treatment; the senior claim stays PRICE-FREE (rent lands as par USDC).
    /// @dev    Runs on the SWAP HOT PATH (the auction pushes rent inside `beforeSwap → poke`), so it is kept
    ///         revert-minimal: an inbound USDC pull + pure split accounting, with NO Aave supply and NO
    ///         pause gate — a revert here would brick the enrolled pool. The free senior buffer this adds is
    ///         swept to Aave on the next `accrueFees`/`depositUSDC`/`recoverFromLP`. USDC-only by
    ///         construction: the pool's am-AMM `bidToken` MUST be USDC, so rent can credit the senior at par
    ///         (a volatile team-token rent would have to land on the junior side — rejected here instead).
    function fundRent(address token, uint256 amount) external nonReentrant {
        if (msg.sender != rentFunder) revert OnlyRentFunder();
        if (token != address(usdc)) revert RentTokenMismatch();
        if (amount == 0) return;

        uint256 balBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - balBefore; // balance-diff (defensive)
        if (received == 0) return;

        uint256 toJunior;
        uint256 toProtocol;
        if (!teamFeesRedirected) {
            toJunior   = received.mulDiv(FEE_TEAM_BPS, BPS, Math.Rounding.Floor);
            toProtocol = received.mulDiv(FEE_PROTOCOL_BPS, BPS, Math.Rounding.Floor);
            reservedJuniorUSDC += toJunior;                 // earmark team's cut out of the senior view
            if (toProtocol > 0 && protocolTreasury != address(0)) {
                // AUDIT (P3 review, MED): EARMARK the protocol cut — do NOT transfer on the swap hot path.
                // A USDC-blacklisted/reverting `protocolTreasury` would otherwise brick every swap on the
                // pool. Paid out off-path via `flushProtocol` / `accrueFees`.
                reservedProtocolUSDC += toProtocol;
            } else {
                toProtocol = 0; // no treasury → leave it in the senior buffer
            }
        }
        // Remainder (100% during lock; 60% community after) stays as senior buffer → lifts par NAV. No Aave
        // supply here (hot-path safety) — swept on the next accrueFees/deposit/recover.
        uint256 toSenior = received - toJunior - toProtocol;
        emit RentFunded(received, toSenior, toJunior, toProtocol);
    }

    // ── engine: JIT borrow-seam (hook-only, atomic within one swap) ─────────────────

    /// @notice Lend the JIT hook a BOUNDED slice of senior idle USDC for ONE swap. `jitBorrowed` counts
    ///         the lent USDC at PAR, so `totalSeniorAssets` is unchanged by the loan.
    function borrowIdleForJit(uint256 want)
        external onlyJitHook nonReentrant returns (uint256 lent)
    {
        // AUDIT M6: return 0 (JIT no-ops) rather than revert when paused — this runs inside beforeSwap.
        if (paused()) return 0;
        if (jitAutoDisabled) return 0;              // AUDIT H4: breaker tripped
        if (jitBorrowed != 0) return 0;             // AUDIT H2: one JIT slice outstanding at a time
        if (block.number != jitBlock) { jitBlock = block.number; jitBorrowedThisBlock = 0; }

        uint256 perBlockCap = totalSeniorAssets().mulDiv(jitMaxPerBlockBps, BPS, Math.Rounding.Floor);
        uint256 remaining = perBlockCap > jitBorrowedThisBlock ? perBlockCap - jitBorrowedThisBlock : 0;
        uint256 cap = want < remaining ? want : remaining;
        uint256 headroom = Math.min(adapter.totalAssets(), adapter.maxWithdrawable());
        if (headroom < cap) cap = headroom;
        if (cap == 0) return 0;
        if (!_coverageOkAfter(cap)) return 0; // AUDIT #7b: skip JIT when the junior cushion is thin (best-effort)

        lent = adapter.withdraw(cap); // best-effort; from senior Aave idle, never a junior earmark
        if (lent == 0) return 0;
        jitBorrowed += lent;
        jitBorrowedThisBlock += lent;
        usdc.safeTransfer(jitHook, lent);
        _jitUsdcBaseline = usdc.balanceOf(address(this)); // AUDIT M3: baseline for balance-verified return
        emit JitBorrowed(lent);
    }

    /// @notice The hook returns the borrowed senior USDC (+ any captured fee, net of its close cost) after
    ///         closing its JIT position in the SAME swap. Profit lifts the senior; a shortfall is absorbed
    ///         by the junior USDC buffer so the senior stays whole at par. NEVER reverts.
    function settleJitReturn(uint256 /* usdcReturnedClaimed */) external onlyJitHook nonReentrant {
        uint256 outstanding = jitBorrowed;
        jitBorrowed = 0;

        // AUDIT M3: do NOT trust the hook's self-reported figure — measure what actually arrived. The whole
        // borrow→settle round is atomic within ONE swap (nonReentrant redemptions cannot interleave), so the
        // vault's USDC balance moved only by the hook's return transfer since `_jitUsdcBaseline` was set. A
        // hook that under-returns (or returns nothing) is thus correctly treated as a JIT loss the junior
        // absorbs, rather than a lie that corrupts `jitNetPnl`/`juniorUsdcBuffer`.
        uint256 nowBal   = usdc.balanceOf(address(this));
        uint256 usdcReturned = nowBal > _jitUsdcBaseline ? nowBal - _jitUsdcBaseline : 0;
        _jitUsdcBaseline = 0;

        uint256 shortfall = usdcReturned < outstanding ? outstanding - usdcReturned : 0;
        uint256 draw;
        if (shortfall > 0) {
            draw = shortfall < juniorUsdcBuffer ? shortfall : juniorUsdcBuffer;
            if (draw > 0) { juniorUsdcBuffer -= draw; emit JuniorUsdcAbsorbed(draw); }
        }
        // Re-idle the returned USDC plus any freed junior buffer (both are now free senior USDC on hand).
        _supplyToAdapter(usdcReturned + draw);

        // AUDIT H4: fold the realized PnL of this JIT round into the running total; trip the breaker if
        // cumulative net loss breaches the owner threshold.
        jitNetPnl += int256(usdcReturned) - int256(outstanding);
        if (jitMaxCumulativeLoss != 0 && !jitAutoDisabled && jitNetPnl < -int256(jitMaxCumulativeLoss)) {
            jitAutoDisabled = true;
            emit JitBreakerTripped(jitNetPnl);
        }
        emit JitSettled(outstanding, usdcReturned, shortfall);
    }

    /// @notice AUDIT R2-H2: owner escape hatch for a STUCK `jitBorrowed` the keeper sweep cannot clear
    ///         (e.g. the team leg stays unconvertible within the oracle band across blocks, so the hook's
    ///         `sweepJit` never returns USDC and `settleJitReturn` never runs). Left outstanding, the
    ///         phantom slice disables ALL future JIT (`borrowIdleForJit` no-ops on `jitBorrowed != 0`),
    ///         blocks `redeemJunior` (`_seniorFullyCovered` stays false), and counts at par in the senior
    ///         NAV on non-existent backing. This reconciles it the SAME way `settleJitReturn(0)` would:
    ///         the outstanding slice is booked as a JIT loss the junior USDC buffer absorbs first, so the
    ///         senior stays whole to the extent the buffer covers it. CONSERVATIVE + last-resort: if the
    ///         hook later recovers and returns USDC, `settleJitReturn` books it as senior profit — i.e.
    ///         the error direction is always toward OVER-covering the senior (junior over-pays), never an
    ///         exfil. onlyOwner + one-way (can only decrease the senior claim / draw junior first-loss).
    function forceSettleJit() external onlyOwner nonReentrant {
        uint256 outstanding = jitBorrowed;
        if (outstanding == 0) return;
        jitBorrowed = 0;

        uint256 draw = outstanding < juniorUsdcBuffer ? outstanding : juniorUsdcBuffer;
        if (draw > 0) { juniorUsdcBuffer -= draw; emit JuniorUsdcAbsorbed(draw); }
        _supplyToAdapter(draw); // freed junior USDC becomes senior-side idle → keeps senior whole to `draw`
        _jitUsdcBaseline = 0;

        jitNetPnl -= int256(outstanding);
        if (jitMaxCumulativeLoss != 0 && !jitAutoDisabled && jitNetPnl < -int256(jitMaxCumulativeLoss)) {
            jitAutoDisabled = true;
            emit JitBreakerTripped(jitNetPnl);
        }
        emit JitSettled(outstanding, 0, outstanding);
    }

    // ── IUnlockCallback ─────────────────────────────────────────────────────────────

    /// @dev PoolManager-only dispatch. Guarded by `_onlyPoolManager()` ONLY — MUST NOT be `nonReentrant`:
    ///      it legitimately re-enters mid-`nonReentrant` redemption (redeemSenior → _pullUSDC →
    ///      _recoverFromLP → poolManager.unlock → HERE). Delegatecalls only the stateless library.
    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        _onlyPoolManager();
        (Op op, uint256 a, uint256 b, int24 oTick, bool oReady) =
            abi.decode(raw, (Op, uint256, uint256, int24, bool));
        if (op == Op.DEPLOY)  return MWTreasuryPositionLib.deploy(_posCtx(), a, b);
        if (op == Op.RECOVER) return MWTreasuryPositionLib.recover(_posCtx(), a, oTick, oReady);
        return MWTreasuryPositionLib.collect(_posCtx(), oTick, oReady);
    }

    function _posCtx() internal view returns (MWTreasuryPositionLib.Ctx memory) {
        return MWTreasuryPositionLib.Ctx({
            pm:                poolManager,
            key:               poolKey,
            usdc:              usdc,
            teamToken:         teamToken,
            usdcIsCurrency0:   usdcIsCurrency0,
            tickLower:         tickLower,
            tickUpper:         tickUpper,
            positionLiquidity: positionLiquidity
        });
    }

    /// @dev Read the JIT hook's truncated-oracle tick; not-ready (→ spot fallback) if unset or a
    ///      non-oracle hook. try/catch so a plain/mock hook never bricks valuation.
    function _oracleTick() internal view returns (int24 tick, bool ready) {
        address h = jitHook;
        if (h == address(0)) return (0, false);
        try IJitOracle(h).oracleTick() returns (int24 t, bool r) {
            return (t, r);
        } catch {
            return (0, false);
        }
    }

    // ── internals ─────────────────────────────────────────────────────────────────

    function _recoverFromLP(uint256 usdcWanted) internal returns (uint256 usdcReturned) {
        if (usdcWanted == 0) revert ZeroAmount();
        if (positionLiquidity == 0) return 0;

        (int24 oTick, bool oReady) = _oracleTick();
        bytes memory out = poolManager.unlock(abi.encode(Op.RECOVER, usdcWanted, uint256(0), oTick, oReady));
        (uint256 ret, uint256 teamBack, uint128 liqRemoved) = abi.decode(out, (uint256, uint256, uint128));
        usdcReturned = ret;
        juniorTokens += teamBack;
        positionLiquidity -= liqRemoved;

        // AUDIT M4: charge the seniority-swap slippage to the JUNIOR, not senior NAV. Drop
        // `deployedFromSenior` by the USDC ACTUALLY recovered (not the requested par); the LP's MTM
        // cushion over par absorbs the (par − usdcReturned) gap. Only when the LP alone no longer covers
        // the deployed par (`recoverable < deployed`) do we write down more — down to the LP's live value.
        // Measure the floor against `recoverableUSDC()` ALONE (not the junior USDC buffer) because
        // `_pullUSDC` consumes that buffer immediately after this call.
        uint256 recoverable = recoverableUSDC();
        uint256 minDec = deployedFromSenior > recoverable ? deployedFromSenior - recoverable : 0;
        uint256 dec = usdcReturned > minDec ? usdcReturned : minDec;
        if (dec > deployedFromSenior) dec = deployedFromSenior; // clamp (never underflow)
        deployedFromSenior -= dec;

        // NOTE: recovered USDC is left ON HAND — the payment waterfall (`_pullUSDC`) needs it there; the
        // owner rebalance (`recoverFromLP`) re-idles it into Aave.
        emit RecoveredFromLP(usdcWanted, usdcReturned, teamBack);
    }

    /// @dev Push idle USDC into Aave, best-effort (never reverts the caller). Mirrors v1.
    function _supplyToAdapter(uint256 amount) internal {
        if (amount == 0) return;
        uint256 suppliable = adapter.maxSuppliable();
        uint256 toSupply   = amount < suppliable ? amount : suppliable;
        if (toSupply == 0) return;
        usdc.forceApprove(address(adapter), toSupply);
        try adapter.deposit(toSupply) {}
        catch { usdc.forceApprove(address(adapter), 0); }
    }

    /// @dev Ensure the vault holds >= `need` USDC on hand to pay the senior. Waterfall: free senior
    ///      buffer → Aave → LP (junior team leg) → junior USDC buffer (first-loss). Reverts
    ///      `InsufficientIdleLiquidity` rather than underpay — the senior is never settled below par.
    function _pullUSDC(uint256 need) internal {
        uint256 freeOnHand = _freeSeniorBuffer();
        if (freeOnHand >= need) return;

        uint256 short = need - freeOnHand;
        uint256 got = adapter.withdraw(short);               // best-effort
        if (got < short && positionLiquidity != 0) {
            _recoverFromLP(short - got);                      // deeper fallback: unwind LP (junior team leg)
        }

        freeOnHand = _freeSeniorBuffer();
        if (freeOnHand < need && juniorUsdcBuffer > 0) {
            // LAST RESORT: the junior USDC buffer absorbs the residual senior shortfall (first-loss).
            uint256 stillShort = need - freeOnHand;
            uint256 draw = stillShort < juniorUsdcBuffer ? stillShort : juniorUsdcBuffer;
            juniorUsdcBuffer -= draw;
            emit JuniorUsdcAbsorbed(draw);
            freeOnHand = _freeSeniorBuffer();
        }

        if (freeOnHand < need) revert InsufficientIdleLiquidity();
    }

    /// @dev Fund a DEPLOY from SENIOR sources ONLY — free senior buffer + Aave withdrawable. Unlike the
    ///      redemption `_pullUSDC`, this NEVER draws the junior USDC buffer and NEVER unwinds the LP: a
    ///      deploy only moves senior idle into the position. If senior idle can't cover `need` (e.g. Aave
    ///      illiquid), it REVERTS `InsufficientIdleLiquidity` rather than spend junior first-loss capital.
    function _pullSeniorForDeploy(uint256 need) internal {
        uint256 freeOnHand = _freeSeniorBuffer();
        if (freeOnHand >= need) return;
        adapter.withdraw(need - freeOnHand); // best-effort; senior Aave idle only, never a junior earmark
        if (_freeSeniorBuffer() < need) revert InsufficientIdleLiquidity();
    }
}
