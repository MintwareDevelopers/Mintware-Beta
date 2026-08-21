// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test}         from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {PoolManager}             from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}            from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                  from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}                 from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}                from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams}   from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}                from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareTreasuryVault} from "../../../src/payments/MintwareTreasuryVault.sol";
import {MockERC20}             from "../../mocks/MockERC20.sol";
import {MockYieldAdapter}      from "../../mocks/MockYieldAdapter.sol";

/// @notice GROUP D (D3) — idle↔active conservation under rebalance, on a REAL Uniswap-V4 pool. The
///         existing gate suite fuzzes `deployToLP`/`recoverFromLP` but asserts coverage BOUNDS, never that
///         a deploy→recover ROUND-TRIP is par-lossless. This suite proves the exact seam the roundtable
///         flagged (research Flag ①): `MWTreasuryPositionLib.recover` L115 —
///           `lrem = FullMath.mulDiv(liq, give, rec)`  (Floor)
///         the closest structural analog to the Bunni site (a `mulDiv` of a share-of-reserve at a rounding
///         boundary). The floor removes ≤ the liquidity needed, so `recover` returns ≤ what was asked and
///         `deployedFromSenior` is only ever written DOWN by real recovered value — it can NEVER be
///         silently written UP. This suite proves that flooring can't COMPOUND senior value out over
///         repeated deploy→recover cycles.
///
///         Assertions (all one-sided + DUST-tolerant so real-pool integer rounding + the seniority swap's
///         fee/slippage don't false-trip):
///           • D3a no-inflation ceiling — senior NAV never exceeds the senior-eligible capital ever in
///             (deposits + yield + junior first-loss USDC). The Bunni direction: value cannot be MINTED at
///             the idle↔active seam across arbitrary deploy/recover sequences.
///           • D3b solvency through the seam — `deployedFromSenior ≤ recoverableUSDC() + juniorUsdcBuffer`.
///           • D3c round-trip not inflating — around each atomic deploy→recover at a flat mark, senior NAV
///             after ≤ before (+DUST): a round-trip never manufactures senior value.
///           • D3d USDC conservation — nothing fabricated in the closed system.
///
///         Mark is FLAT: the only price movement is `recover`'s own oracle-bounded team→USDC seniority
///         swap on a fee-0 pool (kept tiny by deep baseline liquidity), so this isolates ROUNDING, not
///         price risk (price stress lives in the gate suite). The `TEETH_WEI` switch models an unaccounted
///         senior write-up appearing at the seam — the observable a wrong-way (Ceil) L115 rounding would
///         produce on the senior ledger; flipping it on makes D3c FAIL directly (and D3a once the injected
///         value outruns the redemption slack in the cumulative ceiling — see report). A literal L115
///         mutation is out of scope (no `src/` edits), so the teeth injects the same observable at the seam.
contract TreasuryRebalanceHandler is Test {
    // ── TEETH SWITCH ────────────────────────────────────────────────────────────────
    // 0 (committed) = faithful flow. >0 (teeth only) = model an unaccounted senior write-up of this many
    // USDC wei appearing at the deploy→recover seam (the observable of a wrong-way L115 rounding). Proven
    // to trip D3c (round-trip) directly — see report.
    uint256 internal constant TEETH_WEI = 0;

    uint16  internal constant BPS  = 10_000;
    uint256 internal constant DUST = 100_000; // 0.1 USDC — absorbs real-pool integer rounding + swap wobble

    MintwareTreasuryVault public vault;
    MockYieldAdapter      public adapter;
    MockERC20             public usdc;
    MockERC20             public team;
    address               public owner;
    address[]             public actors;

    // ── conservation / property ghosts ────────────────────────────────────────────────
    uint256 public gSeniorInCeiling; // senior-eligible capital ever available (deposits + yield + junior USDC)
    uint256 public gYield;
    bool    public roundTripInflated; // a deploy→recover round-trip manufactured senior NAV

    // ── non-vacuity witnesses ─────────────────────────────────────────────────────────
    uint256 public nDeploys;
    uint256 public nRecovers;
    uint256 public nRoundTrips; // atomic deploy→recover pairs completed

    struct Cfg {
        MintwareTreasuryVault vault;
        MockYieldAdapter adapter;
        MockERC20 usdc;
        MockERC20 team;
        address owner;
        address[] actors;
        uint256 ceilingSeed; // setUp senior deposits + initial junior USDC buffer
    }

    constructor(Cfg memory c) {
        vault = c.vault; adapter = c.adapter; usdc = c.usdc; team = c.team;
        owner = c.owner; actors = c.actors; gSeniorInCeiling = c.ceilingSeed;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    /// @dev The largest deploy that respects the idle-first guard; 0 if none fits (mirrors the contract).
    function _deployRoom() internal view returns (uint256) {
        uint256 base    = vault.totalSeniorAssets();
        uint256 minIdle = (base * vault.idleBufferTargetBps() + BPS - 1) / BPS; // ceil, matches the guard
        uint256 dep     = vault.deployedFromSenior();
        if (base <= minIdle || dep >= base - minIdle) return 0;
        return base - minIdle - dep;
    }

    function seniorDeposit(uint256 aSeed, uint256 amtSeed) public {
        address a = _actor(aSeed);
        uint256 amt = bound(amtSeed, 1_000_000, 500_000_000_000);
        vm.prank(a);
        try vault.depositUSDC(amt, 0, a) returns (uint256) { gSeniorInCeiling += amt; } catch {}
    }

    function seniorRedeem(uint256 aSeed, uint256 shareSeed) public {
        address a = _actor(aSeed);
        uint256 bal = vault.seniorShares(a);
        if (bal == 0) return;
        uint256 s = bound(shareSeed, 1, bal);
        vm.prank(a);
        try vault.redeemSenior(s, 0) returns (uint256) {} catch {}
    }

    function deployToLP(uint256 seed) public {
        uint256 room = _deployRoom();
        if (room < 1_000_000) return;
        uint256 amt = bound(seed, 1_000_000, room);
        uint256 maxTeam = vault.juniorTokens(); // read BEFORE the prank (arg eval would consume it)
        vm.prank(owner);
        try vault.deployToLP(amt, maxTeam) { nDeploys++; } catch {}
    }

    function recoverFromLP(uint256 seed) public {
        uint256 dep = vault.deployedFromSenior();
        if (dep == 0) return;
        uint256 amt = bound(seed, 1, dep);
        vm.prank(owner);
        try vault.recoverFromLP(amt) { nRecovers++; } catch {}
    }

    /// THE D3 CORE: an atomic deploy→recover at a flat mark. Proves the round-trip returns senior par to
    /// its prior value without manufacturing senior NAV (any seniority-swap slippage is charged to junior).
    function roundTrip(uint256 seed) public {
        uint256 room = _deployRoom();
        if (room < 1_000_000) return;
        uint256 amt = bound(seed, 1_000_000, room);

        uint256 navBefore = vault.totalSeniorAssets();
        uint256 depBefore = vault.deployedFromSenior();
        uint256 maxTeam = vault.juniorTokens(); // read BEFORE the prank (arg eval would consume it)
        vm.prank(owner);
        try vault.deployToLP(amt, maxTeam) { nDeploys++; } catch { return; }

        uint256 added = vault.deployedFromSenior() - depBefore;

        // TEETH: model an unaccounted senior write-up surfacing at the seam (wrong-way L115 observable).
        if (TEETH_WEI > 0) usdc.mint(address(vault), TEETH_WEI);

        if (added > 0) {
            vm.prank(owner);
            try vault.recoverFromLP(added) { nRecovers++; } catch {}
        }
        nRoundTrips++;

        uint256 navAfter = vault.totalSeniorAssets();
        if (navAfter > navBefore + DUST) roundTripInflated = true; // senior value cannot be created here
    }

    function aaveYield(uint256 seed) public {
        uint256 amt = bound(seed, 1_000_000, 50_000_000_000);
        usdc.mint(address(adapter), amt);
        gYield += amt;
        gSeniorInCeiling += amt;
    }

    function warp(uint256 seed) public {
        vm.warp(block.timestamp + bound(seed, 1 hours, 2 days));
    }
}

/// @notice D3 — deploy→recover seam conservation for `MintwareTreasuryVault` against a REAL fee-0 V4 pool.
contract TreasuryRebalanceSeamInvariantTest is StdInvariant, Test {
    uint256 internal constant DUST = 100_000; // must match the handler

    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;

    MintwareTreasuryVault internal vault;
    MockYieldAdapter      internal adapter;
    MockERC20             internal usdc;
    MockERC20             internal team;
    TreasuryRebalanceHandler internal handler;
    PoolKey               internal key;

    address internal owner    = makeAddr("owner");
    address internal teamAddr  = makeAddr("team");
    address[] internal actors;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant LOCK_DUR = 365 days;
    uint256 internal constant JUNIOR_USDC_SEED = 50_000_000_000; // $50k first-loss buffer

    uint256 internal minted;
    uint256 internal ceilingSeed;

    function _mint(address to, uint256 amt) internal { usdc.mint(to, amt); minted += amt; }

    function setUp() public {
        pm       = new PoolManager(address(this));
        lpRouter = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);
        adapter = new MockYieldAdapter(address(usdc));

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        // Fee-0, hookless pool: isolates the deploy/recover ROUNDING (no fee drag, no JIT hook). A flat mark
        // means the only price motion is recover's own oracle-bounded team→USDC swap.
        key = PoolKey({currency0: c0, currency1: c1, fee: 0, tickSpacing: SPACING, hooks: IHooks(address(0))});

        vault = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);
        pm.initialize(key, INIT_SQRT_PRICE);

        // team commits the junior reserve (token + stable USDC first-loss) and opens the vault.
        team.mint(teamAddr, 5_000_000e6);
        _mint(teamAddr, JUNIOR_USDC_SEED);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(5_000_000e6, JUNIOR_USDC_SEED, LOCK_DUR);
        vm.stopPrank();
        ceilingSeed = JUNIOR_USDC_SEED; // junior first-loss USDC can legitimately back the senior

        // deep baseline pool liquidity so the vault's seniority swaps barely move the mark.
        _mint(address(this), 50_000_000e6);
        team.mint(address(this), 50_000_000e6);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 40_000_000 * int256(uint256(1e6)), salt: bytes32(0)}),
            ""
        );

        // four community actors funded + approved; seed deposits so there is senior capital from block 0.
        actors = new address[](4);
        for (uint256 i; i < 4; ++i) {
            address a = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors[i] = a;
            _mint(a, 1e30);
            vm.prank(a);
            usdc.approve(address(vault), type(uint256).max);
            vm.prank(a);
            vault.depositUSDC(100_000_000_000, 0, a); // $100k each
            ceilingSeed += 100_000_000_000;
        }

        handler = new TreasuryRebalanceHandler(TreasuryRebalanceHandler.Cfg({
            vault: vault, adapter: adapter, usdc: usdc, team: team, owner: owner, actors: actors,
            ceilingSeed: ceilingSeed
        }));

        bytes4[] memory sels = new bytes4[](6);
        sels[0] = TreasuryRebalanceHandler.seniorDeposit.selector;
        sels[1] = TreasuryRebalanceHandler.seniorRedeem.selector;
        sels[2] = TreasuryRebalanceHandler.deployToLP.selector;
        sels[3] = TreasuryRebalanceHandler.recoverFromLP.selector;
        sels[4] = TreasuryRebalanceHandler.roundTrip.selector;
        sels[5] = TreasuryRebalanceHandler.aaveYield.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
    }

    function _freeBuffer() internal view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(vault));
        uint256 r = vault.reservedJuniorUSDC() + vault.juniorUsdcBuffer() + vault.reservedProtocolUSDC();
        return bal > r ? bal - r : 0;
    }

    // ── D3a: no senior value MINTED at the idle↔active seam across arbitrary deploy/recover sequences ────
    function invariant_D3a_no_senior_inflation() public view {
        assertLe(
            vault.totalSeniorAssets(),
            handler.gSeniorInCeiling() + DUST,
            "D3a: senior NAV exceeds capital-in + yield (value minted at the deploy/recover seam)"
        );
    }

    // ── D3b: the deployed senior par stays covered by recoverable LP value + junior first-loss ───────────
    function invariant_D3b_solvency_through_seam() public view {
        assertLe(
            vault.deployedFromSenior(),
            vault.recoverableUSDC() + vault.juniorUsdcBuffer() + DUST,
            "D3b: deployed senior par exceeds recoverable LP value + junior buffer"
        );
    }

    // ── D3c: a deploy→recover round-trip never manufactures senior NAV ───────────────────────────────────
    function invariant_D3c_roundtrip_not_inflating() public view {
        assertFalse(handler.roundTripInflated(), "D3c: a deploy->recover round-trip inflated senior NAV");
    }

    // ── D3d: USDC conservation — nothing fabricated in the closed system ─────────────────────────────────
    function invariant_D3d_usdc_conserved() public view {
        assertEq(usdc.totalSupply(), minted + handler.gYield(), "D3d: USDC conservation broke");
    }

    // ── senior NAV identity holds structurally even mid-rebalance (no price term leaks in) ──────────────
    function invariant_D3_senior_price_free() public view {
        assertEq(
            vault.totalSeniorAssets(),
            adapter.totalAssets() + _freeBuffer() + vault.deployedFromSenior() + vault.jitBorrowed(),
            "senior NAV identity broke (a price term leaked into the seam)"
        );
    }

    // ── non-vacuity: the fuzz actually deployed, recovered, and completed deploy→recover round-trips ─────
    function afterInvariant() public view {
        assertGt(handler.nDeploys(), 0, "vacuous: no deployToLP executed");
        assertGt(handler.nRecovers(), 0, "vacuous: no recoverFromLP executed");
        assertGt(handler.nRoundTrips(), 0, "vacuous: no deploy->recover round-trip executed");
    }
}
