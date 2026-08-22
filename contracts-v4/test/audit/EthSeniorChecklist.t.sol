// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {PoolManager}  from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}       from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}      from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}     from "@uniswap/v4-core/src/types/Currency.sol";

import {MintwareTreasuryVault}    from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwarePaymentGateway}   from "../../src/payments/MintwarePaymentGateway.sol";
import {MintwareYieldVault}       from "../../src/payments/MintwareYieldVault.sol";
import {MintwareCctpDepositRouter} from "../../src/payments/MintwareCctpDepositRouter.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";

/// @notice A USDT-style ERC-20 whose transfer/approve return NOTHING (no bool). Exercises the SafeERC20
///         paths (which must tolerate empty return data). Used to prove the settlement asset seam works
///         with non-standard ERC-20s.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public decimals = 6;
    string public name = "NoRet USD";
    string public symbol = "nUSD";

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external { allowance[msg.sender][s] = a; } // no return
    function transfer(address to, uint256 a) external {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; // no return
    }
    function transferFrom(address f, address to, uint256 a) external {
        uint256 al = allowance[f][msg.sender];
        if (al != type(uint256).max) allowance[f][msg.sender] = al - a;
        balanceOf[f] -= a; balanceOf[to] += a; // no return
    }
}

/// @notice A fee-on-transfer ERC-20 (1% burned on every transfer). Used to confirm the ONE funding path
///         that documents balance-diff accounting (`fundRent`, Bunni-safe) credits actual-received, not
///         nominal.
contract FeeOnTransferToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public decimals = 6;
    uint256 public constant FEE_BPS = 100; // 1%

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { return _xfer(msg.sender, to, a); }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        uint256 al = allowance[f][msg.sender];
        if (al != type(uint256).max) allowance[f][msg.sender] = al - a;
        return _xfer(f, to, a);
    }
    function _xfer(address f, address to, uint256 a) internal returns (bool) {
        uint256 fee = (a * FEE_BPS) / 10_000;
        balanceOf[f] -= a;
        balanceOf[to] += (a - fee); // fee burned
        return true;
    }
}

