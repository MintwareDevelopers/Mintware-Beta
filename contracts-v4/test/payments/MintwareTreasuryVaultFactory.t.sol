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
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {HookMiner}                        from "../../src/lib/HookMiner.sol";
import {MintwareTreasuryVault}            from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook}          from "../../src/payments/MintwareTreasuryJitHook.sol";
import {MintwarePaymentGateway}           from "../../src/payments/MintwarePaymentGateway.sol";
import {MintwareTreasuryVaultRegistry}    from "../../src/payments/MintwareTreasuryVaultRegistry.sol";
import {MintwareTreasuryVaultFactory}     from "../../src/payments/MintwareTreasuryVaultFactory.sol";
import {
    MintwareTreasuryJitHookDeployer,
    MintwareTreasuryGatewayDeployer
} from "../../src/payments/MintwareTreasuryDeployers.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @notice Proves the YPN multi-tenant factory: `createVault` produces a fully-working, isolated treasury
///         vault (deposit → deployToLP → JIT-firing swap → sweep → recover → Gateway settlement), the
///         hook binds to its canonical pool, two teams get two isolated universes, ownership lands at the
///         intended ops owner (not the factory, not the team), and access control + the registry hold.
contract MintwareTreasuryVaultFactoryTest is Test {
    using PoolIdLibrary for PoolKey;

    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;
    TestSwapRouter          internal swapRouter;

    MockERC20 internal usdc; // shared 6dp settlement asset

    MintwareTreasuryVaultRegistry   internal registry;
    MintwareTreasuryJitHookDeployer internal hookDeployer;
    MintwareTreasuryGatewayDeployer internal gwDeployer;
    MintwareTreasuryVaultFactory    internal factory;

    address internal protocol = makeAddr("protocol"); // treasury + card rail

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant ONE = 1e6;

    struct Created {
        MintwareTreasuryVault   vault;
        MintwareTreasuryJitHook hook;
        address                 gateway;
        MockERC20               team;
        MockYieldAdapter        adapter;
        PoolKey                 key;
    }

    function setUp() public {
        pm         = new PoolManager(address(this));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        usdc       = new MockERC20("USD Coin", "USDC", 6);

        // Factory stack. Owner/admin = this test → it may call createVault + wire the deployers.
        registry     = new MintwareTreasuryVaultRegistry(address(this));
        hookDeployer = new MintwareTreasuryJitHookDeployer(address(this));
        gwDeployer   = new MintwareTreasuryGatewayDeployer(address(this));
        factory      = new MintwareTreasuryVaultFactory(
            address(pm), address(registry), address(hookDeployer), address(gwDeployer), address(this)
        );
        registry.setFactory(address(factory));
        hookDeployer.setFactory(address(factory));
        gwDeployer.setFactory(address(factory));
    }

    // ── helpers ────────────────────────────────────────────────────────────────

    /// @dev Mines the hook salt off-chain (against the hook deployer) and drives `createVault`.
    function _create(address teamAddr, address opsOwner, address gwAdmin) internal returns (Created memory c) {
        MockERC20        teamTok = new MockERC20("Team Token", "TEAM", 6);
        MockYieldAdapter adp     = new MockYieldAdapter(address(usdc));

        address predicted = factory.predictNextVault();
        (address a0, address a1) = address(usdc) < address(teamTok)
            ? (address(usdc), address(teamTok)) : (address(teamTok), address(usdc));
        PoolKey memory ctorKey = PoolKey({
            currency0: Currency.wrap(a0), currency1: Currency.wrap(a1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(address(0))
        });
        bytes memory args = abi.encode(address(pm), ctorKey, address(usdc), predicted, address(factory));
        (address minedHook, bytes32 salt) =
            HookMiner.find(address(hookDeployer), uint160(0x20C8), type(MintwareTreasuryJitHook).creationCode, args);

        MintwareTreasuryVaultFactory.CreateParams memory p = MintwareTreasuryVaultFactory.CreateParams({
            usdc: address(usdc), teamToken: address(teamTok), adapter: address(adp),
            team: teamAddr, owner: opsOwner, treasury: protocol,
            poolFee: 3000, tickSpacing: SPACING, initSqrtPrice: INIT_SQRT_PRICE, gatewayAdmin: gwAdmin
        });

        (address vaultAddr, address hookAddr, address gwAddr) = factory.createVault(p, salt);
        assertEq(hookAddr, minedHook, "hook != mined");
        assertEq(vaultAddr, predicted, "vault != predicted");

        c.vault   = MintwareTreasuryVault(vaultAddr);
        c.hook    = MintwareTreasuryJitHook(hookAddr);
        c.gateway = gwAddr;
        c.team    = teamTok;
        c.adapter = adp;
        c.key     = PoolKey({
            currency0: Currency.wrap(a0), currency1: Currency.wrap(a1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(hookAddr)
        });
    }

    function _seedPool(PoolKey memory key, MockERC20 teamTok) internal {
        usdc.mint(address(this), 50_000_000 * ONE);
        teamTok.mint(address(this), 50_000_000 * ONE);
        usdc.approve(address(lpRouter), type(uint256).max);
        teamTok.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 5_000_000 * int256(uint256(ONE)), salt: bytes32(0)}),
            ""
        );
    }

    function _fund(Created memory c, address teamAddr, address user) internal {
        c.team.mint(teamAddr, 1_000_000 * ONE);
        usdc.mint(teamAddr, 5_000 * ONE);
        vm.startPrank(teamAddr);
        c.team.approve(address(c.vault), type(uint256).max);
        usdc.approve(address(c.vault), type(uint256).max);
        c.vault.commitTeam(1_000_000 * ONE, 5_000 * ONE, 365 days);
        vm.stopPrank();

        usdc.mint(user, 10_000 * ONE);
        vm.startPrank(user);
        usdc.approve(address(c.vault), type(uint256).max);
        c.vault.depositUSDC(10_000 * ONE, 0, user);
        vm.stopPrank();
    }

    function _sellTeamZeroForOne(MockERC20 teamTok) internal view returns (bool) {
        return address(teamTok) < address(usdc);
    }

    function _fireJit(Created memory c) internal {
        address trader = makeAddr(string(abi.encodePacked("trader-", vm.toString(address(c.team)))));
        c.team.mint(trader, 1_000_000 * ONE);
        vm.startPrank(trader);
        c.team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(c.key, _sellTeamZeroForOne(c.team), 3_000 * ONE);
        vm.stopPrank();
    }

    // ── EIP-712 gateway signing (over the gateway's own domain) ──────────────────

    function _permit(address user, uint256 maxDaily, uint256 nonce, uint256 deadline)
        internal pure returns (MintwarePaymentGateway.DelegatedSpendPermit memory)
    {
        return MintwarePaymentGateway.DelegatedSpendPermit({
            user: user, maxDailySpendUSDC: maxDaily, nonce: nonce, deadline: deadline
        });
    }

    function _signPermit(MintwarePaymentGateway gw, uint256 pk, MintwarePaymentGateway.DelegatedSpendPermit memory p)
        internal view returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(
            gw.DELEGATED_SPEND_PERMIT_TYPEHASH(), p.user, p.maxDailySpendUSDC, p.nonce, p.deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", gw.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _emptyEdge() internal pure returns (MintwarePaymentGateway.ShortLivedHoldAuth memory e) {}

    // ── 1. Full lifecycle on a factory-made instance ─────────────────────────────

    function test_factoryVault_fullLifecycle() public {
        (address user, uint256 userPk) = makeAddrAndKey("userA");
        address opsOwner = makeAddr("opsA");
        address teamAddr = makeAddr("teamA");

        Created memory c = _create(teamAddr, opsOwner, address(this)); // gateway admin = this test
        _seedPool(c.key, c.team);
        _fund(c, teamAddr, user);

        // deployToLP (onlyOwner → ops owner). Pre-compute the arg: a nested call would otherwise consume
        // the single-shot prank before deployToLP runs.
        uint256 jt = c.vault.juniorTokens();
        vm.prank(opsOwner);
        c.vault.deployToLP(200 * ONE, jt);
        assertGt(c.vault.deployedFromSenior(), 0, "vault could not deploy senior LP");

        // a real trader's team->USDC swap fires JIT on the factory-made hook
        _fireJit(c);
        assertGt(c.vault.jitBorrowed(), 0, "trader swap did not fire JIT");

        c.hook.sweepJit();
        assertEq(c.vault.jitBorrowed(), 0, "sweep did not clear JIT");

        // owner recover unwinds LP
        uint256 depBefore = c.vault.deployedFromSenior();
        vm.prank(opsOwner);
        c.vault.recoverFromLP(50 * ONE);
        assertLt(c.vault.deployedFromSenior(), depBefore, "recover did not unwind LP");

        // Gateway settlement burns senior shares → USDC lands at the card rail (circle treasury)
        MintwarePaymentGateway gw = MintwarePaymentGateway(c.gateway);
        uint256 assets = 100 * ONE; // < $250 → permit only
        bytes32 holdId = keccak256("hold-A");
        MintwarePaymentGateway.DelegatedSpendPermit memory permit =
            _permit(user, 500 * ONE, 1, block.timestamp + 1 days);
        bytes memory sig = _signPermit(gw, userPk, permit);

        uint256 railBefore = usdc.balanceOf(protocol);
        uint256 shBefore   = c.vault.seniorShares(user);
        uint256 burned = gw.settleSpend(holdId, user, assets, protocol, permit, sig, _emptyEdge(), "");

        assertGt(burned, 0, "no shares burned by gateway");
        assertLt(c.vault.seniorShares(user), shBefore, "user senior shares not burned");
        assertGe(usdc.balanceOf(protocol) - railBefore, assets, "card rail underpaid vs the charge");
    }

    // ── 2. Hook binds to its canonical pool only ─────────────────────────────────

    function test_factoryHook_bindsToCanonicalPool() public {
        address opsOwner = makeAddr("opsC");
        address teamAddr = makeAddr("teamC");
        Created memory c = _create(teamAddr, opsOwner, address(this));
        _seedPool(c.key, c.team);
        _fund(c, teamAddr, makeAddr("userC"));
        uint256 jt = c.vault.juniorTokens();
        vm.prank(opsOwner);
        c.vault.deployToLP(200 * ONE, jt);

        // `beforeInitialize` now gates pool creation to the hook OWNER, so an attacker can no longer open
        // ANY pool naming this hook (see test_beforeInitialize_gatesPoolInitToOwner in the JitStack suite).
        // This verifies the SECOND-layer canonical-binding no-op still holds even for an owner-created
        // non-canonical pool (defense-in-depth: init-gate + swap no-op).
        PoolKey memory evil = PoolKey({
            currency0: c.key.currency0, currency1: c.key.currency1, fee: 500, tickSpacing: SPACING, hooks: c.key.hooks
        });
        vm.prank(opsOwner);
        pm.initialize(evil, INIT_SQRT_PRICE);
        usdc.mint(address(this), 1_000_000 * ONE);
        c.team.mint(address(this), 1_000_000 * ONE);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            evil,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 200_000 * int256(uint256(ONE)), salt: bytes32(0)}),
            ""
        );

        address trader = makeAddr("traderEvil");
        c.team.mint(trader, 1_000_000 * ONE);
        vm.startPrank(trader);
        c.team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(evil, _sellTeamZeroForOne(c.team), 3_000 * ONE); // must not revert, must not JIT
        vm.stopPrank();

        assertEq(c.vault.jitBorrowed(), 0, "hook fired JIT on a NON-canonical pool");
    }

    // ── 3. Two teams → two isolated universes ────────────────────────────────────

    function test_twoTeams_areIsolated() public {
        address opsA = makeAddr("opsA2"); address teamA = makeAddr("teamA2");
        address opsB = makeAddr("opsB2"); address teamB = makeAddr("teamB2");

        Created memory a = _create(teamA, opsA, address(this));
        Created memory b = _create(teamB, opsB, address(this));

        // Distinct tokens / pools / hooks / gateways / vaults.
        assertTrue(address(a.vault) != address(b.vault), "same vault");
        assertTrue(address(a.hook)  != address(b.hook),  "same hook");
        assertTrue(a.gateway        != b.gateway,        "same gateway");
        assertTrue(address(a.team)  != address(b.team),  "same team token");
        assertTrue(PoolId.unwrap(a.key.toId()) != PoolId.unwrap(b.key.toId()), "same pool");

        _seedPool(a.key, a.team); _fund(a, teamA, makeAddr("uA"));
        _seedPool(b.key, b.team); _fund(b, teamB, makeAddr("uB"));

        uint256 jtA = a.vault.juniorTokens();
        vm.prank(opsA); a.vault.deployToLP(200 * ONE, jtA);
        uint256 jtB = b.vault.juniorTokens();
        vm.prank(opsB); b.vault.deployToLP(200 * ONE, jtB);
        uint256 bDeployedBefore = b.vault.deployedFromSenior();

        // Fire JIT on team A's pool only.
        _fireJit(a);
        assertGt(a.vault.jitBorrowed(), 0, "A's JIT did not fire");

        // Team B's vault is completely untouched by A's swap.
        assertEq(b.vault.jitBorrowed(), 0, "B's vault borrowed from A's swap (cross-tenant leak)");
        assertEq(b.vault.deployedFromSenior(), bDeployedBefore, "B's deployed changed from A's swap");
    }

    // ── 4. Ownership two-phase ends at the ops owner ─────────────────────────────

    function test_ownership_endsAtOpsOwner_notFactory_notTeam() public {
        address opsOwner = makeAddr("opsO");
        address teamAddr = makeAddr("teamO");
        Created memory c = _create(teamAddr, opsOwner, address(this));

        assertEq(c.vault.owner(), opsOwner, "vault owner should be the ops owner");
        assertEq(c.hook.owner(),  opsOwner, "hook owner should be the ops owner");
        assertEq(c.vault.team(),  teamAddr, "team should be the constructor-bound tenant");
        assertTrue(c.vault.owner() != address(factory), "ownership stuck at factory");
        assertTrue(c.vault.owner() != teamAddr,         "ownership handed to the team");
    }

    // ── 5. Access control ────────────────────────────────────────────────────────

    function test_createVault_onlyOwner() public {
        MockERC20        teamTok = new MockERC20("Team", "TEAM", 6);
        MockYieldAdapter adp     = new MockYieldAdapter(address(usdc));
        MintwareTreasuryVaultFactory.CreateParams memory p = MintwareTreasuryVaultFactory.CreateParams({
            usdc: address(usdc), teamToken: address(teamTok), adapter: address(adp),
            team: makeAddr("t"), owner: makeAddr("o"), treasury: protocol,
            poolFee: 3000, tickSpacing: SPACING, initSqrtPrice: INIT_SQRT_PRICE, gatewayAdmin: makeAddr("gw")
        });
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(); // Ownable: caller is not the owner
        factory.createVault(p, bytes32(0));
    }

    function test_registry_register_notCallableByArbitrary() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(MintwareTreasuryVaultRegistry.NotFactoryOrOwner.selector);
        registry.register(makeAddr("v"), address(0), address(0), makeAddr("t"), address(0), address(usdc));
    }

    // ── 6. Registry record + deactivate + byTeam + isActive ──────────────────────

    function test_registry_recordsDeactivatesAndIndexesByTeam() public {
        address teamAddr = makeAddr("teamR");
        Created memory c = _create(teamAddr, makeAddr("opsR"), address(this));

        assertEq(registry.count(), 1, "expected exactly one registered vault");

        uint256[] memory ids = registry.byTeam(teamAddr);
        assertEq(ids.length, 1, "byTeam did not index the vault");
        uint256 id = ids[0];

        MintwareTreasuryVaultRegistry.TreasuryVaultRecord memory rec = registry.get(id);
        assertEq(rec.vault,     address(c.vault),  "record vault mismatch");
        assertEq(rec.hook,      address(c.hook),   "record hook mismatch");
        assertEq(rec.gateway,   c.gateway,         "record gateway mismatch");
        assertEq(rec.team,      teamAddr,          "record team mismatch");
        assertEq(rec.teamToken, address(c.team),   "record teamToken mismatch");
        assertEq(rec.usdc,      address(usdc),     "record usdc mismatch");
        assertTrue(rec.active,  "record should start active");
        assertTrue(registry.isActive(address(c.vault)), "isActive should be true");

        registry.deactivate(id);
        assertFalse(registry.get(id).active, "deactivate did not clear active");
        assertFalse(registry.isActive(address(c.vault)), "isActive should be false after deactivate");
    }

    // ── 7. predictNextVault advances with each create ────────────────────────────

    function test_predictNextVault_advances() public {
        address p0 = factory.predictNextVault();
        Created memory a = _create(makeAddr("t1"), makeAddr("o1"), address(this));
        assertEq(address(a.vault), p0, "first vault not at predicted address");

        address p1 = factory.predictNextVault();
        assertTrue(p1 != p0, "prediction did not advance");
        Created memory b = _create(makeAddr("t2"), makeAddr("o2"), address(this));
        assertEq(address(b.vault), p1, "second vault not at advanced prediction");
    }
}
