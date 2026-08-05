// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

// V4 core
import {PoolManager}          from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}         from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}               from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}              from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}             from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}         from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary}         from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

// Our contracts
import {MintwareRWAVault4626} from "../src/rwa/MintwareRWAVault4626.sol";
import {MintwareVRWA}         from "../src/rwa/MintwareVRWA.sol";
import {MintwareOracleHook}   from "../src/rwa/MintwareOracleHook.sol";
import {SPVBeneficiaryRegistry} from "../src/rwa/SPVBeneficiaryRegistry.sol";
import {FeeVault}             from "../src/FeeVault.sol";
import {MWRouter}             from "../src/MWRouter.sol";
import {HookMiner}            from "../src/lib/HookMiner.sol";
import {VaultSurface, VaultConfig} from "../src/vaults/VaultTypes.sol";

import {MockERC20}            from "./mocks/MockERC20.sol";

/// @title  RWA end-to-end flow — list → trade (pure-token model)
/// @notice Proves the RWA pipeline against a real V4 PoolManager on ONE real vRWA. Under the
///         three-role model vRWA is the issuer-supplied security (public deposit is CLOSED), so:
///         (1) public deposit reverts, (2) the issuer lists + seeds an oracle-banded vRWA/USDC pool
///         from its own inventory (list), (3) a trader swaps vRWA↔USDC through MWRouter (trade),
///         (4) an out-of-band swap reverts — band enforcement against a live swap.
contract MintwareRWAFlowTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    address internal deployer       = address(this); // vault + hook owner, issuer of the seed
    address internal alice          = makeAddr("alice");   // depositor
    address internal bob            = makeAddr("bob");      // secondary-market trader
    address internal issuer         = makeAddr("issuer");
    address internal keeper         = makeAddr("keeper");   // posts appraisals
    address internal treasury       = makeAddr("treasury");
    address internal dist           = makeAddr("distributor");
    address internal routerOwner    = makeAddr("routerOwner");
    address internal routerTreasury = makeAddr("routerTreasury");

    PoolManager internal pm;
    MockERC20   internal usdc;
    MintwareVRWA internal vrwa;
    SPVBeneficiaryRegistry internal registry;
    FeeVault    internal feeVault;
    MintwareRWAVault4626 internal vault;
    MintwareOracleHook internal hook;
    MWRouter    internal router;

    PoolKey internal poolKey;
    PoolId  internal poolId;
    bool    internal usdcIsToken0;

    uint160 internal constant SQRT_1_0     = 79228162514264337593543950336;   // price 1.0 (tick 0)
    uint256 internal constant APPRAISAL_1  = uint256(79228162514264337593543950336); // Q96 price 1.0
    uint256 internal constant APPRAISAL_2  = APPRAISAL_1 * 2;                 // price 2.0 (out of band vs 1.0)
    uint16  internal constant CORE_BAND    = 1500; // ±15%
    uint16  internal constant SPEC_BAND    = 4500; // ±45%

    function setUp() public {
        pm   = new PoolManager(deployer);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vrwa = new MintwareVRWA("Mintware vRWA", "vRWA", 6, deployer); // 6dp to match USDC → price 1.0 at tick 0
        registry = new SPVBeneficiaryRegistry(deployer);
        feeVault = new FeeVault(address(usdc), dist, makeAddr("oracle"), treasury);

        VaultConfig memory cfg = VaultConfig({
            surface:             VaultSurface.RWA,
            provider:            deployer,
            underlyingToken:     address(usdc),
            treasury:            treasury,
            name:                "MW RWA Vault Share",
            symbol:              "mwRWA",
            minDeposit:          0,
            entryFeeBps:         0,
            exitFeeBps:          0,
            enableMEVProtection: false,
            enableIdleCapital:   false,
            idleTargetRatio:     0
        });
        vault = new MintwareRWAVault4626(cfg, address(pm), address(feeVault), address(vrwa), address(registry), issuer);
        vrwa.setMinter(address(vault));

        // Mine + deploy the oracle hook (flags 0xA80), gating LP to the vault.
        bytes memory hookArgs = abi.encode(IPoolManager(address(pm)), address(vault), keeper, deployer);
        (, bytes32 salt) = HookMiner.find(deployer, uint160(0xA80), type(MintwareOracleHook).creationCode, hookArgs);
        hook = new MintwareOracleHook{salt: salt}(IPoolManager(address(pm)), address(vault), keeper, deployer);

        // vRWA/USDC dynamic-fee pool with the oracle hook.
        usdcIsToken0 = address(usdc) < address(vrwa);
        (Currency c0, Currency c1) = usdcIsToken0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(vrwa)))
            : (Currency.wrap(address(vrwa)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({
            currency0:   c0,
            currency1:   c1,
            fee:         LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks:       IHooks(address(hook))
        });
        poolId = poolKey.toId();

        hook.configurePool(poolId, CORE_BAND, SPEC_BAND);
        vm.prank(keeper);
        hook.setAppraisal(poolId, APPRAISAL_1);

        router = new MWRouter(IPoolManager(address(pm)), routerTreasury, 50, routerOwner);

        usdc.mint(alice,    100_000e6);
        usdc.mint(bob,      100_000e6);
        usdc.mint(deployer, 100_000e6); // issuer's pool-seed USDC
    }

    // Stage 1 — LIST + seed a two-sided vRWA/USDC market (issuer supplies vRWA inventory).
    function _listPool(uint256 usdcSeed, uint256 vrwaSeed) internal {
        usdc.approve(address(vault), usdcSeed); // deployer (issuer) provides USDC
        vault.listAndSeedPool(poolKey, SQRT_1_0, -6000, 6000, usdcSeed, vrwaSeed);
    }

    // Stage 3 — TRADE: swap `amountIn` of `sellUsdc?USDC:vRWA` via MWRouter → recipient.
    function _swap(address trader, bool sellUsdc, uint256 amountIn) internal returns (uint256 out) {
        bool zeroForOne = sellUsdc ? usdcIsToken0 : !usdcIsToken0;
        address tokenIn = sellUsdc ? address(usdc) : address(vrwa);
        vm.startPrank(trader);
        MockERC20(tokenIn).approve(address(router), amountIn);
        out = router.swapExactInputSingle(MWRouter.ExactInputSingleParams({
            key:              poolKey,
            zeroForOne:       zeroForOne,
            amountIn:         amountIn,
            amountOutMinimum: 0,
            recipient:        trader,
            deadline:         block.timestamp + 1 hours,
            tag:              ""
        }));
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────

    function test_stage1_public_deposit_disabled() public {
        // Three-role model: vRWA is issuer-supplied inventory, not a wrapper minted to depositors.
        vm.startPrank(alice);
        usdc.approve(address(vault), 10_000e6);
        vm.expectRevert(MintwareRWAVault4626.DepositsDisabled.selector);
        vault.deposit(10_000e6, alice);
        vm.stopPrank();
    }

    function test_stage2_list_seeds_oracle_banded_pool() public {
        _listPool(50_000e6, 50_000e6);

        assertTrue(vault.poolInitialized(), "pool initialized");
        assertGt(vault.totalLiquidity(), 0, "seed liquidity added");

        // Pool exists at the appraisal price, bands configured.
        (uint160 sqrtP,,,) = IPoolManager(address(pm)).getSlot0(poolId);
        assertEq(sqrtP, SQRT_1_0, "pool at appraisal price");
        (uint256 lo, uint256 hi) = hook.getActiveBands(poolId);
        assertLt(lo, hi, "active core band");
    }

    function test_stage3_trade_in_band_through_mwrouter() public {
        _listPool(50_000e6, 50_000e6);

        uint256 bobVrwaBefore = vrwa.balanceOf(bob);
        uint256 treasBefore   = vrwa.balanceOf(routerTreasury);

        // bob buys vRWA with 1,000 USDC — small trade, price stays in the core band.
        uint256 userOut = _swap(bob, true, 1_000e6);

        uint256 recvd   = vrwa.balanceOf(bob) - bobVrwaBefore;
        uint256 routerFee = vrwa.balanceOf(routerTreasury) - treasBefore;

        assertGt(recvd, 0, "bob received vRWA");
        assertEq(userOut, recvd, "return value == delivered");
        assertGt(routerFee, 0, "router fee skimmed to treasury (output token)");
        // Router fee is 0.5% of the gross the router received (post LP band-fee).
        assertEq(routerFee, ((recvd + routerFee) * 50) / 10_000, "router fee = 0.5% of gross");
        console2.log("bob vRWA out:", recvd);
        console2.log("router fee  :", routerFee);
    }

    function test_stage4_out_of_band_swap_reverts() public {
        _listPool(50_000e6, 50_000e6);

        // Keeper moves the appraisal to 2.0 while the pool sits at 1.0 → 50% deviation,
        // outside the ±45% spec band. The oracle hook's beforeSwap must reject the swap.
        vm.prank(keeper);
        hook.setAppraisal(poolId, APPRAISAL_2);

        vm.startPrank(bob);
        usdc.approve(address(router), 1_000e6);
        vm.expectRevert(); // MintwareOracleHook.PriceOutOfBands bubbles up through the V4 hook call
        router.swapExactInputSingle(MWRouter.ExactInputSingleParams({
            key:              poolKey,
            zeroForOne:       usdcIsToken0,
            amountIn:         1_000e6,
            amountOutMinimum: 0,
            recipient:        bob,
            deadline:         block.timestamp + 1 hours,
            tag:              ""
        }));
        vm.stopPrank();
    }

    function test_full_flow_end_to_end() public {
        // 1. LIST — issuer seeds inventory + USDC into the oracle-banded pool.
        _listPool(50_000e6, 50_000e6);
        assertTrue(vault.poolInitialized());

        // 2. TRADE (buy) — a secondary-market trader buys vRWA with USDC.
        uint256 bought = _swap(bob, true, 2_000e6);
        assertGt(bought, 0, "bob bought vRWA");

        // 3. TRADE (sell) — bob sells half of it back to USDC via MWRouter.
        uint256 usdcBefore = usdc.balanceOf(bob);
        uint256 usdcOut = _swap(bob, false, bought / 2);
        assertGt(usdcOut, 0, "bob got USDC back for his vRWA");
        assertEq(usdc.balanceOf(bob) - usdcBefore, usdcOut, "USDC delivered");
    }
}
