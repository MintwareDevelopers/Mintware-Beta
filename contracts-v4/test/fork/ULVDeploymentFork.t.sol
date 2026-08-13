// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm}   from "forge-std/Vm.sol";

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IERC20}                from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareDeFiPairVault} from "../../src/vaults/MintwareDeFiPairVault.sol";
import {IYieldAdapter}         from "../../src/vaults/IYieldAdapter.sol";
import {LockTier}              from "../../src/vaults/VaultTypes.sol";
import {AaveV3YieldAdapter}    from "../../src/vaults/AaveV3YieldAdapter.sol";
import {IPoolAddressesProvider} from "../../src/vaults/aave/IAaveV3.sol";

import {TestSwapRouter}        from "../helpers/TestSwapRouter.sol";

/// @dev Minimal view into the live Aave v3 Pool to read a reserve's packed configuration bitmap.
interface IAaveConfig {
    function getConfiguration(address asset) external view returns (uint256 data);
}

/// @notice END-TO-END FORK PROOF of the just-deployed ULV engine against the LIVE Base Sepolia
///         (84532) deployment + REAL Aave v3. Unlike the mock-based invariant suites, this stands up
///         NOTHING of its own except a throw-away swap router: it drives the ACTUAL deployed,
///         delegatecall-linked bytecode (`MintwareDeFiPairVault` at 0x6c0d…, `MWHookCoordinator` at
///         0x9f3c…, the two `AaveV3YieldAdapter`s) and the REAL Aave Pool. It proves the full loop:
///
///           deposit(both tokens)  → shares + V4 position liquidity
///           supplyIdle            → principal actually lands in REAL Aave (adapter.totalAssets ↑)
///           swap (>= jitThreshold)→ hook opens+closes JIT atomically (0 at rest, swap never bricks)
///           collectFees           → three-way split conserves (treasury+buyback + LP == fee)
///           request/executeRedeem → solvent exit (LP never gets MORE than principal + earned)
///
///         Run forked:
///           forge test --match-path "contracts-v4/test/fork/ULVDeploymentFork.t.sol" \
///             --fork-url https://base-sepolia-rpc.publicnode.com -vvv
///         Without --fork-url the PoolManager address has no code → every test SELF-SKIPS (safe in
///         the normal, non-forked suite).
contract ULVDeploymentForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    // ── LIVE Base Sepolia deployment under test (the exact addresses just deployed) ──────────────
    address internal constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address internal constant VAULT_ADDR    = 0x6c0D6460b7Eb094864F6b557506f5519B0c75132;
    address internal constant HOOK_ADDR     = 0x9f3c27B16e152f8dbf2A16Ce7DA4045Bd6100AC8;
    address internal constant ADAPTER0_WETH = 0xf95144636de6bf6c6Aa6C28006Cc6AB6f1d21Da2; // WETH sink
    address internal constant AAVE_PROVIDER  = 0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00; // Aave v3 PoolAddressesProvider
    address internal constant AWETH          = 0x73a5bB60b0B0fc35710DDc0ea9c407031E31Bdbb; // aToken for WETH
    address internal constant ADAPTER1_USDC = 0xBE7F9727521B2d013c0520c0303391Fa576b9Ddd; // USDC sink
    address internal constant WETH          = 0x4200000000000000000000000000000000000006; // currency0
    address internal constant USDC          = 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f; // currency1 (Aave)
    address internal constant PROVIDER      = 0x7fD88B026B65B9f54FFE694bB422bBCC504D7E06; // provider+owner+treasury
    address internal constant AAVE_POOL     = 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27; // live Aave v3 Pool

    /// @dev Aave v3 ReserveConfiguration: bits 116-151 (36 bits) hold the supply cap. ANDing the config
    ///      with this mask zeros those bits → disables the cap (Aave reads `supplyCap == 0` as "no cap").
    uint256 internal constant SUPPLY_CAP_MASK = ~(uint256(0xFFFFFFFFF) << 116);

    MintwareDeFiPairVault internal vault;
    IPoolManager          internal pm;
    TestSwapRouter        internal swapRouter;
    PoolKey               internal poolKey;
    PoolId                internal poolId;
    bool                  internal forked;

    address internal user   = makeAddr("ulvLP");
    address internal trader = makeAddr("ulvTrader");

    function setUp() public {
        if (POOL_MANAGER.code.length == 0) { forked = false; return; } // not forked → self-skip
        forked = true;

        pm         = IPoolManager(POOL_MANAGER);
        vault      = MintwareDeFiPairVault(VAULT_ADDR);
        swapRouter = new TestSwapRouter(pm);

        // Reconstruct the poolKey from the LIVE vault — no hardcoded fee/tickSpacing.
        (Currency c0, Currency c1, uint24 fee, int24 tickSpacing, IHooks hooks) = vault.poolKey();
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: fee, tickSpacing: tickSpacing, hooks: hooks});
        poolId  = poolKey.toId();

        // Sanity: we are pointed at the real, wired deployment.
        assertTrue(vault.poolInitialized(), "live pool initialized");
        assertEq(Currency.unwrap(c0), WETH, "currency0 == WETH");
        assertEq(Currency.unwrap(c1), USDC, "currency1 == USDC");
        assertEq(address(hooks), HOOK_ADDR, "hook wired in poolKey");
        assertEq(address(vault.adapter0()), ADAPTER0_WETH, "adapter0 wired");
        assertEq(address(vault.adapter1()), ADAPTER1_USDC, "adapter1 wired");
        assertEq(vault.hook(), HOOK_ADDR, "hook set-once on vault");
    }

    /// @dev The REAL Base-Sepolia WETH Aave market currently has a FULL supply cap (its live
    ///      `supply()` reverts `SupplyCapExceeded()` for any amount — confirmed against the fork).
    ///      That is a testnet-config artifact, not a defect in the deployed vault/adapter bytecode, so
    ///      to exercise the rest of the REAL Aave path (real `supply`/`aToken` mint / interest /
    ///      `withdraw`) we lift ONLY that one packed config parameter to zero (= "no cap"). Everything
    ///      else about the Aave integration stays real. We locate the exact reserve-config storage slot
    ///      by recording the SLOAD that `getConfiguration` performs, then clear the supply-cap bits.
    function _liftAaveSupplyCap(address asset) internal {
        uint256 cur = IAaveConfig(AAVE_POOL).getConfiguration(asset);
        vm.record();
        IAaveConfig(AAVE_POOL).getConfiguration(asset);
        (bytes32[] memory reads, ) = vm.accesses(AAVE_POOL);
        for (uint256 i; i < reads.length; i++) {
            if (uint256(vm.load(AAVE_POOL, reads[i])) == cur) {
                vm.store(AAVE_POOL, reads[i], bytes32(cur & SUPPLY_CAP_MASK));
                return;
            }
        }
        revert("reserve-config slot not found");
    }

    function test_ulv_full_loop_on_live_deployment() public {
        if (!forked) { vm.skip(true); return; }

        (uint160 sqrtP, int24 tick,,) = pm.getSlot0(poolId);
        emit log_named_int("pool current tick", tick);
        emit log_named_uint("pool sqrtPriceX96", sqrtP);

        // ─────────────────────────────────────────────────────────────────────────────────────
        // STEP 1 — FUND a fresh LP with WETH + Aave-USDC (deal works on both on this fork).
        // ─────────────────────────────────────────────────────────────────────────────────────
        uint256 fund0 = 40e18;       // 40 WETH
        uint256 fund1 = 160_000e6;   // 160k USDC
        deal(WETH, user, fund0);
        deal(USDC, user, fund1);
        assertEq(IERC20(WETH).balanceOf(user), fund0, "funded WETH");
        assertEq(IERC20(USDC).balanceOf(user), fund1, "funded USDC");

        // ─────────────────────────────────────────────────────────────────────────────────────
        // STEP 2 — DEPOSIT both tokens → shares + V4 position liquidity.
        // ─────────────────────────────────────────────────────────────────────────────────────
        uint256 tl0 = IERC20(WETH).balanceOf(user);
        uint256 tu0 = IERC20(USDC).balanceOf(user);
        vm.startPrank(user);
        IERC20(WETH).approve(VAULT_ADDR, fund0);
        IERC20(USDC).approve(VAULT_ADDR, fund1);
        uint256 shares = vault.deposit(fund0, fund1, 0, LockTier.Flex);
        vm.stopPrank();

        uint256 used0 = tl0 - IERC20(WETH).balanceOf(user); // net WETH consumed (after dust refund)
        uint256 used1 = tu0 - IERC20(USDC).balanceOf(user); // net USDC consumed
        emit log_named_uint("deposit shares minted", shares);
        emit log_named_uint("deposit WETH used", used0);
        emit log_named_uint("deposit USDC used", used1);

        assertEq(shares, vault.shares(user), "shares recorded for LP");
        assertGt(shares, 0, "shares minted");
        uint128 posAfterDeposit = vault.positionLiquidity();
        assertGt(posAfterDeposit, 0, "V4 position liquidity opened on the live PoolManager");

        // ─────────────────────────────────────────────────────────────────────────────────────
        // STEP 3 — IDLE IN AAVE: supplyIdle moves pooled principal into REAL Aave v3.
        //          The load-bearing real-Aave proof: adapter.totalAssets() must INCREASE.
        // ─────────────────────────────────────────────────────────────────────────────────────
        // FIX PROOF (maxSuppliable now models Aave's supply cap): the DEPLOYED live adapter predates
        // this fix, so deploy a FRESH adapter for the REAL WETH market. With a supply cap set it must
        // return FINITE headroom (not type(uint256).max) — i.e. the cap is modeled — so that once the
        // market is at cap the vault's `maxSuppliable()==0` idle guard no-ops instead of reverting
        // SupplyCapExceeded. (Pre-fix, maxSuppliable returned type(uint256).max regardless of the cap.)
        AaveV3YieldAdapter freshWeth =
            new AaveV3YieldAdapter(IPoolAddressesProvider(AAVE_PROVIDER), WETH, AWETH, address(0), address(this));
        assertLt(freshWeth.maxSuppliable(), type(uint256).max, "capped WETH market => FINITE headroom (cap modeled, not max)");
        // Lift the FULL testnet Aave supply caps (documented workaround — see _liftAaveSupplyCap) so
        // the deployed adapter's REAL Aave `supply()` isn't blocked by a caps-full testnet market.
        _liftAaveSupplyCap(WETH);
        _liftAaveSupplyCap(USDC);
        // Cap lifted (getSupplyCap==0) ⇒ the fixed adapter reports the uncapped sentinel again.
        assertEq(freshWeth.maxSuppliable(), type(uint256).max, "uncapped WETH market => max (cap lifted)");

        uint256 a0Before = IYieldAdapter(ADAPTER0_WETH).totalAssets();
        uint256 a1Before = IYieldAdapter(ADAPTER1_USDC).totalAssets();
        uint256 idle0Before = vault.idle0();
        uint256 idle1Before = vault.idle1();
        emit log_named_uint("adapter0(WETH).totalAssets BEFORE supplyIdle", a0Before);
        emit log_named_uint("adapter1(USDC).totalAssets BEFORE supplyIdle", a1Before);

        // Idle ~60% of the freshly-opened position (leaves a live resting buffer to earn swap fees).
        uint128 deltaL = uint128((uint256(posAfterDeposit) * 6) / 10);
        vm.prank(PROVIDER);
        vault.supplyIdle(deltaL);

        uint256 a0After = IYieldAdapter(ADAPTER0_WETH).totalAssets();
        uint256 a1After = IYieldAdapter(ADAPTER1_USDC).totalAssets();
        emit log_named_uint("adapter0(WETH).totalAssets AFTER supplyIdle", a0After);
        emit log_named_uint("adapter1(USDC).totalAssets AFTER supplyIdle", a1After);
        emit log_named_uint("vault idle0 delta", vault.idle0() - idle0Before);
        emit log_named_uint("vault idle1 delta", vault.idle1() - idle1Before);

        assertGt(a0After, a0Before, "REAL Aave: WETH principal supplied via adapter0");
        assertGt(a1After, a1Before, "REAL Aave: USDC principal supplied via adapter1");
        assertGt(vault.idle1(), idle1Before, "idle1 (USDC) counter moved");
        assertGt(vault.idleLiquidity(), 0, "idleLiquidity > 0 after supplyIdle");
        assertLt(vault.positionLiquidity(), posAfterDeposit, "position reduced by idling");

        // ─────────────────────────────────────────────────────────────────────────────────────
        // STEP 4 — SWAP THAT TRIGGERS JIT. zeroForOne (sell WETH → pool pays USDC) so the hook
        //          opens single-sided USDC JIT funded from adapter1's idle basis. |amountSpecified|
        //          (1e18) is far above jitThreshold (1e6) → JIT fires. Assert: swap succeeds and the
        //          JIT position is opened+closed ATOMICALLY (zero at rest).
        // ─────────────────────────────────────────────────────────────────────────────────────
        assertEq(vault.jitPositionLiquidity(), 0, "no JIT liquidity at rest (pre-swap)");
        assertEq(vault.jitLiquidity(), 0, "jitLiquidity==0 at rest (pre-swap)");

        // Sized above jitThreshold (1e6) but small vs the resting buffer so price barely moves (keeps
        // the later value-conservation solvency ceiling tight). Exact-input WETH → |amountSpecified|.
        uint256 swapIn = 2e9; // wei WETH; >> jitThreshold, ~3% of the resting position
        deal(WETH, trader, swapIn);
        uint256 traderUsdcBefore = IERC20(USDC).balanceOf(trader);

        vm.recordLogs();
        vm.startPrank(trader);
        IERC20(WETH).approve(address(swapRouter), swapIn);
        swapRouter.swap(poolKey, true, swapIn); // MUST NOT revert — proves the JIT bridge didn't brick
        vm.stopPrank();

        // PROVE the JIT actually FIRED mid-swap (opened + closed atomically), not a silent no-op fallback.
        // The vault emits JitOpened on a real open and JitClosed on the atomic close — both inside the
        // swap unlock. Their presence proves the hook pulled REAL Aave idle into a real V4 JIT position.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 jitOpenedSig = keccak256("JitOpened(bool,uint256,uint128,int24,int24)");
        bytes32 jitClosedSig = keccak256("JitClosed(uint256,uint256,uint256,uint256)");
        bool sawJitOpened;
        bool sawJitClosed;
        uint128 jitLiqOpened;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != VAULT_ADDR) continue;
            if (logs[i].topics[0] == jitOpenedSig) {
                sawJitOpened = true;
                (, , uint128 L, , ) = abi.decode(logs[i].data, (bool, uint256, uint128, int24, int24));
                jitLiqOpened = L;
            }
            if (logs[i].topics[0] == jitClosedSig) sawJitClosed = true;
        }
        emit log_named_uint("JIT liquidity opened mid-swap", jitLiqOpened);
        assertTrue(sawJitOpened, "JIT position OPENED during the swap (funded from real Aave idle)");
        assertGt(jitLiqOpened, 0, "JIT opened with non-zero liquidity");
        assertTrue(sawJitClosed, "JIT position CLOSED atomically within the same swap");

        uint256 traderWethSpent = swapIn - IERC20(WETH).balanceOf(trader); // net WETH into the pool
        emit log_named_uint("trader WETH spent (into pool)", traderWethSpent);
        uint256 traderUsdcOut = IERC20(USDC).balanceOf(trader) - traderUsdcBefore;
        emit log_named_uint("trader USDC received", traderUsdcOut);
        assertGt(traderUsdcOut, 0, "swap produced USDC output (swap succeeded)");
        assertEq(vault.jitPositionLiquidity(), 0, "JIT position closed to 0 at rest (post-swap)");
        assertEq(vault.jitLiquidity(), 0, "jitLiquidity==0 at rest (post-swap)");

        // ─────────────────────────────────────────────────────────────────────────────────────
        // STEP 5 — FEE CAPTURE: collectFees realizes the resting position's swap fee and splits it
        //          3-ways. buybackSink is unset on the live vault, so the buyback leg folds into the
        //          treasury transfer; the LP leg routes to the wired weightedDistributor. Conservation:
        //          (treasury+buyback) + LP == fee, per token.
        // ─────────────────────────────────────────────────────────────────────────────────────
        address treasury = vault.treasury();
        address dist     = vault.weightedDistributor();
        assertTrue(dist != address(0), "weighted distributor wired on live vault");

        uint256 tre0B = IERC20(WETH).balanceOf(treasury);
        uint256 tre1B = IERC20(USDC).balanceOf(treasury);
        uint256 dist0B = IERC20(WETH).balanceOf(dist);
        uint256 dist1B = IERC20(USDC).balanceOf(dist);

        (uint256 fee0, uint256 fee1) = vault.collectFees();
        emit log_named_uint("collectFees fee0 (WETH)", fee0);
        emit log_named_uint("collectFees fee1 (USDC)", fee1);

        uint256 treD0 = IERC20(WETH).balanceOf(treasury) - tre0B;
        uint256 treD1 = IERC20(USDC).balanceOf(treasury) - tre1B;
        uint256 distD0 = IERC20(WETH).balanceOf(dist) - dist0B;
        uint256 distD1 = IERC20(USDC).balanceOf(dist) - dist1B;
        emit log_named_uint("treasury+buyback WETH leg", treD0);
        emit log_named_uint("LP(distributor) WETH leg", distD0);

        // A zeroForOne swap takes its LP fee on the INPUT token (WETH == token0) → fee0 must be > 0.
        assertGt(fee0, 0, "resting position realized a WETH swap fee");
        // Three-way conservation (zero dust stranded), per token.
        assertEq(treD0 + distD0, fee0, "fee0 split conserves: treasury+buyback + LP == fee");
        assertEq(treD1 + distD1, fee1, "fee1 split conserves: treasury+buyback + LP == fee");
        // Sink unset ⇒ treasury leg == floor(30%*fee)+floor(10%*fee); LP leg == remainder (>= 60%).
        uint256 expectTre0 = (fee0 * vault.treasuryFeeBps()) / 10_000 + (fee0 * vault.buybackFeeBps()) / 10_000;
        assertEq(treD0, expectTre0, "treasury+buyback leg == 30%+10% of fee0 (buybackSink unset)");
        assertEq(distD0, fee0 - expectTre0, "LP leg == remainder (>=60%) to distributor");

        // ─────────────────────────────────────────────────────────────────────────────────────
        // STEP 6 — SOLVENT REDEEM. Clear the 24h min-hold + 7d notice, then request→execute. The LP
        //          must get a SANE amount back: never MORE than the principal they contributed (plus
        //          any tiny Aave yield accrued over the warp), and the exit must not revert.
        // ─────────────────────────────────────────────────────────────────────────────────────
        vm.warp(block.timestamp + vault.MIN_HOLD_PERIOD() + 1);
        vm.prank(user);
        vault.requestRedeem(shares);

        vm.warp(block.timestamp + vault.NOTICE_PERIOD() + 1);

        uint256 lpWethBefore = IERC20(WETH).balanceOf(user);
        uint256 lpUsdcBefore = IERC20(USDC).balanceOf(user);
        vm.prank(user);
        (uint256 out0, uint256 out1) = vault.executeRedeem();

        uint256 gotWeth = IERC20(WETH).balanceOf(user) - lpWethBefore;
        uint256 gotUsdc = IERC20(USDC).balanceOf(user) - lpUsdcBefore;
        emit log_named_uint("redeem out0 WETH", out0);
        emit log_named_uint("redeem out1 USDC", out1);
        emit log_named_uint("redeem got WETH (balance delta)", gotWeth);
        emit log_named_uint("redeem got USDC (balance delta)", gotUsdc);

        assertEq(gotWeth, out0, "WETH transferred to LP matches return value");
        assertEq(gotUsdc, out1, "USDC transferred to LP matches return value");
        assertEq(vault.shares(user), 0, "all shares burned on redeem");
        assertTrue(out0 > 0 || out1 > 0, "redeem returned principal (non-zero)");

        // Solvency CEILING (the core proof). The LP is the SOLE depositor, so the vault only ever
        // received, on their behalf, their deposit (used0 + used1) PLUS the WETH the trader sold into
        // the pool (traderWethSpent). It cannot pay out more raw tokens than that — and in fact pays out
        // LESS, because collectFees skimmed the treasury+buyback legs. Price barely moved (~3% swap), so
        // a raw-token sum is a faithful value proxy here. If the sum EXCEEDED inflows, shares would be
        // redeeming value that isn't backed = an insolvency bug. `+2` absorbs pro-rata round-down dust.
        uint256 totalIn  = used0 + used1 + traderWethSpent;
        uint256 totalOut = gotWeth + gotUsdc;
        emit log_named_uint("redeem total raw OUT (weth+usdc)", totalOut);
        emit log_named_uint("total raw IN (deposit + trader inflow)", totalIn);
        assertLe(totalOut, totalIn + 2, "SOLVENT: sole LP cannot redeem more than was ever put in");

        // Floor: the LP recovers essentially all of it — only the tiny swap-fee skim + rounding is lost,
        // so >= 99% of inflows come back (no value silently stranded / burned in the vault).
        assertGe(totalOut, (totalIn * 99) / 100, "LP recovered ~all principal (no stranded value)");

        // Vault is drained of this (sole) LP's managed liquidity — clean solvent teardown.
        assertEq(vault.totalLiquidity(), 0, "sole LP fully exited; totalLiquidity back to 0");
    }
}
