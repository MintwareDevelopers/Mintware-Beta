// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable}        from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math}            from "@openzeppelin/contracts/utils/math/Math.sol";

import {IYieldVault}      from "./IYieldVault.sol";
import {ILiquidityModule} from "./ILiquidityModule.sol";
import {IYieldAdapter}    from "../vaults/IYieldAdapter.sol";

/// @title  MintwareTreasuryVault
/// @notice YPN v2 — the treasury-anchored ULV behind `IYieldVault`. A STRUCTURED TRANCHE vault:
///
///           • SENIOR  = community USDC.  A par + yield, PRICE-FREE, card-spendable claim.
///           • JUNIOR  = the team/treasury's locked native reserve.  First-loss; absorbs price + IL.
///
///         Community USDC idles in Aave (via an `IYieldAdapter`) and — up to a governable fraction —
///         is deployed as two-sided liquidity with the team token through an `ILiquidityModule`. The
///         Gateway settles card charges against the senior side through the *same* `IYieldVault` seam
///         as v1 (`MintwareYieldVault`), so the payment stack is unchanged.
///
/// @dev    THE CRUX — the senior claim counts its deployed USDC at PAR, never mark-to-market:
///
///           seniorAssets = adapter.totalAssets()          // idle in Aave (principal + interest)
///                        + (usdcBalance - reservedJuniorUSDC) // free senior buffer
///                        + deployedFromSenior              // senior USDC out in the LP, at PAR
///
///         No pool price appears anywhere in the senior NAV. The LP's IL/MTM lands entirely on the
///         junior. Senior share math is lifted verbatim from `MintwareYieldVault` — symmetric virtual
///         offset (`VIRTUAL = 1e3`) inflation defense; mint rounds DOWN, `previewWithdraw` rounds UP,
///         redeem asset-math rounds DOWN — every division toward the vault.
///
/// @dev    THE SOLVENCY INVARIANT (fuzzed 256×128k):
///           deployedFromSenior <= liquidityModule.recoverableUSDC()
///         The `ILiquidityModule` values its position by spending the junior token to make senior USDC
///         whole FIRST (seniority is enforced at the seam). So the RHS is the USDC actually behind the
///         deployed senior par; the inequality is exactly "the junior buffer still covers the senior."
///         Redemptions NEVER underpay the senior: `_pullUSDC` reverts rather than pay < par, trading
///         liveness (not principal) in the tail where the junior is fully wiped.
///
/// @dev    Idle-first (idleBufferTargetBps, default 8000 = 80%): the LP slice is small, so the Aave
///         buffer serves ~all card spends instantly and the exposed (IL-bearing) fraction stays inside
///         the junior's coverage. The real Uniswap-V4 JIT/surge module composes behind
///         `_deployToLP`/`_recoverFromLP` in a follow-up — this contract proves the tranche accounting.
contract MintwareTreasuryVault is IYieldVault, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    /// @notice Symmetric virtual offset (virtual shares == virtual assets). Inflation defense — see
    ///         `MintwareYieldVault` NatSpec for the full argument; the algebra is identical here.
    uint256 public constant VIRTUAL = 1e3;

    uint16 public constant BPS = 10_000;
    uint16 public constant MIN_IDLE_TARGET_BPS = 5_000;  // >=50% par-safe in Aave, else senior can't be served
    uint16 public constant MAX_IDLE_TARGET_BPS = 9_500;  // <=95%, else no LP depth
    uint256 public constant MIN_LOCK_DURATION  = 90 days; // hard junior cliff
    uint256 public constant MAX_LOCK_DURATION  = 1460 days;

    // fee split post-lock (community / team / protocol) in bps — 60/30/10
    uint16 public constant FEE_COMMUNITY_BPS = 6_000;
    uint16 public constant FEE_TEAM_BPS      = 3_000;
    uint16 public constant FEE_PROTOCOL_BPS  = 1_000;

    IERC20        public immutable usdc;      // 6dp senior settlement asset
    IERC20        public immutable teamToken; // junior reserve asset
    IYieldAdapter public immutable adapter;   // USDC idle sink (Aave)

    ILiquidityModule public liquidityModule;  // LP seam (set once, at wiring)
    address public gateway;                    // sole burnForPayment caller (set once)
    address public protocolTreasury;           // receives the 10% protocol fee cut post-lock

    // ── senior (community) ────────────────────────────────────────────────────────
    mapping(address => uint256) public seniorShares;
    uint256 public totalSeniorShares;
    /// @notice Senior USDC currently out in the LP, valued at PAR (never MTM). Keeps senior NAV whole
    ///         while capital is deployed; the invariant bounds it by the LP's recoverable USDC.
    uint256 public deployedFromSenior;
    /// @notice USDC held by the vault that belongs to the JUNIOR (post-lock team fee cuts), excluded
    ///         from every senior-side view so it can never be redeemed by the senior.
    uint256 public reservedJuniorUSDC;

    // ── junior (team) ─────────────────────────────────────────────────────────────
    address public team;
    uint256 public juniorTokens;       // team token in the reserve (locked)
    uint256 public lockExpiry;         // junior hard cliff
    uint256 public idleBufferTargetBps = 8_000; // governable per-vault, [MIN,MAX]
    bool    public activated;
    /// @notice True while the junior is locked: 100% of collected LP fees credit the senior
    ///         (supercharged launch yield). Flips false once the cliff passes.
    bool    public teamFeesRedirected;

    event GatewaySet(address indexed gateway);
    event LiquidityModuleSet(address indexed module);
    event TeamCommitted(address indexed team, uint256 teamTokens, uint256 lockExpiry);
    event SeniorDeposit(address indexed caller, address indexed to, uint256 assets, uint256 shares);
    event SeniorRedeem(address indexed owner, uint256 shares, uint256 assets);
    event PaymentBurn(address indexed user, address indexed receiver, uint256 shares, uint256 assets);
    event DeployedToLP(uint256 usdc, uint256 teamTokenUsed);
    event RecoveredFromLP(uint256 usdcWanted, uint256 usdcReturned, uint256 teamTokenReturned);
    event FeesAccrued(uint256 total, uint256 toSenior, uint256 toJunior, uint256 toProtocol);
    event JuniorRedeemed(address indexed team, uint256 teamTokens, uint256 usdc);
    event IdleTargetSet(uint16 bps);

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
    error BadParam();
    error NoModule();

    modifier onlyGateway() { if (msg.sender != gateway) revert OnlyGateway(); _; }

    /// @param usdc_      senior settlement asset (USDC).
    /// @param teamToken_ junior reserve asset (the team/treasury native token).
    /// @param adapter_   Aave idle adapter whose underlying is `usdc_`.
    /// @param owner_     vault owner (wiring, governance, pause).
    constructor(address usdc_, address teamToken_, address adapter_, address owner_) Ownable(owner_) {
        if (usdc_ == address(0) || teamToken_ == address(0) || adapter_ == address(0)) revert ZeroAddress();
        usdc      = IERC20(usdc_);
        teamToken = IERC20(teamToken_);
        adapter   = IYieldAdapter(adapter_);
    }

    // ── admin / wiring (set-once) ─────────────────────────────────────────────────

    function setGateway(address gateway_) external onlyOwner {
        if (gateway != address(0)) revert AlreadySet();
        if (gateway_ == address(0)) revert ZeroAddress();
        gateway = gateway_;
        emit GatewaySet(gateway_);
    }

    function setLiquidityModule(address module_) external onlyOwner {
        if (address(liquidityModule) != address(0)) revert AlreadySet();
        if (module_ == address(0)) revert ZeroAddress();
        liquidityModule = ILiquidityModule(module_);
        emit LiquidityModuleSet(module_);
    }

    function setProtocolTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        protocolTreasury = t;
    }

    function setIdleBufferTarget(uint16 bps) external onlyOwner {
        if (bps < MIN_IDLE_TARGET_BPS || bps > MAX_IDLE_TARGET_BPS) revert BadParam();
        idleBufferTargetBps = bps;
        emit IdleTargetSet(bps);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── junior (team) lifecycle ───────────────────────────────────────────────────

    /// @notice The team/treasury commits its native token as the junior first-loss reserve and locks
    ///         it for `lockDur` (hard cliff, >= 90 days). Opens the vault for community deposits.
    function commitTeam(uint256 teamTokens, uint256 lockDur) external nonReentrant whenNotPaused {
        if (activated) revert AlreadyActivated();
        if (teamTokens == 0) revert ZeroAmount();
        if (lockDur < MIN_LOCK_DURATION || lockDur > MAX_LOCK_DURATION) revert BadParam();

        team               = msg.sender;
        lockExpiry         = block.timestamp + lockDur;
        teamFeesRedirected = true;
        activated          = true;

        teamToken.safeTransferFrom(msg.sender, address(this), teamTokens);
        juniorTokens += teamTokens;

        emit TeamCommitted(msg.sender, teamTokens, lockExpiry);
    }

    /// @notice Post-cliff, the team redeems the junior: its remaining token reserve plus any junior
    ///         USDC (accumulated team fee cuts). This is the residual equity — whatever the first-loss
    ///         tranche has left after covering the senior.
    function redeemJunior() external nonReentrant {
        if (msg.sender != team) revert OnlyTeam();
        if (block.timestamp < lockExpiry) revert StillLocked();

        teamFeesRedirected = false;

        uint256 tok = juniorTokens;
        uint256 cash = reservedJuniorUSDC;
        juniorTokens = 0;
        reservedJuniorUSDC = 0;

        if (tok > 0)  teamToken.safeTransfer(team, tok);
        if (cash > 0) { _pullUSDC(cash); usdc.safeTransfer(team, cash); }

        emit JuniorRedeemed(team, tok, cash);
    }

    // ── senior views / conversions (price-free) ───────────────────────────────────

    /// @notice The senior claim in USDC — Aave idle + free senior buffer + deployed senior par. NO price.
    function totalSeniorAssets() public view returns (uint256) {
        uint256 buffer = usdc.balanceOf(address(this));
        // free senior buffer excludes junior-reserved cash; guard against transient underflow.
        uint256 freeBuffer = buffer > reservedJuniorUSDC ? buffer - reservedJuniorUSDC : 0;
        return adapter.totalAssets() + freeBuffer + deployedFromSenior;
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return _toShares(assets, totalSeniorAssets(), Math.Rounding.Floor);
    }

    /// @inheritdoc IYieldVault
    /// @dev Rounds UP so a following `burnForPayment` of the returned shares redeems >= `assets`.
    function previewWithdraw(uint256 assets) external view returns (uint256) {
        return _toShares(assets, totalSeniorAssets(), Math.Rounding.Ceil);
    }

    function convertToAssets(uint256 shares_) public view returns (uint256) {
        return _toAssets(shares_, totalSeniorAssets(), totalSeniorShares, Math.Rounding.Floor);
    }

    /// @inheritdoc IYieldVault
    /// @dev Conservative liquidity gate for the Gateway: USDC redeemable at par RIGHT NOW without
    ///      touching the LP — the free senior buffer plus what Aave can return this block. Under-
    ///      reporting only makes a settlement safely reject; it never risks funds. (The LP is a
    ///      deeper, slower fallback used inside `_pullUSDC`, not advertised here.)
    function idleBuffer() external view returns (uint256) {
        uint256 buffer = usdc.balanceOf(address(this));
        uint256 freeBuffer = buffer > reservedJuniorUSDC ? buffer - reservedJuniorUSDC : 0;
        uint256 fromAave = Math.min(adapter.totalAssets(), adapter.maxWithdrawable());
        return freeBuffer + fromAave;
    }

    function _toShares(uint256 assets, uint256 ta, Math.Rounding r) internal view returns (uint256) {
        return assets.mulDiv(totalSeniorShares + VIRTUAL, ta + VIRTUAL, r);
    }

    function _toAssets(uint256 shares_, uint256 ta, uint256 ts, Math.Rounding r) internal pure returns (uint256) {
        return shares_.mulDiv(ta + VIRTUAL, ts + VIRTUAL, r);
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

        uint256 taBefore = totalSeniorAssets();
        usdc.safeTransferFrom(msg.sender, address(this), assets);

        sharesMinted = _toShares(assets, taBefore, Math.Rounding.Floor);
        if (sharesMinted == 0) revert ZeroAmount();
        if (sharesMinted < minShares) revert InsufficientShares();

        // EFFECTS before the external adapter.deposit (CEI).
        seniorShares[to]  += sharesMinted;
        totalSeniorShares += sharesMinted;

        _supplyToAdapter(assets);

        emit SeniorDeposit(msg.sender, to, assets, sharesMinted);
    }

    /// @notice A depositor redeems their OWN senior shares for USDC (par + yield). Same NAV + waterfall
    ///         as the payment path. Keeps community deposits honestly liquid outside the card rail.
    function redeemSenior(uint256 sharesToBurn, uint256 minAssets)
        external nonReentrant whenNotPaused returns (uint256 assetsOut)
    {
        uint256 bal = seniorShares[msg.sender];
        if (sharesToBurn == 0) revert ZeroAmount();
        if (sharesToBurn > bal) revert InsufficientShares();

        assetsOut = convertToAssets(sharesToBurn);
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

        assetsRedeemed = convertToAssets(sharesToBurn);

        seniorShares[user] = bal - sharesToBurn;
        totalSeniorShares -= sharesToBurn;

        _pullUSDC(assetsRedeemed);
        usdc.safeTransfer(receiver, assetsRedeemed);

        emit PaymentBurn(user, receiver, sharesToBurn, assetsRedeemed);
    }

    // ── engine: LP deploy / recover / fees ────────────────────────────────────────

    /// @notice Deploy idle senior USDC (down to the idle-buffer target) plus junior token as two-sided
    ///         liquidity. Owner/keeper-driven here; the JIT hook drives it per-swap in the follow-up.
    /// @param  usdcAmount  senior USDC to deploy; the post-deploy Aave idle must stay >= target.
    /// @param  maxTeamToken junior token the module may consume.
    function deployToLP(uint256 usdcAmount, uint256 maxTeamToken)
        external onlyOwner nonReentrant whenNotPaused
    {
        if (address(liquidityModule) == address(0)) revert NoModule();
        if (usdcAmount == 0) revert ZeroAmount();
        if (maxTeamToken > juniorTokens) revert ZeroAmount();

        // Enforce idle-first: keep >= target of the senior base in the Aave buffer after deploying.
        uint256 base = totalSeniorAssets();
        uint256 minIdle = base.mulDiv(idleBufferTargetBps, BPS, Math.Rounding.Ceil);
        if (deployedFromSenior + usdcAmount > base - minIdle) revert BadParam();

        // Pull the USDC on-hand (from buffer, topping up from Aave) and hand both legs to the module.
        _pullUSDC(usdcAmount);
        usdc.forceApprove(address(liquidityModule), usdcAmount);
        if (maxTeamToken > 0) teamToken.forceApprove(address(liquidityModule), maxTeamToken);

        (uint256 usdcUsed, uint256 teamUsed) = liquidityModule.deploy(usdcAmount, maxTeamToken);

        usdc.forceApprove(address(liquidityModule), 0);
        if (maxTeamToken > 0) teamToken.forceApprove(address(liquidityModule), 0);

        // EFFECTS: only the BALANCED senior USDC is now in the LP (junior-covered). The module leaves
        // any USDC it couldn't pair with the vault as free senior buffer, so `deployedFromSenior` never
        // exceeds what the junior backs. Junior token consumed from the reserve.
        deployedFromSenior += usdcUsed;
        juniorTokens -= teamUsed;

        emit DeployedToLP(usdcUsed, teamUsed);
    }

    /// @notice Recover senior USDC from the LP back to Aave/buffer (e.g. to rebuild the idle target).
    ///         Junior absorbs any IL: `deployedFromSenior` drops by the PAR withdrawn, senior NAV is
    ///         unchanged; returned junior token flows back to the reserve. Owner-driven rebalance re-
    ///         idles the recovered USDC into Aave.
    function recoverFromLP(uint256 usdcWanted) external onlyOwner nonReentrant whenNotPaused {
        uint256 got = _recoverFromLP(usdcWanted);
        _supplyToAdapter(got);
    }

    /// @notice Collect LP swap fees as USDC. During the lock, 100% credits the senior (it lands in the
    ///         free buffer / Aave and lifts senior NAV). Post-lock, split 60/30/10 — team's 30% is
    ///         reserved to the junior, protocol's 10% is paid out; the community's 60% stays senior.
    function accrueFees() external nonReentrant whenNotPaused returns (uint256 collected) {
        if (address(liquidityModule) == address(0)) revert NoModule();
        collected = liquidityModule.collectFees(); // USDC lands in this vault
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
        uint256 toSenior = collected - toJunior - toProtocol;
        _supplyToAdapter(usdc.balanceOf(address(this)) > reservedJuniorUSDC
            ? usdc.balanceOf(address(this)) - reservedJuniorUSDC : 0);

        emit FeesAccrued(collected, toSenior, toJunior, toProtocol);
    }

    // ── internals ─────────────────────────────────────────────────────────────────

    function _recoverFromLP(uint256 usdcWanted) internal returns (uint256 usdcReturned) {
        if (address(liquidityModule) == address(0)) revert NoModule();
        if (usdcWanted == 0) revert ZeroAmount();
        uint256 par = usdcWanted > deployedFromSenior ? deployedFromSenior : usdcWanted;

        uint256 teamBack;
        (usdcReturned, teamBack) = liquidityModule.recover(usdcWanted);

        // Senior par leaves the LP at PAR (junior eats the MTM gap); returned junior token re-reserves.
        deployedFromSenior -= par;
        juniorTokens += teamBack;

        // NOTE: recovered USDC is left ON HAND. Callers on the payment waterfall (`_pullUSDC`) need it
        // there to serve the senior; the owner rebalance (`recoverFromLP`) re-idles it into Aave.
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

    /// @dev Ensure the vault holds >= `need` USDC on hand to pay the senior. Waterfall: free buffer →
    ///      Aave → LP (junior-backed). Reverts `InsufficientIdleLiquidity` rather than underpay — the
    ///      senior is never settled below par (liveness, not principal, is sacrificed in the tail).
    function _pullUSDC(uint256 need) internal {
        // "on hand for the senior" excludes junior-reserved cash.
        uint256 bal = usdc.balanceOf(address(this));
        uint256 freeOnHand = bal > reservedJuniorUSDC ? bal - reservedJuniorUSDC : 0;
        if (freeOnHand >= need) return;

        uint256 short = need - freeOnHand;
        uint256 got = adapter.withdraw(short);               // best-effort
        if (got < short && address(liquidityModule) != address(0)) {
            _recoverFromLP(short - got);                      // deeper fallback: unwind LP (junior-backed)
        }

        bal = usdc.balanceOf(address(this));
        freeOnHand = bal > reservedJuniorUSDC ? bal - reservedJuniorUSDC : 0;
        if (freeOnHand < need) revert InsufficientIdleLiquidity();
    }
}
