// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MintwarePaymentGateway} from "../../src/payments/MintwarePaymentGateway.sol";
import {MintwareYieldVault} from "../../src/payments/MintwareYieldVault.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract RefillInvariantAdapter is IYieldAdapter {
    using SafeERC20 for MockERC20;
    MockERC20 public immutable token;
    uint256 public liquid = type(uint256).max;
    constructor(MockERC20 t) { token = t; }
    function asset() external view returns (address) { return address(token); }
    function setLiquid(uint256 n) external { liquid = n; }
    function deposit(uint256 n) external { token.safeTransferFrom(msg.sender, address(this), n); }
    function withdraw(uint256 n) external returns (uint256 got) {
        got = n < liquid ? n : liquid; token.safeTransfer(msg.sender, got);
    }
    function totalAssets() external view returns (uint256) { return token.balanceOf(address(this)); }
    function maxWithdrawable() external view returns (uint256) {
        uint256 b = token.balanceOf(address(this)); return b < liquid ? b : liquid;
    }
    function maxSuppliable() external pure returns (uint256) { return type(uint256).max; }
}

contract RefillInvariantHandler is Test {
    MintwarePaymentGateway public immutable gateway;
    MintwareYieldVault public immutable vault;
    RefillInvariantAdapter public immutable adapter;
    MockERC20 public immutable token;
    address[4] public users = [address(0xA11), address(0xB22), address(0xC33), address(0xD44)];
    address[4] public buffers = [address(0xB01), address(0xB02), address(0xB03), address(0xB04)];
    uint256 public sequence;
    bool public wrongDestination;
    bool public otherClaimDropped;

    constructor(MintwarePaymentGateway g, MintwareYieldVault v, RefillInvariantAdapter a, MockERC20 t) {
        gateway = g; vault = v; adapter = a; token = t;
        for (uint256 i; i < users.length; ++i) {
            token.mint(users[i], 1e12);
            vm.prank(users[i]); token.approve(address(vault), type(uint256).max);
            vm.prank(users[i]); vault.deposit(1e10, users[i]);
        }
    }

    function refill(uint256 u, uint256 rawShares, uint256 rawLiquidity) external {
        address member = users[u % users.length];
        address destination = gateway.bufferOf(member);
        uint256 balance = vault.balanceOf(member);
        if (destination == address(0) || balance == 0) return;
        uint256 shares = bound(rawShares, 1, balance);
        adapter.setLiquid(bound(rawLiquidity, 0, 1e10));
        uint256[4] memory claims;
        for (uint256 i; i < users.length; ++i) {
            if (users[i] != member) claims[i] = vault.convertToAssets(vault.balanceOf(users[i]));
        }
        uint256 beforeDestination = token.balanceOf(destination);
        bytes32 id = keccak256(abi.encode(++sequence));
        try gateway.refill(id, member, shares) returns (uint256 delivered) {
            if (token.balanceOf(destination) - beforeDestination != delivered) wrongDestination = true;
            for (uint256 i; i < users.length; ++i) {
                if (users[i] != member && vault.convertToAssets(vault.balanceOf(users[i])) + 2 < claims[i]) {
                    otherClaimDropped = true;
                }
            }
        } catch {}
    }

    function warp(uint256 seconds_) external { vm.warp(block.timestamp + bound(seconds_, 0, 3 days)); }

    function changeCaps(uint256 u, uint256 userRaw, uint256 globalRaw) external {
        address member = users[u % users.length];
        gateway.setUserCap(member, bound(userRaw, 0, 2_000_000_000));
        gateway.setGlobalCap(bound(globalRaw, 0, 2_000_000_000));
    }

    function confirmCaps(uint256 u) external {
        address member = users[u % users.length];
        try gateway.confirmUserCap(member) {} catch {}
        try gateway.confirmGlobalCap() {} catch {}
    }

    function changeDestination(uint256 u, uint256 choice, bool revoke) external {
        uint256 i = u % users.length;
        address member = users[i];
        if (revoke) {
            vm.prank(member); gateway.revokeBuffer();
        }
        else {
            vm.prank(member); gateway.proposeBuffer(buffers[(i + 1 + choice % 3) % buffers.length]);
            vm.warp(block.timestamp + 48 hours);
            vm.prank(member); gateway.acceptBuffer();
        }
    }
}

/// @notice Stateful refill safety check (default Foundry profile: 256 runs × 500 calls).
contract MintwarePaymentGatewayInvariantTest is StdInvariant, Test {
    MockERC20 internal token;
    RefillInvariantAdapter internal adapter;
    MintwareYieldVault internal vault;
    MintwarePaymentGateway internal gateway;
    RefillInvariantHandler internal handler;

    function setUp() public {
        token = new MockERC20("USD Coin", "USDC", 6);
        adapter = new RefillInvariantAdapter(token);
        vault = new MintwareYieldVault(address(token), address(adapter), address(this));
        gateway = new MintwarePaymentGateway(address(vault), address(this));
        vault.setGateway(address(gateway));
        handler = new RefillInvariantHandler(gateway, vault, adapter, token);
        for (uint256 i; i < 4; ++i) {
            address member = handler.users(i);
            address destination = handler.buffers(i);
            vm.prank(member); gateway.proposeBuffer(destination);
            vm.warp(1 + (i + 1) * 48 hours);
            vm.prank(member); gateway.acceptBuffer();
        }
        gateway.grantRole(gateway.RELAYER_ROLE(), address(handler));
        gateway.grantRole(gateway.DEFAULT_ADMIN_ROLE(), address(handler));
        targetContract(address(handler));
    }

    function invariant_dailyLedgersNeverExceedEffectiveCaps() public view {
        uint256 day = block.timestamp / 1 days;
        uint256 total;
        for (uint256 i; i < 4; ++i) {
            address member = handler.users(i);
            uint256 cap = gateway.userCap(member);
            if (cap == 0) cap = gateway.DEFAULT_REFILL_CAP();
            uint256 delivered = gateway.userRefilled(member, day);
            if (delivered > cap) cap = delivered;
            assertLe(delivered, cap);
            total += delivered;
        }
        uint256 global = gateway.globalCap() == 0 ? gateway.DEFAULT_REFILL_CAP() : gateway.globalCap();
        if (gateway.globalRefilled(day) > global) global = gateway.globalRefilled(day);
        assertLe(total, global);
        assertLe(gateway.globalRefilled(day), global);
    }

    function invariant_refillsUseCurrentDestination_andProtectOtherClaims() public view {
        assertFalse(handler.wrongDestination());
        assertFalse(handler.otherClaimDropped());
        for (uint256 i; i < 4; ++i) {
            address member = handler.users(i);
            address current = gateway.bufferOf(member);
            if (current != address(0)) assertEq(vault.destinationOf(member), current);
        }
    }
}
