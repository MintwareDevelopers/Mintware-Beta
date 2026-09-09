// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareIdleYieldAdapter} from "../../src/vaults/MintwareIdleYieldAdapter.sol";

import {MockERC20} from "../mocks/MockERC20.sol";
import {MockSlot0PoolManager} from "../mocks/MockSlot0PoolManager.sol";

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

contract PrincipalCapStub {}

/// @notice IA-11 hardening: `MintwareLpGatewayPositionManager.principalCap` bounds `idle + deployedPrincipal +
///         deployedPairedValue` -- the actual "total value at risk" figure `LP_GATEWAY_DEPOSIT_CAP` was always
///         DESCRIBED as bounding, but never did on its own (the adapter's own cap only ever gated its own idle
///         custody). This file proves the DEPOSIT-side half of the fix against a lean idle-only rig (no real
///         V4 periphery needed -- tokenId stays 0 throughout). The DEPLOY-side half (the owner's paired-leg
///         subsidy, and the full multi-round compounding loop IA-11/IA-11b originally exposed) needs a real V4
///         mint and is proven in `test/fork/MintwareLpGatewayIdleAdapterFork.t.sol` (self-skips without
///         `LP_FORK_RPC_URL`).
contract MintwareLpGatewayPrincipalCapTest is Test {
    MintwareLpGatewayStaging staging;
    MintwareLpGatewayPositionManager pm;
    MintwareIdleYieldAdapter adapter;
    MockERC20 usdg;
    MockERC20 pons;
    PoolKey key;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant ADAPTER_CAP = 1_000_000e6; // deliberately generous -- principalCap is the binding constraint here
    uint256 constant PRINCIPAL_CAP = 100_000e6;

    function setUp() public {
        usdg = new MockERC20("USD Global", "USDG", 6);
        pons = new MockERC20("Pons", "PONS", 18);
        (adapter, staging, pm) = _rig(PRINCIPAL_CAP);

        usdg.mint(alice, 5_000_000e6);
        usdg.mint(bob, 5_000_000e6);
        vm.prank(alice);
        usdg.approve(address(pm), type(uint256).max);
        vm.prank(bob);
        usdg.approve(address(pm), type(uint256).max);
    }

    function _rig(uint256 principalCap)
        internal
        returns (MintwareIdleYieldAdapter a, MintwareLpGatewayStaging s, MintwareLpGatewayPositionManager p)
    {
        a = new MintwareIdleYieldAdapter(address(usdg), address(0), address(this), ADAPTER_CAP);
        s = new MintwareLpGatewayStaging(IERC20(address(usdg)), a);
        (address c0, address c1) =
            address(usdg) < address(pons) ? (address(usdg), address(pons)) : (address(pons), address(usdg));
        key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        address stub = address(new PrincipalCapStub());
        p = new MintwareLpGatewayPositionManager(
            IPoolManager(address(new MockSlot0PoolManager())),
            IPositionManager(stub),
            IPermit2Minimal(stub),
            key,
            IERC20(address(usdg)),
            -600,
            600,
            s,
            address(this),
            address(0x5151),
            2000,
            principalCap
        );
        s.setController(address(p));
        a.setVault(address(s));
    }

    // ── construction / views ──────────────────────────────────────────────────────────────────

    function test_principalCap_readsBackExactlyAsConstructed() public view {
        assertEq(pm.principalCap(), PRINCIPAL_CAP);
        assertEq(pm.deployedPairedValue(), 0, "nothing deployed yet");
    }

    // ── deposit-side enforcement (IA-11) ──────────────────────────────────────────────────────

    /// A deposit that would push `idle + deployedPrincipal + deployedPairedValue` above `principalCap` reverts
    /// -- even though the ADAPTER's own (much larger) cap has plenty of room. This is the fix: the adapter's
    /// cap was never the binding constraint on total value at risk; the PM's own cap now is.
    function test_deposit_revertsPrincipalCapExceeded_evenWithAdapterHeadroomToSpare() public {
        vm.prank(alice);
        pm.deposit(PRINCIPAL_CAP); // exactly at the cap -- succeeds
        assertEq(adapter.maxSuppliable(), ADAPTER_CAP - PRINCIPAL_CAP, "adapter itself has tons of headroom left");

        vm.roll(block.number + 1);
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.PrincipalCapExceeded.selector);
        pm.deposit(1); // the PM's own cap refuses it regardless
    }

    function test_deposit_atExactlyTheCap_succeeds() public {
        vm.prank(alice);
        uint256 sh = pm.deposit(PRINCIPAL_CAP);
        assertEq(sh, PRINCIPAL_CAP);
        assertEq(pm.totalNav(), PRINCIPAL_CAP);
    }

    /// The redeploy-refill cycling that originally let cumulative depositor quote exceed the cap indefinitely
    /// (IA-11) cannot happen through deposits alone any more: a withdrawal frees the SAME room a deposit
    /// consumed (idle drops, nothing else changes), so repeated deposit/withdraw/deposit cycles never let the
    /// live total exceed principalCap even once, let alone compound past it.
    function testFuzz_repeatedDepositWithdrawCyclesNeverExceedPrincipalCap(uint8 rounds, uint96 amountSeed) public {
        vm.assume(rounds > 0 && rounds <= 20);
        uint256 amount = (uint256(amountSeed) % (PRINCIPAL_CAP / 2)) + 1;
        // Anchor to a captured b0 -- a relative `block.number + 1` re-evaluated across iterations can get
        // CSE'd under via-IR and land on the same block twice, tripping SameBlockAction (documented gotcha,
        // .claude/rules/lp-gateway.md).
        uint256 b0 = block.number;
        for (uint256 i; i < rounds; i++) {
            vm.roll(b0 + i * 2 + 1);
            vm.prank(alice);
            try pm.deposit(amount) {
                assertLe(pm.totalNav(), PRINCIPAL_CAP, "never above the cap after an accepted deposit");
            } catch {
                assertGt(pm.totalNav() + amount, PRINCIPAL_CAP, "only refused when it would genuinely exceed");
            }
            vm.roll(b0 + i * 2 + 2);
            uint256 sh = pm.sharesOf(alice);
            if (sh > 0) {
                vm.prank(alice);
                pm.withdraw(sh); // free the room back up
            }
        }
    }

    // ── setPrincipalCap ────────────────────────────────────────────────────────────────────────

    function test_setPrincipalCap_isOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert(); // Ownable: caller is not the owner
        pm.setPrincipalCap(1);
    }

    /// Lowering the cap below the current total blocks further growth but never forces a withdrawal or touches
    /// funds already held -- mirrors the idle adapter's own `setDepositCap` semantics exactly.
    function test_lowering_principalCap_belowCurrentTotal_doesNotTouchExistingDeposits() public {
        vm.prank(alice);
        pm.deposit(PRINCIPAL_CAP);
        pm.setPrincipalCap(1); // owner is address(this) in this rig
        assertEq(pm.totalNav(), PRINCIPAL_CAP, "existing deposit untouched");

        vm.roll(block.number + 1);
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.PrincipalCapExceeded.selector);
        pm.deposit(1); // no further growth admitted

        uint256 aliceShares = pm.sharesOf(alice); // read BEFORE the prank -- a pranked view call still consumes
        // the single-call prank, so reading it inside vm.prank(alice) leaves the actual withdraw() running as
        // address(this) instead, which holds no shares (InsufficientShares).
        vm.prank(alice);
        (uint256 q,) = pm.withdraw(aliceShares);
        assertGt(q, 0, "withdrawal still works normally under a lowered cap");
    }

    function test_raisingPrincipalCap_reopensGrowth() public {
        vm.prank(alice);
        pm.deposit(PRINCIPAL_CAP);
        vm.roll(block.number + 1);
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.PrincipalCapExceeded.selector);
        pm.deposit(1);

        pm.setPrincipalCap(PRINCIPAL_CAP * 2);
        vm.roll(block.number + 2);
        vm.prank(bob);
        assertGt(pm.deposit(1), 0, "growth resumes once the owner raises the cap");
    }
}
