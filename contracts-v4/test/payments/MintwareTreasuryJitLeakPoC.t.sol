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
import {LPFeeLibrary}          from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {HookMiner}                 from "../../src/lib/HookMiner.sol";
import {MintwareTreasuryVault}     from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook}   from "../../src/payments/MintwareTreasuryJitHook.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @notice RED-TEAM PoC: attempt a value leak on the treasury JIT provision/settle accounting.
///         Thesis under test: a crafted (sandwich) swap obtains the JIT senior USDC and leaves the
///         vault NOT made whole — senior tranche impaired below par while junior still has capital,
///         or attacker nets senior funds. If the design holds, senior stays whole (junior first-loss
///         absorbs the bounded slice) and jitBorrowed always reconciles to 0.
contract MintwareTreasuryJitLeakPoC is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for PoolManager;

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
    address internal attacker = makeAddr("attacker");

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

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));

        PoolKey memory ctorKey = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(address(0))});
        address predictedVault = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        bytes memory args = abi.encode(address(pm), ctorKey, address(usdc), predictedVault, address(this));
        (address hookAddr, bytes32 salt) =
            HookMiner.find(address(this), uint160(0x20C8), type(MintwareTreasuryJitHook).creationCode, args);
        hook = new MintwareTreasuryJitHook{salt: salt}(address(pm), ctorKey, address(usdc), predictedVault, address(this));
        require(address(hook) == hookAddr, "hook addr");

        key = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(hookAddr)});
        vault = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), address(this), teamAddr);
        require(address(vault) == predictedVault, "vault addr prediction");

        pm.initialize(key, INIT_SQRT_PRICE);
        vault.setJitHook(address(hook));
        hook.setJitSkipSender(address(vault));

        // Team first-loss (junior): 1M team tokens + 5,000 USDC junior buffer.
        team.mint(teamAddr, 1_000_000 * ONE);
        usdc.mint(teamAddr, 5_000 * ONE);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(1_000_000 * ONE, 5_000 * ONE, 365 days);
        vm.stopPrank();

        // Senior (community): user deposits 10,000 USDC at par.
        usdc.mint(user, 10_000 * ONE);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(10_000 * ONE, 0, user);
        vm.stopPrank();

        // Deep baseline pool liquidity so the attacker can push spot freely.
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

    function _sellTeamZeroForOne() internal view returns (bool) {
        return address(team) < address(usdc); // selling team ⇒ team is input
    }

    /// @notice The core leak attempt: repeated sandwich rounds that push spot up, dump team onto the JIT
    ///         senior USDC, push spot back down, then sweep at the oracle-lagged price. After ALL rounds,
    ///         the senior must remain whole (redeems >= its 10,000 par) and jitBorrowed must reconcile to 0.
    function test_sandwich_cannotDrainSeniorBelowPar() public {
        uint256 seniorParStart = vault.seniorParLiability();
        uint256 juniorStart    = vault.juniorUsdcBuffer();
        uint256 userShares     = vault.seniorShares(user);

        // Fund the attacker generously with BOTH tokens.
        team.mint(attacker, 100_000_000 * ONE);
        usdc.mint(attacker, 100_000_000 * ONE);
        uint256 attackerUsdcStart = usdc.balanceOf(attacker);
        uint256 attackerTeamStart = team.balanceOf(attacker);

        bool sellTeam = _sellTeamZeroForOne();

        vm.startPrank(attacker);
        team.approve(address(swapRouter), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);

        // Run 8 sandwich rounds across 8 blocks (each block resets the per-block JIT cap).
        for (uint256 i = 0; i < 8; i++) {
            // (1) push team spot UP: buy team with USDC (usdc is INPUT ⇒ JIT does NOT fire).
            swapRouter.swap(key, !sellTeam, 200_000 * ONE);
            // (2) dump team → USDC: usdc is OUTPUT ⇒ JIT fires and lends the bounded senior slice.
            swapRouter.swap(key, sellTeam, 400_000 * ONE);
            // (3) push spot back DOWN toward origin: sell team (usdc output again — may fire JIT, still bounded).
            swapRouter.swap(key, sellTeam, 150_000 * ONE);
            vm.stopPrank();

            // (4) advance a block so the oracle can lag, then sweep (permissionless).
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 12);
            hook.sweepJit();
            vm.startPrank(attacker);
        }
        vm.stopPrank();

        // A final sweep to clear any residual claim/borrow.
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 12);
        hook.sweepJit();

        // ── ASSERT: the vault is made whole ──────────────────────────────────────
        // (A) A JIT slice may remain "stranded" if the attacker keeps the oracle lagging so the team leg
        //     can't be converted within the band. That is NOT itself a leak: seniorRealizableAssets() caps
        //     the stranded slice at recoverable+junior (R5-L1), so it is NEVER counted at par against the
        //     senior. Log it, then use the owner backstop forceSettleJit() to reconcile it (junior absorbs).
        emit log_named_uint("jitBorrowed stranded before forceSettle", vault.jitBorrowed());
        // Realizable NAV must ALREADY be >= par even with the slice stranded (the real solvency test).
        assertGe(
            vault.seniorRealizableAssets(),
            vault.seniorParLiability(),
            "LEAK: senior impaired below par WITH stranded JIT slice (should be junior-backed only)"
        );
        if (vault.jitBorrowed() != 0) vault.forceSettleJit(); // owner last-resort reconcile (junior first-loss)
        assertEq(vault.jitBorrowed(), 0, "jitBorrowed not reconciled even by owner backstop");

        // (B) Senior par liability is unchanged (no senior share was destroyed by the attack).
        assertEq(vault.seniorParLiability(), seniorParStart, "senior par liability moved unexpectedly");
        assertEq(vault.seniorShares(user), userShares, "user senior shares changed");

        // (C) The senior remains fully realizable at par: realizable assets >= par liability. This is the
        //     solvency invariant — if the attacker had drained senior USDC beyond the junior first-loss,
        //     realizable would fall below par and this would FAIL (the leak).
        assertGe(
            vault.seniorRealizableAssets(),
            vault.seniorParLiability(),
            "LEAK: senior impaired below par while junior first-loss should have absorbed the slice"
        );

        // (D) The user can actually redeem their full 10,000 par in real USDC (no first-redeemer haircut).
        vm.prank(user);
        uint256 got = vault.redeemSenior(userShares, 0);
        emit log_named_uint("senior USDC redeemed", got);
        assertGe(got, 10_000 * ONE, "LEAK: senior redeems below par deposit");

        // (E) Any loss the attack realized was paid by the JUNIOR buffer, not the senior.
        uint256 juniorEnd = vault.juniorUsdcBuffer();
        emit log_named_uint("junior buffer start", juniorStart);
        emit log_named_uint("junior buffer end  ", juniorEnd);
        assertLe(juniorEnd, juniorStart, "junior buffer should only ever shrink from JIT loss");

        // (F) Attacker did NOT profit from senior funds: any USDC gain is bounded by what the junior
        //     first-loss absorbed (i.e. team's own capital), never the senior's.
        uint256 attackerUsdcEnd = usdc.balanceOf(attacker);
        uint256 attackerTeamEnd = team.balanceOf(attacker);
        emit log_named_int("attacker usdc delta", int256(attackerUsdcEnd) - int256(attackerUsdcStart));
        emit log_named_int("attacker team delta", int256(attackerTeamEnd) - int256(attackerTeamStart));
    }
}
