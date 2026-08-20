// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MintwareStagedLiquidityRouter, IPairVaultLike} from "../src/vaults/MintwareStagedLiquidityRouter.sol";
import {LockTier} from "../src/vaults/VaultTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockYieldAdapter} from "./mocks/MockYieldAdapter.sol";

/// @dev Minimal pair vault stand-in: pulls both sides via `depositFor`, credits LP to `recipient`,
///      enforces `minShares`. Exercises the router's LP-formation seam without V4 machinery.
contract MockPairVault is IPairVaultLike {
    IERC20 public t0;
    IERC20 public t1;
    mapping(address => uint256) public lp;

    constructor(IERC20 a, IERC20 b) { t0 = a; t1 = b; }

    function token0() external view returns (IERC20) { return t0; }
    function token1() external view returns (IERC20) { return t1; }

    function depositFor(address recipient, uint256 a0, uint256 a1, uint256 minShares, LockTier)
        external
        returns (uint256 sharesMinted)
    {
        if (a0 > 0) t0.transferFrom(msg.sender, address(this), a0);
        if (a1 > 0) t1.transferFrom(msg.sender, address(this), a1);
        sharesMinted = a0 + a1;
        require(sharesMinted >= minShares, "minShares");
        lp[recipient] += sharesMinted;
    }
}

