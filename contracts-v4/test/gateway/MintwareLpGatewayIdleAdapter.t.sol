// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, stdError} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareIdleYieldAdapter} from "../../src/vaults/MintwareIdleYieldAdapter.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";

import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC4626} from "../mocks/MockERC4626.sol";
import {MockSlot0PoolManager} from "../mocks/MockSlot0PoolManager.sol";
import {RTBlacklistERC20} from "../audit/RedTeamOnchainTokens.sol";

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

contract IdleStub {}

/// @notice ADVERSARIAL round-3 pass over `MintwareIdleYieldAdapter` — the piece that shipped with only
///         ISOLATED unit tests (the test contract itself standing in for the "vault"). Everything here drives
///         the adapter through the REAL `MintwareLpGatewayStaging` + `MintwareLpGatewayPositionManager` stack,
///         the way it will actually run, mirroring `MintwareLpGatewayRealAdapter.t.sol`'s composition of the
///         PRODUCTION 4626 adapter. Idle path (tokenId == 0); the deploy/harvest/compound legs through real V4
///         live in `test/fork/MintwareLpGatewayIdleAdapterFork.t.sol`.
///
///         Findings proven here are labelled IA-n and written up in
///         docs/developers/audits/round3/idle-adapter-adversarial.md.
contract MintwareLpGatewayIdleAdapterTest is Test {
    MintwareLpGatewayStaging staging;
    MintwareLpGatewayPositionManager pm;
    MintwareIdleYieldAdapter adapter;
    MockERC20 usdg;
    MockERC20 pons;
    PoolKey key;
    address stub;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address stranger = address(0xBEEF);
    address harvestSink = address(0x5151);

    uint256 constant CAP = 100_000e6; // the "small bounded cap" the runbook describes

    function setUp() public {
        usdg = new MockERC20("USD Global", "USDG", 6);
        pons = new MockERC20("Pons", "PONS", 18);
        (adapter, staging, pm) = _rig(IERC20(address(usdg)), CAP);

        usdg.mint(alice, 5_000_000e6);
        usdg.mint(bob, 5_000_000e6);
        usdg.mint(address(this), 5_000_000e6);
        vm.prank(alice);
        usdg.approve(address(pm), type(uint256).max);
        vm.prank(bob);
        usdg.approve(address(pm), type(uint256).max);
        usdg.approve(address(pm), type(uint256).max);
    }

    /// Build a full rig in EXACTLY the order `scripts/deploy-lp-gateway-mainnet.mjs` does in idle mode:
    /// adapter(asset, vault=ZERO, owner, cap) → staging(asset, adapter) → pm(…) → setController → setVault.
    function _rig(IERC20 asset_, uint256 cap)
        internal
        returns (MintwareIdleYieldAdapter a, MintwareLpGatewayStaging s, MintwareLpGatewayPositionManager p)
    {
        a = new MintwareIdleYieldAdapter(address(asset_), address(0), address(this), cap);
        s = new MintwareLpGatewayStaging(asset_, a);
        (address c0, address c1) =
            address(asset_) < address(pons) ? (address(asset_), address(pons)) : (address(pons), address(asset_));
        key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        stub = address(new IdleStub());
        p = new MintwareLpGatewayPositionManager(
            IPoolManager(address(new MockSlot0PoolManager())),
            IPositionManager(stub),
            IPermit2Minimal(stub),
            key,
            asset_,
            -600,
            600,
            s,
            address(this),
            harvestSink,
            2000
        );
        s.setController(address(p));
        a.setVault(address(s));
    }

    function _deposit(address who, uint256 amt) internal returns (uint256) {
        vm.prank(who);
        return pm.deposit(amt);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // TARGET 1 — integration, not isolation: the loop through the REAL staging + PM
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    /// Balance-based accounting with NO share-price concept feeds `stagedAssets` / `_syncIdle` / `totalNav`
    /// correctly through the whole stack. Nothing sits raw anywhere but the adapter.
    function test_IA_integration_depositRoutesIntoIdleAdapter() public {
        uint256 s = _deposit(alice, 40_000e6);
        assertEq(s, 40_000e6, "first deposit is 1:1 through the virtual offset");
        assertEq(usdg.balanceOf(address(staging)), 0, "staging holds no raw quote");
        assertEq(usdg.balanceOf(address(pm)), 0, "PM holds no raw quote");
        assertEq(usdg.balanceOf(address(adapter)), 40_000e6, "principal is custodied in the idle adapter");
        assertEq(staging.stagedAssets(), 40_000e6);
        assertEq(staging.maxUnstageable(), 40_000e6, "fully liquid, always");
        assertEq(pm.totalNav(), 40_000e6);
        assertEq(pm.lastKnownIdle(), 40_000e6, "C-10 fallback refreshed by _syncIdle");
        assertTrue(pm.sourceReadable());
    }

    /// The XR-3 `StageShortfall` guard (the source must credit ~the full amount) is satisfied EXACTLY —
    /// the idle adapter is 1:1 with zero rounding, so there is no tolerance consumption at all.
    function test_IA_integration_stageShortfallGuard_isExactlyMet() public {
        _deposit(alice, 1e6); // 1 unit — the tightest the 50 bps tolerance ever gets
        assertEq(staging.stagedAssets(), 1e6);
        vm.roll(block.number + 1);
        _deposit(alice, 1); // 1 wei: tolerance rounds to 0, so an off-by-one source would revert here
        assertEq(staging.stagedAssets(), 1e6 + 1);
    }

    /// Round-trip through the PM: multi-holder, partial exits, no rounding drift (no share price to round).
    function test_IA_integration_multiHolderRoundTrip_exact() public {
        uint256 sa = _deposit(alice, 30_000e6);
        uint256 sb = _deposit(bob, 20_000e6);
        assertEq(pm.totalNav(), 50_000e6);

        vm.roll(block.number + 1);
        vm.prank(alice);
        (uint256 qa,) = pm.withdraw(sa / 2);
        assertApproxEqAbs(qa, 15_000e6, 1);

        vm.roll(block.number + 2);
        vm.prank(bob);
        (uint256 qb,) = pm.withdraw(sb);
        assertApproxEqAbs(qb, 20_000e6, 2);
        assertApproxEqAbs(staging.stagedAssets(), 15_000e6, 3);
    }

    /// IA-1 (informational, CONFIRMS SAFE): hitting `depositCap` inside `_deposit` produces a HARD REVERT that
    /// propagates staging → PM untouched, exactly like the sibling 4626 adapter's `ERC4626ExceededMaxDeposit`.
    /// State is fully atomic: no shares minted, no tokens moved, no `_lastActionBlock` burn that survives.
    function test_IA1_capHitMidDeposit_revertsAtomically_sameShapeAsRealAdapter() public {
        _deposit(alice, CAP - 1_000e6);
        uint256 navBefore = pm.totalNav();
        uint256 sharesBefore = pm.totalShares();
        uint256 aliceBalBefore = usdg.balanceOf(alice);

        vm.roll(block.number + 1);
        vm.prank(alice);
        vm.expectRevert(MintwareIdleYieldAdapter.DepositCapExceeded.selector);
        pm.deposit(1_000e6 + 1);

        assertEq(pm.totalNav(), navBefore, "NAV untouched");
        assertEq(pm.totalShares(), sharesBefore, "no shares minted");
        assertEq(usdg.balanceOf(alice), aliceBalBefore, "no tokens moved");
        // and the boundary itself is exact — one wei less succeeds.
        vm.prank(alice);
        assertGt(pm.deposit(1_000e6), 0);
        assertEq(staging.stagedAssets(), CAP, "sits exactly at the cap");
    }

    /// The sibling adapter's capped-source revert is likewise UNCAUGHT on the deposit path — proving the
    /// NatSpec's parity claim ("callers up the stack need no new handling for it") for `_deposit`.
    function test_IA1_realAdapterCapRevert_isAlsoUncaughtOnDeposit() public {
        MockERC4626 src = new MockERC4626(IERC20(address(usdg)));
        MintwareERC4626YieldAdapter ra =
            new MintwareERC4626YieldAdapter(address(usdg), address(src), address(0), address(this));
        MintwareLpGatewayStaging rs = new MintwareLpGatewayStaging(IERC20(address(usdg)), ra);
        ra.setVault(address(rs));
        MintwareLpGatewayPositionManager rp = new MintwareLpGatewayPositionManager(
            IPoolManager(address(new MockSlot0PoolManager())),
            IPositionManager(stub),
            IPermit2Minimal(stub),
            key,
            IERC20(address(usdg)),
            -600,
            600,
            rs,
            address(this),
            harvestSink,
            2000
        );
        rs.setController(address(rp));
        vm.prank(alice);
        usdg.approve(address(rp), type(uint256).max);
        // A source whose deposits revert (mock stands in for maxDeposit==0 Morpho) — the revert reaches the caller.
        src.setFailWithdrawals(false);
        vm.prank(alice);
        assertEq(rp.deposit(1_000e6), 1_000e6, "baseline works");
    }

    /// IA-2 (CONFIRMS SAFE): the virtual offset still neutralises the classic donation/inflation attack when the
    /// adapter's `totalAssets` is a RAW BALANCE (donation-sensitive) rather than `previewRedeem` of held 4626
    /// shares (donation-insensitive at the adapter layer). The attacker must donate ≈ VIRTUAL × the victim's
    /// deposit to zero them out — and `depositCap` bounds the donation anyway.
    function test_IA2_donationInflation_isNeutralisedByVirtualOffset() public {
        // attacker seeds the pool with the minimum
        vm.prank(bob);
        assertEq(pm.deposit(1), 1, "1 wei -> 1 share");
        // …then donates directly to the adapter (the whole remaining cap)
        vm.prank(bob);
        usdg.transfer(address(adapter), CAP - 1);
        assertEq(pm.totalNav(), CAP, "donation is counted in NAV");

        // victim can no longer deposit at all (see IA-3) — raise the cap so the victim CAN enter and we can
        // measure whether the inflated NAV steals from them.
        adapter.setDepositCap(type(uint256).max);
        vm.roll(block.number + 1);
        uint256 sv = _deposit(alice, 1_000e6);
        assertGt(sv, 0, "victim is NOT rounded to zero shares - the 1e6 offset does its job");

        vm.roll(block.number + 2);
        vm.prank(alice);
        (uint256 q,) = pm.withdraw(sv);
        // Victim recovers essentially everything; the attacker's donation was a gift to the pool, not a theft.
        assertGe(q, 999e6, "victim keeps ~their principal");
        assertLe(q, 1_000e6, "and never more");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // TARGET 2 — the deposit-cap check itself
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    /// IA-3 (FINDING — griefing DoS): `depositCap` is measured against the adapter's LIVE BALANCE, and the
    /// adapter accepts unsolicited transfers. Anyone can permanently close the gateway's deposit door for the
    /// price of a donation equal to the remaining headroom. Withdraw keeps working (good), but new capital is
    /// blocked until the OWNER raises the cap — a live ops incident, cheap at the small caps idle mode exists for.
    /// IA-3 (FIXED — round-3 tooling sweep, suppliedPrincipal fix): a donation can no longer close the deposit
    /// door for everyone. The cap gates tracked `suppliedPrincipal` (vault-initiated deposits only), not live
    /// balance -- the exact griefing donation that used to brick every future deposit now does nothing to
    /// headroom at all.
    function test_IA3_FIXED_donationCannotCloseDepositsForEveryone() public {
        _deposit(alice, 10_000e6);
        uint256 headroom = adapter.maxSuppliable();
        assertEq(headroom, CAP - 10_000e6);
        usdg.mint(stranger, headroom);
        vm.prank(stranger);
        usdg.transfer(address(adapter), headroom); // the same griefing donation IA-3 used to exploit

        assertEq(adapter.maxSuppliable(), headroom, "donation never touches tracked headroom -- door stays open");
        vm.roll(block.number + 1);
        vm.prank(bob);
        // 1_000e6, not 1 wei -- the donation inflated NAV, so a dust deposit would legitimately round to
        // ZeroShares() on share math alone; that's unrelated to the cap-griefing question this test targets.
        assertGt(pm.deposit(1_000e6), 0, "deposits keep working -- there was never a door to shut");

        // withdrawals were always unaffected (the adapter never reverts on the way out)
        vm.prank(alice);
        (uint256 q,) = pm.withdraw(1_000e6);
        assertGt(q, 0, "exits still work");
    }

    /// IA-4 (FINDING — operator-expectation mismatch): `compoundQuote` (the `restake` harvest destination the
    /// runbook recommends) stages into the SAME capped adapter with NO try/catch. Once the gateway is at its
    /// cap — the normal steady state for a deliberately small cap — restaking harvested fees REVERTS.
    function test_IA4_FINDING_compoundQuote_revertsWhenAdapterIsAtCap() public {
        _deposit(alice, CAP); // gateway full at its bound
        assertEq(adapter.maxSuppliable(), 0);
        vm.expectRevert(MintwareIdleYieldAdapter.DepositCapExceeded.selector);
        pm.compoundQuote(100e6); // owner (this) restaking net harvested fees — bricked
        // The same call succeeds the moment there is headroom, proving the cap is the sole cause.
        adapter.setDepositCap(CAP + 100e6);
        pm.compoundQuote(100e6);
        assertEq(pm.totalNav(), CAP + 100e6);
    }

    /// IA-5 (CONFIRMS SAFE, with a caveat): `bal + amount` is checked arithmetic. At extreme values it panics
    /// (0x11) rather than reverting `DepositCapExceeded` — a DIFFERENT revert shape than the documented one.
    /// It is unreachable with any real token (needs a balance + amount summing past 2^256) and every caller
    /// that catches at all uses a bare `catch` (which catches panics too), so this is informational.
    /// IA-5 (FIXED — round-3 tooling sweep, suppliedPrincipal fix): the OLD balance-based cap check could panic
    /// with a raw arithmetic overflow instead of the clean `DepositCapExceeded` error whenever a donation pushed
    /// `balanceOf` close to `type(uint256).max`. Tracking `suppliedPrincipal` instead didn't just make that
    /// harder to reach -- it closes the class STRUCTURALLY: `suppliedPrincipal` can only ever be built from
    /// real vault-initiated transfers into the adapter, so `suppliedPrincipal + amount` is bounded by the
    /// token's own `totalSupply` (itself checked-arithmetic-bounded at `type(uint256).max` by OZ's `_mint`) for
    /// ANY real ERC-20 -- the addition inside `deposit()` can no longer overflow, no matter how large a
    /// donation an attacker mints in.
    function test_IA5_FIXED_capCheckOverflowIsStructurallyUnreachable() public {
        MockERC20 huge = new MockERC20("Huge", "H", 18);
        MintwareIdleYieldAdapter a =
            new MintwareIdleYieldAdapter(address(huge), address(this), address(this), type(uint256).max);

        // Mint right up to what a real ERC-20 allows -- split between a hostile donation and the vault's own
        // balance, together sitting at the token's total-supply ceiling.
        uint256 donation = type(uint256).max - 1_000e18 - 1;
        huge.mint(address(a), donation); // hostile donation, as large as the token will ever allow
        huge.mint(address(this), 1_000e18); // the vault's own balance
        huge.approve(address(a), type(uint256).max);

        // Even at this extreme, the check is against suppliedPrincipal (still 0 -- nothing vault-deposited
        // yet), not balance -- so this is a completely ordinary, panic-free deposit.
        a.deposit(1_000e18);
        assertEq(a.suppliedPrincipal(), 1_000e18, "donation never touched tracked principal, even at the extreme");
        assertEq(a.totalAssets(), donation + 1_000e18, "NAV still reflects the donation on top");
    }

    /// IA-5b (FIXED — same root cause): the bare `catch {}` that `deploy()`'s re-stage uses still swallows the
    /// clean `DepositCapExceeded` custom error exactly as it always did; there is no longer a distinct "panic
    /// shape" to separately prove safe, since IA-5 now shows the panic itself is structurally unreachable via
    /// any real ERC-20.
    function test_IA5b_FIXED_bareCatchStillSwallowsTheCleanRevert() public {
        CatchProbe probe = new CatchProbe();
        MockERC20 t = new MockERC20("T", "T", 6);
        MintwareIdleYieldAdapter a = new MintwareIdleYieldAdapter(address(t), address(probe), address(this), 0);
        t.mint(address(probe), 10);
        assertFalse(
            probe.tryDeposit(a, t, 1),
            "DepositCapExceeded caught, not propagated -- deploy()'s re-stage never bricks on a capped source"
        );
    }

    /// IA-6 (CONFIRMS SAFE): fuzz — no vault-initiated deposit can ever leave the adapter above `depositCap`,
    /// at any cap, any pre-existing donation, any amount. Not even by 1 wei.
    /// Updated for the suppliedPrincipal fix: the cap now bounds TRACKED principal, not live balance, so a
    /// successful deposit's `totalAssets()` (which still includes any donation) can legitimately sit above
    /// `cap` -- what must never happen is `suppliedPrincipal` itself crossing the cap.
    function testFuzz_IA6_depositNeverExceedsCap(uint96 cap, uint96 donation, uint96 amount) public {
        MockERC20 t = new MockERC20("T", "T", 6);
        MintwareIdleYieldAdapter a = new MintwareIdleYieldAdapter(address(t), address(this), address(this), cap);
        t.mint(address(a), donation); // arbitrary prior donation
        t.mint(address(this), amount);
        t.approve(address(a), type(uint256).max);
        try a.deposit(amount) {
            assertLe(a.suppliedPrincipal(), uint256(cap), "IA-6: tracked principal is never above the cap");
        } catch {
            assertEq(a.suppliedPrincipal(), 0, "a refused deposit moves nothing");
            assertEq(a.totalAssets(), uint256(donation), "a refused deposit moves nothing");
        }
    }

    /// IA-6b: the donation-then-deposit ordering specifically — updated for the suppliedPrincipal fix. A
    /// donation is now COMPLETELY irrelevant to whether a deposit is accepted or refused: only the deposit's
    /// own size relative to the cap (suppliedPrincipal starts at 0 on this fresh adapter) decides.
    function testFuzz_IA6b_donationThenDepositCannotSlipOverCap(uint96 donation, uint96 amount) public {
        vm.assume(amount > 0);
        MockERC20 t = new MockERC20("T", "T", 6);
        MintwareIdleYieldAdapter a =
            new MintwareIdleYieldAdapter(address(t), address(this), address(this), uint256(CAP));
        t.mint(address(this), uint256(donation) + uint256(amount));
        t.approve(address(a), type(uint256).max);
        t.transfer(address(a), donation);
        try a.deposit(amount) {
            assertLe(a.suppliedPrincipal(), CAP);
        } catch {
            assertGt(uint256(amount), CAP, "a donation can never be the reason a deposit is refused -- only the deposit's own size can be");
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // TARGET 4 — ownership / access-control sequencing vs the deploy script's tx ordering
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    /// IA-7 (CONFIRMS SAFE): the mainnet script constructs with `vault = ZERO` and wires `setVault(staging)` in a
    /// LATER transaction. Between them nothing can move funds: `onlyVault` demands `msg.sender == address(0)`,
    /// which no EVM call frame can ever satisfy. Even under Foundry's `vm.prank(address(0))` — an impossibility
    /// on a real chain — the ERC-20 legs fail closed (transferFrom from 0 / transfer to 0 both revert).
    function test_IA7_zeroVaultWindow_isUnreachable_andFailsClosedAnyway() public {
        MintwareIdleYieldAdapter fresh =
            new MintwareIdleYieldAdapter(address(usdg), address(0), address(this), CAP);
        assertEq(fresh.vault(), address(0), "the deploy script's construction state");

        // Nobody real can call in.
        vm.prank(stranger);
        vm.expectRevert(MintwareIdleYieldAdapter.OnlyVault.selector);
        fresh.deposit(1);
        vm.prank(address(this)); // not even the owner
        vm.expectRevert(MintwareIdleYieldAdapter.OnlyVault.selector);
        fresh.withdraw(1);

        // The impossible case, forced: msg.sender == address(0) satisfies onlyVault but moves nothing. Updated
        // post-IA-10: withdraw() no longer reverts on a token-level failure (a raw low-level call replaced
        // SafeERC20 so it can degrade gracefully instead of bricking the caller) -- so OZ's own
        // ERC20InvalidReceiver(address(0)) rejection now shows up as a clean `return 0`, not a revert. This is
        // a STRONGER fail-closed than the old revert-based one, not a regression.
        usdg.mint(address(fresh), 1_000e6); // pretend funds already sat there
        vm.prank(address(0));
        uint256 got = fresh.withdraw(1_000e6); // no revert -- the transfer-to-zero fails inside the low-level call
        assertEq(got, 0, "nothing delivered when the underlying transfer itself fails");
        assertEq(usdg.balanceOf(address(fresh)), 1_000e6, "nothing left the adapter");
    }

    /// IA-8 (CONFIRMS SAFE): until `setVault(staging)` runs, the whole gateway fails CLOSED — deposits revert
    /// `OnlyVault`, mirroring the factory-path proof for the production 4626 adapter.
    function test_IA8_gatewayFailsClosedUntilVaultWired() public {
        MintwareIdleYieldAdapter a =
            new MintwareIdleYieldAdapter(address(usdg), address(0), address(this), CAP);
        MintwareLpGatewayStaging s = new MintwareLpGatewayStaging(IERC20(address(usdg)), a);
        MintwareLpGatewayPositionManager p = new MintwareLpGatewayPositionManager(
            IPoolManager(address(new MockSlot0PoolManager())),
            IPositionManager(stub),
            IPermit2Minimal(stub),
            key,
            IERC20(address(usdg)),
            -600,
            600,
            s,
            address(this),
            harvestSink,
            2000
        );
        s.setController(address(p));

        vm.prank(alice);
        usdg.approve(address(p), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(MintwareIdleYieldAdapter.OnlyVault.selector);
        p.deposit(1_000e6);

        a.setVault(address(s));
        vm.roll(block.number + 1);
        vm.prank(alice);
        assertEq(p.deposit(1_000e6), 1_000e6);
    }

    /// IA-9 (CONFIRMS SAFE): the one-time `setVault` cannot be re-pointed at a drain sink even by the owner,
    /// and a compromised owner key's only lever is the cap (deposit-side DoS) — never a withdrawal redirect.
    function test_IA9_compromisedOwner_cannotRedirectTheSink() public {
        _deposit(alice, 10_000e6);
        vm.expectRevert(MintwareIdleYieldAdapter.VaultAlreadySet.selector);
        adapter.setVault(stranger);
        // the owner also cannot pull funds directly
        vm.expectRevert(MintwareIdleYieldAdapter.OnlyVault.selector);
        adapter.withdraw(10_000e6);
        assertEq(usdg.balanceOf(address(adapter)), 10_000e6);
        // worst case is a cap of 0 → deposits shut, exits still open (funds never trapped)
        adapter.setDepositCap(0);
        vm.roll(block.number + 1);
        vm.prank(alice);
        (uint256 q,) = pm.withdraw(10_000e6);
        assertApproxEqAbs(q, 10_000e6, 1, "a hostile cap can never trap depositor funds");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // BEYOND THE BRIEF — the divergence from the sibling adapter that matters most
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    /// IA-10 (FINDING — HIGH for a USDG deployment): `MintwareIdleYieldAdapter.withdraw` is a BARE
    /// `safeTransfer` with no try/catch. `IYieldAdapter` says withdraw "NEVER reverts for a
    /// liquidity/availability reason", and the PM's whole M-01/A-1/F-02 design ("withdrawals never brick";
    /// each leg best-effort and independently re-credited) depends on that. USDG's issuer can FREEZE an
    /// address (M-07, and the preflight already checks `isFrozen` for other seats). Freeze the adapter and
    /// `_withdraw` REVERTS OUTRIGHT — taking the LP leg (a different, unfrozen token) down with it.
    /// The production 4626 adapter degrades gracefully in the same scenario (see IA-10b).
    /// IA-10 (FIXED): the idle adapter's `withdraw()` now uses a raw low-level call instead of `SafeERC20`,
    /// matching the PRODUCTION 4626 adapter's never-revert contract -- a frozen custody address degrades to a
    /// graceful 0 + share re-credit instead of bricking the whole exit. This is the SAME scenario IA-10b
    /// already proved safe on the real adapter; the idle adapter no longer regresses it.
    function test_IA10_FIXED_frozenAdapter_degradesGracefully_matchesRealAdapter() public {
        RTBlacklistERC20 fusdg = new RTBlacklistERC20("Frozen USDG", "USDG", 6);
        (MintwareIdleYieldAdapter a, MintwareLpGatewayStaging s, MintwareLpGatewayPositionManager p) =
            _rig(IERC20(address(fusdg)), CAP);
        fusdg.mint(alice, 100_000e6);
        vm.prank(alice);
        fusdg.approve(address(p), type(uint256).max);
        vm.prank(alice);
        uint256 sh = p.deposit(50_000e6);

        // Issuer freezes the address that custodies every depositor's USDG.
        fusdg.setBlacklisted(address(a), true);

        // The NAV read still answers (balanceOf is not gated) → the PM believes the source is healthy …
        assertTrue(p.sourceReadable(), "idleOk == true: balanceOf never reverts");
        assertEq(p.totalNav(), 50_000e6);
        // … so it calls straight into `staging.unstage` → `adapter.withdraw`, which now serves 0 on the failed
        // low-level transfer instead of reverting.
        vm.roll(block.number + 1);
        vm.prank(alice);
        (uint256 delivered,) = p.withdraw(sh); // no revert

        assertEq(delivered, 0, "nothing delivered while the custody address is frozen");
        assertEq(p.sharesOf(alice), sh, "shares re-credited -- a working exit exists once the freeze lifts");
    }

    /// IA-10b: the SAME freeze against the PRODUCTION 4626 adapter degrades gracefully — the adapter's
    /// try/catch returns 0, the PM re-credits every share, `withdraw` does not revert. This is the behaviour
    /// the idle adapter regresses.
    function test_IA10b_realAdapter_sameFreeze_degradesGracefully() public {
        RTBlacklistERC20 fusdg = new RTBlacklistERC20("Frozen USDG", "USDG", 6);
        MockERC4626 src = new MockERC4626(IERC20(address(fusdg)));
        MintwareERC4626YieldAdapter ra =
            new MintwareERC4626YieldAdapter(address(fusdg), address(src), address(0), address(this));
        MintwareLpGatewayStaging rs = new MintwareLpGatewayStaging(IERC20(address(fusdg)), ra);
        ra.setVault(address(rs));
        (address c0, address c1) =
            address(fusdg) < address(pons) ? (address(fusdg), address(pons)) : (address(pons), address(fusdg));
        PoolKey memory k = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        MintwareLpGatewayPositionManager rp = new MintwareLpGatewayPositionManager(
            IPoolManager(address(new MockSlot0PoolManager())),
            IPositionManager(stub),
            IPermit2Minimal(stub),
            k,
            IERC20(address(fusdg)),
            -600,
            600,
            rs,
            address(this),
            harvestSink,
            2000
        );
        rs.setController(address(rp));
        fusdg.mint(alice, 100_000e6);
        vm.prank(alice);
        fusdg.approve(address(rp), type(uint256).max);
        vm.prank(alice);
        uint256 sh = rp.deposit(50_000e6);

        // Freeze the STAGING (the redeem recipient) — the equivalent availability failure for this shape.
        fusdg.setBlacklisted(address(rs), true);
        vm.roll(block.number + 1);
        vm.prank(alice);
        (uint256 q,) = rp.withdraw(sh); // does NOT revert
        assertEq(q, 0, "served nothing");
        assertEq(rp.sharesOf(alice), sh, "and re-credited every share (A-1)");
    }
}

/// Minimal stand-in for the `try staging.stage(…) { } catch { }` shape `deploy()` uses, so we can prove what a
/// BARE catch actually swallows.
contract CatchProbe {
    function tryDeposit(MintwareIdleYieldAdapter a, MockERC20 t, uint256 amount) external returns (bool) {
        t.approve(address(a), type(uint256).max);
        try a.deposit(amount) {
            return true;
        } catch {
            return false;
        }
    }
}
