// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MintwareYieldVault} from "../../src/payments/MintwareYieldVault.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract EarnInvariantAdapter is IYieldAdapter {
    using SafeERC20 for MockERC20;
    MockERC20 public immutable token;
    uint256 public liquidity = type(uint256).max;
    constructor(MockERC20 t) { token = t; }
    function asset() external view returns (address) { return address(token); }
    function setLiquidity(uint256 n) external { liquidity = n; }
    function deposit(uint256 n) external { token.safeTransferFrom(msg.sender, address(this), n); }
    function withdraw(uint256 n) external returns (uint256 got) {
        got = n < liquidity ? n : liquidity;
        token.safeTransfer(msg.sender, got);
    }
    function totalAssets() external view returns (uint256) { return token.balanceOf(address(this)); }
    function maxWithdrawable() external view returns (uint256) {
        uint256 b = token.balanceOf(address(this)); return b < liquidity ? b : liquidity;
    }
    function maxSuppliable() external pure returns (uint256) { return type(uint256).max; }
}

contract EarnHandler is Test {
    MintwareYieldVault public vault;
    MockERC20 public token;
    EarnInvariantAdapter public adapter;
    address[4] public users;
    uint256 public totalDeposited;
    uint256 public totalYield;
    uint256 public totalPaid;
    uint256 public ops;
    bool public claimDroppedOnExit;
    constructor(MintwareYieldVault v, MockERC20 t, EarnInvariantAdapter a) {
        vault = v; token = t; adapter = a;
        users = [address(0xA11), address(0xB22), address(0xC33), address(0xD44)];
        for (uint256 i; i < users.length; ++i) {
            token.mint(users[i], 1e18);
            vm.prank(users[i]); token.approve(address(v), type(uint256).max);
        }
    }
    function _user(uint256 seed) internal view returns (address) { return users[seed % users.length]; }
    function deposit(uint256 u, uint256 seed) external {
        address who = _user(u); uint256 amt = bound(seed, 1, 1e12);
        vm.prank(who); try vault.deposit(amt, who) returns (uint256) { totalDeposited += amt; } catch {}
        ++ops;
    }
    function redeem(uint256 u, uint256 seed) external {
        address who = _user(u); uint256 bal = vault.balanceOf(who); if (bal == 0) return;
        uint256 s = bound(seed, 1, bal); uint256 beforeClaim = vault.convertToAssets(vault.balanceOf(users[(u + 1) % users.length]));
        vm.prank(who); try vault.redeem(s, who, who) returns (uint256 paid) { totalPaid += paid; } catch {}
        uint256 afterClaim = vault.convertToAssets(vault.balanceOf(users[(u + 1) % users.length]));
        if (afterClaim + 1 < beforeClaim) claimDroppedOnExit = true;
        ++ops;
    }
    function tinyRedeem(uint256 u) external {
        address who = _user(u); if (vault.balanceOf(who) == 0) return;
        uint256 beforeClaim = vault.convertToAssets(vault.balanceOf(users[(u + 1) % users.length]));
        vm.prank(who); try vault.redeem(1, who, who) returns (uint256 paid) { totalPaid += paid; } catch {}
        if (vault.convertToAssets(vault.balanceOf(users[(u + 1) % users.length])) + 1 < beforeClaim) claimDroppedOnExit = true;
        ++ops;
    }
    function yieldAccrue(uint256 seed) external {
        uint256 amt = bound(seed, 1, 1e10); token.mint(address(adapter), amt); totalYield += amt; ++ops;
    }
    function capLiquidity(uint256 seed) external { adapter.setLiquidity(seed % (1e12 + 1)); ++ops; }
    function donate(uint256 seed) external { uint256 amt = seed % 1e10; token.mint(address(vault), amt); ++ops; }
}

contract MintwareYieldVaultInvariantTest is StdInvariant, Test {
    MockERC20 token;
    EarnInvariantAdapter adapter;
    MintwareYieldVault vault;
    EarnHandler handler;
    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        adapter = new EarnInvariantAdapter(token);
        vault = new MintwareYieldVault(address(token), address(adapter), address(this));
        handler = new EarnHandler(vault, token, adapter);
        targetContract(address(handler));
    }
    function invariant_claims_backed() public view {
        uint256 claims;
        for (uint256 i; i < 4; ++i) claims += vault.convertToAssets(vault.balanceOf(handler.users(i)));
        assertLe(claims, vault.totalAssets() + 1);
    }
    function invariant_other_holder_claim_never_falls_on_exit() public view { assertFalse(handler.claimDroppedOnExit()); }
    function invariant_supply_matches_holder_balances() public view {
        uint256 sum; for (uint256 i; i < 4; ++i) sum += vault.balanceOf(handler.users(i));
        assertEq(sum, vault.totalSupply());
    }
}
