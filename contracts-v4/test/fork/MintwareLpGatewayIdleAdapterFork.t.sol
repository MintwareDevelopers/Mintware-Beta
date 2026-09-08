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
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

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

    address internal RECIP = address(0xFEE5);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
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
            poolManager, posm, IPermit2Minimal(PERMIT2), key, IERC20(address(quote)), TL, TU, staging, address(this), RECIP, 500
        );
        staging.setController(address(pm));

        swapper = new PoolSwapTest(poolManager);

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
        pm.deploy(30_000e18, 30_000e18, 0, block.timestamp);
        assertGt(pm.tokenId(), 0, "position minted");
        assertGt(pm.deployedPrincipal(), 0);
        // NAV does NOT stay at 60k -- `deploy`'s paired leg (30k) comes from the OWNER's own balance, not
        // depositor funds (documented design residual: "owner paired-leg subsidy accounting", lp-gateway.md),
        // and totalNav prices the whole LP position (both legs) at spot. So one deploy at the 50% MAX_DEPLOY_BPS
        // boundary roughly DOUBLES the deployed slice's NAV contribution: idle (30k) + LP (30k quote + 30k
        // owner-subsidized paired, ~1:1 pool) ≈ 90k, not 60k. This is the same mechanism IA-11/IA-11b below
        // measure precisely -- not an idle-adapter-specific bug (identical with the real 4626 adapter).
        assertApproxEqRel(pm.totalNav(), 90_000e18, 0.01e18, "NAV rises by the owner's paired-leg subsidy across deploy");

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
        // Deliberately offer more quote than the balanced mint can consume → guaranteed leftover. 25k/5k, not
        // 40k/20k -- MAX_DEPLOY_BPS caps a single deploy's quote leg at 50% of the 60k deposit (30k); 40k would
        // legitimately revert `DeployCapExceeded` before ever reaching the re-stage leg this test targets.
        vm.recordLogs();
        pm.deploy(25_000e18, 5_000e18, 0, block.timestamp);

        assertGt(pm.tokenId(), 0, "the LP add itself succeeded despite the failed re-stage");
        uint256 parked = quote.balanceOf(address(pm));
        assertGt(parked, 0, "leftover quote parked in the PM (RestageDeferred), not lost");
        // Parked quote is still inside NAV — R3-INV-2 holds with the idle adapter underneath.
        assertEq(pm.totalNav(), quote.balanceOf(address(adapter)) + parked + _lpValue(), "parked quote is priced");

        // …and the NEXT deploy consumes the parked quote first.
        adapter.setDepositCap(CAP); // reopen so the loop is normal again
        vm.roll(b0 + 2);
        uint256 parkedBefore = quote.balanceOf(address(pm));
        pm.deploy(parkedBefore / 2, 5_000e18, 0, block.timestamp);
        assertLt(quote.balanceOf(address(pm)), parkedBefore, "parked quote was drawn down first");
    }

    function _lpValue() internal view returns (uint256) {
        // totalNav = idle + LP@spot; back out the LP leg by difference so the assertion above stays honest
        // without duplicating the PM's internal math.
        uint256 idle = staging.stagedAssets() + quote.balanceOf(address(pm));
        return pm.totalNav() - idle;
    }

    // ── TARGET 2 (extended): what `depositCap` actually bounds ────────────────────────────────

    /// IA-11 (FINDING — the cap does NOT bound total value at risk): `depositCap` bounds the ADAPTER's balance,
    /// i.e. the IDLE leg only. Once `deploy()` moves capital into the LP the headroom reopens, so fresh
    /// deposits refill it and total depositor value climbs ABOVE the cap. `MAX_DEPLOY_BPS = 5000` makes the
    /// series converge to 2 × cap, not 1 ×.
    ///
    /// This directly contradicts the deployment record the mainnet script writes:
    ///   "depositCap {…} atomic (owner-adjustable, this IS the bound on total value at risk while unaudited)"
    /// and the preflight row "LP_GATEWAY_DEPOSIT_CAP set (bounds total value at risk while unaudited)".
    function test_forkIA_11_FINDING_capBoundsIdleOnly_totalValueExceedsIt() public onlyFork {
        vm.prank(alice);
        pm.deposit(CAP); // gateway full at its stated bound
        assertEq(pm.totalNav(), CAP);
        assertEq(adapter.maxSuppliable(), 0, "no headroom - for now");

        uint256 b0 = block.number;
        vm.roll(b0 + 1);
        pm.deploy(CAP / 2, CAP / 2, 0, block.timestamp); // the max MAX_DEPLOY_BPS allows

        // Deploying REOPENED the cap: the adapter's balance fell, so the door is open again.
        uint256 headroom = adapter.maxSuppliable();
        assertGt(headroom, 0, "cap headroom reopened purely by moving capital into the LP");

        vm.roll(b0 + 2);
        vm.prank(bob);
        pm.deposit(headroom); // a second depositor refills the idle leg to the cap

        assertApproxEqAbs(quote.balanceOf(address(adapter)), CAP, 1e18, "idle leg back at the cap");
        assertGt(pm.totalNav(), CAP, "IA-11: total depositor value at risk is now ABOVE the deposit cap");
        assertApproxEqRel(pm.totalNav(), (CAP * 3) / 2, 0.05e18, "~1.5x after one round; converges to 2x");
    }

    /// IA-11b: and the ceiling really is 2x, not unbounded — `MAX_DEPLOY_BPS` keeps deployed principal <= idle,
    /// so idle <= cap implies deployed <= cap. Worth stating precisely so the operator can size the cap.
    function test_forkIA_11b_ceilingIsTwiceTheCap_notUnbounded() public onlyFork {
        vm.prank(alice);
        pm.deposit(CAP);
        uint256 b0 = block.number;
        for (uint256 i = 0; i < 4; i++) {
            vm.roll(b0 + 1 + i * 2);
            uint256 idle = staging.stagedAssets();
            uint256 principal = idle + pm.deployedPrincipal();
            uint256 room = (principal * 5000) / 10_000;
            if (room <= pm.deployedPrincipal()) break;
            uint256 want = room - pm.deployedPrincipal();
            if (want > idle) want = idle;
            if (want < 1e18) break;
            pm.deploy(want, want, 0, block.timestamp);
            vm.roll(b0 + 2 + i * 2);
            uint256 head = adapter.maxSuppliable();
            if (head > 0) {
                vm.prank(bob);
                pm.deposit(head);
            }
            // INVARIANT: deployed principal never exceeds the cap, so total never exceeds 2x.
            assertLe(pm.deployedPrincipal(), CAP, "deployed principal stays <= cap");
            assertLe(quote.balanceOf(address(adapter)), CAP, "idle stays <= cap");
        }
        assertLe(pm.totalNav(), 2 * CAP + 1e18, "IA-11b: total value at risk is bounded by ~2x the deposit cap");
        assertGt(pm.totalNav(), CAP, "but is genuinely above 1x");
    }
}
