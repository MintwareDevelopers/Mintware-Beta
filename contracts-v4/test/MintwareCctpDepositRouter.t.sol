// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareCctpDepositRouter} from "../src/payments/MintwareCctpDepositRouter.sol";
import {MintwareYieldVault}        from "../src/payments/MintwareYieldVault.sol";
import {MintwareERC4626YieldAdapter} from "../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MockERC20}   from "./mocks/MockERC20.sol";
import {MockERC4626} from "./mocks/MockERC4626.sol";
import {MockMessageTransmitter} from "./mocks/MockMessageTransmitter.sol";

/// @notice Proof of the Arc CCTP bridge-and-deposit against the REAL Arc spend stack: a CCTP message mints
///         USDC to the router (mock transmitter), which deposits it into the real MintwareYieldVault (idling
///         via the real ERC-4626 adapter), crediting the end user — one relayer-gated tx, no stuck USDC.
contract MintwareCctpDepositRouterTest is Test {
    MockERC20   internal usdc;
    MockERC4626 internal source;
    MintwareERC4626YieldAdapter internal adapter;
    MintwareYieldVault internal vault;
    MockMessageTransmitter internal transmitter;
    MintwareCctpDepositRouter internal router;

    address internal owner   = makeAddr("owner");
    address internal relayer = makeAddr("relayer");
    address internal alice   = makeAddr("alice");

    uint256 internal constant BRIDGED = 100_000e6; // $100k USDC arriving via CCTP

    function setUp() public {
        usdc    = new MockERC20("USD Coin", "USDC", 6);
        source  = new MockERC4626(IERC20(address(usdc)));
        adapter = new MintwareERC4626YieldAdapter(address(usdc), address(source), address(0), owner);
        vault   = new MintwareYieldVault(address(usdc), address(adapter), owner);
        vm.prank(owner);
        adapter.setVault(address(vault));

        transmitter = new MockMessageTransmitter();
        transmitter.configure(address(usdc), BRIDGED);

        router = new MintwareCctpDepositRouter(address(transmitter), address(usdc), address(vault), owner, relayer);
    }

    function test_bridge_and_deposit_credits_recipient() public {
        vm.prank(relayer);
        uint256 shares = router.receiveAndDeposit(hex"01", hex"02", alice);

        assertGt(shares, 0, "shares minted");
        assertEq(vault.shares(alice), shares, "credited to alice, not the router");
        assertApproxEqAbs(vault.totalAssets(), BRIDGED, 2, "bridged USDC is now vault assets");
        assertEq(usdc.balanceOf(address(router)), 0, "no USDC stuck in the router");
    }

    function test_only_relayer_can_complete() public {
        vm.prank(alice);
        vm.expectRevert(MintwareCctpDepositRouter.OnlyRelayer.selector);
        router.receiveAndDeposit(hex"01", hex"02", alice);
    }

    function test_reverts_when_receive_fails() public {
        transmitter.setFail(true);
        vm.prank(relayer);
        vm.expectRevert(MintwareCctpDepositRouter.ReceiveFailed.selector);
        router.receiveAndDeposit(hex"01", hex"02", alice);
    }

    function test_reverts_when_nothing_minted() public {
        transmitter.configure(address(usdc), 0); // message mints nothing
        vm.prank(relayer);
        vm.expectRevert(MintwareCctpDepositRouter.NothingMinted.selector);
        router.receiveAndDeposit(hex"01", hex"02", alice);
    }

    function test_reverts_on_zero_recipient() public {
        vm.prank(relayer);
        vm.expectRevert(MintwareCctpDepositRouter.ZeroAddress.selector);
        router.receiveAndDeposit(hex"01", hex"02", address(0));
    }

    function test_setRelayer_only_owner() public {
        vm.prank(alice);
        vm.expectRevert();
        router.setRelayer(alice);

        vm.prank(owner);
        router.setRelayer(makeAddr("newRelayer"));
        assertEq(router.relayer(), makeAddr("newRelayer"));
    }
}
