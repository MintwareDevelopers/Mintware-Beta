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

import {MintwareTreasuryVault}     from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwarePaymentGateway}    from "../../src/payments/MintwarePaymentGateway.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {MockReadyOracle}  from "../mocks/MockReadyOracle.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @notice "Make v2 real" SMOKE — mirrors the `DeployTreasuryV2.s.sol` assembly against a REAL in-test
///         V4 PoolManager, then runs the FULL lifecycle in one flow: init pool → commitTeam → community
///         deposit → deployToLP (real V4 module) → swaps (fees + price move) → accrueFees → recover →
///         a card charge settled through the real Gateway → USDC at the rail. Proves the deployed stack
///         works end-to-end before it goes to Base Sepolia (the actual `--broadcast` is operator-gated).
///
/// @dev    Both tokens are 6dp here so the Gateway's 6dp thresholds ($250 high-value, $1,000 cap) stay
///         valid at a clean 1:1 pool. The module is decimal-agnostic; production wires a 6dp/18dp pool at
///         the decimal-adjusted init price (see the script's INIT_SQRT_PRICE note).
contract DeployTreasuryV2SmokeTest is Test {
    PoolManager             internal pm;
    TestSwapRouter          internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;

    MockERC20                internal usdc; // 6dp
    MockERC20                internal team; // 6dp (mock; real is 18dp)
    MockYieldAdapter         internal adapter;
    MintwareTreasuryVault    internal vault;
    MintwarePaymentGateway   internal gateway;
    PoolKey                  internal key;

    address internal deployer  = address(this); // owner + gateway admin (holds RELAYER/EDGE roles)
    address internal teamAddr   = makeAddr("team");
    address internal circleCpn  = makeAddr("circleCpn");
    address internal rail       = makeAddr("cardRail");
    address internal trader     = makeAddr("trader");
    address internal user; uint256 internal userPk;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant ONE = 1e6; // 6dp

    function setUp() public {
        (user, userPk) = makeAddrAndKey("user");

        // ── mirror of DeployTreasuryV2.s.sol assembly ──────────────────────
        pm         = new PoolManager(deployer);
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);
        adapter = new MockYieldAdapter(address(usdc));

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(key, INIT_SQRT_PRICE);

        // Phase-2 convergence: the vault HOLDS the V4 position itself (no separate liquidity module).
        vault  = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), deployer, teamAddr);
        gateway = new MintwarePaymentGateway(address(vault), address(usdc), circleCpn, deployer);
        vault.setGateway(address(gateway));
        vault.setProtocolTreasury(circleCpn);
        // FIX 2a: deployToLP requires a ready oracle — wire a live-tick stand-in. FIX 3: arm the smallest
        // coverage floor (1 bps); the tiny junior buffer committed below covers the $200 deploy at that floor.
        vault.setJitHook(address(new MockReadyOracle(IPoolManager(address(pm)), key)));
        vault.setMinCoverage(1);

        // Deep baseline pool liquidity so the module's seniority swaps have depth.
        usdc.mint(deployer, 100_000_000 * ONE);
        team.mint(deployer, 100_000_000 * ONE);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 5_000_000 * 1e6, salt: bytes32(0)}),
            ""
        );
    }

    function _signPermit(MintwarePaymentGateway.DelegatedSpendPermit memory p) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            gateway.DELEGATED_SPEND_PERMIT_TYPEHASH(), p.user, p.maxDailySpendUSDC, p.nonce, p.deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", gateway.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// The whole v2 lifecycle in one flow, through the deploy-assembled stack.
    function test_fullLifecycle_deposit_deploy_swap_accrue_settle() public {
        // 1. Team commits the junior reserve (activates the vault) — incl. a tiny USDC buffer so the $200
        //    deploy below clears the FIX-3 coverage floor (1 bps).
        team.mint(teamAddr, 1_000_000 * ONE);
        usdc.mint(teamAddr, 1 * ONE);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(1_000_000 * ONE, 1 * ONE, 365 days);
        vm.stopPrank();

        // 2. Community deposit: $1,000 senior.
        usdc.mint(user, 10_000 * ONE);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        uint256 shares = vault.depositUSDC(1_000 * ONE, 0, user);
        vm.stopPrank();
        assertGt(shares, 0, "no senior shares minted");
        assertApproxEqAbs(vault.totalSeniorAssets(), 1_000 * ONE, 2, "senior NAV != deposit");

        // 3. Deploy the idle-permitted slice ($200 = 20% of $1,000) as real V4 liquidity.
        uint256 jt = vault.juniorTokens();
        vault.deployToLP(200 * ONE, jt);
        assertGt(vault.deployedFromSenior(), 0, "nothing deployed to LP");
        assertLe(vault.deployedFromSenior(), vault.recoverableUSDC() + vault.juniorUsdcBuffer(), "solvency invariant");

        // 4. Trading generates fees; accrue them to the senior (100% during lock).
        usdc.mint(trader, 5_000_000 * ONE);
        team.mint(trader, 5_000_000 * ONE);
        vm.startPrank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);
        team.approve(address(swapRouter), type(uint256).max);
        bool usdcIs0 = address(usdc) < address(team);
        swapRouter.swap(key, usdcIs0, 20_000 * ONE);
        swapRouter.swap(key, !usdcIs0, 18_000 * ONE);
        vm.stopPrank();

        uint256 navBeforeFees = vault.totalSeniorAssets();
        uint256 collected = vault.accrueFees();
        assertGt(collected, 0, "no fees collected through the module");
        assertGt(vault.totalSeniorAssets(), navBeforeFees, "fees did not lift senior NAV");

        // 5. Owner rebalance: recover some senior USDC from the LP back to Aave.
        vault.recoverFromLP(50 * ONE);
        assertLe(vault.deployedFromSenior(), vault.recoverableUSDC() + vault.juniorUsdcBuffer(), "invariant after recover");

        // 6. A card charge settles through the REAL Gateway → USDC at the rail.
        uint256 assets = 100 * ONE; // $100 < $250 → permit-only
        bytes32 holdId = keccak256("smoke-hold");
        MintwarePaymentGateway.DelegatedSpendPermit memory p = MintwarePaymentGateway.DelegatedSpendPermit({
            user: user, maxDailySpendUSDC: 500 * ONE, nonce: 1, deadline: block.timestamp + 1 days
        });
        bytes memory sig = _signPermit(p);
        MintwarePaymentGateway.ShortLivedHoldAuth memory noEdge;

        uint256 railBefore = usdc.balanceOf(circleCpn); // AUDIT C1: settlement lands at the treasury, not a passed rail
        uint256 sharesBefore = vault.seniorShares(user);
        gateway.settleSpend(holdId, user, assets, rail, p, sig, noEdge, "");

        assertGe(usdc.balanceOf(circleCpn) - railBefore, assets, "treasury underpaid the charge");
        assertLt(vault.seniorShares(user), sharesBefore, "user shares not burned");
        ( , , , bool settled, ) = gateway.holds(holdId);
        assertTrue(settled, "hold not settled");
    }
}
