// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";

import {Pausable}                       from "@openzeppelin/contracts/utils/Pausable.sol";
import {MWGuardianPausable}             from "../src/lib/MWGuardianPausable.sol";
import {MintwareMatchedLiquidityVault}  from "../src/vaults/MintwareMatchedLiquidityVault.sol";
import {MintwareWeightedDistributor}    from "../src/MintwareWeightedDistributor.sol";
import {PoolProfile}                    from "../src/vaults/VaultTypes.sol";
import {HookMiner}                      from "../src/lib/HookMiner.sol";
import {MWHookCoordinator}              from "../src/hooks/MWHookCoordinator.sol";

import {MockERC20}      from "./mocks/MockERC20.sol";
import {TestSwapRouter} from "./helpers/TestSwapRouter.sol";

/// @notice Invariant + lifecycle tests for the team-locked, community-matched liquidity vault.
///         The §6 invariants are the acceptance bar:
///           - team funds NEVER unlock before lockExpiry, under any path;
///           - community is NEVER locked;
///           - activation cannot be self-dealt (team barred + min-depositor floor);
///           - on-chain fee redirection: team earns 0% while locked, community absorbs it.
/// @dev 1% transfer-tax token — the median case for a MEME launch project token.
contract TaxToken is MockERC20 {
    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100; // 1% tax on real transfers (not mint/burn)
            super._update(from, to, value - fee);
            super._update(from, address(0xdEaD), fee);
        } else {
            super._update(from, to, value);
        }
    }
}

