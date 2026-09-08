// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayFactory} from "../../src/gateway/MintwareLpGatewayFactory.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";

import {MockERC20} from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {MockSlot0PoolManager} from "../mocks/MockSlot0PoolManager.sol";

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

contract CgStub {}

/// @title  Round-3 coverage close-out — unasserted revert paths in the LP gateway
/// @notice Every test here closes a gap found by cross-referencing the custom `error`s declared in
///         `src/gateway/*` against `vm.expectRevert(<Contract>.<Error>.selector)` across the WHOLE combined
///         suite (`test/gateway`, `test/audit`, `test/audit3`, `test/fork/MintwareLpGateway*`). A selector
///         with zero asserting test is a real gap even when raw line coverage calls the line "hit": a revert
///         reached without asserting WHICH error it was is a strictly weaker guarantee — a later refactor can
///         silently swap the guard for a different (or wrong) one and nothing fails.
///
///         Gaps closed (selector → previously asserted nowhere):
///           PositionManager: QuoteNotInPool, ZeroAddress (the six constructor address args — only the
///                            native-ETH-paired branch and `proposeHarvestRecipient(0)` were asserted),
///                            ZeroAmount on `compoundQuote` (every existing caller bounds the amount to >= 1).
///           Staging:         ZeroAddress (both ctor args + `setController(0)`), ZeroAmount (stage + unstage).
///           Factory:         ZeroAddress (all three ctor args), `deactivate` owner gate.
///
///         Plus one DEAD-CODE guard test: since round-3 XR-2 anchored the follower in the constructor, the
///         defensive `_refSqrtPrice == 0` branches can no longer be reached. `test_refAnchoredAtConstruction_*`
///         pins the invariant that makes them dead, so if anyone ever removes the ctor anchor this fails.
contract CoverageGapRevertPathsTest is Test {
    using PoolIdLibrary for PoolKey;

    MockERC20 usdg;
    MockERC20 pons;
    MockERC20 other;
    MockYieldAdapter adapter;
    MintwareLpGatewayStaging staging;

    address slot0Pm;
    address stub;

    address stranger = address(0xBEEF);
    address gwOwner = address(this);
    address sink = address(0x5151);

    function setUp() public {
        usdg = new MockERC20("USD Global", "USDG", 6);
        pons = new MockERC20("Pons", "PONS", 18);
        other = new MockERC20("Other", "OTHR", 18);
        adapter = new MockYieldAdapter(address(usdg));
        staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        // Built OUTSIDE any expectRevert window — a `new` inside one would consume the expectation.
        slot0Pm = address(new MockSlot0PoolManager());
        stub = address(new CgStub());
    }

    function _key(address a, address b) internal pure returns (PoolKey memory) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }

    function _newPm(
        address poolManager_,
        address positionManager_,
        address permit2_,
        PoolKey memory key,
        address quote_,
        MintwareLpGatewayStaging staging_,
        address owner_,
        address harvestRecipient_
    ) internal returns (MintwareLpGatewayPositionManager) {
        return new MintwareLpGatewayPositionManager(
            IPoolManager(poolManager_),
            IPositionManager(positionManager_),
            IPermit2Minimal(permit2_),
            key,
            IERC20(quote_),
            -600,
            600,
            staging_,
            owner_,
            harvestRecipient_,
            500
        );
    }

    // ── PositionManager constructor: QuoteNotInPool ──────────────────────────────────────────────
    // GAP: `QuoteNotInPool` had ZERO assertions anywhere in the combined suite. It is the guard that stops a
    // curator wiring a gateway whose quote asset is not one of the pool's two currencies — which would mint an
    // instance that can stage capital but can never deploy it (LiquidityAmounts would price the wrong leg).

    function test_ctor_rejectsQuoteAssetNotInPool() public {
        // Pool is (pons, other); the quote we hand it is usdg — in neither slot.
        vm.expectRevert(MintwareLpGatewayPositionManager.QuoteNotInPool.selector);
        _newPm(slot0Pm, stub, stub, _key(address(pons), address(other)), address(usdg), staging, gwOwner, sink);
    }

    /// The mirror case: the SAME key is accepted the moment the quote actually is one of the currencies —
    /// so the guard rejects on membership, not on some incidental property of the key.
    function test_ctor_acceptsQuoteAssetInPool() public {
        MintwareLpGatewayPositionManager pm =
            _newPm(slot0Pm, stub, stub, _key(address(pons), address(other)), address(pons), staging, gwOwner, sink);
        assertEq(address(pm.quoteAsset()), address(pons));
        assertEq(address(pm.pairedAsset()), address(other));
    }

    // ── PositionManager constructor: the six ZeroAddress arguments ───────────────────────────────
    // GAP: only the native-ETH-paired branch (`(q0 ? c1 : c0) == 0`) was asserted. The six-way arg check that
    // runs BEFORE it had no test — so e.g. a zero `harvestRecipient_` (which would burn every swept fee, since
    // `_sweepFees` transfers to it unconditionally) was an unasserted guard.

    function test_ctor_rejectsZeroPoolManager() public {
        vm.expectRevert(MintwareLpGatewayPositionManager.ZeroAddress.selector);
        _newPm(address(0), stub, stub, _key(address(usdg), address(pons)), address(usdg), staging, gwOwner, sink);
    }

    function test_ctor_rejectsZeroPositionManager() public {
        vm.expectRevert(MintwareLpGatewayPositionManager.ZeroAddress.selector);
        _newPm(slot0Pm, address(0), stub, _key(address(usdg), address(pons)), address(usdg), staging, gwOwner, sink);
    }

    function test_ctor_rejectsZeroPermit2() public {
        vm.expectRevert(MintwareLpGatewayPositionManager.ZeroAddress.selector);
        _newPm(slot0Pm, stub, address(0), _key(address(usdg), address(pons)), address(usdg), staging, gwOwner, sink);
    }

    function test_ctor_rejectsZeroStaging() public {
        vm.expectRevert(MintwareLpGatewayPositionManager.ZeroAddress.selector);
        _newPm(
            slot0Pm,
            stub,
            stub,
            _key(address(usdg), address(pons)),
            address(usdg),
            MintwareLpGatewayStaging(address(0)),
            gwOwner,
            sink
        );
    }

    function test_ctor_rejectsZeroQuoteAsset() public {
        // Ordered BEFORE the QuoteNotInPool check, so a zero quote is a ZeroAddress, never a QuoteNotInPool.
        vm.expectRevert(MintwareLpGatewayPositionManager.ZeroAddress.selector);
        _newPm(slot0Pm, stub, stub, _key(address(usdg), address(pons)), address(0), staging, gwOwner, sink);
    }

    /// The one with real money meaning: `_sweepFees` transfers every collected fee to `harvestRecipient`
    /// unconditionally, so a zero recipient would burn the whole fee stream of the instance.
    function test_ctor_rejectsZeroHarvestRecipient() public {
        vm.expectRevert(MintwareLpGatewayPositionManager.ZeroAddress.selector);
        _newPm(slot0Pm, stub, stub, _key(address(usdg), address(pons)), address(usdg), staging, gwOwner, address(0));
    }

    /// The owner seat is guarded by OZ `Ownable`, not by the gateway's own `ZeroAddress` — pinned so the
    /// distinction is deliberate and a future refactor can't quietly drop the only check there is.
    function test_ctor_rejectsZeroOwner_viaOwnable() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        _newPm(slot0Pm, stub, stub, _key(address(usdg), address(pons)), address(usdg), staging, address(0), sink);
    }

    // ── PositionManager: compoundQuote(0) ────────────────────────────────────────────────────────
    // GAP: `ZeroAmount` was asserted for `deposit` / `withdraw` / `deploy` only. Every existing `compoundQuote`
    // caller (both invariant handlers, the outage rig, the unit suite) bounds the amount to >= 1, so the
    // zero-amount guard on the accretion path was never exercised. It matters: a zero compound would
    // `forceApprove(0)` and call `staging.stage(0)`, which reverts deeper with the STAGING ZeroAmount — the
    // local guard is what keeps the failure legible at the surface the operator actually calls.

    function test_compoundQuote_zeroAmount_reverts() public {
        MintwareLpGatewayPositionManager pm =
            _newPm(slot0Pm, stub, stub, _key(address(usdg), address(pons)), address(usdg), staging, gwOwner, sink);
        staging.setController(address(pm));
        vm.expectRevert(MintwareLpGatewayPositionManager.ZeroAmount.selector);
        pm.compoundQuote(0);
    }

    // ── DEAD CODE pin: the follower reference is anchored at construction ────────────────────────
    // Round-3 XR-2 made the ctor revert `PoolNotInitialized` unless slot0 answers non-zero, and anchor
    // `_refSqrtPrice` to it. That makes three defensive `_refSqrtPrice == 0` branches UNREACHABLE:
    //   `_anchorFollow`'s `if (ref == 0) {...}`, `_refOrSpot`'s `ref == 0 ? spot : ref`, and `deploy`'s
    //   `if (ref != 0)` band guard (its implicit else — an unbanded first deploy).
    // `_refSqrtPrice` is written only in those two places and can never reach 0 afterwards: `maxStep` is at
    // most `ref/2` (band <= 5000 bps), so `next` is at worst `ref - ref/2 > 0`. This test pins the invariant
    // that makes them dead — if the ctor anchor is ever removed, it fails here rather than silently
    // resurrecting an unbanded first deploy.

    function test_refAnchoredAtConstruction_makesZeroRefBranchesUnreachable() public {
        MintwareLpGatewayPositionManager pm =
            _newPm(slot0Pm, stub, stub, _key(address(usdg), address(pons)), address(usdg), staging, gwOwner, sink);
        (uint160 ref, uint64 atBlock, uint160 entryHigh) = pm.referencePrice();
        assertTrue(ref != 0, "follower must be anchored at construction (XR-2)");
        assertEq(uint256(atBlock), block.number, "anchor block is creation block");
        assertTrue(entryHigh != 0, "entry-mark memory seeded at construction (R3-INV-3)");

        // And a bounded follow-step can never walk it to zero: roll forward, drive spot to the minimum the
        // mock will report, and the reference still stays strictly positive.
        MockSlot0PoolManager(payable(slot0Pm)).setSqrtPrice(1);
        for (uint256 i = 0; i < 50; i++) {
            vm.roll(block.number + 1);
            pm.poke();
        }
        (uint160 refAfter,,) = pm.referencePrice();
        assertTrue(refAfter != 0, "clamped follower can never reach zero");
    }

    // ── Staging: ZeroAddress + ZeroAmount ────────────────────────────────────────────────────────
    // GAP: the staging reserve's four guards had ZERO assertions. `test/gateway/MintwareLpGatewayStaging.t.sol`
    // covers the controller/deployer seats and the best-effort unstage, but never the zero cases.

    function test_staging_ctor_rejectsZeroQuoteAsset() public {
        vm.expectRevert(MintwareLpGatewayStaging.ZeroAddress.selector);
        new MintwareLpGatewayStaging(IERC20(address(0)), adapter);
    }

    function test_staging_ctor_rejectsZeroAdapter() public {
        vm.expectRevert(MintwareLpGatewayStaging.ZeroAddress.selector);
        new MintwareLpGatewayStaging(IERC20(address(usdg)), IYieldAdapter(address(0)));
    }

    /// A zero controller would leave the reserve permanently unusable AND burn the one-shot `AlreadySet` seat,
    /// bricking the instance (`controller` stays 0, so `onlyController` can never pass again... except that the
    /// `AlreadySet` guard reads `controller != 0`, so it would in fact stay settable — either way the guard is
    /// what stops an operator typo from wiring a dead sink).
    function test_staging_setController_rejectsZero() public {
        MintwareLpGatewayStaging fresh = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        vm.expectRevert(MintwareLpGatewayStaging.ZeroAddress.selector);
        fresh.setController(address(0));
        assertEq(fresh.controller(), address(0), "no partial write on the rejected path");
        fresh.setController(address(this)); // still settable afterwards
        assertEq(fresh.controller(), address(this));
    }

    function test_staging_stage_zeroAmount_reverts() public {
        staging.setController(address(this));
        vm.expectRevert(MintwareLpGatewayStaging.ZeroAmount.selector);
        staging.stage(0);
    }

    function test_staging_unstage_zeroAmount_reverts() public {
        staging.setController(address(this));
        vm.expectRevert(MintwareLpGatewayStaging.ZeroAmount.selector);
        staging.unstage(0);
    }

    /// The `returned > 0` FALSE branch of `unstage` (round-3 X-3 measures what actually landed). A source that
    /// is fully illiquid must return 0 WITHOUT reverting and WITHOUT transferring — this is the branch the
    /// gateway's best-effort withdraw leg relies on to re-credit shares instead of bricking. The existing
    /// staging test only covers a PARTIAL cap (30k of 100k), never a zero one.
    function test_staging_unstage_fullyIlliquidSource_returnsZeroWithoutReverting() public {
        staging.setController(address(this));
        usdg.mint(address(this), 100_000e6);
        usdg.approve(address(staging), type(uint256).max);
        staging.stage(100_000e6);

        adapter.setWithdrawableCap(0); // source frozen: totalAssets still full, nothing withdrawable
        uint256 balBefore = usdg.balanceOf(address(this));

        vm.expectEmit(false, false, false, true, address(staging));
        emit MintwareLpGatewayStaging.Unstaged(50_000e6, 0);
        uint256 got = staging.unstage(50_000e6);

        assertEq(got, 0, "nothing delivered");
        assertEq(usdg.balanceOf(address(this)), balBefore, "no transfer on the zero-return branch");
        assertEq(staging.stagedAssets(), 100_000e6, "principal untouched: the claim is not consumed");
        assertEq(staging.maxUnstageable(), 0);
    }

    // ── Factory: ZeroAddress ctor args + the deactivate owner gate ───────────────────────────────
    // GAP: the factory's three ctor `ZeroAddress` guards had no assertions, and `deactivate`'s owner gate was
    // untested (only `createGateway`'s was, and only with a bare `vm.expectRevert()`).

    function test_factory_ctor_rejectsZeroPoolManager() public {
        vm.expectRevert(MintwareLpGatewayFactory.ZeroAddress.selector);
        new MintwareLpGatewayFactory(
            IPoolManager(address(0)), IPositionManager(stub), IPermit2Minimal(stub), address(this)
        );
    }

    function test_factory_ctor_rejectsZeroPositionManager() public {
        vm.expectRevert(MintwareLpGatewayFactory.ZeroAddress.selector);
        new MintwareLpGatewayFactory(
            IPoolManager(slot0Pm), IPositionManager(address(0)), IPermit2Minimal(stub), address(this)
        );
    }

    function test_factory_ctor_rejectsZeroPermit2() public {
        vm.expectRevert(MintwareLpGatewayFactory.ZeroAddress.selector);
        new MintwareLpGatewayFactory(
            IPoolManager(slot0Pm), IPositionManager(stub), IPermit2Minimal(address(0)), address(this)
        );
    }

    /// Retiring a curated instance is a curation decision — a stranger must not be able to flip `active` off
    /// (the app layer routes deposits off the registry's `active` flag).
    function test_factory_deactivate_onlyOwner() public {
        MintwareLpGatewayFactory factory = new MintwareLpGatewayFactory(
            IPoolManager(slot0Pm), IPositionManager(stub), IPermit2Minimal(stub), address(this)
        );
        PoolKey memory key = _key(address(usdg), address(pons));
        factory.createGateway(key, IERC20(address(usdg)), adapter, -600, 600, gwOwner, sink, 2000);
        bytes32 poolId = PoolId.unwrap(key.toId());

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.deactivate(poolId);

        (,, bool stillActive) = factory.instanceForPool(poolId);
        assertTrue(stillActive, "a stranger cannot retire a curated instance");

        factory.deactivate(poolId); // the owner still can
        (,, bool active) = factory.instanceForPool(poolId);
        assertFalse(active);
    }
}
