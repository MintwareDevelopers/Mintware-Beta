// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MintwareTreasuryFloatSettlementTest} from "./MintwareTreasuryFloatSettlement.t.sol";

/// @notice AUDIT R5 (autonomous exploit red-team). The leg-1 wstETH→ETH slippage floor (`lidoBandBps`,
///         enforced by `_enforceLidoFloor`) and the emergency-valve conversion headroom were INSTANT
///         `onlyOwner` setters, while their risk-sibling `bandTicks` (leg 2) was 48h-timelocked. With
///         `minSettleOutBps` default-off, `_enforceLidoFloor` is the ONLY bound on leg 1 — so a rogue
///         owner could widen it 1%→100% in one block and (with a colluding keeper) self-sandwich-drain
///         wstETH backing, bypassing the exact governance window R4-L4 installs. The fix routes both
///         through the same rail. These tests PROVE the fix: widening is delayed, tightening is instant.
///
///         The parent setUp pins `settlementRail`, so `_riskParamsLive()` is TRUE (timelock active).
contract FloatSettlementR5TimelockTest is MintwareTreasuryFloatSettlementTest {

    function test_R5_LidoBand_widen_is_timelocked() public {
        uint16 start = fs.lidoBandBps();               // default 100 (1%)
        bytes32 id = fs.RP_LIDO_BAND();                // hoist (getter must not consume the prank)

        vm.prank(owner);
        fs.setLidoBandBps(10_000);                     // widen to 100% ⇒ risk-increasing

        // Must NOT take effect this block — the exploit's instant widen is now blocked.
        assertEq(fs.lidoBandBps(), start, "widening lidoBandBps must be 48h-timelocked, not instant");

        // After the 48h window the owner can confirm it (governance path preserved).
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(owner);
        fs.confirmRiskParam(id);
        assertEq(fs.lidoBandBps(), 10_000, "widening applies only after the 48h delay + confirm");
    }

    function test_R5_LidoBand_narrow_is_instant() public {
        vm.prank(owner);
        fs.setLidoBandBps(50);                         // narrow (tighten) ⇒ safety ⇒ instant
        assertEq(fs.lidoBandBps(), 50, "tightening lidoBandBps stays instant");
    }

    function test_R5_EmergencyHeadroom_raise_is_timelocked() public {
        uint16 start = fs.emergencySwapHeadroomBps();  // default 200
        vm.prank(owner);
        fs.setEmergencySwapHeadroomBps(5_000);         // raise ⇒ spends more backing/unit ⇒ risk-increasing
        assertEq(fs.emergencySwapHeadroomBps(), start, "raising emergency headroom must be 48h-timelocked");
    }

    function test_R5_EmergencyHeadroom_lower_is_instant() public {
        vm.prank(owner);
        fs.setEmergencySwapHeadroomBps(50);            // lower ⇒ safety ⇒ instant
        assertEq(fs.emergencySwapHeadroomBps(), 50, "lowering emergency headroom stays instant");
    }
}