/// @title  EthSeniorChecklist — Layer-2 unit / negative / edge audit coverage for the ETH senior stack.
/// @notice Fills the gaps a happy-path suite misses: a SYSTEMATIC access-control-negative sweep over every
///         privileged function, constructor zero-address injection, non-standard-ERC20 tolerance, and event
///         emission with correct args. Findings (or their absence) are documented in the returned report.
contract EthSeniorChecklistTest is Test {
    PoolManager      internal pm;
    MintwareTreasuryVault internal vault;
    MockYieldAdapter internal adapter;
    MockERC20        internal usdc;
    MockERC20        internal teamTok;
    PoolKey          internal key;

    address internal owner    = makeAddr("owner");
    address internal teamAddr = makeAddr("team");
    address internal gatewayEOA = makeAddr("gatewayEOA");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal attacker = makeAddr("attacker");
    address internal jitHookEOA = makeAddr("jitHook");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant TEAM_COMMIT = 1_000_000 ether;

    // events (re-declared for expectEmit)
    event SeniorDeposit(address indexed caller, address indexed to, uint256 assets, uint256 shares);
    event SeniorRedeem(address indexed owner, uint256 shares, uint256 assets);
    event PaymentBurn(address indexed user, address indexed receiver, uint256 shares, uint256 assets);

    function setUp() public {
        pm = new PoolManager(address(this));
        usdc = new MockERC20("USD Coin", "USDC", 6);
        teamTok = new MockERC20("Team Token", "TEAM", 18);
        bool usdcIs0 = address(usdc) < address(teamTok);
        (Currency c0, Currency c1) = usdcIs0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(teamTok)))
            : (Currency.wrap(address(teamTok)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(key, INIT_SQRT_PRICE);

        adapter = new MockYieldAdapter(address(usdc));
        vault = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);

        vm.prank(owner);
        vault.setGateway(gatewayEOA); // set gateway to an EOA so we can drive burnForPayment directly

        // Activate: team commits junior (no LP deployed → all idle in adapter, pool-free path).
        teamTok.mint(teamAddr, TEAM_COMMIT);
        vm.startPrank(teamAddr);
        teamTok.approve(address(vault), type(uint256).max);
        vault.commitTeam(TEAM_COMMIT, 0, 365 days);
        vm.stopPrank();
    }

    function _deposit(address who, uint256 amt) internal returns (uint256 shares) {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        shares = vault.depositUSDC(amt, 0, who);
        vm.stopPrank();
    }

    // ───────────────────────── Access control — negative sweep (VAULT) ─────────────────────────
    // Every onlyOwner / role-gated function MUST revert for a non-authorized caller. The happy-path
    // suite covers onlyGateway/onlyTeam; this adds the owner-setter surface + JIT-hook seam that was
    // NOT systematically negatively tested.

    function test_vault_ownerSetters_revertForNonOwner() public {
        vm.startPrank(attacker);
        vm.expectRevert(); vault.setProtocolTreasury(attacker);
        vm.expectRevert(); vault.setIdleBufferTarget(6000);
        vm.expectRevert(); vault.setJitHook(jitHookEOA);
        vm.expectRevert(); vault.setJitCap(100);
        vm.expectRevert(); vault.setMinCoverage(1000);
        vm.expectRevert(); vault.setMaxBurnPerBlock(1e6);
        vm.expectRevert(); vault.setRentFunder(attacker);
        vm.expectRevert(); vault.setJitMaxCumulativeLoss(1e6);
        vm.expectRevert(); vault.resetJitBreaker();
        vm.expectRevert(); vault.deployToLP(1e6, 1e6);
        vm.expectRevert(); vault.recoverFromLP(1e6);
        vm.expectRevert(); vault.forceSettleJit();          // owner-only escape hatch (GAP filled)
        vm.stopPrank();
    }

    function test_vault_setGateway_isSetOnce() public {
        vm.prank(owner);
        vm.expectRevert(MintwareTreasuryVault.AlreadySet.selector);
        vault.setGateway(bob);
    }

    function test_vault_setJitHook_isSetOnce() public {
        vm.prank(owner);
        vault.setJitHook(jitHookEOA);
        vm.prank(owner);
        vm.expectRevert(MintwareTreasuryVault.AlreadySet.selector);
        vault.setJitHook(bob);
    }

    function test_vault_jitSeam_onlyJitHook() public {
        vm.prank(owner);
        vault.setJitHook(jitHookEOA);
        // A non-hook caller cannot borrow senior idle or settle a JIT return.
        vm.startPrank(attacker);
        vm.expectRevert(MintwareTreasuryVault.OnlyJitHook.selector);
        vault.borrowIdleForJit(1e6);
        vm.expectRevert(MintwareTreasuryVault.OnlyJitHook.selector);
        vault.settleJitReturn(1e6);
        vm.stopPrank();
    }

    function test_vault_burnForPayment_onlyGateway() public {
        _deposit(alice, 10_000e6);
        vm.prank(attacker);
        vm.expectRevert(MintwareTreasuryVault.OnlyGateway.selector);
        vault.burnForPayment(alice, 1, bob);
    }

    function test_vault_commitTeam_onlyBoundTeam_and_notReactivatable() public {
        // Fresh, un-activated vault.
        MintwareTreasuryVault v2 =
            new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);
        teamTok.mint(attacker, TEAM_COMMIT);
        vm.startPrank(attacker);
        teamTok.approve(address(v2), type(uint256).max);
        vm.expectRevert(MintwareTreasuryVault.OnlyTeam.selector);
        v2.commitTeam(TEAM_COMMIT, 0, 365 days);
        vm.stopPrank();
        // The already-activated `vault` cannot be re-committed even by the bound team.
        vm.prank(teamAddr);
        vm.expectRevert(MintwareTreasuryVault.AlreadyActivated.selector);
        vault.commitTeam(1, 0, 365 days);
    }

    function test_vault_redeemJunior_onlyTeam() public {
        vm.prank(attacker);
        vm.expectRevert(MintwareTreasuryVault.OnlyTeam.selector);
        vault.redeemJunior();
    }

    // ───────────────────────── Access control — negative sweep (GATEWAY) ─────────────────────────

    function test_gateway_adminSetters_revertForNonAdmin() public {
        MintwarePaymentGateway gw =
            new MintwarePaymentGateway(address(vault), address(usdc), makeAddr("rail"), owner);
        vm.startPrank(attacker);
        vm.expectRevert(); gw.setCircleCpnTreasury(attacker);
        vm.expectRevert(); gw.setUserDailyCap(attacker, 1e9);
        vm.expectRevert(); gw.pause();   // PAUSER_ROLE
        vm.expectRevert(); gw.unpause();
        vm.stopPrank();
    }

    // ───────────────────────── Access control — negative sweep (CCTP) ─────────────────────────
    // `setRelayer` onlyOwner and `receiveAndDeposit` onlyRelayer are already covered by
    // MintwareCctpDepositRouter.t.sol — not duplicated here.

    // ───────────────────────── Constructor zero-address injection ─────────────────────────
    // The settlement constructor's zero/NotWethUsdcPool guards are covered by MintwareEthSettlement.t.sol.
    // The vault / gateway / cctp / yieldvault constructors were NOT negatively tested — filled here.

    function test_ctor_vault_rejectsZero() public {
        vm.expectRevert(MintwareTreasuryVault.ZeroAddress.selector);
        new MintwareTreasuryVault(address(pm), key, address(0), address(adapter), owner, teamAddr);
        vm.expectRevert(MintwareTreasuryVault.ZeroAddress.selector);
        new MintwareTreasuryVault(address(pm), key, address(usdc), address(0), owner, teamAddr);
        vm.expectRevert(MintwareTreasuryVault.ZeroAddress.selector);
        new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, address(0));
    }

    function test_ctor_vault_rejectsUsdcNotInPool() public {
        MockERC20 stray = new MockERC20("Stray", "STR", 6);
        vm.expectRevert(MintwareTreasuryVault.UsdcNotInPool.selector);
        new MintwareTreasuryVault(address(pm), key, address(stray), address(adapter), owner, teamAddr);
    }

    function test_ctor_gateway_rejectsZero() public {
        address rail = makeAddr("rail");
        vm.expectRevert(MintwarePaymentGateway.ZeroAddress.selector);
        new MintwarePaymentGateway(address(0), address(usdc), rail, owner);
        vm.expectRevert(MintwarePaymentGateway.ZeroAddress.selector);
        new MintwarePaymentGateway(address(vault), address(0), rail, owner);
        vm.expectRevert(MintwarePaymentGateway.ZeroAddress.selector);
        new MintwarePaymentGateway(address(vault), address(usdc), address(0), owner);
        vm.expectRevert(MintwarePaymentGateway.ZeroAddress.selector);
        new MintwarePaymentGateway(address(vault), address(usdc), rail, address(0));
    }

    function test_ctor_cctp_rejectsZero() public {
        MintwareYieldVault yv = new MintwareYieldVault(address(usdc), address(adapter), owner);
        address mt = makeAddr("messageTransmitter");
        address rel = makeAddr("relayer");
        vm.expectRevert(MintwareCctpDepositRouter.ZeroAddress.selector);
        new MintwareCctpDepositRouter(address(0), address(usdc), address(yv), owner, rel);
        vm.expectRevert(MintwareCctpDepositRouter.ZeroAddress.selector);
        new MintwareCctpDepositRouter(mt, address(0), address(yv), owner, rel);
        vm.expectRevert(MintwareCctpDepositRouter.ZeroAddress.selector);
        new MintwareCctpDepositRouter(mt, address(usdc), address(0), owner, rel);
        vm.expectRevert(MintwareCctpDepositRouter.ZeroAddress.selector);
        new MintwareCctpDepositRouter(mt, address(usdc), address(yv), owner, address(0));
    }

    function test_ctor_yieldVault_rejectsZero() public {
        vm.expectRevert(MintwareYieldVault.ZeroAddress.selector);
        new MintwareYieldVault(address(0), address(adapter), owner);
        vm.expectRevert(MintwareYieldVault.ZeroAddress.selector);
        new MintwareYieldVault(address(usdc), address(0), owner);
    }

    // ───────────────────────── Zero & edge amount handling ─────────────────────────

    function test_zeroAmounts_revert() public {
        vm.startPrank(alice);
        vm.expectRevert(MintwareTreasuryVault.ZeroAmount.selector);
        vault.depositUSDC(0, 0, alice);
        vm.expectRevert(MintwareTreasuryVault.ZeroAmount.selector);
        vault.redeemSenior(0, 0);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(MintwareTreasuryVault.ZeroAddress.selector);
        vault.depositUSDC(1e6, 0, address(0));
    }

    function test_deposit_dustRoundingToZeroShares_reverts() public {
        // With a large NAV and a 1-wei deposit, shares round to 0 → must revert, never mint 0.
        _deposit(alice, 1_000_000e6);
        // Simulate yield so NAV/shares ratio is > 1 and a 1-wei deposit floors to 0 shares… but with the
        // 1e6 virtual offset a 1-wei deposit into a fresh-ish vault still mints. Instead force a huge NAV:
        usdc.mint(address(adapter), 1_000_000e6); // donate to adapter → NAV per share climbs
        vm.startPrank(bob);
        usdc.mint(bob, 1);
        usdc.approve(address(vault), type(uint256).max);
        // 1 wei * (shares+V)/(assets+V) with assets ~2e12 rounds to 0 → ZeroAmount.
        vm.expectRevert(MintwareTreasuryVault.ZeroAmount.selector);
        vault.depositUSDC(1, 0, bob);
        vm.stopPrank();
    }

    function test_minShares_slippageGuard() public {
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.expectRevert(MintwareTreasuryVault.InsufficientShares.selector);
        vault.depositUSDC(1_000e6, type(uint256).max, alice); // demands impossibly many shares
        vm.stopPrank();
    }

    // ───────────────────────── Event emission ─────────────────────────

    function test_events_depositRedeemBurn() public {
        // Deposit emits SeniorDeposit(caller,to,assets,shares).
        usdc.mint(alice, 5_000e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        uint256 expShares = vault.previewDeposit(5_000e6);
        vm.expectEmit(true, true, false, true, address(vault));
        emit SeniorDeposit(alice, alice, 5_000e6, expShares);
        uint256 got = vault.depositUSDC(5_000e6, 0, alice);
        vm.stopPrank();
        assertEq(got, expShares, "deposit shares match preview");

        // Redeem emits SeniorRedeem(owner,shares,assets).
        vm.startPrank(alice);
        uint256 half = got / 2;
        // don't assert exact asset amount value (NAV math) — check topics + that it fires
        vm.expectEmit(true, false, false, false, address(vault));
        emit SeniorRedeem(alice, half, 0);
        vault.redeemSenior(half, 0);
        vm.stopPrank();

        // burnForPayment emits PaymentBurn(user,receiver,shares,assets) — driven by the gateway EOA.
        uint256 remaining = vault.seniorShares(alice);
        vm.prank(gatewayEOA);
        vm.expectEmit(true, true, false, false, address(vault));
        emit PaymentBurn(alice, bob, remaining, 0);
        vault.burnForPayment(alice, remaining, bob);
    }

    // ───────────────────────── Non-standard ERC-20 tolerance (USDT-style, no return) ─────────────────────────

    function test_nonStandardToken_yieldVault_depositRedeemRoundTrip() public {
        NoReturnToken nusd = new NoReturnToken();
        MockYieldAdapter ad = new MockYieldAdapter(address(nusd));
        MintwareYieldVault yv = new MintwareYieldVault(address(nusd), address(ad), owner);

        nusd.mint(alice, 1_000e6);
        vm.startPrank(alice);
        nusd.approve(address(yv), type(uint256).max);
        uint256 s = yv.deposit(1_000e6, alice);
        assertGt(s, 0, "USDT-style deposit mints shares via SafeERC20");
        uint256 out = yv.redeem(s);
        vm.stopPrank();
        // Round-trip returns no MORE than contributed (rounding favors the vault).
        assertLe(out, 1_000e6, "redeem never over-pays");
        assertApproxEqAbs(out, 1_000e6, 2, "USDT-style round-trips within dust");
    }

    // ───────────────────────── Fee-on-transfer: balance-diff path is Bunni-safe ─────────────────────────
    // `fundRent` is the ONE path that documents balance-diff (Bunni-safe) accounting. Confirm it credits
    // ACTUAL-received, not nominal, under a fee-on-transfer token. (The deposit/commit paths intentionally
    // assume standard USDC/WETH — see the report's Info finding.)

    function test_feeOnTransfer_fundRent_creditsActualReceived() public {
        // Build a vault whose USDC IS the fee-on-transfer token so fundRent's balance-diff is exercised.
        FeeOnTransferToken fot = new FeeOnTransferToken();
        MockYieldAdapter ad = new MockYieldAdapter(address(fot));
        // Pool currencies must include the fot token; pair it with teamTok.
        bool fotIs0 = address(fot) < address(teamTok);
        (Currency c0, Currency c1) = fotIs0
            ? (Currency.wrap(address(fot)), Currency.wrap(address(teamTok)))
            : (Currency.wrap(address(teamTok)), Currency.wrap(address(fot)));
        PoolKey memory k2 = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(k2, INIT_SQRT_PRICE);
        MintwareTreasuryVault v2 = new MintwareTreasuryVault(address(pm), k2, address(fot), address(ad), owner, teamAddr);

        // Activate (junior committed) so the lock is live → teamFeesRedirected == true → 100% of received
        // rent credits the SENIOR, isolating the balance-diff property (received, not nominal).
        teamTok.mint(teamAddr, TEAM_COMMIT);
        vm.startPrank(teamAddr);
        teamTok.approve(address(v2), type(uint256).max);
        v2.commitTeam(TEAM_COMMIT, 0, 365 days);
        vm.stopPrank();

        vm.prank(owner);
        v2.setRentFunder(address(this));

        // During lock, 100% of received rent credits the senior buffer. Push 1,000 (fot burns 1%).
        fot.mint(address(this), 1_000e6);
        fot.approve(address(v2), type(uint256).max);

        // Probe the balance-diff DIRECTLY via the RentFunded event: `total` is the balance-diff
        // `received` computed INSIDE fundRent (usdc.balanceOf-after minus before), and `toSenior` is
        // what credits the senior view. Under a 1%-fee token these must be 990 (actual-received), NOT
        // the nominal 1000 → the Bunni-safe property. (We assert the event, not a totalSeniorAssets()
        // delta: with a fee-on-transfer token wired AS the vault's USDC — an unrealistic config, hence
        // the Info note — the par-NAV read applies additional fee-aware discounting, so the NAV delta is
        // conservatively LOWER than `received`; that is safe, but the event is the precise probe of the
        // balance-diff credit this test is about.)
        vm.recordLogs();
        v2.fundRent(address(fot), 1_000e6);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("RentFunded(uint256,uint256,uint256,uint256)");
        uint256 total;
        uint256 toSenior;
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == sig) {
                (total, toSenior,,) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                found = true;
                break;
            }
        }
        assertTrue(found, "RentFunded emitted");
        assertEq(total, 990e6, "fundRent credits actual-received (balance-diff 990), not nominal 1000");
        assertEq(toSenior, 990e6, "during lock, 100% of received rent credits senior");
    }
}
