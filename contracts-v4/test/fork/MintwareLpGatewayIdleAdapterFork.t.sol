// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareIdleYieldAdapter} from "../../src/vaults/MintwareIdleYieldAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice ADVERSARIAL fork pass: `MintwareIdleYieldAdapter` composed into the FULL gateway stack against the
///         REAL Uniswap V4 periphery (Robinhood Chain testnet by default) — the deploy / harvest /
///         compoundQuote / re-stage legs the Stub unit rigs cannot reach. Mirrors
///         `MintwareLpGatewayHardeningFork.t.sol`'s rig, swapping the production 4626 adapter for the idle one.
///         SELF-SKIPS when `LP_FORK_RPC_URL` is unset.
///
///         Run: LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com \
///              forge test --match-contract MintwareLpGatewayIdleAdapterFork -vv
contract MintwareLpGatewayIdleAdapterForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant RH_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 constant SQRT_1 = 79228162514264337593543950336;

    bool internal live;
    IPoolManager internal poolManager;
    MintwareLpGatewayStaging internal staging;
    MintwareLpGatewayPositionManager internal pm;
    MintwareIdleYieldAdapter internal adapter;
    MockERC20 internal quote;
    MockERC20 internal paired;
    PoolKey internal key;
    PoolSwapTest internal swapper;
    PoolModifyLiquidityTest internal seeder;

    address internal RECIP = address(0xFEE5);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal seederLp = address(0x5EED);
    int24 internal constant TL = -22980;
    int24 internal constant TU = 22980;

    /// The bounded cap idle mode exists for.
    uint256 internal constant CAP = 100_000e18;

    event RestageDeferred(uint256 quoteLeft);

    function setUp() public {
        string memory rpc = vm.envOr("LP_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            live = false;
            return;
        }
        vm.createSelectFork(rpc);
        live = true;

        poolManager = IPoolManager(vm.envOr("LP_POOL_MANAGER", RH_POOL_MANAGER));
        IPositionManager posm = IPositionManager(vm.envOr("LP_POSITION_MANAGER", RH_POSITION_MANAGER));

        MockERC20 a = new MockERC20("Quote", "Q", 18);
        MockERC20 b = new MockERC20("Paired", "P", 18);
        (MockERC20 c0, MockERC20 c1) = address(a) < address(b) ? (a, b) : (b, a);
        quote = a;
        paired = b;

        // The idle adapter, wired EXACTLY as the mainnet script does it: vault = ZERO at construction,
        // owner = the gateway seat, cap set at construction, `setVault(staging)` as a later transaction.
        adapter = new MintwareIdleYieldAdapter(address(quote), address(0), address(this), CAP);
        key = PoolKey({
            currency0: Currency.wrap(address(c0)),
            currency1: Currency.wrap(address(c1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        poolManager.initialize(key, SQRT_1);

        staging = new MintwareLpGatewayStaging(IERC20(address(quote)), adapter);
        adapter.setVault(address(staging));
        pm = new MintwareLpGatewayPositionManager(
            poolManager, posm, IPermit2Minimal(PERMIT2), key, IERC20(address(quote)), TL, TU, staging, address(this), RECIP, 500,
            type(uint256).max // IA-11 principal cap: uncapped -- this test predates/is unrelated to the cap
        );
        staging.setController(address(pm));

        swapper = new PoolSwapTest(poolManager);

        // Earn-vs-LP decision (2026-09-08): `deploy()` now swaps part of the user's own quote into the
        // paired leg ATOMICALLY, in-contract -- exactly like a real production pool, this needs a
        // THIRD-PARTY LP already in the pool for that swap to trade against (a brand-new pool has nothing
        // to swap into). Seed one here, wide enough to cover the gateway's own range with room to spare,
        // mirroring how the gateway is only ever meant to deploy into an EXISTING, already-liquid pool.
        seeder = new PoolModifyLiquidityTest(poolManager);
        quote.mint(seederLp, 10_000_000e18);
        paired.mint(seederLp, 10_000_000e18);
        vm.startPrank(seederLp);
        quote.approve(address(seeder), type(uint256).max);
        paired.approve(address(seeder), type(uint256).max);
        seeder.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TL - key.tickSpacing,
                tickUpper: TU + key.tickSpacing,
                liquidityDelta: 10_000_000e18,
                salt: bytes32(0)
            }),
            bytes("")
        );
        vm.stopPrank();

        quote.mint(alice, 1_000_000e18);
        quote.mint(bob, 1_000_000e18);
        quote.mint(address(this), 1_000_000e18);
        paired.mint(address(this), 1_000_000e18);
        vm.prank(alice);
        quote.approve(address(pm), type(uint256).max);
        vm.prank(bob);
        quote.approve(address(pm), type(uint256).max);
        quote.approve(address(pm), type(uint256).max);
        paired.approve(address(pm), type(uint256).max);
        quote.approve(address(swapper), type(uint256).max);
        paired.approve(address(swapper), type(uint256).max);
    }

    modifier onlyFork() {
        if (!live) return;
        _;
    }

    function _swap(bool zeroForOne, int256 amt) internal {
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        swapper.swap(
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: amt, sqrtPriceLimitX96: limit}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            bytes("")
        );
    }

    // ── TARGET 1: the whole loop, on the idle adapter, through real V4 ────────────────────────

    /// IA-F1 (CONFIRMS SAFE): deposit → deploy → swap (fees accrue) → harvest → withdraw, end to end, with
    /// balance-based (no share-price) idle accounting underneath. `_syncIdle` / `totalNav` / `deployedPrincipal`
    /// all track correctly; the virtual-offset math is indifferent to the idle leg being a raw balance.
    function test_forkIA_F1_fullCycle_depositDeployHarvestWithdraw() public onlyFork {
        vm.prank(alice);
        uint256 sh = pm.deposit(60_000e18);
        assertEq(sh, 60_000e18);
        assertEq(pm.totalNav(), 60_000e18);
        assertEq(quote.balanceOf(address(adapter)), 60_000e18, "idle custody is the adapter itself");

        uint256 b0 = block.number;
        // Earn-vs-LP decision (2026-09-08): 100% deployed (MAX_DEPLOY_BPS=10000, no held-back buffer), half
        // swapped in-contract into the paired leg -- Mintware supplies nothing.
        pm.deploy(60_000e18, 30_000e18, 0, 0, block.timestamp);
        assertGt(pm.tokenId(), 0, "position minted");
        assertGt(pm.deployedPrincipal(), 0);
        // The paired leg is now 100% USER value that changed form via the in-contract swap -- there is no
        // owner subsidy left to inflate NAV, so it stays ~60k across deploy (modulo swap-fee/rounding dust).
        assertApproxEqRel(pm.totalNav(), 60_000e18, 0.01e18, "NAV stays ~60k across deploy -- no owner subsidy any more");

        vm.roll(b0 + 1);
        _swap(true, 5_000e18);
        _swap(false, 5_000e18);

        uint256 recipBefore = quote.balanceOf(RECIP) + paired.balanceOf(RECIP);
        vm.roll(b0 + 2);
        pm.harvest(block.timestamp);
        assertGt(quote.balanceOf(RECIP) + paired.balanceOf(RECIP), recipBefore, "fees swept to the buffer");

        vm.roll(b0 + 3);
        vm.prank(alice);
        (uint256 q, uint256 p) = pm.withdraw(sh);
        assertGt(q, 0, "quote leg delivered");
        assertGt(p, 0, "paired leg delivered");
        assertApproxEqRel(pm.totalShares(), 0, 0.001e18);
    }

    /// IA-F1b (CONFIRMS SAFE): `compoundQuote` — the recommended `restake` harvest destination — works through
    /// the idle adapter and lifts NAV pro-rata with no share mint, SO LONG AS there is cap headroom (see IA-4).
    function test_forkIA_F1b_compoundQuote_liftsNavWithHeadroom() public onlyFork {
        vm.prank(alice);
        uint256 sh = pm.deposit(50_000e18);
        uint256 navBefore = pm.totalNav();
        pm.compoundQuote(1_000e18);
        assertEq(pm.totalNav(), navBefore + 1_000e18);
        assertEq(pm.totalShares(), sh, "pure accretion, no mint");
    }

    // ── TARGET 1: does `deploy()`'s re-stage try/catch handle DepositCapExceeded? ─────────────

    /// IA-F2 (CONFIRMS SAFE — the specific question asked): the R3-2 `RestageDeferred` try/catch was written
    /// for Morpho's `ERC4626ExceededMaxDeposit`. A bare `catch` also swallows the idle adapter's
    /// `DepositCapExceeded`, so a deploy whose leftover quote cannot be re-staged still SUCCEEDS, parks the
    /// leftover in the PM (where `_idle()` still counts it as depositor principal), and the next deploy
    /// consumes it. No new caller-side handling is required.
    function test_forkIA_F2_deployRestage_catchesDepositCapExceeded() public onlyFork {
        vm.prank(alice);
        pm.deposit(60_000e18);
        // Force the re-stage leg to fail: shut the cap so ANY re-supply reverts DepositCapExceeded.
        adapter.setDepositCap(0);
        assertEq(adapter.maxSuppliable(), 0);

        uint256 b0 = block.number;
        vm.roll(b0 + 1);
        // Deliberately offer more quote than a ~5k-paired-balanced mint can consume → guaranteed leftover.
        // quoteToDeploy = 30k (25k for the mint + 5k swapped to paired), same composition the old
        // owner-supplied "25k quote / 5k paired" call produced -- well within MAX_DEPLOY_BPS=10000 now.
        vm.recordLogs();
        pm.deploy(30_000e18, 5_000e18, 0, 0, block.timestamp);

        assertGt(pm.tokenId(), 0, "the LP add itself succeeded despite the failed re-stage");
        uint256 parked = quote.balanceOf(address(pm));
        assertGt(parked, 0, "leftover quote parked in the PM (RestageDeferred), not lost");
        // Parked quote is still inside NAV — R3-INV-2 holds with the idle adapter underneath.
        assertEq(pm.totalNav(), quote.balanceOf(address(adapter)) + parked + _lpValue(), "parked quote is priced");

        // …and the NEXT deploy consumes the parked quote first.
        adapter.setDepositCap(CAP); // reopen so the loop is normal again
        vm.roll(b0 + 2);
        uint256 parkedBefore = quote.balanceOf(address(pm));
        pm.deploy(parkedBefore / 2 + 5_000e18, 5_000e18, 0, 0, block.timestamp);
        assertLt(quote.balanceOf(address(pm)), parkedBefore, "parked quote was drawn down first");
    }

    function _lpValue() internal view returns (uint256) {
        // totalNav = idle + LP@spot; back out the LP leg by difference so the assertion above stays honest
        // without duplicating the PM's internal math.
        uint256 idle = staging.stagedAssets() + quote.balanceOf(address(pm));
        return pm.totalNav() - idle;
    }

    // ── TARGET 2 (extended): what `depositCap` actually bounds, and the on-chain fix (IA-11) ──

    /// IA-11 (STRUCTURALLY FIXED — earn-vs-lp decision, 2026-09-08): the owner-paired-subsidy mechanism this
    /// finding described no longer exists AT ALL. `deploy()` never accepts a caller/owner-supplied paired
    /// token any more — the paired leg is 100% the SAME user quote already counted in `quoteToDeploy`,
    /// converted by an in-contract swap. So `idle + deployedPrincipal + deployedPairedValue` can never exceed
    /// total user-deposited value, with or without `principalCap` — there is no mechanism left that creates
    /// NEW, uncounted value on a deploy. `principalCap` remains as an independent, deliberate ceiling on
    /// total deposits (gates growth exactly like the adapter's own `depositCap`), not as a defense against a
    /// subsidy that no longer exists.
    function test_forkIA_11_FIXED_deployNeverCreatesValue_principalCapStillGatesDeposits() public onlyFork {
        pm.setPrincipalCap(CAP);
        vm.prank(alice);
        pm.deposit(CAP); // gateway full at its stated bound
        assertEq(pm.totalNav(), CAP);
        assertEq(adapter.maxSuppliable(), 0, "adapter's own cap also exhausted");

        uint256 b0 = block.number;
        vm.roll(b0 + 1);
        // Deploying the FULL amount, half swapped to paired, needs NO principalCap headroom beyond what was
        // already deposited — there is no owner subsidy left to bound.
        pm.deploy(CAP, CAP / 2, 0, 0, block.timestamp);
        assertApproxEqRel(pm.totalNav(), CAP, 0.01e18, "deploying never creates value -- NAV stays at what was deposited");

        // principalCap still gates NEW deposits independently (unrelated to the now-deleted subsidy mechanism).
        vm.roll(b0 + 2);
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.PrincipalCapExceeded.selector);
        pm.deposit(1);
    }

    /// IA-11b (STRUCTURALLY FIXED): the multi-round deploy/refill loop that used to blow PAST even the
    /// documented "2x" figure (287.5k observed against a 200k expected ceiling on a 100k cap) can no longer
    /// compound at all — each deploy just relocates already-counted user value, so total NAV tracks total
    /// deposits exactly, round after round, and `principalCap` (not any deploy-side mechanic) is the only
    /// thing that can ever stop it from growing further.
    function test_forkIA_11b_FIXED_repeatedDeployNeverCompoundsValue() public onlyFork {
        pm.setPrincipalCap(2 * CAP);
        vm.prank(alice);
        pm.deposit(CAP);
        uint256 b0 = block.number;
        for (uint256 i = 0; i < 4; i++) {
            vm.roll(b0 + 1 + i * 2);
            uint256 idle = staging.stagedAssets();
            if (idle < 2e18) break;
            pm.deploy(idle, idle / 2, 0, 0, block.timestamp);
            assertApproxEqRel(pm.totalNav(), CAP * (i + 1), 0.02e18, "IA-11b FIXED: NAV tracks total real deposits, never compounds, at any round");
            vm.roll(b0 + 2 + i * 2);
            uint256 head = adapter.maxSuppliable();
            if (head > 0) {
                vm.prank(bob);
                try pm.deposit(head) {} catch { /* principalCap may already be at its ceiling -- that's fine, and the point */ }
            }
        }
        assertLe(pm.totalNav(), 2 * CAP, "still bounded by principalCap regardless -- but now for the honest reason: it gates deposits, not a compounding trick");
    }
}
