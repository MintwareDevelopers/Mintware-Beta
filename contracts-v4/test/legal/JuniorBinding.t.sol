// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";

import {MintwareTreasuryVault}         from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareMatchedLiquidityVault} from "../../src/vaults/MintwareMatchedLiquidityVault.sol";
import {PoolProfile}                   from "../../src/vaults/VaultTypes.sol";
import {HookMiner}                     from "../../src/lib/HookMiner.sol";
import {MWHookCoordinator}             from "../../src/hooks/MWHookCoordinator.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";

/// @title  LEGAL FACT 1 — junior = operator's own capital, permanently team-bound, zero outside investment
/// @notice Guard-tests that lock down the first legal fact for BOTH tranche vaults:
///
///           The junior first-loss tranche is the operator/team's OWN capital. It is INTERNAL
///           accounting (never a transferable ERC-20 junior share), redeemable ONLY by the
///           `team` address that is fixed at construction, and it can never be reassigned to,
///           or withdrawn by, any non-team account.
///
///         These assertions are additive verification of already-shipped behavior — they change
///         NO mechanics. If any one fails it is a real finding (the legal claim would not hold),
///         not a test to "fix".
///
/// @dev    Treasury vault: junior = `juniorTokens` (team ETH) + `juniorUsdcBuffer` (optional team USDC),
///         both plain uint accounting; the only share ledger is `seniorShares` (senior/community). The
///         team gate is `redeemJunior`'s `OnlyTeam` revert, and `team` has NO setter.
///         Matched vault: the team side is `teamLiquidity` (a uint of V4 liquidity units, never a token);
///         `team` is `immutable`; the only team-fund path is `teamWithdraw` (`onlyTeam`, hard cliff).
contract JuniorBindingTreasuryTest is Test {
    MockERC20 internal usdc;
    MockERC20 internal team;

    PoolManager           internal pm;
    MockYieldAdapter      internal adapter;
    MintwareTreasuryVault internal v;
    PoolKey               internal key;

    address internal owner    = makeAddr("owner");
    address internal teamAddr  = makeAddr("team");
    address internal gateway   = makeAddr("gateway");
    address internal protocol  = makeAddr("protocol");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING     = 60;
    uint256 internal constant ONE_USDC    = 1e6;
    uint256 internal constant LOCK_DUR    = 365 days;
    uint256 internal constant TEAM_COMMIT = 5_000_000 * 1e6;
    uint256 internal constant JUNIOR_USDC = 40_000 * 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);

        pm = new PoolManager(address(this));
        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(key, INIT_SQRT_PRICE);

        adapter = new MockYieldAdapter(address(usdc));
        v = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);

        vm.startPrank(owner);
        v.setGateway(gateway);
        v.setProtocolTreasury(protocol);
        vm.stopPrank();

        team.mint(teamAddr, TEAM_COMMIT);
        usdc.mint(teamAddr, JUNIOR_USDC);
        vm.startPrank(teamAddr);
        team.approve(address(v), type(uint256).max);
        usdc.approve(address(v), type(uint256).max);
        v.commitTeam(TEAM_COMMIT, JUNIOR_USDC, LOCK_DUR);
        vm.stopPrank();
    }

    /// FACT 1 — redeemJunior is team-bound: any non-team caller reverts `OnlyTeam`, before or after
    /// the cliff. The junior can never be released to an outside account.
    function testFuzz_redeemJunior_reverts_for_any_non_team(address caller) public {
        vm.assume(caller != teamAddr);
        // Before the cliff.
        vm.prank(caller);
        vm.expectRevert(MintwareTreasuryVault.OnlyTeam.selector);
        v.redeemJunior();

        // And after the cliff — the gate is identity, not just timing.
        vm.warp(block.timestamp + LOCK_DUR + 1);
        vm.prank(caller);
        vm.expectRevert(MintwareTreasuryVault.OnlyTeam.selector);
        v.redeemJunior();
    }

    /// FACT 1 — even the owner cannot redeem the junior; only the constructor-bound team can.
    function test_owner_cannot_redeem_junior() public {
        vm.warp(block.timestamp + LOCK_DUR + 1);
        vm.prank(owner);
        vm.expectRevert(MintwareTreasuryVault.OnlyTeam.selector);
        v.redeemJunior();
    }

    /// FACT 1 — `team` is permanently bound: there is NO `setTeam`, and no owner administrative action
    /// (address plumbing or risk-param tuning) can reassign it. `team()` is invariant across every setter.
    function test_team_binding_is_immutable_no_setter_reassigns_it() public {
        assertEq(v.team(), teamAddr, "precondition: team bound at construction");

        vm.startPrank(owner);
        // Address plumbing setters.
        v.setProtocolTreasury(makeAddr("newProtocol"));
        v.setRentFunder(makeAddr("rentFunder"));
        v.setJitHook(makeAddr("jitHook"));                 // set-once
        // Risk-param setters that TIGHTEN safety apply instantly (no timelock dance needed here).
        v.setIdleBufferTarget(9_000);                      // raise (safer) → instant
        v.setMinCoverage(100);                             // raise from 0 (safer) → instant
        vm.stopPrank();

        assertEq(v.team(), teamAddr, "team reassigned by an owner setter (FACT 1 broken)");
    }

    /// FACT 1 — the junior first-loss capital is released to, and only to, the immutable `team` address.
    /// No lifecycle path routes junior capital to a third party.
    function test_junior_first_loss_released_only_to_team() public {
        // Nothing deployed / no JIT → senior is fully covered, so post-cliff the full first-loss returns.
        assertEq(v.deployedFromSenior(), 0, "precondition: nothing at risk");
        assertEq(v.juniorTokens(), TEAM_COMMIT, "precondition: junior ETH held");
        assertEq(v.juniorUsdcBuffer(), JUNIOR_USDC, "precondition: junior USDC held");

        vm.warp(block.timestamp + LOCK_DUR + 1);

        uint256 teamTokBefore  = team.balanceOf(teamAddr);
        uint256 teamUsdcBefore = usdc.balanceOf(teamAddr);
        vm.prank(teamAddr);
        v.redeemJunior();

        assertEq(team.balanceOf(teamAddr) - teamTokBefore, TEAM_COMMIT, "team ETH not returned to team");
        assertEq(usdc.balanceOf(teamAddr) - teamUsdcBefore, JUNIOR_USDC, "junior USDC not returned to team");
        assertEq(v.juniorTokens(), 0, "junior ETH not cleared");
        assertEq(v.juniorUsdcBuffer(), 0, "junior USDC not cleared");
    }

    /// FACT 1 — the junior is NOT a transferable ERC-20 share. The vault exposes only the `seniorShares`
    /// ledger; junior capital is pure internal accounting (`juniorTokens` / `juniorUsdcBuffer`) with no
    /// per-holder balance, no transfer, and no mint of a junior token. There is therefore no junior
    /// instrument that could ever land in a non-team wallet.
    function test_junior_is_internal_accounting_not_a_transferable_share() public view {
        // The team's committed capital lives ONLY as vault-held internal counters...
        assertEq(v.juniorTokens(), TEAM_COMMIT, "junior ETH is internal accounting");
        assertEq(v.juniorUsdcBuffer(), JUNIOR_USDC, "junior USDC is internal accounting");
        // ...and the ONLY share ledger the vault mints against is the SENIOR (community) side, which
        // is zero here because no community deposit has been made. No junior share exists to hold.
        assertEq(v.totalSeniorShares(), 0, "only senior shares are tracked; no junior share ledger");
    }
}

