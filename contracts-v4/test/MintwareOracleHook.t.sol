// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolId}              from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {MintwareOracleHook} from "../src/rwa/MintwareOracleHook.sol";
import {HookMiner}          from "../src/lib/HookMiner.sol";

contract MintwareOracleHookTest is Test {
    address internal deployer = address(this);
    address internal vault    = makeAddr("vault");
    address internal pmAddr   = makeAddr("poolManager"); // getSlot0 not hit by view tests

    MintwareOracleHook internal hook;
    PoolId internal id = PoolId.wrap(bytes32(uint256(1)));

    uint256 internal constant Q96 = 1 << 96; // price 1.0

    function setUp() public {
        bytes memory args = abi.encode(IPoolManager(pmAddr), vault, deployer, deployer);
        (address expected, bytes32 salt) = HookMiner.find(
            deployer, uint160(0xA80), type(MintwareOracleHook).creationCode, args
        );
        hook = new MintwareOracleHook{salt: salt}(IPoolManager(pmAddr), vault, deployer, deployer);
        require(address(hook) == expected, "addr");

        hook.configurePool(id, 1500, 4500); // ±15% core / ±45% spec
        hook.setAppraisal(id, Q96);          // appraisal price = 1.0
    }

    function _price(uint256 bps) internal pure returns (uint256) {
        return (Q96 * bps) / 10_000;
    }

    function test_core_band_fee() public view {
        assertEq(hook.previewFee(id, Q96), 7_500, "at appraisal -> 0.75%");
        assertEq(hook.previewFee(id, _price(11_000)), 7_500, "+10% still core");
        assertEq(hook.previewFee(id, _price(8_600)), 7_500, "-14% still core");
    }

    function test_spec_band_fee() public view {
        assertEq(hook.previewFee(id, _price(13_000)), 20_000, "+30% -> spec 2.00%");
        assertEq(hook.previewFee(id, _price(6_000)), 20_000, "-40% -> spec 2.00%");
    }

    function test_out_of_spec_band_reverts() public {
        vm.expectRevert(MintwareOracleHook.PriceOutOfBands.selector);
        hook.previewFee(id, _price(15_000)); // +50% > 45%
    }

    function test_isPriceValid() public view {
        assertTrue(hook.isPriceValid(id, _price(14_000)), "+40% valid");
        assertFalse(hook.isPriceValid(id, _price(15_000)), "+50% invalid");
    }

    function test_getActiveBands_core_bounds() public view {
        (uint256 lower, uint256 upper) = hook.getActiveBands(id);
        assertEq(lower, (Q96 * 8_500) / 10_000, "core lower = -15%");
        assertEq(upper, (Q96 * 11_500) / 10_000, "core upper = +15%");
    }

    function test_unconfigured_pool_no_enforcement() public view {
        PoolId other = PoolId.wrap(bytes32(uint256(99)));
        assertEq(hook.previewFee(other, _price(15_000)), 0, "no override when unconfigured");
        assertTrue(hook.isPriceValid(other, _price(99_000)), "unconfigured always valid");
    }

    function test_setAppraisal_only_keeper() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(MintwareOracleHook.OnlyKeeper.selector);
        hook.setAppraisal(id, Q96);
    }

    function test_priceX96_from_sqrt_1to1() public view {
        uint160 sqrtAtTick0 = 79228162514264337593543950336; // = 2^96
        assertEq(hook.priceX96FromSqrt(sqrtAtTick0), Q96, "sqrt(1.0) -> price 1.0 (Q96)");
    }

    // ── LP authorization (multi-LP: primary vault + additional LPs like the ULV) ──────

    function _key() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0:   Currency.wrap(address(0)),
            currency1:   Currency.wrap(address(1)),
            fee:         0,
            tickSpacing: 60,
            hooks:       IHooks(address(hook))
        });
    }

    function _mlp() internal pure returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 1, salt: bytes32(0)});
    }

    function test_lp_gate_primary_vault_passes() public {
        vm.prank(pmAddr);
        hook.beforeAddLiquidity(vault, _key(), _mlp(), "");
        vm.prank(pmAddr);
        hook.beforeRemoveLiquidity(vault, _key(), _mlp(), "");
    }

    function test_lp_gate_unauthorized_reverts() public {
        vm.prank(pmAddr);
        vm.expectRevert(MintwareOracleHook.OnlyVaultCanModifyLiquidity.selector);
        hook.beforeAddLiquidity(makeAddr("ulv"), _key(), _mlp(), "");
    }

    function test_lp_gate_authorized_lp_passes_and_revoke() public {
        address ulv = makeAddr("ulv");
        hook.setLp(ulv, true);
        vm.prank(pmAddr);
        hook.beforeAddLiquidity(ulv, _key(), _mlp(), "");
        vm.prank(pmAddr);
        hook.beforeRemoveLiquidity(ulv, _key(), _mlp(), "");

        hook.setLp(ulv, false); // revoke → back to reverting
        vm.prank(pmAddr);
        vm.expectRevert(MintwareOracleHook.OnlyVaultCanModifyLiquidity.selector);
        hook.beforeAddLiquidity(ulv, _key(), _mlp(), "");
    }

    function test_setLp_only_owner() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        hook.setLp(makeAddr("ulv"), true);
    }
}
