// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {SPVAssetProviderRegistry, ProviderStatus} from "../src/rwa/SPVAssetProviderRegistry.sol";
import {SPVBeneficiaryRegistry, KYCLevel} from "../src/rwa/SPVBeneficiaryRegistry.sol";
import {PVDistributionEscrow} from "../src/rwa/PVDistributionEscrow.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract SPVAssetProviderRegistryTest is Test {
    SPVAssetProviderRegistry internal reg;
    address internal issuer = makeAddr("issuer");

    function setUp() public {
        reg = new SPVAssetProviderRegistry(address(this));
    }

    function test_register_then_verify_then_suspend() public {
        vm.prank(issuer);
        reg.registerProvider(bytes32("dd-pack"));
        assertEq(uint256(reg.getProviderStatus(issuer)), uint256(ProviderStatus.REGISTERED));
        assertFalse(reg.isVerified(issuer));

        reg.verifyProvider(issuer);
        assertTrue(reg.isVerified(issuer));

        reg.suspendProvider(issuer);
        assertEq(uint256(reg.getProviderStatus(issuer)), uint256(ProviderStatus.SUSPENDED));
    }

    function test_verify_only_owner() public {
        vm.prank(issuer);
        reg.registerProvider(bytes32("x"));
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        reg.verifyProvider(issuer);
    }
}

contract PVDistributionEscrowTest is Test {
    SPVBeneficiaryRegistry internal kyc;
    PVDistributionEscrow internal escrow;
    MockERC20 internal usdc;

    address internal provider    = makeAddr("provider");
    address internal kycProvider = makeAddr("kycProvider");
    address internal alice       = makeAddr("alice");
    address internal bob         = makeAddr("bob");

    bytes32 internal constant DIST = keccak256("dist-1");
    bytes32 internal leafA;
    bytes32 internal leafB;
    bytes32 internal root;

    function setUp() public {
        kyc = new SPVBeneficiaryRegistry(address(this));
        kyc.setKycProvider(kycProvider);
        escrow = new PVDistributionEscrow(address(kyc), address(this));
        usdc = new MockERC20("USD Coin", "USDC", 6);

        // 2-leaf tree: alice -> 100, bob -> 50
        leafA = _leaf(alice, 100e6);
        leafB = _leaf(bob, 50e6);
        root  = _hashPair(leafA, leafB);

        usdc.mint(provider, 150e6);
        vm.startPrank(provider);
        usdc.approve(address(escrow), 150e6);
        escrow.createDistribution(DIST, address(usdc), root, 150e6);
        vm.stopPrank();
    }

    function _leaf(address a, uint256 amt) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a, amt))));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _kyc(address who) internal {
        vm.prank(kycProvider);
        kyc.verifyBeneficiary(who, KYCLevel.BASIC, bytes32("ref"), bytes2("US"), 0, false);
    }

    function test_claim_with_kyc_and_proof() public {
        _kyc(alice);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;

        vm.prank(alice);
        escrow.claim(DIST, 100e6, proof);
        assertEq(usdc.balanceOf(alice), 100e6, "alice claimed");
        assertTrue(escrow.hasClaimed(DIST, alice));
    }

    function test_claim_requires_kyc() public {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;
        vm.prank(alice); // no KYC
        vm.expectRevert(bytes("SPV: KYC required"));
        escrow.claim(DIST, 100e6, proof);
    }

    function test_claim_rejects_bad_proof() public {
        _kyc(alice);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafA; // wrong sibling
        vm.prank(alice);
        vm.expectRevert(PVDistributionEscrow.InvalidProof.selector);
        escrow.claim(DIST, 100e6, proof);
    }

    function test_double_claim_reverts() public {
        _kyc(alice);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;
        vm.startPrank(alice);
        escrow.claim(DIST, 100e6, proof);
        vm.expectRevert(PVDistributionEscrow.AlreadyClaimed.selector);
        escrow.claim(DIST, 100e6, proof);
        vm.stopPrank();
    }
}
