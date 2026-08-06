// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}          from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {MintwareRWAVault4626}  from "../src/rwa/MintwareRWAVault4626.sol";
import {MintwareULV4626}       from "../src/rwa/MintwareULV4626.sol";
import {MintwareVRWA}          from "../src/rwa/MintwareVRWA.sol";
import {MintwareOracleHook}    from "../src/rwa/MintwareOracleHook.sol";
import {SPVBeneficiaryRegistry, KYCLevel} from "../src/rwa/SPVBeneficiaryRegistry.sol";
import {FeeVault}              from "../src/FeeVault.sol";
import {MWRouter}              from "../src/MWRouter.sol";
import {HookMiner}             from "../src/lib/HookMiner.sol";
import {VaultSurface, VaultConfig} from "../src/vaults/VaultTypes.sol";
import {MockERC20}             from "./mocks/MockERC20.sol";

/// @title  MintwareULV4626 — USDC-only LP vault (WS2) integration
/// @notice Against a real V4 PoolManager: the issuer's RWA vault creates+seeds the oracle-banded
///         vRWA/USDC pool; the ULV attaches as an authorized LP and deploys single-sided USDC
///         liquidity. Proves LPs get USDC-denominated shares and NEVER vRWA, the QP gate, USDC-only
///         withdrawal, and the keeper's vRWA→USDC sweep.
contract MintwareULVTest is Test {
    using PoolIdLibrary for PoolKey;

    address internal deployer  = address(this); // owner + issuer
    address internal lp        = makeAddr("lp");       // accredited LP
    address internal stranger  = makeAddr("stranger"); // non-accredited
    address internal kycProv   = makeAddr("kycProvider");
    address internal keeper    = makeAddr("keeper");
    address internal treasury  = makeAddr("treasury");
    address internal dist      = makeAddr("distributor");
    address internal rTreasury = makeAddr("routerTreasury");
    address internal rOwner    = makeAddr("routerOwner");

    PoolManager internal pm;
    MockERC20   internal usdc;
    MintwareVRWA internal vrwa;
    SPVBeneficiaryRegistry internal registry;
    FeeVault    internal feeVault;
    MintwareRWAVault4626 internal rwaVault;
    MintwareOracleHook internal hook;
    MWRouter    internal router;
    MintwareULV4626 internal ulv;

    PoolKey internal poolKey;
    PoolId  internal poolId;
    bool    internal usdcIsToken0;

    uint160 internal constant SQRT_1_0 = 79228162514264337593543950336; // price 1.0 (tick 0)

    function setUp() public {
        pm       = new PoolManager(deployer);
        usdc     = new MockERC20("USD Coin", "USDC", 6);
        vrwa     = new MintwareVRWA("Mintware vRWA", "vRWA", 6, deployer);
        registry = new SPVBeneficiaryRegistry(deployer);
        registry.setKycProvider(kycProv);
        feeVault = new FeeVault(address(usdc), dist, makeAddr("oracle"), treasury);

        rwaVault = new MintwareRWAVault4626(_cfg(), address(pm), address(feeVault), address(vrwa), address(registry), deployer);
        vrwa.setMinter(address(rwaVault));

        // Oracle hook wired to the RWA vault as the primary LP.
        bytes memory hookArgs = abi.encode(IPoolManager(address(pm)), address(rwaVault), makeAddr("keeper2"), deployer);
        (, bytes32 salt) = HookMiner.find(deployer, uint160(0xA80), type(MintwareOracleHook).creationCode, hookArgs);
        hook = new MintwareOracleHook{salt: salt}(IPoolManager(address(pm)), address(rwaVault), makeAddr("keeper2"), deployer);

        usdcIsToken0 = address(usdc) < address(vrwa);
        (Currency c0, Currency c1) = usdcIsToken0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(vrwa)))
            : (Currency.wrap(address(vrwa)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(hook))});
        poolId  = poolKey.toId();
        hook.configurePool(poolId, 1500, 4500);
        vm.prank(makeAddr("keeper2"));
        hook.setAppraisal(poolId, uint256(SQRT_1_0));

        router = new MWRouter(IPoolManager(address(pm)), rTreasury, 50, rOwner);

        usdc.mint(deployer, 200_000e6);
        usdc.mint(lp, 100_000e6);
        usdc.mint(stranger, 100_000e6);

        // Issuer lists + seeds the pool (creates it, two-sided).
        usdc.approve(address(rwaVault), 50_000e6);
        rwaVault.listAndSeedPool(poolKey, SQRT_1_0, -6000, 6000, 50_000e6, 50_000e6);

        // Deploy + wire the ULV: authorize it on the hook, attach it to the pool with a
        // single-sided USDC range (above current price if USDC is token0, else below).
        ulv = new MintwareULV4626(_cfg(), address(pm), address(feeVault), address(registry));
        ulv.setRouter(address(router));
        ulv.setKeeper(keeper);
        hook.setLp(address(ulv), true);
        (int24 tl, int24 tu) = usdcIsToken0 ? (int24(120), int24(6000)) : (int24(-6000), int24(-120));
        ulv.attachPool(poolKey, tl, tu);

        // KYC the LP as ACCREDITED (qualified purchaser tier).
        vm.prank(kycProv);
        registry.verifyBeneficiary(lp, KYCLevel.ACCREDITED, bytes32("ref"), bytes2("US"), 0, false);
    }

    function _cfg() internal view returns (VaultConfig memory) {
        return VaultConfig({
            surface: VaultSurface.RWA, provider: deployer, underlyingToken: address(usdc), treasury: treasury,
            name: "MW ULV Share", symbol: "mwULV", minDeposit: 0, entryFeeBps: 0, exitFeeBps: 0,
            enableMEVProtection: false, enableIdleCapital: false, idleTargetRatio: 0
        });
    }

    function _deposit(address who, uint256 amt) internal returns (uint256 shares) {
        vm.startPrank(who);
        usdc.approve(address(ulv), amt);
        shares = ulv.deposit(amt, who);
        vm.stopPrank();
    }

    // ── LP is USDC-only ──────────────────────────────────────────────────────

    function test_lp_gets_usdc_shares_never_vrwa() public {
        uint256 shares = _deposit(lp, 10_000e6);
        assertGt(shares, 0, "shares minted");
        assertEq(ulv.balanceOf(lp), shares, "LP holds ULV shares");
        assertEq(vrwa.balanceOf(lp), 0, "LP holds NO vRWA");
        assertGt(ulv.totalLiquidity(), 0, "single-sided USDC liquidity deployed");
    }

    // ── QP gate ──────────────────────────────────────────────────────────────

    function test_qp_gate_blocks_unqualified() public {
        vm.startPrank(stranger);
        usdc.approve(address(ulv), 1_000e6);
        vm.expectRevert(MintwareULV4626.NotQualifiedPurchaser.selector);
        ulv.deposit(1_000e6, stranger);
        vm.stopPrank();
    }

    function test_qp_gate_relaxed_allows_anyone() public {
        ulv.setQualifiedPurchaserRequired(false); // counsel's 3(c)(7) ruling relaxes it
        uint256 shares = _deposit(stranger, 1_000e6);
        assertGt(shares, 0, "open deposit allowed when gate relaxed");
        assertEq(vrwa.balanceOf(stranger), 0);
    }

    // ── USDC-only withdrawal via the async window ────────────────────────────

    function test_withdrawal_returns_usdc() public {
        uint256 shares = _deposit(lp, 10_000e6);

        vm.warp(block.timestamp + 25 hours); // clear MIN_HOLD_PERIOD
        vm.prank(lp);
        ulv.requestRedeem(shares);

        vm.warp(block.timestamp + 7 days + 1); // clear NOTICE_PERIOD
        uint256 balBefore = usdc.balanceOf(lp);
        vm.prank(lp);
        uint256 out = ulv.executeRedeem();

        assertGt(out, 9_990e6, "USDC returned (position stayed single-sided USDC)");
        assertEq(usdc.balanceOf(lp) - balBefore, out, "paid in USDC");
        assertEq(vrwa.balanceOf(lp), 0, "never any vRWA");
    }

    // ── keeper sweep: accrued vRWA → USDC ────────────────────────────────────

    function test_keeper_sweeps_vrwa_to_usdc() public {
        // Simulate the ULV position having accrued vRWA (as if trades converted part of it).
        vrwa.setMinter(deployer);
        vrwa.mint(address(ulv), 500e6);
        vrwa.setMinter(address(rwaVault));

        uint256 usdcBefore = usdc.balanceOf(address(ulv));
        vm.prank(keeper);
        uint256 usdcOut = ulv.sweepVrwaToUsdc(0, 0); // 0 amountIn = sweep all

        assertGt(usdcOut, 0, "vRWA swept to USDC");
        assertEq(vrwa.balanceOf(address(ulv)), 0, "no vRWA left in the vault");
        assertGe(usdc.balanceOf(address(ulv)) - usdcBefore, usdcOut, "USDC received");
    }

    function test_sweep_only_keeper() public {
        vm.prank(stranger);
        vm.expectRevert(MintwareULV4626.OnlyKeeper.selector);
        ulv.sweepVrwaToUsdc(0, 0);
    }
}
