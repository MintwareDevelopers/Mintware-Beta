// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {HookMiner}                 from "../../src/lib/HookMiner.sol";
import {MintwareTreasuryVault}     from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook}   from "../../src/payments/MintwareTreasuryJitHook.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @notice Increment 2 of #5: the REAL V4 JIT hook against a genuine in-test PoolManager. A trader's
///         team→USDC swap fires the hook (borrow a bounded slice → open a tight single-sided USDC
///         position → close → mint ERC-6909 claims for the afterSwap gotcha); then a keeper `sweepJit()`
///         redeems the claims, swaps team→USDC, and settles with the vault — leaving `jitBorrowed` at 0
///         and the senior whole. Both tokens 6dp at a 1:1 pool.
contract MintwareTreasuryJitHookTest is Test {
    PoolManager             internal pm;
    TestSwapRouter          internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;

    MockERC20                internal usdc; // 6dp
    MockERC20                internal team; // 6dp
    MockYieldAdapter         internal adapter;
    MintwareTreasuryVault    internal vault;
    MintwareTreasuryJitHook  internal hook;
    PoolKey                  internal key;

    address internal teamAddr = makeAddr("team");
    address internal user     = makeAddr("user");
    address internal trader   = makeAddr("trader");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant ONE = 1e6;

    function setUp() public {
        pm         = new PoolManager(address(this));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);
        adapter = new MockYieldAdapter(address(usdc));
        vault = new MintwareTreasuryVault(address(usdc), address(team), address(adapter), address(this), teamAddr); // owner=this

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));

        // Mine the hook address (beforeSwap|afterSwap = 0xC0). The ctor ignores key.hooks, so a
        // placeholder-hooks key is fine for the initcode; the pool + hook agree on the real address.
        PoolKey memory ctorKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        bytes memory args = abi.encode(address(pm), ctorKey, address(usdc), address(vault), address(this));
        (address hookAddr, bytes32 salt) =
            HookMiner.find(address(this), uint160(0xC0), type(MintwareTreasuryJitHook).creationCode, args);
        hook = new MintwareTreasuryJitHook{salt: salt}(address(pm), ctorKey, address(usdc), address(vault), address(this));
        require(address(hook) == hookAddr, "hook addr");

        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(hookAddr)});
        pm.initialize(key, INIT_SQRT_PRICE);

        // Team commit + community deposit ($10k senior → Aave idle backs the JIT borrow).
        team.mint(teamAddr, 1_000_000 * ONE);
        usdc.mint(teamAddr, 5_000 * ONE);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(1_000_000 * ONE, 5_000 * ONE, 365 days); // $5k junior buffer backstop
        vm.stopPrank();
        usdc.mint(user, 10_000 * ONE);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(10_000 * ONE, 0, user);
        vm.stopPrank();

        vault.setJitHook(address(hook)); // owner=this

        // Deep baseline liquidity on the pool.
        usdc.mint(address(this), 50_000_000 * ONE);
        team.mint(address(this), 50_000_000 * ONE);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 5_000_000 * int256(uint256(ONE)), salt: bytes32(0)}),
            ""
        );
    }

    /// team→USDC = the direction that SELLS the team token (output USDC).
    function _sellTeamZeroForOne() internal view returns (bool) {
        return address(team) < address(usdc); // team is currency0 → zeroForOne sells it
    }

    function test_traderSwap_firesJit_thenSweepMakesSeniorWhole() public {
        uint256 navBefore = vault.totalSeniorAssets();

        // A trader sells team for USDC — large enough to matter.
        team.mint(trader, 1_000_000 * ONE);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _sellTeamZeroForOne(), 2_000 * ONE);
        vm.stopPrank();

        // JIT fired: it borrowed (outstanding until the sweep) and closed into ERC-6909 claims.
        assertGt(vault.jitBorrowed(), 0, "JIT did not borrow / stayed unsettled");
        assertGt(hook.usdcClaim() + hook.teamClaim(), 0, "no claims minted on close");
        // NAV is preserved through the open (jitBorrowed counted at par).
        assertApproxEqAbs(vault.totalSeniorAssets(), navBefore, 2, "senior NAV moved while JIT open");

        // Keeper sweeps: redeem claims → team → USDC → settle. Senior made whole, borrow cleared.
        uint256 returned = hook.sweepJit();
        assertGt(returned, 0, "sweep returned no USDC");
        assertEq(vault.jitBorrowed(), 0, "jitBorrowed not cleared after sweep");
        assertEq(hook.usdcClaim(), 0, "usdc claims not cleared");
        assertEq(hook.teamClaim(), 0, "team claims not cleared");
        // Senior is whole (the junior buffer backstops any close cost); a captured fee only lifts it.
        assertGe(vault.totalSeniorAssets() + 5 * ONE, navBefore, "senior lost more than a bounded amount");
    }

    function test_usdcToTeamSwap_doesNotFireJit() public {
        // Buying team (output = team) can't be JIT-funded (no team adapter) — no borrow.
        usdc.mint(trader, 100_000 * ONE);
        vm.startPrank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, !_sellTeamZeroForOne(), 2_000 * ONE);
        vm.stopPrank();
        assertEq(vault.jitBorrowed(), 0, "JIT fired on a USDC->team swap");
        assertEq(hook.usdcClaim() + hook.teamClaim(), 0, "claims minted on a non-JIT direction");
    }

    function test_sweep_noop_when_nothing_pending() public {
        assertEq(hook.sweepJit(), 0, "sweep returned value with nothing pending");
    }
}