contract MintwareMatchedLiquidityVaultTest is Test {
    using PoolIdLibrary for PoolKey;

    address internal deployer = address(this);
    address internal team     = makeAddr("team");
    address internal treasury = makeAddr("treasury");
    address internal trader   = makeAddr("trader");
    address internal a        = makeAddr("lp_a");
    address internal b        = makeAddr("lp_b");
    address internal c        = makeAddr("lp_c");

    PoolManager    internal pm;
    TestSwapRouter internal swapRouter;
    MintwareMatchedLiquidityVault internal vault;

    MockERC20 internal proj;
    MockERC20 internal quote;
    bool      internal projIsToken0;

    PoolKey internal poolKey;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0

    uint256 internal constant T          = 100_000e18; // team commitment
    uint256 internal constant CAP        = 100_000e18; // targetMatchQuote
    uint256 internal constant WINDOW     = 7 days;
    uint256 internal constant THRESHOLD  = 5_000;      // 50%
    uint256 internal constant LOCK       = 365 days;

    function setUp() public {
        pm         = new PoolManager(deployer);
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));

        proj  = new MockERC20("Project", "PEPE", 18);
        quote = new MockERC20("Quote", "USDC", 18);
        projIsToken0 = address(proj) < address(quote);

        vault = new MintwareMatchedLiquidityVault(
            address(pm), address(proj), address(quote), team, treasury, address(0),
            PoolProfile.MEME, deployer
        );

        // AUDIT R2-L2: commitTeam now requires a wired `expectedHook` (no ungated launch pools), so the
        // harness mirrors production (DeployMatchedVault) and binds the vault to a real MWHookCoordinator.
        // The coordinator only gates modify-liquidity to the vault (vault-only LP); `beforeInitialize` is
        // false and all MEV levers are off by default, so swaps + griefer pool inits behave as before.
        address coord = _deployCoord(address(vault));
        vault.setExpectedHook(coord);

        (Currency c0, Currency c1) = projIsToken0
            ? (Currency.wrap(address(proj)), Currency.wrap(address(quote)))
            : (Currency.wrap(address(quote)), Currency.wrap(address(proj)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(coord)});

        proj.mint(team, 1_000_000e18);
        quote.mint(a, 1_000_000e18);
        quote.mint(b, 1_000_000e18);
        quote.mint(c, 1_000_000e18);
        proj.mint(trader, 1_000_000e18);
        quote.mint(trader, 1_000_000e18);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _commit() internal {
        vm.startPrank(team);
        proj.approve(address(vault), T);
        vault.commitTeam(poolKey, INIT_SQRT_PRICE, T, CAP, WINDOW, THRESHOLD, LOCK);
        vm.stopPrank();
    }

    /// @dev AUDIT R2-L2: mine + deploy a canonical MWHookCoordinator bound to `vaultAddr` (mirrors
    ///      DeployMatchedVault.s.sol) so `commitTeam` accepts the launch pool.
    function _deployCoord(address vaultAddr) internal returns (address) {
        bytes memory args = abi.encode(IPoolManager(address(pm)), vaultAddr, deployer);
        (address expected, bytes32 salt) =
            HookMiner.find(deployer, uint160(0xAC8), type(MWHookCoordinator).creationCode, args);
        MWHookCoordinator h = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), vaultAddr, deployer);
        require(address(h) == expected, "coord addr");
        return address(h);
    }

    function _deposit(address who, uint256 amt) internal {
        vm.startPrank(who);
        quote.approve(address(vault), amt);
        vault.depositCommunity(amt);
        vm.stopPrank();
    }

    /// @dev Fund to `total` quote across three distinct depositors (satisfies the min-depositor floor).
    function _fundThree(uint256 total) internal {
        _deposit(a, total * 40 / 100);
        _deposit(b, total * 40 / 100);
        _deposit(c, total - (total * 40 / 100) - (total * 40 / 100));
    }

    function _genFees() internal {
        // Round-trip swaps to accrue fees in both tokens on the vault's position.
        vm.startPrank(trader);
        quote.approve(address(swapRouter), type(uint256).max);
        proj.approve(address(swapRouter), type(uint256).max);
        bool quoteIsZero = !projIsToken0;
        swapRouter.swap(poolKey, quoteIsZero, 5_000e18);  // buy proj with quote
        swapRouter.swap(poolKey, !quoteIsZero, 4_000e18); // sell proj back
        vm.stopPrank();
    }

    // ── lifecycle ────────────────────────────────────────────────────────────

    function test_full_lifecycle_activates_and_deploys() public {
        _commit();
        _fundThree(CAP);
        assertEq(vault.communityDeposited(), CAP, "cap filled");

        vault.activate();
        assertEq(uint256(vault.phase()), uint256(MintwareMatchedLiquidityVault.Phase.Active), "active");
        assertGt(vault.totalLiquidity(), 0, "liquidity deployed");
        assertGt(vault.teamLiquidity(), 0, "team locked half");
        assertEq(vault.totalLiquidity(), vault.teamLiquidity() + vault.totalCommunityShares(), "split sums");
        assertEq(vault.lockExpiry(), block.timestamp + LOCK, "lock set");
        assertTrue(vault.isLocked(), "locked");
    }

    // ── audit: pre-init griefing (HIGH) — pool inited atomically in commitTeam ────

    function test_preinit_at_launch_price_commits_and_activates() public {
        // Griefer front-runs commitTeam by initializing the pool at OUR launch price (benign).
        vm.prank(makeAddr("griefer"));
        pm.initialize(poolKey, INIT_SQRT_PRICE);
        _commit();          // must adopt the existing pool, not revert
        _fundThree(CAP);
        vault.activate();   // must still deploy
        assertGt(vault.totalLiquidity(), 0, "activated despite benign pre-init");
    }

    function test_preinit_at_hostile_price_reverts_commit_no_escrow() public {
        // Griefer initializes the pool at a DIFFERENT price before commit.
        vm.prank(makeAddr("griefer"));
        pm.initialize(poolKey, INIT_SQRT_PRICE * 2);
        vm.startPrank(team);
        proj.approve(address(vault), T);
        vm.expectRevert(MintwareMatchedLiquidityVault.PoolPreInitialized.selector);
        vault.commitTeam(poolKey, INIT_SQRT_PRICE, T, CAP, WINDOW, THRESHOLD, LOCK);
        vm.stopPrank();
        assertEq(proj.balanceOf(address(vault)), 0, "no team escrow on revert - team can retry");
    }

    // ── audit: fee-on-transfer intake credits RECEIVED, not nominal ──────────────

    function test_commitTeam_balance_diff_for_tax_token() public {
        TaxToken taxProj = new TaxToken("Tax", "TAX", 18);
        MintwareMatchedLiquidityVault v2 = new MintwareMatchedLiquidityVault(
            address(pm), address(taxProj), address(quote), team, treasury, address(0),
            PoolProfile.MEME, deployer
        );
        address coord2 = _deployCoord(address(v2)); // AUDIT R2-L2: bind v2 to a canonical hook
        v2.setExpectedHook(coord2);
        (Currency k0, Currency k1) = address(taxProj) < address(quote)
            ? (Currency.wrap(address(taxProj)), Currency.wrap(address(quote)))
            : (Currency.wrap(address(quote)), Currency.wrap(address(taxProj)));
        PoolKey memory k = PoolKey({currency0: k0, currency1: k1, fee: 3000, tickSpacing: 60, hooks: IHooks(coord2)});

        taxProj.mint(team, 200_000e18);
        vm.startPrank(team);
        taxProj.approve(address(v2), T);
        v2.commitTeam(k, INIT_SQRT_PRICE, T, CAP, WINDOW, THRESHOLD, LOCK);
        vm.stopPrank();

        // 1% tax → vault received 99% → commitment reflects RECEIVED, not the nominal T.
        assertLt(v2.teamTokenCommitment(), T, "credits less than nominal");
        assertApproxEqRel(v2.teamTokenCommitment(), T * 99 / 100, 0.001e18, "credits post-tax received");
    }

    // ── audit: imbalanced deploy strand is REFUNDED, not stranded (non-1:1 price) ─

    function test_strand_refunded_at_non_1to1_price() public {
        // Launch away from 1:1 so the range binds on one side and the other strands.
        uint160 nonOne = uint160(INIT_SQRT_PRICE * 2); // price ~4
        vm.startPrank(team);
        proj.approve(address(vault), T);
        vault.commitTeam(poolKey, nonOne, T, CAP, WINDOW, THRESHOLD, LOCK);
        vm.stopPrank();
        _fundThree(CAP);

        uint256 teamProjBefore = proj.balanceOf(team);
        vault.activate();

        uint256 teamRefunded = proj.balanceOf(team) - teamProjBefore; // undeployed proj back to team
        uint256 strandedQuote = vault.undeployedQuote();
        assertTrue(teamRefunded > 0 || strandedQuote > 0, "a side strands at non-1:1 and is accounted");

        // If the quote side stranded, community claims its pro-rata share (deposit-weighted).
        if (strandedQuote > 0) {
            uint256 aBefore = quote.balanceOf(a);
            vm.prank(a);
            vault.claimUndeployedQuote();
            assertGt(quote.balanceOf(a) - aBefore, 0, "community claimed its undeployed quote");
            // No double-claim.
            vm.prank(a);
            vm.expectRevert(MintwareMatchedLiquidityVault.AlreadyClaimedUndeployed.selector);
            vault.claimUndeployedQuote();
        }
    }

    function test_partial_fill_scales_team_and_refunds_unmatched() public {
        _commit();
        uint256 filled = CAP * 60 / 100; // 60% — below cap, so must wait for the window
        _fundThree(filled);

        vm.warp(block.timestamp + WINDOW + 1);
        uint256 teamBalBefore = proj.balanceOf(team);
        vault.activate();

        // Team's unmatched 40% of T is refunded; ~60% remains as matched (deployed) liquidity.
        uint256 refunded = proj.balanceOf(team) - teamBalBefore;
        assertApproxEqRel(refunded, T * 40 / 100, 0.001e18, "unmatched team tokens refunded");
    }

    function test_below_threshold_aborts_and_refunds_both_sides() public {
        _commit();
        _fundThree(CAP * 40 / 100); // 40% < 50% threshold

        vm.warp(block.timestamp + WINDOW + 1);
        uint256 teamBefore = proj.balanceOf(team);
        vault.abort();
        assertEq(uint256(vault.phase()), uint256(MintwareMatchedLiquidityVault.Phase.Aborted), "aborted");
        assertEq(proj.balanceOf(team) - teamBefore, T, "team fully refunded");

        // Community pulls its escrow back. (Read contribution before the prank — a nested
        // getter call in the argument would otherwise consume the prank.)
        uint256 aContribution = vault.communityContribution(a);
        uint256 aBefore = quote.balanceOf(a);
        vm.prank(a);
        vault.withdrawCommunityFunding(aContribution);
        assertGt(quote.balanceOf(a) - aBefore, 0, "community refunded");
    }

    function test_cap_is_enforced_at_contract_level() public {
        _commit();
        _deposit(a, CAP);
        vm.startPrank(b);
        quote.approve(address(vault), 1e18);
        vm.expectRevert(MintwareMatchedLiquidityVault.CapExceeded.selector);
        vault.depositCommunity(1e18);
        vm.stopPrank();
    }

    // ── self-dealing guards (§6) ──────────────────────────────────────────────

    function test_team_cannot_match_own_launch() public {
        _commit();
        vm.startPrank(team);
        quote.mint(team, 1e18);
        quote.approve(address(vault), 1e18);
        vm.expectRevert(MintwareMatchedLiquidityVault.TeamCannotMatch.selector);
        vault.depositCommunity(1e18);
        vm.stopPrank();
    }

    function test_activation_requires_min_depositors() public {
        _commit();
        _deposit(a, CAP); // single depositor fills the cap, but count == 1 < 3
        vm.expectRevert(MintwareMatchedLiquidityVault.ThresholdNotMet.selector);
        vault.activate();
    }

    // ── THE core invariant: team lock has no bypass ───────────────────────────

    function test_team_cannot_withdraw_before_expiry() public {
        _commit();
        _fundThree(CAP);
        vault.activate();

        vm.startPrank(team);
        vm.expectRevert(MintwareMatchedLiquidityVault.StillLocked.selector);
        vault.teamWithdraw();

        // One second before expiry — still locked.
        vm.warp(vault.lockExpiry() - 1);
        vm.expectRevert(MintwareMatchedLiquidityVault.StillLocked.selector);
        vault.teamWithdraw();
        vm.stopPrank();
    }

    function test_guardian_pause_cannot_release_team_early() public {
        _commit();
        _fundThree(CAP);
        vault.activate();

        // Guardian pauses; owner unpauses — neither can satisfy the cliff.
        vault.pause();
        vm.prank(team);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.teamWithdraw();
        vault.unpause();

        vm.prank(team);
        vm.expectRevert(MintwareMatchedLiquidityVault.StillLocked.selector);
        vault.teamWithdraw();
    }

    function test_team_withdraws_after_expiry() public {
        _commit();
        _fundThree(CAP);
        vault.activate();

        vm.warp(vault.lockExpiry() + 1);
        uint256 before = proj.balanceOf(team) + quote.balanceOf(team);
        vm.prank(team);
        vault.teamWithdraw();
        assertGt(proj.balanceOf(team) + quote.balanceOf(team) - before, 0, "team recovered liquidity");
        assertTrue(vault.teamWithdrawn(), "flagged withdrawn");
    }

    // ── community is never locked ─────────────────────────────────────────────

    function test_community_can_redeem_while_team_still_locked() public {
        _commit();
        _fundThree(CAP);
        vault.activate();
        assertTrue(vault.isLocked(), "team still locked");

        vm.startPrank(a);
        vault.requestCommunityRedeem(vault.communityShareOf(a));
        vm.warp(block.timestamp + 7 days + 1);
        (uint256 projOut, uint256 quoteOut) = vault.executeCommunityRedeem();
        vm.stopPrank();

        assertGt(projOut + quoteOut, 0, "community redeemed proportional liquidity");
        assertEq(vault.communityShares(a), 0, "shares burned");
        assertTrue(vault.isLocked(), "team STILL locked after community exit");
    }

    // ── on-chain fee redirection (§2.3) ───────────────────────────────────────

    function test_community_fees_route_to_weighted_distributor_when_wired() public {
        _commit();
        _fundThree(CAP);
        vault.activate();

        MintwareWeightedDistributor dist =
            new MintwareWeightedDistributor(makeAddr("oracle"), deployer);
        bytes32 vid = keccak256("matched");
        dist.setAuthorizedRegistrar(address(vault), true); // front-run guard (audit MED)
        vault.setWeightedDistributor(address(dist), vid);

        _genFees();
        (uint256 pf, uint256 qf) = vault.collectFees();
        assertTrue(pf > 0 || qf > 0, "fees realized");

        // Community LP portion (fee minus Mintware cut) routed to the distributor pot.
        uint256 mintP = (pf * vault.MINTWARE_FEE_BPS()) / vault.BPS();
        uint256 mintQ = (qf * vault.MINTWARE_FEE_BPS()) / vault.BPS();
        MintwareWeightedDistributor.Epoch memory e = dist.getEpoch(vid, 1);
        assertEq(e.pot0, pf - mintP, "proj LP fees routed");
        assertEq(e.pot1, qf - mintQ, "quote LP fees routed");

        // Accumulator untouched; community claims its weighted share from the distributor.
        assertEq(vault.accProjPerShare(), 0, "accumulator not credited");
        (uint256 pp, uint256 qq) = vault.pendingCommunityFees(a);
        assertEq(pp, 0, "no pending accumulator fees");
        assertEq(qq, 0, "no pending accumulator fees");
    }

    function test_matched_setWeightedDistributor_is_one_time() public {
        MintwareWeightedDistributor dist =
            new MintwareWeightedDistributor(makeAddr("oracle"), deployer);
        dist.setAuthorizedRegistrar(address(vault), true); // front-run guard (audit MED)
        vault.setWeightedDistributor(address(dist), keccak256("v"));
        vm.expectRevert(MintwareMatchedLiquidityVault.WeightedDistributorAlreadySet.selector);
        vault.setWeightedDistributor(address(dist), keccak256("v2"));
    }

    function test_team_earns_zero_community_absorbs_fees_during_lock() public {
        _commit();
        _fundThree(CAP);
        vault.activate();

        _genFees();
        vault.collectFees();

        // Team accrues NOTHING while locked — its balance must not move on a claim.
        uint256 teamProjBefore  = proj.balanceOf(team);
        uint256 teamQuoteBefore = quote.balanceOf(team);
        vm.prank(team);
        vault.claimTeamFees();
        assertEq(proj.balanceOf(team),  teamProjBefore,  "team proj unchanged while locked");
        assertEq(quote.balanceOf(team), teamQuoteBefore, "team quote unchanged while locked");

        // Community has claimable fees and receives them.
        (uint256 pp, uint256 qq) = vault.pendingCommunityFees(a);
        assertTrue(pp > 0 || qq > 0, "community has fees to claim");

        uint256 pBefore = proj.balanceOf(a);
        uint256 qBefore = quote.balanceOf(a);
        vm.prank(a);
        vault.claimCommunityFees();
        assertTrue(proj.balanceOf(a) > pBefore || quote.balanceOf(a) > qBefore, "community received fees");
    }

    function test_team_earns_fees_after_lock_expiry() public {
        _commit();
        _fundThree(CAP);
        vault.activate();

        vm.warp(vault.lockExpiry() + 1);
        _genFees();
        vault.collectFees();

        uint256 pBefore = proj.balanceOf(team);
        uint256 qBefore = quote.balanceOf(team);
        vm.prank(team);
        vault.claimTeamFees();
        assertTrue(proj.balanceOf(team) > pBefore || quote.balanceOf(team) > qBefore, "team earns after lock");
    }

    // ── kill-switch wiring ────────────────────────────────────────────────────

    function test_pause_blocks_deposit_but_not_funding_withdraw() public {
        _commit();
        _deposit(a, 10_000e18);
        vault.pause();

        vm.startPrank(b);
        quote.approve(address(vault), 1e18);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.depositCommunity(1e18);
        vm.stopPrank();

        // Funding withdrawal is NOT gated by pause — community can always pull pending funds.
        vm.prank(a);
        vault.withdrawCommunityFunding(10_000e18);
        assertEq(vault.communityContribution(a), 0, "pending funds returned during pause");
    }

    function test_construction_rejects_blue_chip() public {
        vm.expectRevert(MintwareMatchedLiquidityVault.BadProfile.selector);
        new MintwareMatchedLiquidityVault(
            address(pm), address(proj), address(quote), team, treasury, address(0),
            PoolProfile.BLUE_CHIP, deployer
        );
    }

    // ── AUDIT R2-M1: the H6 activation-griefing lock is ESCAPABLE ───────────────────────────────────
    //
    // An attacker front-runs every `activate()` with a free empty-pool swap that pushes the launch price
    // outside the band → `LaunchPriceMoved`. Because `abort()` refused while the threshold was met, the
    // team's committed tokens (and community escrow) were trapped forever. The R2-M1 fix opens `abort()`
    // as an escape once a post-window GRACE has elapsed with the vault still un-activated: everyone refunds.
    function test_R2M1_griefLock_escapable_after_grace() public {
        _commit();
        _fundThree(CAP); // threshold MET (full fill, 3 depositors)

        // Griefer moves the EMPTY launch pool price to the extreme (free on zero liquidity).
        address griefer = makeAddr("griefer");
        quote.mint(griefer, 1e18);
        proj.mint(griefer, 1e18);
        vm.startPrank(griefer);
        quote.approve(address(swapRouter), type(uint256).max);
        proj.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(poolKey, !projIsToken0, 1e18); // push price out of band
        vm.stopPrank();

        // Past the window, activation is griefed — the locked position can't deploy at the moved price.
        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectRevert(MintwareMatchedLiquidityVault.LaunchPriceMoved.selector);
        vault.activate();

        // Within the grace window, abort still refuses — the team is expected to (re)try activation.
        vm.expectRevert(MintwareMatchedLiquidityVault.ThresholdWasMet.selector);
        vault.abort();

        // After the grace elapses with the vault still stuck, abort becomes the escape → full refunds.
        vm.warp(block.timestamp + 3 days + 1); // LAUNCH_GRACE_PERIOD = 3 days
        uint256 teamBefore = proj.balanceOf(team);
        vault.abort();
        assertEq(uint256(vault.phase()), uint256(MintwareMatchedLiquidityVault.Phase.Aborted), "escaped to Aborted");
        assertEq(proj.balanceOf(team) - teamBefore, T, "team reclaimed its full commitment");

        // Community also recovers its escrow (pull-refund stays open in Aborted).
        uint256 aBefore  = quote.balanceOf(a);
        uint256 contribA = vault.communityContribution(a); // compute BEFORE the prank (arg-eval consumes it)
        assertGt(contribA, 0, "community had escrow");
        vm.prank(a);
        vault.withdrawCommunityFunding(contribA);
        assertGt(quote.balanceOf(a) - aBefore, 0, "community reclaimed its escrow");
    }
}
