// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {MintwareYieldVault} from "../../src/payments/MintwareYieldVault.sol";
import {IYieldAdapter}      from "../../src/vaults/IYieldAdapter.sol";
import {MockERC20}          from "../mocks/MockERC20.sol";

/// @title  Reentrancy red-team PoC — vault <-> yield-adapter external-call ordering.
/// @notice Attacker-supplied MALICIOUS ADAPTER. The vault calls `adapter.withdraw()` in the middle of
///         `redeem()`/`burnForPayment()` (CEI: shares already decremented, USDC not yet paid). The
///         malicious adapter re-enters the vault from inside `withdraw` to attempt a double-spend.
///         THESIS under test: the state-update-before-external-call ordering is exploitable.
///         RESULT (recorded by the assertions): the `nonReentrant` guard blocks the re-entry.
contract MaliciousReentrantAdapter is IYieldAdapter {
    MintwareYieldVault public vault;
    MockERC20 public immutable usdc;

    bool public reenterOnWithdraw;
    bool public reenterAttempted;
    bool public reenterReverted;
    bytes public lastRevert;

    uint256 internal _principal; // USDC this adapter "holds" for the vault

    constructor(MockERC20 _usdc) { usdc = _usdc; }

    function setVault(MintwareYieldVault _v) external { vault = _v; }
    function arm(bool on) external { reenterOnWithdraw = on; }

    function deposit(uint256 amount) external override {
        usdc.transferFrom(msg.sender, address(this), amount); // pull from vault (mirrors a real adapter)
        _principal += amount;
    }

    function withdraw(uint256 amount) external override returns (uint256 withdrawn) {
        uint256 pay = amount > _principal ? _principal : amount;

        // ── the attack: re-enter the vault mid-redemption, from inside the adapter callback ──
        if (reenterOnWithdraw && !reenterAttempted) {
            reenterAttempted = true;
            // Attempt to redeem the attacker's shares a second time while the first redeem is still in
            // flight (its shares are already burned, but its USDC has not yet been transferred out).
            try vault.redeem(1) {
                // success here == double-spend == guard failed
            } catch (bytes memory err) {
                reenterReverted = true;
                lastRevert = err;
            }
        }

        _principal -= pay;
        usdc.transfer(address(vault), pay);
        return pay;
    }

    function totalAssets() external view override returns (uint256) { return _principal; }
    function maxWithdrawable() external view override returns (uint256) { return _principal; }
    function maxSuppliable() external view override returns (uint256) { return type(uint256).max; }
}

contract MintwareVaultReentrancyPoCTest is Test {
    MintwareYieldVault internal vault;
    MaliciousReentrantAdapter internal adapter;
    MockERC20 internal usdc;

    address internal owner = makeAddr("owner");
    address internal attacker = makeAddr("attacker");
    address internal victim = makeAddr("victim");

    uint256 constant ONE = 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        adapter = new MaliciousReentrantAdapter(usdc);
        vault = new MintwareYieldVault(address(usdc), address(adapter), owner);
        adapter.setVault(vault);

        usdc.mint(victim, 1_000 * ONE);
        usdc.mint(attacker, 1_000 * ONE);

        vm.startPrank(victim);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(1_000 * ONE, victim);
        vm.stopPrank();

        vm.startPrank(attacker);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(1_000 * ONE, attacker);
        vm.stopPrank();
    }

    /// @notice Cross-function reentrancy attempt: attacker's adapter re-enters `vault.redeem` while the
    ///         attacker's outer `redeem` is mid-flight. Proves whether `nonReentrant` blocks it.
    function test_reentrantAdapter_cannotDoubleSpend() public {
        adapter.arm(true);

        uint256 attackerUsdcBefore = usdc.balanceOf(attacker);
        uint256 attackerSharesBefore = vault.shares(attacker);

        vm.prank(attacker);
        uint256 out = vault.redeem(attackerSharesBefore);

        // The re-entrant redeem was ATTEMPTED and REVERTED (guard held).
        assertTrue(adapter.reenterAttempted(), "reentry was not even attempted");
        assertTrue(adapter.reenterReverted(),  "REENTRANT redeem SUCCEEDED - nonReentrant guard FAILED");

        // Confirm the revert was ReentrancyGuardReentrantCall() (OZ v5 selector 0x3ee5aeb5).
        bytes4 sel;
        bytes memory err = adapter.lastRevert();
        if (err.length >= 4) { assembly { sel := mload(add(err, 0x20)) } }
        assertEq(sel, bytes4(0x3ee5aeb5), "revert was not ReentrancyGuardReentrantCall");

        // Attacker got exactly ONE fair redemption, no more.
        uint256 gained = usdc.balanceOf(attacker) - attackerUsdcBefore;
        assertEq(gained, out, "attacker extracted more than one redemption");
        assertEq(vault.shares(attacker), 0, "attacker shares mis-accounted");

        // Vault stays solvent: victim still withdraws their full principal.
        adapter.arm(false);
        uint256 victimShares = vault.shares(victim);
        vm.prank(victim);
        uint256 vout = vault.redeem(victimShares);
        assertGe(vout, 1_000 * ONE - 2, "victim underpaid - pool was drained");
    }
}
