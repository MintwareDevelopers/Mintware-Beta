// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IYieldAdapter} from "./IYieldAdapter.sol";

/// @title  MintwareMultiVenueYieldAdapter
/// @notice A curator-managed `IYieldAdapter` that fans idle capital across MANY child adapters by weight —
///         the "become a curator, not just an Aave depositor" baseline-yield lever. The vault treats this as
///         a single adapter; underneath, the owner (curator) allocates across e.g. `AaveV3YieldAdapter` +
///         `MintwareERC4626YieldAdapter` wrapping a Morpho MetaMorpho / Euler v2 vault. Same architecture,
///         a new allocation. No new custody category — every child is an already-audited-adjacent adapter.
///
/// @dev    Composition: `setVault(realVault)` here, and EACH CHILD's `setVault(address(this))` — so the vault
///         funds this router, this router funds the children, and withdrawals flow child → router → vault.
///         Children MUST share this router's `asset` (the interface has no `asset()` to verify, so it is a
///         deploy-wiring invariant — document + check off-chain).
///
///         Discipline inherited from the child adapters:
///           • **withdraw is BEST-EFFORT and never reverts** — it is on the vault's swap/settlement hot path.
///             Each child pull is try/caught; a stalled venue contributes 0 and the router serves the rest
///             from the other venues + its own idle balance. A partial return is normal; the vault falls back
///             to its reserves.
///           • **deposit is try/caught per venue** — a full/paused source can't brick the allocation; its
///             share simply stays idle in the router (still counted in `totalAssets`, still withdrawable).
///           • `onlyVault` on the money paths, `onlyOwner` (curator) on allocation. `rebalance` is off-path.
contract MintwareMultiVenueYieldAdapter is IYieldAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 internal constant BPS = 10_000;

    IERC20 public immutable asset;

    /// @notice The only address allowed to supply/withdraw. Owner-settable ONCE (deploy chicken-and-egg).
    address public vault;

    struct Venue {
        IYieldAdapter adapter;
        uint16        weightBps; // target share of new deposits; Σ weights ≤ 10_000 (remainder = idle buffer)
    }

    Venue[] private _venues;

    /// @notice Max weight (bps) any single venue may be assigned in `setVenues` — a DEPOSIT-ROUTING
    ///         concentration cap ONLY. It bounds how much fresh capital is routed to one venue; it does
    ///         **NOT** bound that venue's self-reported NAV (that is the principal-clamp below). Defaults
    ///         to a non-zero `5_000` (no single venue above 50%) so a fresh deploy is diversified by
    ///         default; set it lower to force wider diversification, or up to `BPS` to opt back into
    ///         single-venue concentration.
    uint16 public maxVenueWeightBps;

    /// @notice Real underlying principal the router has DEPLOYED into each child (keyed by adapter address),
    ///         moved by `_deploy` / `withdraw` / `rebalance`. This is the clamp ceiling for that child's
    ///         self-reported NAV: a child can never mark the senior NAV up beyond the principal the router
    ///         actually sent it (+ a bounded yield band). A malicious/mis-reporting child holding $0 of real
    ///         principal contributes ~$0 to NAV no matter what it claims — closing the phantom-NAV lie that
    ///         the weight cap does not gate.
    mapping(address => uint256) public deployedPrincipal;

    /// @notice Upper bound (bps of a child's deployed principal) by which its self-reported value may exceed
    ///         that principal before the router stops believing it — the "bounded yield band". Default
    ///         `2_000` (20%). A report above `principal + band` is treated as an over-statement and clamped
    ///         to the ceiling. Governable so a legitimately higher-yield venue can be given more headroom.
    uint16 public maxYieldBps;

    /// @notice Per-child allowlist. A venue MUST be explicitly trusted (`setVenueTrust`) before it can be
    ///         wired via `setVenues`, so pairing an unvetted (possibly NAV-lying) child is a DELIBERATE
    ///         curator act rather than a silent default. Belt to the principal-clamp's suspenders.
    mapping(address => bool) public trustedVenue;

    event VaultSet(address indexed vault);
    event MaxVenueWeightSet(uint16 maxWeightBps);
    event MaxYieldBpsSet(uint16 maxYieldBps);
    event VenueTrustSet(address indexed venue, bool trusted);
    event VenuesSet(uint256 count, uint16 totalWeightBps);
    event Rebalanced(uint256 pulled, uint256 redeployed);
    event Supplied(uint256 amount, uint256 deployed);
    event Withdrawn(uint256 requested, uint256 withdrawn);

    error OnlyVault();
    error ZeroAddress();
    error VaultAlreadySet();
    error WeightOverflow();
    error EmptyVenues();
    error InvalidCap();
    error VenueWeightCapExceeded();
    error VenueNotTrusted();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    /// @param asset_  The underlying token every venue must share (e.g. USDC).
    /// @param vault_  Initial authorized vault (may be zero, set later via `setVault`).
    /// @param owner_  Curator (allocation + rebalance).
    constructor(address asset_, address vault_, address owner_) Ownable(owner_) {
        if (asset_ == address(0)) revert ZeroAddress();
        asset = IERC20(asset_);
        vault = vault_;
        maxVenueWeightBps = 5_000; // non-zero default: no single venue above 50% of fresh deposits
        maxYieldBps = 2_000;       // default bounded yield band = 20% of deployed principal per child
    }

    // ── admin / curation ─────────────────────────────────────────────────────────
    function setVault(address vault_) external onlyOwner {
        if (vault_ == address(0)) revert ZeroAddress();
        if (vault != address(0)) revert VaultAlreadySet();
        vault = vault_;
        emit VaultSet(vault_);
    }

    /// @notice Set the per-venue weight cap (bps). Must be in `(0, BPS]`. Applies to future `setVenues`
    ///         calls; it does not retroactively move funds — re-run `setVenues` to enforce it on the
    ///         current set. Lowering it is the risk-tiering lever (e.g. `4_000` = no venue above 40%).
    function setMaxVenueWeightBps(uint16 cap) external onlyOwner {
        if (cap == 0 || cap > BPS) revert InvalidCap();
        maxVenueWeightBps = cap;
        emit MaxVenueWeightSet(cap);
    }

    /// @notice Set the bounded yield band (bps of principal) a child's self-report may exceed its deployed
    ///         principal by before it is clamped. `[0, BPS]`. Lower = stricter (a compromised/lying child
    ///         can inflate NAV by at most this fraction of what it actually holds). Applies immediately to
    ///         `totalAssets` / `maxWithdrawable`.
    function setMaxYieldBps(uint16 bps) external onlyOwner {
        if (bps > BPS) revert InvalidCap();
        maxYieldBps = bps;
        emit MaxYieldBpsSet(bps);
    }

    /// @notice Allow/deny a child adapter for wiring via `setVenues`. Trusting a venue is the deliberate
    ///         curation act; the principal-clamp still bounds even a trusted-then-compromised child's NAV.
    function setVenueTrust(address venue, bool trusted) external onlyOwner {
        if (venue == address(0)) revert ZeroAddress();
        trustedVenue[venue] = trusted;
        emit VenueTrustSet(venue, trusted);
    }

    /// @notice Set the venue set + target weights (curator's allocation call). `Σ weightBps ≤ 10_000`; any
    ///         shortfall is deliberately held idle in the router as an instant-withdraw buffer. Replacing the
    ///         set does NOT move funds — call `rebalance()` after to align holdings to the new weights.
    function setVenues(IYieldAdapter[] calldata adapters, uint16[] calldata weightsBps) external onlyOwner {
        if (adapters.length == 0 || adapters.length != weightsBps.length) revert EmptyVenues();
        uint256 total;
        delete _venues;
        for (uint256 i; i < adapters.length; ++i) {
            if (address(adapters[i]) == address(0)) revert ZeroAddress();
            if (!trustedVenue[address(adapters[i])]) revert VenueNotTrusted();
            if (weightsBps[i] > maxVenueWeightBps) revert VenueWeightCapExceeded();
            total += weightsBps[i];
            _venues.push(Venue({adapter: adapters[i], weightBps: weightsBps[i]}));
        }
        if (total > BPS) revert WeightOverflow();
        emit VenuesSet(adapters.length, uint16(total));
    }

    function venuesLength() external view returns (uint256) { return _venues.length; }
    function venueAt(uint256 i) external view returns (address adapter, uint16 weightBps) {
        Venue storage v = _venues[i];
        return (address(v.adapter), v.weightBps);
    }

    /// @notice Pull everything back to the router and redeploy by the current weights. Best-effort per venue;
    ///         off the hot path (owner-only). Use after re-weighting or to harvest drift into the target mix.
    function rebalance() external onlyOwner nonReentrant {
        uint256 pulled;
        uint256 n = _venues.length;
        for (uint256 i; i < n; ++i) {
            IYieldAdapter a = _venues[i].adapter;
            uint256 max = a.maxWithdrawable();
            if (max == 0) continue;
            try a.withdraw(max) returns (uint256 got) { pulled += got; _reducePrincipal(address(a), got); } catch {}
        }
        uint256 deployed = _deploy(asset.balanceOf(address(this)));
        emit Rebalanced(pulled, deployed);
    }

    // ── IYieldAdapter ──────────────────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    function deposit(uint256 amount) external override onlyVault nonReentrant {
        if (amount == 0) return;
        asset.safeTransferFrom(vault, address(this), amount);
        uint256 deployed = _deploy(amount);
        emit Supplied(amount, deployed);
    }

    /// @dev Split `amount` across venues by weight and try to supply each (skipping full/paused sources and
    ///      swallowing a source revert). Un-deployed funds stay idle in the router. Returns amount deployed.
    function _deploy(uint256 amount) internal returns (uint256 deployed) {
        if (amount == 0) return 0;
        uint256 n = _venues.length;
        for (uint256 i; i < n; ++i) {
            Venue storage v = _venues[i];
            uint256 want = (amount * v.weightBps) / BPS;
            if (want == 0) continue;
            uint256 room = v.adapter.maxSuppliable();
            if (room < want) want = room;
            if (want == 0) continue;
            asset.forceApprove(address(v.adapter), want);
            try v.adapter.deposit(want) { deployed += want; deployedPrincipal[address(v.adapter)] += want; } catch {}
            asset.forceApprove(address(v.adapter), 0);
        }
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Best-effort: serve from idle first, then pull from venues in order until satisfied. Each pull is
    ///      try/caught and sized to the venue's headroom; a stalled venue contributes 0. Transfers the total
    ///      to the vault and returns it (`<= amount`). Never reverts for an availability reason.
    function withdraw(uint256 amount) external override onlyVault nonReentrant returns (uint256 withdrawn) {
        if (amount == 0) return 0;

        uint256 idle = asset.balanceOf(address(this));
        uint256 need = amount > idle ? amount - idle : 0;

        uint256 n = _venues.length;
        for (uint256 i; i < n && need > 0; ++i) {
            IYieldAdapter a = _venues[i].adapter;
            uint256 room = a.maxWithdrawable();
            if (room == 0) continue;
            uint256 pull = need < room ? need : room;
            try a.withdraw(pull) returns (uint256 got) {
                need = need > got ? need - got : 0;
                _reducePrincipal(address(a), got);
            } catch {}
        }

        // Everything withdrawn now sits in the router (children pay their `vault` == this). Pay the vault.
        uint256 have = asset.balanceOf(address(this));
        withdrawn = amount < have ? amount : have;
        if (withdrawn > 0) asset.safeTransfer(vault, withdrawn);
        emit Withdrawn(amount, withdrawn);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev PRINCIPAL-CLAMPED NAV. Each child contributes `min(self-reported, deployedPrincipal + band)` —
    ///      the router never trusts a child's mark above the principal it actually sent that child plus a
    ///      bounded yield band. A lying/compromised child holding $0 of real principal contributes ~$0 no
    ///      matter what it claims, so it cannot inflate the senior NAV this feeds. The clamp is an UPPER
    ///      bound only: a child reporting a real LOSS (below principal) still surfaces the lower value.
    function totalAssets() external view override returns (uint256 total) {
        uint256 n = _venues.length;
        // AUDIT L3: saturating add so a single misbehaving child can't overflow-revert the NAV read.
        for (uint256 i; i < n; ++i) {
            IYieldAdapter a = _venues[i].adapter;
            total = _satAdd(total, _clampChild(address(a), a.totalAssets()));
        }
        total = _satAdd(total, asset.balanceOf(address(this))); // idle buffer counts
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Same principal-clamp as `totalAssets` — a child's claimed headroom is bounded by the principal
    ///      it actually holds (+ band), so an over-stated `maxWithdrawable` cannot promise capital a child
    ///      cannot pay.
    function maxWithdrawable() external view override returns (uint256 total) {
        uint256 n = _venues.length;
        for (uint256 i; i < n; ++i) {
            IYieldAdapter a = _venues[i].adapter;
            total = _satAdd(total, _clampChild(address(a), a.maxWithdrawable()));
        }
        total = _satAdd(total, asset.balanceOf(address(this)));
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Sum of the venues' headroom — the vault only routes here what can actually earn; if every source
    ///      is full it returns 0 and the vault keeps the capital as its own buffer (rather than deposit it to
    ///      sit idle in the router).
    function maxSuppliable() external view override returns (uint256 total) {
        uint256 n = _venues.length;
        for (uint256 i; i < n; ++i) total = _satAdd(total, _venues[i].adapter.maxSuppliable());
    }

    /// @dev Saturating add. A single uncapped child legitimately reports `type(uint256).max` headroom — an
    ///      Aave reserve with no supply cap, or a standard ERC-4626 with no deposit limit (exactly the
    ///      "curator over Aave + Morpho/Euler" composition this contract advertises). Summing two of those
    ///      with checked arithmetic overflows and REVERTS, and because the vault reads `maxSuppliable()` /
    ///      `maxWithdrawable()` on its deposit/withdraw path, that revert bricks the money path (DoS). Cap the
    ///      running total at `type(uint256).max` instead — an "effectively unbounded" headroom is the right
    ///      answer, and callers already treat these as best-effort ceilings.
    function _satAdd(uint256 a, uint256 b) private pure returns (uint256) {
        unchecked { return b > type(uint256).max - a ? type(uint256).max : a + b; }
    }

    /// @dev Clamp a child's self-reported value to `min(reported, deployedPrincipal + boundedYield)`, where
    ///      `boundedYield = deployedPrincipal * maxYieldBps / BPS`. Upper bound only — a report BELOW
    ///      principal (a real loss) passes through unchanged. This is the load-bearing anti-phantom-NAV
    ///      invariant: a child's NAV contribution never exceeds the principal the router deployed into it
    ///      plus the bounded yield band, so self-reported NAV can never be fabricated out of thin air.
    function _clampChild(address a, uint256 reported) private view returns (uint256) {
        uint256 p = deployedPrincipal[a];
        uint256 ceiling = _satAdd(p, (p * maxYieldBps) / BPS);
        return reported < ceiling ? reported : ceiling;
    }

    /// @dev Reduce a child's tracked principal by the amount just withdrawn from it (floored at 0). Pulling
    ///      out yield on top of principal simply zeroes the tracked principal — conservative (never negative,
    ///      never over-counts the clamp ceiling).
    function _reducePrincipal(address a, uint256 got) private {
        uint256 p = deployedPrincipal[a];
        deployedPrincipal[a] = got >= p ? 0 : p - got;
    }
}
