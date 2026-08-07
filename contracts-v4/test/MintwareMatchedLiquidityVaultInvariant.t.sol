// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";

import {MintwareMatchedLiquidityVault} from "../src/vaults/MintwareMatchedLiquidityVault.sol";
import {PoolProfile}                   from "../src/vaults/VaultTypes.sol";

import {MockERC20}      from "./mocks/MockERC20.sol";
import {TestSwapRouter} from "./helpers/TestSwapRouter.sol";

/// @dev Drives the vault through fuzzed sequences during the LOCKED window. Time advances but is
///      clamped to stay strictly before lockExpiry, so the "team cannot exit early" property is
///      meaningful. All actions swallow reverts (a reverted action is a no-op for the fuzzer).
contract MLVHandler is Test {
    MintwareMatchedLiquidityVault public vault;
    TestSwapRouter public router;
    MockERC20 public proj;
    MockERC20 public quote;
    PoolKey   public key;
    address[] public actors;
    address   public trader;
    address   public team;

    uint256 public lockExpiry;
    bool     public teamEverExitedEarly;
    uint256  public lastAccProj;
    uint256  public lastAccQuote;
    bool     public accEverDecreased;
    bool     public projIsToken0;

    constructor(
        MintwareMatchedLiquidityVault _vault,
        TestSwapRouter _router,
        MockERC20 _proj,
        MockERC20 _quote,
        PoolKey memory _key,
        address[] memory _actors,
        address _trader,
        address _team
    ) {
        vault = _vault;
        router = _router;
        proj = _proj;
        quote = _quote;
        key = _key;
        actors = _actors;
        trader = _trader;
        team = _team;
        lockExpiry = _vault.lockExpiry();
        projIsToken0 = address(_proj) < address(_quote);
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    function _recordAcc() internal {
        uint256 ap = vault.accProjPerShare();
        uint256 aq = vault.accQuotePerShare();
        if (ap < lastAccProj || aq < lastAccQuote) accEverDecreased = true;
        lastAccProj = ap;
        lastAccQuote = aq;
    }

    /// @notice Advance time, clamped to stay strictly before lockExpiry.
    function warp(uint256 delta) public {
        uint256 maxT = lockExpiry - 1;
        if (block.timestamp >= maxT) return;
        delta = bound(delta, 0, maxT - block.timestamp);
        vm.warp(block.timestamp + delta);
    }

    function genSwap(uint256 amt, bool dir) public {
        amt = bound(amt, 1e18, 40_000e18);
        vm.startPrank(trader);
        proj.approve(address(router), type(uint256).max);
        quote.approve(address(router), type(uint256).max);
        try router.swap(key, dir, amt) {} catch {}
        vm.stopPrank();
    }

    function collect() public {
        try vault.collectFees() {} catch {}
        _recordAcc();
    }

    function communityClaim(uint256 seed) public {
        address a = _actor(seed);
        vm.prank(a);
        try vault.claimCommunityFees() {} catch {}
        _recordAcc();
    }

    function communityRequestRedeem(uint256 seed, uint256 sharesSeed) public {
        address a = _actor(seed);
        uint256 sh = vault.communityShareOf(a);
        if (sh == 0) return;
        uint256 s = bound(sharesSeed, 1, sh);
        vm.prank(a);
        try vault.requestCommunityRedeem(s) {} catch {}
    }

    function communityExecuteRedeem(uint256 seed) public {
        address a = _actor(seed);
        vm.prank(a);
        try vault.executeCommunityRedeem() {} catch {}
        _recordAcc();
    }

    /// @notice The adversarial action: repeatedly try to pull team funds before the cliff.
    function teamTryWithdraw() public {
        vm.prank(team);
        try vault.teamWithdraw() {
            if (block.timestamp < lockExpiry) teamEverExitedEarly = true;
        } catch {}
    }

    function teamTryClaimFees() public {
        vm.prank(team);
        try vault.claimTeamFees() {} catch {}
        _recordAcc();
    }
}

/// @notice Stateful invariant tests for the matched-liquidity vault's §6 acceptance bar.
contract MintwareMatchedLiquidityVaultInvariantTest is StdInvariant, Test {
    PoolManager    internal pm;
    TestSwapRouter internal router;
    MintwareMatchedLiquidityVault internal vault;
    MLVHandler internal handler;

    MockERC20 internal proj;
    MockERC20 internal quote;
    PoolKey   internal key;

    address internal team     = makeAddr("team");
    address internal treasury = makeAddr("treasury");
    address internal trader   = makeAddr("trader");
    address internal a = makeAddr("a");
    address internal b = makeAddr("b");
    address internal c = makeAddr("c");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    uint256 internal constant T    = 100_000e18;
    uint256 internal constant CAP  = 100_000e18;
    uint256 internal constant LOCK = 365 days;

    uint128 internal initialTeamLiquidity;
    uint128 internal initialCommunityShares;

    function setUp() public {
        pm     = new PoolManager(address(this));
        router = new TestSwapRouter(IPoolManager(address(pm)));

        proj  = new MockERC20("Project", "PEPE", 18);
        quote = new MockERC20("Quote", "USDC", 18);
        (Currency c0, Currency c1) = address(proj) < address(quote)
            ? (Currency.wrap(address(proj)), Currency.wrap(address(quote)))
            : (Currency.wrap(address(quote)), Currency.wrap(address(proj)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});

        vault = new MintwareMatchedLiquidityVault(
            address(pm), address(proj), address(quote), team, treasury, address(0),
            PoolProfile.MEME, address(this)
        );

        // Commit + fund to activation (three distinct depositors → past the min-depositor floor).
        proj.mint(team, T);
        vm.startPrank(team);
        proj.approve(address(vault), T);
        vault.commitTeam(key, INIT_SQRT_PRICE, T, CAP, 7 days, 5_000, LOCK);
        vm.stopPrank();

        _fund(a, 40_000e18);
        _fund(b, 40_000e18);
        _fund(c, 20_000e18);
        vault.activate();

        initialTeamLiquidity    = vault.teamLiquidity();
        initialCommunityShares  = vault.totalCommunityShares();

        // Fund the trader for fee-generating swaps.
        proj.mint(trader, 10_000_000e18);
        quote.mint(trader, 10_000_000e18);

        address[] memory actors = new address[](3);
        actors[0] = a; actors[1] = b; actors[2] = c;
        handler = new MLVHandler(vault, router, proj, quote, key, actors, trader, team);

        // Restrict the fuzzer to the handler's action surface.
        bytes4[] memory sels = new bytes4[](7);
        sels[0] = MLVHandler.warp.selector;
        sels[1] = MLVHandler.genSwap.selector;
        sels[2] = MLVHandler.collect.selector;
        sels[3] = MLVHandler.communityClaim.selector;
        sels[4] = MLVHandler.communityRequestRedeem.selector;
        sels[5] = MLVHandler.communityExecuteRedeem.selector;
        sels[6] = MLVHandler.teamTryWithdraw.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
    }

    function _fund(address who, uint256 amt) internal {
        quote.mint(who, amt);
        vm.startPrank(who);
        quote.approve(address(vault), amt);
        vault.depositCommunity(amt);
        vm.stopPrank();
    }

    // ── invariants ───────────────────────────────────────────────────────────

    /// @notice THE core trust invariant: team funds never leave before lockExpiry, by any path.
    function invariant_team_cannot_exit_early() public view {
        assertFalse(handler.teamEverExitedEarly(), "team exited before lockExpiry");
        assertFalse(vault.teamWithdrawn(), "team withdrawn while still locked");
        assertEq(vault.teamLiquidity(), initialTeamLiquidity, "team locked liquidity mutated");
        assertTrue(block.timestamp < vault.lockExpiry(), "harness kept us in the locked window");
    }

    /// @notice Community liquidity can only shrink (redemptions) — never mint beyond activation.
    function invariant_community_shares_never_grow() public view {
        assertLe(vault.totalCommunityShares(), initialCommunityShares, "community shares grew");
    }

    /// @notice Fee accumulators are monotonic — no negative accrual / accounting corruption.
    function invariant_fee_accumulators_monotonic() public view {
        assertFalse(handler.accEverDecreased(), "a fee accumulator decreased");
    }
}
