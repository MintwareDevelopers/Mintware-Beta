// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test}         from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}          from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";

import {MintwareTreasuryVault} from "../../../src/payments/MintwareTreasuryVault.sol";
import {MockERC20}             from "../../mocks/MockERC20.sol";
import {MockYieldAdapter}      from "../../mocks/MockYieldAdapter.sol";

/// @notice GROUP C (C1) + GROUP E (E1) — ports the v1 `MintwareYieldVault` NAV-monotonic + rounding
///         probes onto `MintwareTreasuryVault` (v2), which lacked them. Bunni V2 was, at bottom, a
///         share-price-drifts-DOWN bug: chained roundings let a redeemer pull a larger fraction of the
///         active balance than the fraction of shares burned, so the price per share fell. v1 asserts
///         `navDecreased == false`; the treasury vault only argued price-freeness structurally. This
///         proves it directly.
///
///         THE TREASURY CAVEAT (why this is not a copy-paste of v1). The senior claim is
///           `totalSeniorAssets = adapter.totalAssets() + freeSeniorBuffer + deployedFromSenior + jitBorrowed`
///         and `borrowIdleForJit` moves senior USDC OUT of Aave into the JIT hook (`adapter.totalAssets`
///         falls) while crediting `jitBorrowed` at PAR (NAV is conserved by construction). But between the
///         borrow and its `settleJitReturn` the capital is out on loan — RECALLABLE, not lost. A NAIVE
///         monotonicity check that forgets `jitBorrowed` sees the borrow as a NAV drop and trips falsely.
///         The correct invariant therefore holds **at rest** (no open JIT borrow) — it never compares a
///         mid-borrow snapshot against a rest snapshot. The `TEETH_NAIVE` switch below deletes `jitBorrowed`
///         from the NAV and drops the at-rest gate; flipping it on makes C1 FAIL on the exact open-borrow
///         states this suite reaches (see the report), which is what makes the caveat handling load-bearing.
///
///         No Uniswap pool is initialized here: the deposit/redeem/burn/JIT-borrow/JIT-settle paths never
///         call the PoolManager (`positionLiquidity` stays 0, so `_pullUSDC` never unwinds LP). The
///         deploy→recover LP seam is proven separately in `TreasuryRebalanceSeamInvariant.t.sol` (D3).
contract TreasuryNavHandler is Test {
    // ── TEETH SWITCH ────────────────────────────────────────────────────────────────
    // false (committed) = the CORRECT invariant: NAV counts `jitBorrowed` at par AND the monotonicity
    //   ghost is only evaluated at rest (no open JIT borrow).
    // true  (teeth only) = the NAIVE invariant the caveat warns against: drop `jitBorrowed` from NAV and
    //   evaluate monotonicity on every state, including mid-open-borrow. Proven to FAIL — see report.
    bool internal constant TEETH_NAIVE = false;

    uint256 internal constant RAY     = 1e27;
    uint256 internal constant VIRTUAL = 1e6; // MintwareTreasuryVault.VIRTUAL

    MintwareTreasuryVault public vault;
    MockERC20             public usdc;
    MockYieldAdapter      public adapter;
    address[]             public actors;

    // ── C1 ghosts ───────────────────────────────────────────────────────────────────
    bool    public navDropped;      // senior price-per-share fell on a non-loss-injecting op
    uint256 public lastRestPps;     // last at-rest senior pps (RAY)

    // ── conservation ghost (backstop) ────────────────────────────────────────────────
    uint256 public initialMinted;
    uint256 public gYield;

    // ── non-vacuity witnesses ─────────────────────────────────────────────────────────
    uint256 public nDeposits;
    uint256 public nRedeems;
    uint256 public nBurns;
    uint256 public nJitBorrowsOpened;   // borrows that actually lent (jitBorrowed went 0 → >0)
    uint256 public nJitSettles;
    uint256 public openBorrowObservations; // times a handler op ended with jitBorrowed > 0
    bool    public sawOpenBorrow;

    constructor(MintwareTreasuryVault _vault, MockERC20 _usdc, MockYieldAdapter _adapter, address[] memory _actors, uint256 _minted) {
        vault = _vault; usdc = _usdc; adapter = _adapter; actors = _actors; initialMinted = _minted;
        lastRestPps = _pps(); // baseline at rest
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    /// @dev Senior price-per-share in RAY. Correct form counts `jitBorrowed` (recallable par capital);
    ///      the naive teeth form deletes it, so an open borrow reads as a NAV loss.
    function _pps() internal view returns (uint256) {
        uint256 ts = vault.totalSeniorShares();
        uint256 ta = vault.totalSeniorAssets();
        if (TEETH_NAIVE) {
            uint256 jb = vault.jitBorrowed();
            ta = ta > jb ? ta - jb : 0;
        }
        return (ta + VIRTUAL) * RAY / (ts + VIRTUAL);
    }

    /// @dev Record + assert senior-pps monotonicity. CORRECT form skips while a JIT borrow is open (the
    ///      at-rest rule): it never updates or compares against a mid-borrow snapshot, so the recallable
    ///      loan is never mistaken for a loss. NAIVE teeth form evaluates unconditionally.
    function _record() internal {
        uint256 jb = vault.jitBorrowed();
        if (jb > 0) {
            sawOpenBorrow = true;
            openBorrowObservations++;
            if (!TEETH_NAIVE) return; // at-rest gate — do not assert across an open borrow
        }
        uint256 pps = _pps();
        if (pps < lastRestPps) navDropped = true; // strict: rounding favors the vault ⇒ pps only ticks up
        lastRestPps = pps;
    }

    // ── ordinary senior flows ─────────────────────────────────────────────────────────
    function seniorDeposit(uint256 aSeed, uint256 amtSeed) public {
        address a = _actor(aSeed);
        uint256 amt = bound(amtSeed, 1_000_000, 500_000_000_000); // $1 .. $500k (6dp)
        vm.prank(a);
        try vault.depositUSDC(amt, 0, a) returns (uint256) { nDeposits++; } catch {}
        _record();
    }

    function seniorRedeem(uint256 aSeed, uint256 shareSeed) public {
        address a = _actor(aSeed);
        uint256 bal = vault.seniorShares(a);
        if (bal != 0) {
            uint256 s = bound(shareSeed, 1, bal);
            vm.prank(a);
            try vault.redeemSenior(s, 0) returns (uint256) { nRedeems++; } catch {}
        }
        _record();
    }

    /// Gateway payment burn — the handler is wired as the vault's gateway.
    function gatewayBurn(uint256 aSeed, uint256 shareSeed) public {
        address a = _actor(aSeed);
        uint256 bal = vault.seniorShares(a);
        if (bal != 0) {
            uint256 s = bound(shareSeed, 1, bal);
            try vault.burnForPayment(a, s, address(0xBEEF)) returns (uint256) { nBurns++; } catch {}
        }
        _record();
    }

    // ── senior yield (Aave interest proxy) — lifts NAV, must never drop pps ─────────────
    function aaveYield(uint256 amtSeed) public {
        uint256 amt = bound(amtSeed, 1_000_000, 50_000_000_000);
        usdc.mint(address(adapter), amt);
        gYield += amt;
        _record();
    }

    // ── JIT seam: open a borrow (handler == jitHook), leaving `jitBorrowed` > 0 across records ──────────
    function jitBorrow(uint256 wantSeed) public {
        if (vault.jitBorrowed() != 0) { _record(); return; } // one slice at a time
        uint256 want = bound(wantSeed, 1_000_000, 100_000_000_000);
        try vault.borrowIdleForJit(want) returns (uint256 lent) {
            if (lent > 0) nJitBorrowsOpened++;
        } catch {}
        _record();
    }

    /// Settle the open borrow. `usdcReturned` is bounded so the SENIOR never realizes a loss: any shortfall
    /// stays within the junior USDC buffer (junior first-loss fully absorbs it → senior NAV conserved), and
    /// profit lifts the senior. This keeps at-rest senior pps genuinely non-decreasing — the property C1
    /// asserts. (The senior-loss tail, where the junior is wiped, is a deliberate loss injection excluded
    /// here; the solvency-side invariants in the main gate suite cover it.)
    function jitSettle(uint256 retSeed) public {
        uint256 outstanding = vault.jitBorrowed();
        if (outstanding == 0) { _record(); return; }
        uint256 jub = vault.juniorUsdcBuffer();
        uint256 lo  = outstanding > jub ? outstanding - jub : 0; // junior fully covers any shortfall
        uint256 hi  = outstanding + 10_000_000_000;              // up to +$10k JIT profit
        uint256 ret = bound(retSeed, lo, hi);
        // The handler already holds the borrowed `outstanding` USDC (from the borrow). Only a genuine JIT
        // PROFIT (ret > what's on hand) mints new value — count it as yield so conservation stays exact.
        uint256 bal = usdc.balanceOf(address(this));
        if (bal < ret) { uint256 need = ret - bal; usdc.mint(address(this), need); gYield += need; }
        // The hook transfers the returned USDC to the vault, then reports it (production order).
        usdc.transfer(address(vault), ret);
        try vault.settleJitReturn(ret) { nJitSettles++; } catch {}
        _record();
    }

    // ── advance a block so the per-block JIT accumulator resets (lets many borrow cycles run) ──────────
    function roll(uint256 seed) public {
        vm.roll(block.number + 1 + (seed % 3));
        vm.warp(block.timestamp + bound(seed, 1 hours, 2 days));
        _record();
    }
}

/// @notice C1 (senior NAV monotonic) + E1 (rounding favors the vault) for `MintwareTreasuryVault`.
contract TreasuryNavMonotonicInvariantTest is StdInvariant, Test {
    PoolManager           internal pm;
    MintwareTreasuryVault internal vault;
    MockYieldAdapter      internal adapter;
    MockERC20             internal usdc;
    MockERC20             internal team;
    TreasuryNavHandler    internal handler;

    address internal owner    = makeAddr("owner");
    address internal teamAddr  = makeAddr("team");

    address[] internal actors;

    uint256 internal constant LOCK_DUR = 365 days;
    uint256 internal minted;

    function _mint(address to, uint256 amt) internal { usdc.mint(to, amt); minted += amt; }

    function setUp() public {
        pm      = new PoolManager(address(this));
        usdc    = new MockERC20("USD Coin", "USDC", 6);
        team    = new MockERC20("Team Token", "TEAM", 6);
        adapter = new MockYieldAdapter(address(usdc));

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        // A valid USDC/team PoolKey (never initialized — no LP is deployed in this suite).
        PoolKey memory key = PoolKey({
            currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60, hooks: IHooks(address(0))
        });

        vault = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);

        // team commits the junior first-loss reserve (token + a stable USDC buffer) and opens the vault.
        team.mint(teamAddr, 5_000_000e6);
        _mint(teamAddr, 50_000_000_000); // $50k junior USDC buffer
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(5_000_000e6, 50_000_000_000, LOCK_DUR);
        vm.stopPrank();

        // four community actors funded + approved, each seeded so the fuzzer has shares from block 0.
        actors = new address[](4);
        for (uint256 i; i < 4; ++i) {
            address a = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors[i] = a;
            _mint(a, 1e30);
            vm.prank(a);
            usdc.approve(address(vault), type(uint256).max);
            vm.prank(a);
            vault.depositUSDC(100_000_000_000, 0, a); // $100k each
        }

        handler = new TreasuryNavHandler(vault, usdc, adapter, actors, minted);

        // Wire the handler as the gateway (burnForPayment) and the JIT hook (borrow/settle). Enable JIT.
        vm.startPrank(owner);
        vault.setGateway(address(handler));
        vault.setJitHook(address(handler));
        vault.setJitCap(500); // 5% of senior base per block
        vm.stopPrank();

        bytes4[] memory sels = new bytes4[](7);
        sels[0] = TreasuryNavHandler.seniorDeposit.selector;
        sels[1] = TreasuryNavHandler.seniorRedeem.selector;
        sels[2] = TreasuryNavHandler.gatewayBurn.selector;
        sels[3] = TreasuryNavHandler.aaveYield.selector;
        sels[4] = TreasuryNavHandler.jitBorrow.selector;
        sels[5] = TreasuryNavHandler.jitSettle.selector;
        sels[6] = TreasuryNavHandler.roll.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
    }

    // ── C1: senior price-per-share never decreases (at rest). The direct Bunni analog. ───
    function invariant_C1_senior_nav_monotonic() public view {
        assertFalse(handler.navDropped(), "C1: senior NAV (assets/share) decreased at rest");
    }

    // ── E1a: no phantom senior shares — Σ holder shares == totalSeniorShares. ─────────────
    function invariant_E1_no_phantom_shares() public view {
        uint256 sum;
        for (uint256 i; i < actors.length; ++i) sum += vault.seniorShares(actors[i]);
        assertEq(sum, vault.totalSeniorShares(), "phantom senior shares: holder sum != totalSeniorShares");
    }

    // ── E1b: previewWithdraw rounds UP — shares quoted for `assets` always redeem >= `assets`. ─────────
    function invariant_E1_previewWithdraw_not_underquoted() public view {
        if (vault.totalSeniorShares() == 0) return;
        uint256 probe = 1_000_000; // $1
        uint256 sh = vault.previewWithdraw(probe);
        assertGe(vault.convertToAssets(sh), probe, "previewWithdraw under-quoted shares (rounds against vault)");
    }

    // ── E1c: previewDeposit rounds DOWN — a deposit never mints shares worth more than deposited. ──────
    function invariant_E1_previewDeposit_no_free_value() public view {
        uint256 probe = 1_000_000_000; // $1,000
        uint256 sh = vault.previewDeposit(probe);
        assertLe(vault.convertToAssets(sh), probe, "previewDeposit minted shares worth more than deposited");
    }

    // ── conservation backstop: no USDC fabricated in the closed system. ───────────────────
    function invariant_C_usdc_conserved() public view {
        assertEq(usdc.totalSupply(), minted + handler.gYield(), "USDC conservation broke");
    }

    // ── non-vacuity: the fuzz exercised deposits, exits, and the full JIT borrow/settle seam. ──────────
    function afterInvariant() public view {
        assertGt(handler.nDeposits(), 0, "vacuous: no deposit executed");
        assertGt(handler.nRedeems() + handler.nBurns(), 0, "vacuous: no senior exit executed");
        assertGt(handler.nJitBorrowsOpened(), 0, "vacuous: no JIT borrow opened");
        assertGt(handler.nJitSettles(), 0, "vacuous: no JIT settle executed");
        assertGt(handler.openBorrowObservations(), 0, "vacuous: never observed an open JIT borrow (at-rest gate untested)");
    }
}