contract MintwareStagedLiquidityRouterTest is Test {
    MintwareStagedLiquidityRouter router;
    MockERC20 tokenA; // pair token0
    MockERC20 usdc;   // pair token1 (the quote)
    MockYieldAdapter adapterA;
    MockYieldAdapter adapterUsdc;
    MockPairVault vault;

    address alice = address(0xA11CE);
    address bob   = address(0xB0B);

    uint256 constant UNIT = 1e18;

    function setUp() public {
        tokenA = new MockERC20("TokenA", "TKA", 18);
        usdc   = new MockERC20("USDC", "USDC", 18);
        adapterA    = new MockYieldAdapter(address(tokenA));
        adapterUsdc = new MockYieldAdapter(address(usdc));
        vault  = new MockPairVault(IERC20(address(tokenA)), IERC20(address(usdc)));
        router = new MintwareStagedLiquidityRouter();

        tokenA.mint(alice, 1_000_000 * UNIT);
        usdc.mint(alice, 1_000_000 * UNIT);
        tokenA.mint(bob, 1_000_000 * UNIT);
        usdc.mint(bob, 1_000_000 * UNIT);
    }

    // ── helpers ──────────────────────────────────────────────
    function _stageUsdc(address who, uint256 amount) internal returns (uint256 id) {
        vm.startPrank(who);
        usdc.approve(address(router), amount);
        id = router.stage(vault, false /* token1 */, amount, adapterUsdc);
        vm.stopPrank();
    }

    // Simulate yield: mint underlying straight into the adapter (raises totalAssets).
    function _accrue(MockYieldAdapter a, MockERC20 t, uint256 amount) internal {
        t.mint(address(a), amount);
    }

    // ── stage / earn ─────────────────────────────────────────
    function test_FirstStageBootstrapsOneToOne() public {
        uint256 id = _stageUsdc(alice, 1_000 * UNIT);
        (address owner,,,, , bool active, uint256 shares) = router.stages(id);
        assertEq(owner, alice);
        assertTrue(active);
        assertEq(shares, 1_000 * UNIT, "first stage mints 1:1");
        assertEq(router.stagedAssets(id), 1_000 * UNIT);
        assertEq(usdc.balanceOf(address(adapterUsdc)), 1_000 * UNIT, "supplied to adapter");
    }

    function test_StagedAssetsReflectYield() public {
        uint256 id = _stageUsdc(alice, 1_000 * UNIT);
        _accrue(adapterUsdc, usdc, 100 * UNIT); // +10%
        assertApproxEqAbs(router.stagedAssets(id), 1_100 * UNIT, 1e6, "principal + yield");
    }

    function test_YieldSplitsProRataByTime() public {
        // Alice stages, then 100 accrues (all hers), then Bob stages the same principal.
        uint256 idA = _stageUsdc(alice, 1_000 * UNIT);
        _accrue(adapterUsdc, usdc, 100 * UNIT);
        uint256 idB = _stageUsdc(bob, 1_000 * UNIT);

        // Alice keeps the 100 that accrued before Bob joined; Bob is ~flat at principal.
        assertApproxEqAbs(router.stagedAssets(idA), 1_100 * UNIT, 1e15, "alice keeps her yield");
        assertApproxEqAbs(router.stagedAssets(idB), 1_000 * UNIT, 1e15, "bob buys in at NAV");
    }

    function test_ZeroAmountReverts() public {
        vm.prank(alice);
        vm.expectRevert(MintwareStagedLiquidityRouter.ZeroAmount.selector);
        router.stage(vault, false, 0, adapterUsdc);
    }

    // ── unstage ──────────────────────────────────────────────
    function test_UnstageReturnsPrincipalPlusYield() public {
        uint256 id = _stageUsdc(alice, 1_000 * UNIT);
        _accrue(adapterUsdc, usdc, 50 * UNIT);
        uint256 before = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 returned = router.unstage(id);

        assertApproxEqAbs(returned, 1_050 * UNIT, 1e6);
        assertEq(usdc.balanceOf(alice) - before, returned);
        assertFalse(_active(id));
        assertEq(router.stagedAssets(id), 0);
    }

    function test_UnstageOnlyOwner() public {
        uint256 id = _stageUsdc(alice, 1_000 * UNIT);
        vm.prank(bob);
        vm.expectRevert(MintwareStagedLiquidityRouter.NotOwner.selector);
        router.unstage(id);
    }

    function test_UnstageIlliquidReverts() public {
        uint256 id = _stageUsdc(alice, 1_000 * UNIT);
        adapterUsdc.setWithdrawableCap(500 * UNIT); // adapter can only return 500 now
        vm.prank(alice);
        vm.expectRevert(MintwareStagedLiquidityRouter.AdapterIlliquid.selector);
        router.unstage(id);
    }

    // ── pair ─────────────────────────────────────────────────
    function test_PairFormsLpToOwner() public {
        uint256 id = _stageUsdc(alice, 1_000 * UNIT); // staged token1 (usdc)
        _accrue(adapterUsdc, usdc, 100 * UNIT);       // now worth ~1100

        uint256 counterparty = 2_000 * UNIT; // alice brings tokenA (the other side)
        vm.startPrank(alice);
        tokenA.approve(address(router), counterparty);
        uint256 lp = router.pair(id, counterparty, 0, LockTier.Flex);
        vm.stopPrank();

        // Vault received both sides; LP shares minted to alice (mock: shares = a0 + a1).
        assertApproxEqAbs(vault.lp(alice), lp, 0);
        assertApproxEqAbs(usdc.balanceOf(address(vault)), 1_100 * UNIT, 1e6, "staged side (with yield) paired");
        assertEq(tokenA.balanceOf(address(vault)), counterparty, "counterparty side paired");
        assertFalse(_active(id));
    }

    function test_PairRespectsTokenOrdering() public {
        // Stage token0 (tokenA) this time; counterparty is usdc (token1).
        vm.startPrank(alice);
        tokenA.approve(address(router), 500 * UNIT);
        uint256 id = router.stage(vault, true /* token0 */, 500 * UNIT, adapterA);
        usdc.approve(address(router), 800 * UNIT);
        router.pair(id, 800 * UNIT, 0, LockTier.Flex);
        vm.stopPrank();

        assertEq(tokenA.balanceOf(address(vault)), 500 * UNIT, "token0 = staged side");
        assertEq(usdc.balanceOf(address(vault)), 800 * UNIT, "token1 = counterparty");
    }

    function test_PairOnlyOwner() public {
        uint256 id = _stageUsdc(alice, 1_000 * UNIT);
        vm.startPrank(bob);
        tokenA.approve(address(router), 1_000 * UNIT);
        vm.expectRevert(MintwareStagedLiquidityRouter.NotOwner.selector);
        router.pair(id, 1_000 * UNIT, 0, LockTier.Flex);
        vm.stopPrank();
    }

    function test_PairInactiveReverts() public {
        uint256 id = _stageUsdc(alice, 1_000 * UNIT);
        vm.startPrank(alice);
        usdc.approve(address(router), 0);
        tokenA.approve(address(router), 2_000 * UNIT);
        router.pair(id, 1_000 * UNIT, 0, LockTier.Flex);
        vm.expectRevert(MintwareStagedLiquidityRouter.StageInactive.selector);
        router.pair(id, 1_000 * UNIT, 0, LockTier.Flex); // second pair on the same stage
        vm.stopPrank();
    }

    function test_PairMinSharesForwarded() public {
        uint256 id = _stageUsdc(alice, 1_000 * UNIT);
        vm.startPrank(alice);
        tokenA.approve(address(router), 1 * UNIT);
        // staged ~1000 usdc + 1 tokenA = ~1001 shares in the mock; require 5000 → vault reverts.
        vm.expectRevert(bytes("minShares"));
        router.pair(id, 1 * UNIT, 5_000 * UNIT, LockTier.Flex);
        vm.stopPrank();
    }

    function test_PairIlliquidReverts() public {
        uint256 id = _stageUsdc(alice, 1_000 * UNIT);
        adapterUsdc.setWithdrawableCap(100 * UNIT);
        vm.startPrank(alice);
        tokenA.approve(address(router), 1_000 * UNIT);
        vm.expectRevert(MintwareStagedLiquidityRouter.AdapterIlliquid.selector);
        router.pair(id, 1_000 * UNIT, 0, LockTier.Flex);
        vm.stopPrank();
    }

    // ── util ─────────────────────────────────────────────────
    function _active(uint256 id) internal view returns (bool active) {
        (,,,, , active,) = router.stages(id);
    }
}
