// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareWeightedDistributor}   from "../../src/MintwareWeightedDistributor.sol";
import {MintwareStagedLiquidityRouter, IPairVaultLike} from "../../src/vaults/MintwareStagedLiquidityRouter.sol";
import {LockTier}                       from "../../src/vaults/VaultTypes.sol";
import {MWOracleGuard}                  from "../../src/hooks/MWOracleGuard.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";

/// @dev 1% fee-on-transfer ("tax") ERC-20 — fee applies only to real transfers, never mint/burn.
///      Stands in for the community/meme-tier tokens where fee-on-transfer actually appears.
contract FeeOnTransferToken is MockERC20 {
    uint256 public constant FEE_BPS = 100; // 1%
    address public immutable sink;

    constructor() MockERC20("FeeToken", "FEE", 18) {
        sink = address(0xFEE5);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && to != sink) {
            uint256 fee = (value * FEE_BPS) / 10_000;
            super._update(from, sink, fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// @dev Minimal pair-vault stand-in (mirrors the router's own unit test) so `pair()` has a seam.
contract MockPairVault is IPairVaultLike {
    IERC20 public t0;
    IERC20 public t1;
    constructor(IERC20 a, IERC20 b) { t0 = a; t1 = b; }
    function token0() external view returns (IERC20) { return t0; }
    function token1() external view returns (IERC20) { return t1; }
    function depositFor(address, uint256 a0, uint256 a1, uint256 minShares, LockTier)
        external returns (uint256 s)
    {
        if (a0 > 0) t0.transferFrom(msg.sender, address(this), a0);
        if (a1 > 0) t1.transferFrom(msg.sender, address(this), a1);
        s = a0 + a1;
        require(s >= minShares, "minShares");
    }
}

/// @dev Harness exposing the MWOracleGuard library over a persistent State.
contract OracleGuardHarness {
    using MWOracleGuard for MWOracleGuard.State;
    MWOracleGuard.State internal s;

    function init(int24 maxMove, int24 maxDev, uint32 catchup) external {
        s.maxTickMovePerBlock = maxMove;
        s.maxDeviationTicks   = maxDev;
        s.maxCatchupBlocks    = catchup;
    }
    function update(int24 t) external { s.update(t); }
    function oracleTick() external view returns (int24) { return s.oracleTick; }
    function initialized() external view returns (bool) { return s.initialized; }
    function deviation(int24 t) external view returns (uint256) { return s.deviationTicks(t); }
    function checkBreaker(int24 t) external view { s.checkCircuitBreaker(t); }
}

/// @title  Audit Layer-2 (negative/edge) + Layer-5 (economic) checklist gaps
/// @notice Firm-level checks a happy-path suite misses, targeting gaps NOT already covered by the
///         existing ~450-test suites:
///           • M3 fee-on-transfer balance-diff on the distributor fund path (hostile token).
///           • First-depositor / donation inflation attack on the staged-router per-adapter 4626
///             share pool (virtual-offset defense).
///           • Single-tx spot manipulation vs. the truncated in-pool oracle (MWOracleGuard).
///           • Access-control negatives on the staged router pair/unstage owner gate.
contract SuiteChecklist is Test {
    // ── distributor fixtures ──
    MintwareWeightedDistributor internal dist;
    FeeOnTransferToken internal feeTok;
    uint256 internal constant ORACLE_PK = 0xBEEF;
    address internal oracle;
    address internal owner = address(0xA0);
    address internal alice = address(0xA1);
    bytes32 internal constant VAULT = keccak256("fee-vault");

    // ── staged-router fixtures ──
    MintwareStagedLiquidityRouter internal router;
    MockERC20 internal usdc;
    MockYieldAdapter internal adapter;
    MockPairVault internal pairVault;
    address internal attacker = address(0xBAD);
    address internal victim   = address(0x900D);

    uint256 internal constant UNIT = 1e18;

    function setUp() public {
        oracle = vm.addr(ORACLE_PK);

        // Distributor with a single-sided (token1 == 0) fee-on-transfer token0.
        vm.prank(owner);
        dist = new MintwareWeightedDistributor(oracle, owner);
        vm.prank(owner);
        dist.setAuthorizedRegistrar(address(this), true);
        feeTok = new FeeOnTransferToken();
        dist.registerVault(VAULT, address(feeTok), address(0));

        // Staged router.
        usdc      = new MockERC20("USDC", "USDC", 18);
        adapter   = new MockYieldAdapter(address(usdc));
        MockERC20 quote = new MockERC20("Q", "Q", 18);
        pairVault = new MockPairVault(IERC20(address(usdc)), IERC20(address(quote)));
        router    = new MintwareStagedLiquidityRouter();
        usdc.mint(attacker, 1_000_000 * UNIT);
        usdc.mint(victim,   1_000_000 * UNIT);
    }

    // ── helpers ──
    function _sign(bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ORACLE_PK, digest);
        return abi.encodePacked(r, s, v);
    }
    function _fundFee(uint256 requested) internal {
        feeTok.mint(address(this), requested);
        feeTok.approve(address(dist), requested);
        dist.fundFees(VAULT, requested, 0);
    }
    function _leaf(address w, uint256 a0, uint256 a1) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(w, a0, a1))));
    }
    function _stage(address who, uint256 amount) internal returns (uint256 id) {
        vm.startPrank(who);
        usdc.approve(address(router), amount);
        id = router.stage(pairVault, true /* token0 */, amount, adapter);
        vm.stopPrank();
    }

    // ───────────────────────────────────────────────────────────────────────
    // M3 — distributor fundFees credits balance-diff, not the requested amount.
    // ───────────────────────────────────────────────────────────────────────

    /// The fund path must credit what was RECEIVED (990 after 1% fee), not what was REQUESTED
    /// (1000). If it credited the request, a signed total ≤ requested would pass C5 while the
    /// contract holds less → a cross-epoch/cross-vault claim shortfall. We prove the ceiling
    /// tracks the received amount.
    function test_M3_fundFees_creditsReceivedNotRequested() public {
        _fundFee(1_000 * UNIT);
        // 1% fee ⇒ contract received 990.
        uint256 held = feeTok.balanceOf(address(dist));
        assertEq(held, 990 * UNIT, "contract holds post-fee amount");

        MintwareWeightedDistributor.Epoch memory e = dist.getEpoch(VAULT, dist.currentEpoch(VAULT));
        assertEq(e.pot0, held, "pot credited by balance-diff, equals held balance");
    }

    /// A root declaring the REQUESTED (pre-fee) total must be rejected by C5 — the pot only ever
    /// reflects tokens actually held, so over-declaration cannot pass close.
    function test_M3_overDeclareBeyondReceived_revertsOverAllocated() public {
        _fundFee(1_000 * UNIT);
        vm.warp(block.timestamp + 7 days);
        uint256 ep = dist.currentEpoch(VAULT);
        bytes32 root = _leaf(alice, 1_000 * UNIT, 0); // 1000 > pot0 (990)
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(dist.getEpochRootDigest(VAULT, ep, root, 1_000 * UNIT, 0, dl));
        vm.expectRevert(MintwareWeightedDistributor.OverAllocated.selector);
        dist.closeEpoch(VAULT, root, 1_000 * UNIT, 0, sig, dl);
    }

    /// The received total (990) closes and pays out fully — contract stays solvent end to end.
    function test_M3_claimAtReceivedTotal_isSolvent() public {
        _fundFee(1_000 * UNIT);
        vm.warp(block.timestamp + 7 days);
        uint256 ep = dist.currentEpoch(VAULT);
        uint256 total = 990 * UNIT;
        bytes32 root = _leaf(alice, total, 0);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(dist.getEpochRootDigest(VAULT, ep, root, total, 0, dl));
        dist.closeEpoch(VAULT, root, total, 0, sig, dl);

        bytes32[] memory proof = new bytes32[](0); // single-leaf root == leaf
        uint256 before = feeTok.balanceOf(alice);
        vm.prank(alice);
        dist.claim(VAULT, ep, total, 0, proof); // must not revert for insufficient balance
        // Alice receives total minus the token's own 1% exit fee; the contract is fully drained.
        assertGt(feeTok.balanceOf(alice) - before, 0);
        assertEq(feeTok.balanceOf(address(dist)), 0, "distributor fully solvent - nothing stranded/over-owed");
    }

    // ───────────────────────────────────────────────────────────────────────
    // First-depositor / donation inflation attack — staged-router adapter pool.
    // ───────────────────────────────────────────────────────────────────────

    /// Classic ERC-4626 inflation attack: attacker takes the first (1 wei) share, donates a large
    /// amount straight into the adapter to spike assets-per-share, then the victim deposits. Without
    /// the virtual offset the victim's shares would floor to ~0 and the attacker would redeem the
    /// victim's principal. SeniorSharesMath's symmetric virtual offset (VIRTUAL = 1e3) neutralizes it.
    function test_inflationAttack_victimPrincipalProtected() public {
        // 1) attacker seeds the pool with 1 wei.
        uint256 idAtk = _stage(attacker, 1);

        // 2) attacker donates 1,000 tokens straight into the adapter (raises totalAssets, not shares).
        usdc.mint(address(adapter), 1_000 * UNIT);

        // 3) victim stages a real 1,000-token position.
        uint256 principal = 1_000 * UNIT;
        uint256 idVic = _stage(victim, principal);

        // Victim can still recover ~their full principal (defense held — no theft via rounding).
        uint256 recoverable = router.stagedAssets(idVic);
        assertGe(recoverable, (principal * 99) / 100, "victim keeps >=99% of principal");

        // Attacker's 1-wei share cannot have captured the victim's deposit.
        uint256 atkAssets = router.stagedAssets(idAtk);
        assertLt(atkAssets, principal / 100, "attacker 1-wei stake captured <1% of victim principal");
    }

    // ───────────────────────────────────────────────────────────────────────
    // Access control — staged router owner gate (negative).
    // ───────────────────────────────────────────────────────────────────────

    function test_pair_nonOwnerReverts() public {
        uint256 id = _stage(victim, 100 * UNIT);
        vm.prank(attacker);
        vm.expectRevert(MintwareStagedLiquidityRouter.NotOwner.selector);
        router.pair(id, 100 * UNIT, 0, LockTier.Flex);
    }

    function test_unstage_nonOwnerReverts() public {
        uint256 id = _stage(victim, 100 * UNIT);
        vm.prank(attacker);
        vm.expectRevert(MintwareStagedLiquidityRouter.NotOwner.selector);
        router.unstage(id);
    }

    // ───────────────────────────────────────────────────────────────────────
    // Layer-5 — single-tx spot manipulation vs. the truncated in-pool oracle.
    // ───────────────────────────────────────────────────────────────────────

    /// A single-block price push must NOT move the oracle reference: `update` is a no-op within the
    /// same block, so however hard an attacker pushes spot in one tx, the oracle stays put and the
    /// swap is priced by its (large) DEVIATION — the fee moves AGAINST the attacker, and the circuit
    /// breaker trips. This is the manipulation resistance the deviation-priced fee relies on.
    function test_oracle_singleBlockManipulation_frozen() public {
        OracleGuardHarness g = new OracleGuardHarness();
        g.init(int24(100), int24(500), uint32(10)); // maxMove 100/blk, breaker at 500 ticks

        vm.roll(1000);
        g.update(1000); // initialize reference at tick 1000
        assertEq(g.oracleTick(), int24(1000));

        // Same block: attacker slams spot to 50_000 repeatedly. Reference must not budge.
        g.update(50_000);
        g.update(50_000);
        g.update(50_000);
        assertEq(g.oracleTick(), int24(1000), "oracle frozen within the block");

        // Deviation is huge → priced against the attacker, and the breaker trips.
        assertEq(g.deviation(50_000), uint256(49_000));
        vm.expectRevert(MWOracleGuard.PriceDeviationTooHigh.selector);
        g.checkBreaker(50_000);
    }

    /// Even across blocks, the reference advances at most `maxTickMovePerBlock × elapsed` — a
    /// sustained multi-block manipulation is rate-limited, never a clean jump to the pushed price.
    function test_oracle_crossBlockAdvance_clamped() public {
        OracleGuardHarness g = new OracleGuardHarness();
        g.init(int24(100), int24(0), uint32(10)); // breaker disabled; test the clamp only

        vm.roll(1000);
        g.update(1000);

        vm.roll(1001); // one block later
        g.update(50_000);
        // Clamped to +100 (1 block × 100), NOT the 50_000 the attacker pushed.
        assertEq(g.oracleTick(), int24(1100), "advance clamped to maxTickMovePerBlock * elapsed");

        vm.roll(1006); // 5 blocks later
        g.update(50_000);
        assertEq(g.oracleTick(), int24(1600), "still clamped: +100 * 5 blocks");
    }
}
