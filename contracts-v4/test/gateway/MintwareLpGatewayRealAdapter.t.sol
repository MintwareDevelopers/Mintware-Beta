// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayFactory} from "../../src/gateway/MintwareLpGatewayFactory.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC4626} from "../mocks/MockERC4626.sol";
import {MockFeeERC4626} from "../mocks/MockFeeERC4626.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {MockSlot0PoolManager} from "../mocks/MockSlot0PoolManager.sol";

contract Stub {}

/// @notice Re-audit A-5: the gateway composed with the PRODUCTION yield adapter (`MintwareERC4626YieldAdapter`
///         over an ERC-4626 source — the Morpho shape) instead of the test `MockYieldAdapter`, whose `withdraw`
///         had NO access control (anyone could drain the live rig). Proves the real stage → earn → unstage loop
///         end to end, the `onlyVault` / one-time `setVault` boundary, and the A-1 re-credit against the real
///         adapter's two degraded modes (per-block cap; stalled source). Idle-path only (tokenId == 0 — the
///         V4 leg is the fork harness, which is ALSO on the real adapter now).
contract MintwareLpGatewayRealAdapterTest is Test {
    MintwareLpGatewayStaging staging;
    MintwareLpGatewayPositionManager pm;
    MintwareERC4626YieldAdapter adapter;
    MockERC4626 yieldSource;
    MockERC20 usdg;
    MockERC20 pons;
    PoolKey key;
    address stub;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address stranger = address(0xBEEF);
    address harvestSink = address(0x5151);

    function setUp() public {
        usdg = new MockERC20("USD Global", "USDG", 6);
        pons = new MockERC20("Pons", "PONS", 18);
        yieldSource = new MockERC4626(IERC20(address(usdg)));
        // vault = 0 at construction (the staging doesn't exist yet) → wired once below. Owner = this test.
        adapter = new MintwareERC4626YieldAdapter(address(usdg), address(yieldSource), address(0), address(this));
        staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        adapter.setVault(address(staging)); // the ONLY address that may supply/withdraw through the adapter

        (address c0, address c1) =
            address(usdg) < address(pons) ? (address(usdg), address(pons)) : (address(pons), address(usdg));
        key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        stub = address(new Stub());
        pm = new MintwareLpGatewayPositionManager(
            IPoolManager(address(new MockSlot0PoolManager())), IPositionManager(stub), IPermit2Minimal(stub),
            key, IERC20(address(usdg)), -600, 600, staging, address(this), harvestSink, 2000
        );
        staging.setController(address(pm));

        usdg.mint(alice, 2_000_000e6);
        usdg.mint(bob, 2_000_000e6);
        usdg.mint(address(this), 2_000_000e6);
        vm.prank(alice);
        usdg.approve(address(pm), type(uint256).max);
        vm.prank(bob);
        usdg.approve(address(pm), type(uint256).max);
    }

    function _deposit(address who, uint256 amt) internal returns (uint256) {
        vm.prank(who);
        return pm.deposit(amt);
    }

    // ── the stage → earn loop on the real adapter ─────────────────────────────────────────────

    // Deposited quote lands in the 4626 SOURCE (as adapter-held shares) — nothing sits raw in staging/adapter.
    function test_A5_deposit_routesIntoYieldSource() public {
        uint256 s = _deposit(alice, 100_000e6);
        assertEq(s, 100_000e6);
        assertEq(usdg.balanceOf(address(staging)), 0, "staging holds no raw quote");
        assertEq(usdg.balanceOf(address(adapter)), 0, "adapter holds no raw quote");
        assertEq(usdg.balanceOf(address(yieldSource)), 100_000e6, "principal is in the yield source");
        assertEq(yieldSource.balanceOf(address(adapter)), 100_000e6, "adapter holds the 4626 shares");
        assertEq(staging.stagedAssets(), 100_000e6);
        assertEq(pm.totalNav(), 100_000e6);
    }

    function test_A5_withdraw_roundTrip() public {
        uint256 s = _deposit(alice, 100_000e6);
        vm.roll(block.number + 1);
        vm.prank(alice);
        (uint256 q, uint256 p) = pm.withdraw(s / 2);
        assertApproxEqAbs(q, 50_000e6, 2);
        assertEq(p, 0);
        assertApproxEqAbs(staging.stagedAssets(), 50_000e6, 2);
    }

    // Accrued yield in the source lifts NAV; the next depositor is priced at that NAV (not 1:1).
    function test_A5_sourceYield_liftsNav_secondDepositorPricedAtNav() public {
        _deposit(alice, 100_000e6);
        usdg.approve(address(yieldSource), 10_000e6);
        yieldSource.simulateYield(10_000e6); // source share price rises
        // OZ 4626 virtual-share rounding floors previewRedeem by 1 unit — the conservative direction.
        assertApproxEqAbs(pm.totalNav(), 110_000e6, 1);
        assertLe(pm.totalNav(), 110_000e6, "never marks above realizable");
        uint256 sBob = _deposit(bob, 100_000e6);
        assertLt(sBob, 100_000e6);
        // Bob exits for ~what he put in: alice keeps the yield that accrued before he entered.
        vm.roll(block.number + 1);
        vm.prank(bob);
        (uint256 q,) = pm.withdraw(sBob);
        assertApproxEqRel(q, 100_000e6, 0.001e18);
    }

    // ── A-5 proper: the drain hole is closed at BOTH layers ───────────────────────────────────

    // `MockYieldAdapter.withdraw` let ANY caller pull the reserve. The production adapter is onlyVault.
    function test_A5_nonVaultCannotDrainAdapter() public {
        _deposit(alice, 100_000e6);
        vm.prank(stranger);
        vm.expectRevert(MintwareERC4626YieldAdapter.OnlyVault.selector);
        adapter.withdraw(100_000e6);
        vm.prank(stranger);
        vm.expectRevert(MintwareERC4626YieldAdapter.OnlyVault.selector);
        adapter.deposit(1);
        // Not even the controller / owner — only the staging (the wired vault) may move funds.
        vm.prank(address(pm));
        vm.expectRevert(MintwareERC4626YieldAdapter.OnlyVault.selector);
        adapter.withdraw(1);
        vm.expectRevert(MintwareERC4626YieldAdapter.OnlyVault.selector);
        adapter.withdraw(1); // owner (this)
        assertEq(usdg.balanceOf(address(yieldSource)), 100_000e6, "nothing left the source");
    }

    // And the 4626 shares are the adapter's — a stranger can't redeem them out from under it.
    function test_A5_strangerCannotRedeemAdapterShares() public {
        _deposit(alice, 100_000e6);
        vm.prank(stranger);
        vm.expectRevert();
        yieldSource.redeem(1, stranger, address(adapter));
    }

    // The withdraw sink is set ONCE; a re-settable sink would be a drain vector for a compromised owner key.
    function test_A5_setVault_oneTime_andOwnerOnly() public {
        vm.expectRevert(MintwareERC4626YieldAdapter.VaultAlreadySet.selector);
        adapter.setVault(stranger);
        MintwareERC4626YieldAdapter fresh =
            new MintwareERC4626YieldAdapter(address(usdg), address(yieldSource), address(0), address(this));
        vm.prank(stranger);
        vm.expectRevert();
        fresh.setVault(stranger);
    }

    // Mis-wired source (a 4626 over a DIFFERENT asset) is rejected at construction — a Bunni-class guard.
    function test_A5_adapterRejectsWrongAssetSource() public {
        MockERC4626 wrong = new MockERC4626(IERC20(address(pons)));
        vm.expectRevert(MintwareERC4626YieldAdapter.AssetMismatch.selector);
        new MintwareERC4626YieldAdapter(address(usdg), address(wrong), address(0), address(this));
    }

    // Factory path: the factory creates the staging internally, so the adapter's vault MUST be wired to
    // that staging afterwards — until then every deposit fails closed (OnlyVault), it can't silently
    // mis-route. This is the operational step the deploy script now performs (`adapter.setVault(staging)`).
    function test_A5_factoryPath_depositsFailClosedUntilVaultWired() public {
        MintwareERC4626YieldAdapter fa =
            new MintwareERC4626YieldAdapter(address(usdg), address(yieldSource), address(0), address(this));
        MintwareLpGatewayFactory factory =
            new MintwareLpGatewayFactory(IPoolManager(address(new MockSlot0PoolManager())), IPositionManager(stub), IPermit2Minimal(stub), address(this));
        (address stagingAddr, address pmAddr) =
            factory.createGateway(key, IERC20(address(usdg)), IYieldAdapter(address(fa)), -600, 600, address(this), harvestSink, 2000);
        MintwareLpGatewayPositionManager fpm = MintwareLpGatewayPositionManager(pmAddr);

        vm.prank(alice);
        usdg.approve(pmAddr, type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(MintwareERC4626YieldAdapter.OnlyVault.selector);
        fpm.deposit(1_000e6);

        fa.setVault(stagingAddr);
        vm.roll(block.number + 1);
        vm.prank(alice);
        assertEq(fpm.deposit(1_000e6), 1_000e6);
        assertEq(fpm.totalNav(), 1_000e6);
    }

    // ── A-1 re-credit against the REAL adapter's degraded modes ───────────────────────────────

    // Per-block withdraw cap (the adapter's own drain bound): only 30k of a 100k claim can leave this block.
    // The withdrawer gets 30k and is re-credited shares for the 70k — recovered next block. No loss.
    function test_A5_A1_perBlockCap_reCreditsUnserved() public {
        uint256 shares = _deposit(alice, 100_000e6);
        adapter.setPerBlockWithdrawCap(30_000e6);
        assertEq(pm.totalNav(), 100_000e6, "NAV still reports full principal");
        assertEq(staging.maxUnstageable(), 30_000e6);

        uint256 balBefore = usdg.balanceOf(alice);
        uint256 b0 = block.number;
        vm.roll(b0 + 1);
        vm.prank(alice);
        (uint256 q,) = pm.withdraw(shares);
        assertEq(q, 30_000e6);
        assertEq(pm.sharesOf(alice), 70_000e6, "unserved 70% re-credited");
        assertEq(pm.totalShares(), 70_000e6);

        adapter.setPerBlockWithdrawCap(0); // unlimited again
        vm.roll(b0 + 2);
        vm.prank(alice);
        (uint256 q2,) = pm.withdraw(70_000e6);
        assertEq(q2, 70_000e6);
        assertEq(usdg.balanceOf(alice) - balBefore, 100_000e6, "full principal recovered");
        assertEq(pm.totalShares(), 0);
    }

    // Stalled source (redeem reverts — a paused Morpho): the adapter's best-effort exit serves 0 rather than
    // reverting; the PM re-credits EVERY share. Withdraw never bricks (M-01) and nothing is stranded (A-1).
    function test_A5_A1_stalledSource_servesZero_fullReCredit_thenRecovers() public {
        uint256 shares = _deposit(alice, 100_000e6);
        yieldSource.setFailWithdrawals(true);

        uint256 balBefore = usdg.balanceOf(alice);
        uint256 b0 = block.number;
        vm.roll(b0 + 1);
        vm.prank(alice);
        (uint256 q, uint256 p) = pm.withdraw(shares); // does NOT revert
        assertEq(q, 0);
        assertEq(p, 0);
        assertEq(pm.sharesOf(alice), shares, "every share re-credited - claim fully intact");
        assertEq(pm.totalShares(), shares);
        assertEq(pm.totalNav(), 100_000e6);

        yieldSource.setFailWithdrawals(false);
        vm.roll(b0 + 2);
        vm.prank(alice);
        (uint256 q2,) = pm.withdraw(shares);
        assertApproxEqAbs(q2, 100_000e6, 2);
        assertApproxEqAbs(usdg.balanceOf(alice) - balBefore, 100_000e6, 2);
    }

    // ── fee-charging source: NAV is fee-NET, never over-reported ──────────────────────────────

    // A source with an exit fee (XyloVault-shaped, 10 bps) must not overstate what depositors can actually
    // realize — `totalAssets` via `previewRedeem` marks it net, and the exit delivers exactly that.
    function test_A5_feeChargingSource_navIsFeeNet() public {
        MockFeeERC4626 feeSrc = new MockFeeERC4626(IERC20(address(usdg)), 10);
        MintwareERC4626YieldAdapter fa =
            new MintwareERC4626YieldAdapter(address(usdg), address(feeSrc), address(0), address(this));
        MintwareLpGatewayStaging fs = new MintwareLpGatewayStaging(IERC20(address(usdg)), fa);
        fa.setVault(address(fs));
        MintwareLpGatewayPositionManager fpm = new MintwareLpGatewayPositionManager(
            IPoolManager(address(new MockSlot0PoolManager())), IPositionManager(stub), IPermit2Minimal(stub),
            key, IERC20(address(usdg)), -600, 600, fs, address(this), harvestSink, 2000
        );
        fs.setController(address(fpm));

        vm.prank(alice);
        usdg.approve(address(fpm), type(uint256).max);
        vm.prank(alice);
        uint256 s = fpm.deposit(100_000e6);
        assertEq(fpm.totalNav(), 99_900e6, "NAV marked net of the 10 bps exit fee");

        uint256 balBefore = usdg.balanceOf(alice);
        vm.roll(block.number + 1);
        vm.prank(alice);
        (uint256 q,) = fpm.withdraw(s);
        assertLe(q, 99_900e6, "never pays more than the fee-net mark");
        assertGe(q, 99_800e6, "and pays ~all of it");
        assertEq(usdg.balanceOf(alice) - balBefore, q);
    }
}
