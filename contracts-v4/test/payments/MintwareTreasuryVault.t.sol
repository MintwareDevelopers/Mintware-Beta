// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {MintwareTreasuryVault} from "../../src/payments/MintwareTreasuryVault.sol";

import {MockERC20}           from "../mocks/MockERC20.sol";
import {MockYieldAdapter}    from "../mocks/MockYieldAdapter.sol";
import {MockLiquidityModule} from "../mocks/MockLiquidityModule.sol";

/// @title  MintwareTreasuryVault unit tests
/// @notice Focused (non-fuzz) coverage of the tranche accounting: senior mint-down / redeem round-trip,
///         inflation defense (lifted from v1), the price-free senior NAV under a 50% crash, junior
///         first-loss absorption, the "revert-rather-than-underpay" senior guard, access control on the
///         Gateway + junior redeem, the 90-day cliff, and the locked-vs-post-lock fee routing.
contract MintwareTreasuryVaultTest is Test {
    MintwareTreasuryVault internal vault;
    MockLiquidityModule   internal module;
    MockYieldAdapter      internal adapter;
    MockERC20             internal usdc;
    MockERC20             internal team;

    address internal owner    = makeAddr("owner");
    address internal teamAddr  = makeAddr("team");
    address internal gateway   = makeAddr("gateway");
    address internal receiver  = makeAddr("cardRail");
    address internal protocol  = makeAddr("protocol");
    address internal alice     = makeAddr("alice");

    uint256 internal constant ONE_USDC   = 1e6;
    uint256 internal constant INIT_PRICE = 1_000_000; // 1 USDC (6dp) per 1e18 team token
    uint256 internal constant LOCK_DUR   = 365 days;
    uint256 internal constant TEAM_COMMIT = 5_000_000 ether;

    function setUp() public {
        (vault, module, adapter) = _newVault(INIT_PRICE);

        // fund + deposit alice ($100k senior).
        usdc.mint(alice, 1_000_000 * ONE_USDC);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vault.depositUSDC(100_000 * ONE_USDC, 0, alice);
    }

    /// @dev Spin up a fully-wired, team-committed vault (shared usdc/team tokens across instances).
    ///      Pure-ETH junior (juniorUSDC = 0) — the pre-extension behavior.
    function _newVault(uint256 price)
        internal
        returns (MintwareTreasuryVault v, MockLiquidityModule m, MockYieldAdapter a)
    {
        return _newVault(price, 0);
    }

    /// @dev Same, but the team also commits `juniorUsdc` of stable first-loss coverage.
    function _newVault(uint256 price, uint256 juniorUsdc)
        internal
        returns (MintwareTreasuryVault v, MockLiquidityModule m, MockYieldAdapter a)
    {
        if (address(usdc) == address(0)) usdc = new MockERC20("USD Coin", "USDC", 6);
        if (address(team) == address(0)) team = new MockERC20("Team Token", "TEAM", 18);

        a = new MockYieldAdapter(address(usdc));
        v = new MintwareTreasuryVault(address(usdc), address(team), address(a), owner, teamAddr);
        m = new MockLiquidityModule(address(usdc), address(team), address(v), price);

        vm.startPrank(owner);
        v.setLiquidityModule(address(m));
        v.setGateway(gateway);
        v.setProtocolTreasury(protocol);
        vm.stopPrank();

        team.mint(teamAddr, TEAM_COMMIT);
        if (juniorUsdc > 0) usdc.mint(teamAddr, juniorUsdc);
        vm.startPrank(teamAddr);
        team.approve(address(v), type(uint256).max);
        usdc.approve(address(v), type(uint256).max);
        v.commitTeam(TEAM_COMMIT, juniorUsdc, LOCK_DUR);
        vm.stopPrank();
    }

    // ── deposit mints DOWN, redeem round-trips (no more than contributed) ───────────

    function test_deposit_mints_down_and_redeem_round_trips() public {
        address bob = makeAddr("bob");
        usdc.mint(bob, 50_000 * ONE_USDC);
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        uint256 minted = vault.depositUSDC(50_000 * ONE_USDC, 0, bob);
        // mint rounds DOWN → never more shares than assets at genesis-parity NAV.
        assertLe(minted, 50_000 * ONE_USDC, "mint minted MORE shares than assets");
        uint256 out = vault.redeemSenior(minted, 0);
        vm.stopPrank();
        assertLe(out, 50_000 * ONE_USDC, "round-trip returned MORE than contributed");
        assertApproxEqAbs(out, 50_000 * ONE_USDC, 2, "round-trip lost more than dust");
    }

    // ── first-depositor inflation attack is resisted (symmetric virtual offset) ─────

    function test_inflation_attack_resisted() public {
        (MintwareTreasuryVault v,,) = _newVault(INIT_PRICE);

        address attacker = makeAddr("attacker");
        address victim   = makeAddr("victim");
        usdc.mint(attacker, 1_000_000 * ONE_USDC);
        usdc.mint(victim, 10_000 * ONE_USDC);

        // Attacker deposits 1 unit then donates $15k straight into the vault buffer — the classic
        // first-depositor move that, without a virtual offset, rounds the victim's mint to zero.
        vm.startPrank(attacker);
        usdc.approve(address(v), type(uint256).max);
        v.depositUSDC(1, 0, attacker);
        vm.stopPrank();
        usdc.mint(address(v), 15_000 * ONE_USDC); // donation lands in the free senior buffer

        vm.startPrank(victim);
        usdc.approve(address(v), type(uint256).max);
        uint256 minted = v.depositUSDC(10_000 * ONE_USDC, 0, victim);
        uint256 out = v.redeemSenior(minted, 0);
        vm.stopPrank();

        assertGt(minted, 0, "victim minted zero shares (inflation succeeded)");
        assertGe(out, 9_500 * ONE_USDC, "victim lost more than dust to inflation");
    }

    // ── THE selling point: senior NAV ignores a 50% pool-price crash ────────────────

    function test_senior_price_free_under_50pct_crash() public {
        // Deploy the idle-target-permitted slice (20% of $100k = $20k) as 2-sided LP.
        uint256 jt = vault.juniorTokens(); // read BEFORE prank (arg-call would consume it)
        vm.prank(owner);
        vault.deployToLP(20_000 * ONE_USDC, jt);

        uint256 aliceShares = vault.seniorShares(alice);
        uint256 navBefore = vault.convertToAssets(aliceShares);
        uint256 pvBefore  = vault.previewWithdraw(1_000 * ONE_USDC);

        // Crash the ONLY price in the system by 50%.
        module.setPrice(INIT_PRICE / 2);

        assertEq(vault.convertToAssets(aliceShares), navBefore, "senior NAV moved with the pool price");
        assertEq(vault.previewWithdraw(1_000 * ONE_USDC), pvBefore, "previewWithdraw moved with the price");
        assertEq(vault.totalSeniorAssets(), 100_000 * ONE_USDC, "senior par not preserved at deposit value");
    }

    // ── junior is first-loss: after a crash the junior redeems LESS than committed ──
    //    while the senior redeems full par.

    function test_junior_absorbs_il_first() public {
        // Deploy 20% to LP (20k USDC + 20k team tokens paired at the initial mark).
        uint256 committed = vault.juniorTokens();
        vm.prank(owner);
        vault.deployToLP(20_000 * ONE_USDC, committed);
        uint256 teamInLp = committed - vault.juniorTokens(); // team tokens now backing the senior

        // Crash the pool 50% — impermanent loss on the paired position.
        module.setPrice(INIT_PRICE / 2);

        // SENIOR is made whole FIRST: alice redeems her full par (idle Aave + LP unwind at PAR).
        uint256 aliceShares = vault.seniorShares(alice);
        vm.prank(alice);
        uint256 seniorOut = vault.redeemSenior(aliceShares, 0);
        assertApproxEqAbs(seniorOut, 100_000 * ONE_USDC, 5, "senior was not made whole at par");

        // JUNIOR eats it: the LP-committed team tokens are consumed backing the senior, so post-cliff
        // the team recovers strictly fewer tokens than it committed (first-loss realized).
        vm.warp(vm.getBlockTimestamp() + LOCK_DUR + 1);
        uint256 teamBefore = team.balanceOf(teamAddr);
        vm.prank(teamAddr);
        vault.redeemJunior();
        uint256 tokensBack = team.balanceOf(teamAddr) - teamBefore;

        assertLt(tokensBack, committed, "junior recovered its full commit (did not absorb loss)");
        assertEq(tokensBack, committed - teamInLp, "junior residual != commit minus LP-consumed tokens");
        assertGt(teamInLp, 0, "test did not actually deploy junior tokens into the LP");
    }

    // ── AUDIT M1: only the constructor-bound team may commit + activate (no front-run hijack) ──
    function test_commitTeam_onlyBoundTeam() public {
        MockYieldAdapter a = new MockYieldAdapter(address(usdc));
        MintwareTreasuryVault v = new MintwareTreasuryVault(address(usdc), address(team), address(a), owner, teamAddr);

        // A stranger front-running commitTeam reverts.
        address stranger = makeAddr("stranger");
        team.mint(stranger, TEAM_COMMIT);
        vm.startPrank(stranger);
        team.approve(address(v), type(uint256).max);
        vm.expectRevert(MintwareTreasuryVault.OnlyTeam.selector);
        v.commitTeam(TEAM_COMMIT, 0, LOCK_DUR);
        vm.stopPrank();

        // The bound team succeeds.
        team.mint(teamAddr, TEAM_COMMIT);
        vm.startPrank(teamAddr);
        team.approve(address(v), type(uint256).max);
        v.commitTeam(TEAM_COMMIT, 0, LOCK_DUR);
        vm.stopPrank();
        assertTrue(v.activated(), "bound team could not activate");
        assertEq(v.team(), teamAddr, "team is not the bound address");
    }

    // ── AUDIT H3: while the senior is underwater (LP can't cover the deployed par and no senior has
    //    redeemed to unwind it), redeemJunior HOLDS BACK the first-loss capital (ETH stake + junior USDC
    //    buffer) to backstop the senior. The team cannot pull its first-loss out from under a stranded
    //    senior. (Protected fees still flow; here none have accrued.)
    function test_redeemJunior_holds_firstLoss_while_senior_underwater() public {
        uint256 buffer = 5_000 * ONE_USDC;
        (MintwareTreasuryVault v, MockLiquidityModule m,) = _newVault(INIT_PRICE, buffer);
        address u = makeAddr("h3user");
        usdc.mint(u, 100_000 * ONE_USDC);
        vm.startPrank(u);
        usdc.approve(address(v), type(uint256).max);
        v.depositUSDC(100_000 * ONE_USDC, 0, u);
        vm.stopPrank();

        // Deploy a slice, then crash the pool to ~0 so recoverableUSDC() << deployedFromSenior —
        // senior underwater, and crucially NO senior redemption has unwound the LP yet.
        vm.prank(owner);
        v.setIdleBufferTarget(5_000);
        uint256 jt = v.juniorTokens();
        vm.prank(owner);
        v.deployToLP(50_000 * ONE_USDC, jt);
        m.setPrice(1);
        assertLt(m.recoverableUSDC(), v.deployedFromSenior(), "test did not put the senior underwater");

        vm.warp(vm.getBlockTimestamp() + LOCK_DUR + 1);

        uint256 bufBefore  = v.juniorUsdcBuffer();
        uint256 tokBefore  = v.juniorTokens();
        uint256 teamTokBefore = team.balanceOf(teamAddr);
        vm.prank(teamAddr);
        v.redeemJunior();

        assertEq(v.juniorUsdcBuffer(), bufBefore, "junior USDC buffer released while senior underwater");
        assertEq(v.juniorTokens(), tokBefore, "junior ETH released while senior underwater");
        assertEq(team.balanceOf(teamAddr), teamTokBefore, "team pulled first-loss ETH while senior underwater");
    }

    // ── the senior is NEVER settled below par: burnForPayment reverts rather than underpay ─
    //    when the junior is wiped (the tail the invariant run deliberately excludes from its band).
    //    The constant-product mock makes this REAL: crashing the mark to ~0 rotates the LP position
    //    almost entirely into the worthless team token, so `recoverableUSDC()` collapses far below the
    //    deployed senior par. We additionally drain the Aave adapter so the senior claim cannot be
    //    honored from any source; the settlement then reverts (never pays a partial amount below par).

    function test_burnForPayment_reverts_not_underpays_when_junior_wiped() public {
        // Fresh vault so we can exhaust its yield sources in isolation.
        (MintwareTreasuryVault v, MockLiquidityModule m, MockYieldAdapter a) = _newVault(INIT_PRICE);
        address u = makeAddr("payUser");
        usdc.mint(u, 100_000 * ONE_USDC);
        vm.prank(u);
        usdc.approve(address(v), type(uint256).max);
        vm.prank(u);
        v.depositUSDC(100_000 * ONE_USDC, 0, u);

        // Allow a large LP slice, deploy it, then crash the pool to ~0 (junior wiped).
        vm.prank(owner);
        v.setIdleBufferTarget(5_000); // 50% floor → deploy up to 50%
        uint256 jt = v.juniorTokens();
        vm.prank(owner);
        v.deployToLP(50_000 * ONE_USDC, jt);
        m.setPrice(1); // pool value ~0

        // Exhaust BOTH yield sources: drain the Aave adapter AND the LP module of their USDC, so the
        // senior claim (still backed by `deployedFromSenior` par) cannot be honored on-chain. (Reads
        // are lifted out of the transfer args — an arg-call would consume the vm.prank.)
        uint256 adapterBal = usdc.balanceOf(address(a));
        vm.prank(address(a));
        usdc.transfer(address(0xdead), adapterBal);
        uint256 moduleBal = usdc.balanceOf(address(m));
        vm.prank(address(m));
        usdc.transfer(address(0xdead), moduleBal);

        uint256 shares = v.seniorShares(u);
        uint256 rcvBefore = usdc.balanceOf(receiver);
        // The Gateway settlement MUST revert — the senior is never paid a partial amount below par.
        vm.prank(gateway);
        vm.expectRevert();
        v.burnForPayment(u, shares, receiver);
        assertEq(usdc.balanceOf(receiver), rcvBefore, "receiver was paid despite exhausted backing");
    }

    // ── junior USDC buffer (Case B): stable first-loss coverage ─────────────────────

    /// The junior USDC buffer is EXCLUDED from the senior claim — committing it never inflates the
    /// senior NAV, and a senior can never redeem it.
    function test_junior_usdc_excluded_from_senior_nav() public {
        (MintwareTreasuryVault v,,) = _newVault(INIT_PRICE, 40_000 * ONE_USDC);
        address u = makeAddr("junU1");
        usdc.mint(u, 100_000 * ONE_USDC);
        vm.startPrank(u);
        usdc.approve(address(v), type(uint256).max);
        uint256 sh = v.depositUSDC(100_000 * ONE_USDC, 0, u);
        vm.stopPrank();

        assertEq(v.juniorUsdcBuffer(), 40_000 * ONE_USDC, "buffer not held");
        assertEq(v.totalSeniorAssets(), 100_000 * ONE_USDC, "buffer leaked into senior NAV");

        vm.prank(u);
        uint256 out = v.redeemSenior(sh, 0);
        assertApproxEqAbs(out, 100_000 * ONE_USDC, 2, "senior redeemed more/less than par");
        assertEq(v.juniorUsdcBuffer(), 40_000 * ONE_USDC, "senior touched the junior buffer");
    }

    /// The buffer ABSORBS a senior shortfall: after IL leaves Aave + LP short, the stable buffer tops
    /// up so the senior is paid full par, and the buffer decrements by the loss it covered.
    function test_junior_usdc_absorbs_senior_shortfall() public {
        (MintwareTreasuryVault v, MockLiquidityModule m,) = _newVault(INIT_PRICE, 30_000 * ONE_USDC);
        address u = makeAddr("junU2");
        usdc.mint(u, 100_000 * ONE_USDC);
        vm.startPrank(u);
        usdc.approve(address(v), type(uint256).max);
        v.depositUSDC(100_000 * ONE_USDC, 0, u);
        vm.stopPrank();

        // Deploy a 50% LP slice, then crash the mark to 10% — deep enough that the LP's recoverable
        // value falls BELOW the deployed par (a ~100k position marks to ~2·sqrt(0.1)·50k ≈ 31.6k),
        // so Aave + LP-unwind genuinely can't make the senior whole and the buffer must cover the gap.
        vm.prank(owner);
        v.setIdleBufferTarget(5_000);
        uint256 jt = v.juniorTokens();
        vm.prank(owner);
        v.deployToLP(50_000 * ONE_USDC, jt);
        m.setPrice(INIT_PRICE / 10);

        uint256 bufBefore = v.juniorUsdcBuffer();
        uint256 shares = v.seniorShares(u);

        // Aave (50k) + IL-reduced LP unwind fall short of full par; the buffer covers the gap.
        vm.prank(u);
        uint256 out = v.redeemSenior(shares, 0);

        assertApproxEqAbs(out, 100_000 * ONE_USDC, 5, "senior not made whole at par");
        assertLt(v.juniorUsdcBuffer(), bufBefore, "buffer did not absorb the shortfall");
        assertLe(
            v.deployedFromSenior(),
            m.recoverableUSDC() + v.juniorUsdcBuffer() + 1_000,
            "solvency invariant broke after the draw"
        );
    }

    /// Past the WHOLE junior stack (LP + USDC buffer) the senior is STILL never underpaid — it reverts.
    function test_senior_reverts_when_buffer_also_exhausted() public {
        (MintwareTreasuryVault v, MockLiquidityModule m, MockYieldAdapter a) =
            _newVault(INIT_PRICE, 1_000 * ONE_USDC);
        address u = makeAddr("junU3");
        usdc.mint(u, 100_000 * ONE_USDC);
        vm.startPrank(u);
        usdc.approve(address(v), type(uint256).max);
        v.depositUSDC(100_000 * ONE_USDC, 0, u);
        vm.stopPrank();

        vm.prank(owner);
        v.setIdleBufferTarget(5_000);
        uint256 jt = v.juniorTokens();
        vm.prank(owner);
        v.deployToLP(50_000 * ONE_USDC, jt);
        m.setPrice(1); // wipe the LP

        // Drain Aave so nothing but the tiny $1k buffer is left — still not enough for full par.
        uint256 adapterBal = usdc.balanceOf(address(a));
        vm.prank(address(a));
        usdc.transfer(address(0xdead), adapterBal);

        uint256 shares = v.seniorShares(u);
        uint256 rcvBefore = usdc.balanceOf(receiver);
        vm.prank(gateway);
        vm.expectRevert();
        v.burnForPayment(u, shares, receiver);
        assertEq(usdc.balanceOf(receiver), rcvBefore, "receiver paid despite exhausted junior stack");
        assertEq(v.juniorUsdcBuffer(), 1_000 * ONE_USDC, "buffer not restored on revert");
    }

    /// Unused buffer is returned to the team at unlock (first-loss payoff: team keeps what it didn't lose).
    function test_junior_usdc_returned_at_unlock_if_unused() public {
        (MintwareTreasuryVault v,,) = _newVault(INIT_PRICE, 25_000 * ONE_USDC);
        vm.warp(vm.getBlockTimestamp() + LOCK_DUR + 1);
        uint256 teamUsdcBefore = usdc.balanceOf(teamAddr);
        vm.prank(teamAddr);
        v.redeemJunior();
        assertEq(usdc.balanceOf(teamAddr) - teamUsdcBefore, 25_000 * ONE_USDC, "unused buffer not returned");
        assertEq(v.juniorUsdcBuffer(), 0, "buffer not cleared");
    }

    // ── access control ─────────────────────────────────────────────────────────────

    function test_only_gateway_burns() public {
        vm.expectRevert(MintwareTreasuryVault.OnlyGateway.selector);
        vault.burnForPayment(alice, 1, receiver); // caller is the test, not the gateway
    }

    function test_only_team_redeems_junior() public {
        vm.warp(vm.getBlockTimestamp() + LOCK_DUR + 1); // even post-cliff, only the team may redeem
        vm.expectRevert(MintwareTreasuryVault.OnlyTeam.selector);
        vm.prank(alice);
        vault.redeemJunior();
    }

    function test_lock_cliff_enforced() public {
        // before the cliff → StillLocked.
        vm.prank(teamAddr);
        vm.expectRevert(MintwareTreasuryVault.StillLocked.selector);
        vault.redeemJunior();

        // one second before expiry → still StillLocked.
        vm.warp(vault.lockExpiry() - 1);
        vm.prank(teamAddr);
        vm.expectRevert(MintwareTreasuryVault.StillLocked.selector);
        vault.redeemJunior();

        // at exactly expiry the `< lockExpiry` guard clears → succeeds.
        vm.warp(vault.lockExpiry());
        vm.prank(teamAddr);
        vault.redeemJunior();
    }

    // ── fee routing: 100% to senior during the lock ────────────────────────────────

    function test_fees_100pct_to_senior_during_lock() public {
        uint256 jt = vault.juniorTokens();
        vm.prank(owner);
        vault.deployToLP(20_000 * ONE_USDC, jt);

        uint256 fee = 1_000 * ONE_USDC;
        module.addFees(fee);

        uint256 seniorBefore = vault.totalSeniorAssets();
        assertTrue(vault.teamFeesRedirected(), "expected fees redirected while locked");

        vm.prank(owner);
        vault.accrueFees();

        assertEq(vault.reservedJuniorUSDC(), 0, "junior reserved cash during lock (should be 0)");
        assertEq(
            vault.totalSeniorAssets() - seniorBefore,
            fee,
            "100% of fees did not lift the senior NAV during lock"
        );
    }

    // ── fee routing: 60/30/10 once the junior tranche is released ───────────────────

    function test_fees_split_60_30_10_post_lock() public {
        uint256 jt = vault.juniorTokens();
        vm.prank(owner);
        vault.deployToLP(20_000 * ONE_USDC, jt);

        // Release the junior post-cliff → flips `teamFeesRedirected` false, activating the split.
        vm.warp(vault.lockExpiry() + 1);
        vm.prank(teamAddr);
        vault.redeemJunior();
        assertFalse(vault.teamFeesRedirected(), "fees still redirected after junior release");

        uint256 fee = 1_000 * ONE_USDC;
        module.addFees(fee);

        uint256 seniorBefore  = vault.totalSeniorAssets();
        uint256 protoBefore   = usdc.balanceOf(protocol);
        uint256 reservedBefore = vault.reservedJuniorUSDC();

        vm.prank(owner);
        vault.accrueFees();

        assertEq(vault.reservedJuniorUSDC() - reservedBefore, 300 * ONE_USDC, "team cut != 30%");
        assertEq(usdc.balanceOf(protocol) - protoBefore, 100 * ONE_USDC, "protocol cut != 10%");
        assertEq(vault.totalSeniorAssets() - seniorBefore, 600 * ONE_USDC, "community cut != 60%");
    }

    // ── governance bounds on the idle-buffer target ────────────────────────────────

    function test_idle_target_bounds() public {
        vm.startPrank(owner);

        vm.expectRevert(MintwareTreasuryVault.BadParam.selector);
        vault.setIdleBufferTarget(4_999); // < MIN 5000

        vm.expectRevert(MintwareTreasuryVault.BadParam.selector);
        vault.setIdleBufferTarget(9_501); // > MAX 9500

        vault.setIdleBufferTarget(5_000); // MIN inclusive
        assertEq(vault.idleBufferTargetBps(), 5_000);
        vault.setIdleBufferTarget(9_500); // MAX inclusive
        assertEq(vault.idleBufferTargetBps(), 9_500);
        vault.setIdleBufferTarget(7_000);
        assertEq(vault.idleBufferTargetBps(), 7_000);

        vm.stopPrank();
    }
}
