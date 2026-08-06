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

import {MintwareOracleHook}    from "../src/rwa/MintwareOracleHook.sol";
import {RwaCollateralOracle}   from "../src/rwa/RwaCollateralOracle.sol";
import {HookMiner}             from "../src/lib/HookMiner.sol";
import {MockERC20}             from "./mocks/MockERC20.sol";

/// @dev A stand-in for a THIRD-PARTY lending market that reads Mintware's on-chain RwaCollateralOracle
///      mid-transaction to size a loan against vRWA collateral. It knows nothing about Mintware's hook
///      internals — it integrates against one oracle address. This is the composability proof.
contract MockRwaLendingMarket {
    RwaCollateralOracle public immutable oracle;
    constructor(RwaCollateralOracle _oracle) { oracle = _oracle; }

    function maxBorrowUsd(PoolKey calldata key, uint256 collateralUsd) external view returns (uint256) {
        uint16 ltvBps = oracle.suggestedMaxLtvBps(key);
        return (collateralUsd * ltvBps) / 10_000;
    }
}

/// @title  RwaCollateralOracle — composability proof
/// @notice Proves the "Chainlink move": an external protocol reads Mintware's on-chain oracle to
///         parameterize itself against vRWA collateral, using REAL band data. As the pool's price
///         drifts from the appraisal (core -> spec -> out of band), the lending market's LTV steps
///         down 70% -> 40% -> 0% — with no Mintware cooperation beyond the public oracle read.
contract RwaCollateralOracleTest is Test {
    using PoolIdLibrary for PoolKey;

    address internal deployer = address(this);
    address internal keeper   = makeAddr("keeper");

    PoolManager internal pm;
    MockERC20   internal usdc;
    MockERC20   internal vrwa;
    MintwareOracleHook internal hook;
    RwaCollateralOracle internal oracle;
    MockRwaLendingMarket internal market;

    PoolKey internal key;
    PoolId  internal id;

    uint256 internal constant Q96      = 1 << 96;
    uint160 internal constant SQRT_1_0 = 79228162514264337593543950336; // price 1.0 (tick 0)

    function setUp() public {
        pm   = new PoolManager(deployer);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vrwa = new MockERC20("Mintware vRWA", "vRWA", 6);

        // Mine + deploy the oracle hook (flags 0xA80). `vault` is irrelevant to the read path.
        bytes memory args = abi.encode(IPoolManager(address(pm)), makeAddr("vault"), keeper, deployer);
        (, bytes32 salt) = HookMiner.find(deployer, uint160(0xA80), type(MintwareOracleHook).creationCode, args);
        hook = new MintwareOracleHook{salt: salt}(IPoolManager(address(pm)), makeAddr("vault"), keeper, deployer);

        bool usdcIsToken0 = address(usdc) < address(vrwa);
        (Currency c0, Currency c1) = usdcIsToken0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(vrwa)))
            : (Currency.wrap(address(vrwa)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(hook))});
        id  = key.toId();

        pm.initialize(key, SQRT_1_0);      // pool price = 1.0
        hook.configurePool(id, 1500, 4500); // ±15% core / ±45% spec

        oracle = new RwaCollateralOracle(IPoolManager(address(pm)));
        market = new MockRwaLendingMarket(oracle);
    }

    function _setAppraisal(uint256 x96) internal {
        vm.prank(keeper);
        hook.setAppraisal(id, x96);
    }

    // ── the composability proof: LTV steps down as band risk rises ───────────

    function test_in_core_band_full_ltv() public {
        _setAppraisal(Q96); // appraisal 1.0 == price 1.0 -> deviation 0 -> core
        RwaCollateralOracle.RwaRisk memory r = oracle.riskOf(key);
        assertTrue(r.configured);
        assertTrue(r.inCoreBand, "in core band");
        assertTrue(r.tradeable);
        assertEq(r.deviationBps, 0);
        assertEq(oracle.suggestedMaxLtvBps(key), 7000, "core -> 70% LTV");
        assertEq(market.maxBorrowUsd(key, 100_000e6), 70_000e6, "lending market lets you borrow 70%");
    }

    function test_in_spec_band_reduced_ltv() public {
        _setAppraisal((Q96 * 13) / 10); // appraisal 1.3, price 1.0 -> ~23% dev -> off-core, in-spec
        RwaCollateralOracle.RwaRisk memory r = oracle.riskOf(key);
        assertFalse(r.inCoreBand, "off core");
        assertTrue(r.tradeable, "still tradeable");
        assertApproxEqAbs(r.deviationBps, 2307, 2);
        assertEq(oracle.suggestedMaxLtvBps(key), 4000, "spec -> 40% LTV");
        assertEq(market.maxBorrowUsd(key, 100_000e6), 40_000e6, "lending market cuts to 40%");
    }

    function test_out_of_band_no_ltv() public {
        _setAppraisal(Q96 * 2); // appraisal 2.0, price 1.0 -> 50% dev -> out of spec (untradeable)
        RwaCollateralOracle.RwaRisk memory r = oracle.riskOf(key);
        assertFalse(r.tradeable, "out of band -> could not liquidate");
        assertEq(oracle.suggestedMaxLtvBps(key), 0, "out of band -> no lending");
        assertEq(market.maxBorrowUsd(key, 100_000e6), 0, "lending market refuses the collateral");
    }

    function test_unconfigured_pool_is_zero_risk_view() public view {
        // A pool key whose hook has no band config -> configured=false, no LTV.
        RwaCollateralOracle.RwaRisk memory r = oracle.riskOf(key);
        // (band config exists in setUp, but appraisal is 0 until set -> treated as unconfigured)
        assertEq(r.appraisalX96, 0);
        assertFalse(r.inCoreBand);
        assertEq(oracle.suggestedMaxLtvBps(key), 0);
    }
}