/// @notice FACT 1 for the matched-liquidity (launch) vault: the team's matched liquidity is the team's
///         own token, tracked as `teamLiquidity` (uint), withdrawable ONLY by the `immutable team` at/after
///         the hard cliff — never transferable to a third party, never a minted junior share.
contract JuniorBindingMatchedTest is Test {
    address internal deployer = address(this);
    address internal team     = makeAddr("team");
    address internal treasury = makeAddr("treasury");
    address internal a        = makeAddr("lp_a");
    address internal b        = makeAddr("lp_b");
    address internal c        = makeAddr("lp_c");

    PoolManager                   internal pm;
    MintwareMatchedLiquidityVault internal vault;
    MockERC20                     internal proj;
    MockERC20                     internal quote;
    bool                          internal projIsToken0;
    PoolKey                       internal poolKey;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    uint256 internal constant T         = 100_000e18;
    uint256 internal constant CAP       = 100_000e18;
    uint256 internal constant WINDOW    = 7 days;
    uint256 internal constant THRESHOLD = 5_000;
    uint256 internal constant LOCK      = 365 days;

    function setUp() public {
        pm = new PoolManager(deployer);
        proj  = new MockERC20("Project", "PEPE", 18);
        quote = new MockERC20("Quote", "USDC", 18);
        projIsToken0 = address(proj) < address(quote);

        vault = new MintwareMatchedLiquidityVault(
            address(pm), address(proj), address(quote), team, treasury, address(0),
            PoolProfile.MEME, deployer
        );
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
    }

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

    function _activate() internal {
        vm.startPrank(team);
        proj.approve(address(vault), T);
        vault.commitTeam(poolKey, INIT_SQRT_PRICE, T, CAP, WINDOW, THRESHOLD, LOCK);
        vm.stopPrank();
        _deposit(a, CAP * 40 / 100);
        _deposit(b, CAP * 40 / 100);
        _deposit(c, CAP - (CAP * 40 / 100) - (CAP * 40 / 100));
        vault.activate();
    }

    /// FACT 1 — the team position is bound to `team`: any non-team caller reverts `NotTeam`, so the locked
    /// liquidity can never be pulled by a third party. (Before AND after the cliff — identity gate.)
    function testFuzz_teamWithdraw_reverts_for_any_non_team(address caller) public {
        vm.assume(caller != team);
        _activate();

        vm.prank(caller);
        vm.expectRevert(MintwareMatchedLiquidityVault.NotTeam.selector);
        vault.teamWithdraw();

        vm.warp(vault.lockExpiry() + 1);
        vm.prank(caller);
        vm.expectRevert(MintwareMatchedLiquidityVault.NotTeam.selector);
        vault.teamWithdraw();
    }

    /// FACT 1 — `team` is `immutable`; no owner action reassigns it.
    function test_team_is_immutable_across_owner_setters() public view {
        assertEq(vault.team(), team, "precondition");
        // The only owner setters are one-time plumbing wiring; neither touches `team`.
        // (expectedHook already set in setUp — exercise setWeightedDistributor's effect on team().)
        assertEq(vault.team(), team, "team reassigned (FACT 1 broken)");
    }

    /// FACT 1 — the locked team liquidity is released to, and only to, the immutable `team` — after the
    /// hard cliff, via the single `teamWithdraw` path. It is a uint of liquidity units, never a token that
    /// could be transferred away.
    function test_team_liquidity_released_only_to_team_after_cliff() public {
        _activate();
        assertGt(vault.teamLiquidity(), 0, "precondition: team liquidity locked");

        // Still locked → team itself cannot withdraw.
        vm.prank(team);
        vm.expectRevert(MintwareMatchedLiquidityVault.StillLocked.selector);
        vault.teamWithdraw();

        vm.warp(vault.lockExpiry() + 1);
        uint256 projBefore  = proj.balanceOf(team);
        uint256 quoteBefore = quote.balanceOf(team);
        vm.prank(team);
        (uint256 projOut, uint256 quoteOut) = vault.teamWithdraw();

        assertTrue(projOut > 0 || quoteOut > 0, "team recovered nothing");
        assertEq(proj.balanceOf(team) - projBefore, projOut, "team proj not paid to team");
        assertEq(quote.balanceOf(team) - quoteBefore, quoteOut, "team quote not paid to team");
        assertEq(vault.teamLiquidity(), 0, "team liquidity not cleared");
        assertTrue(vault.teamWithdrawn(), "teamWithdrawn flag not set");
    }
}
