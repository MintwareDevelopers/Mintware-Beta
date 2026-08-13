// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AaveV3YieldAdapter}     from "../../src/vaults/AaveV3YieldAdapter.sol";
import {IPoolAddressesProvider} from "../../src/vaults/aave/IAaveV3.sol";
import {MintwareYieldVault}     from "../../src/payments/MintwareYieldVault.sol";
import {MintwarePaymentGateway} from "../../src/payments/MintwarePaymentGateway.sol";

/// @dev Minimal view into the live Aave v3 Pool to read a reserve's packed configuration bitmap.
interface IAaveConfig {
    function getConfiguration(address asset) external view returns (uint256 data);
}

/// @notice END-TO-END FORK PROOF of the YPN v1 PAYMENT CORE against REAL Base Sepolia (84532) Aave v3.
///         Stands up the EXACT stack the deploy route ships — `AaveV3YieldAdapter(USDC)` +
///         `MintwareYieldVault` + `MintwarePaymentGateway` — against the LIVE Aave Pool, and proves the
///         settlement loop the card rail depends on, over real yield infrastructure (not a mock):
///
///           deposit(USDC)        → senior shares minted; USDC actually SUPPLIED to real Aave
///                                  (adapter.totalAssets ↑, backed by live aUSDC)
///           burnForPayment       → Gateway-authorized burn WITHDRAWS from real Aave and pays the
///                                  receiver at par (NAV round-trip within dust)
///           onlyGateway          → a non-gateway caller cannot settle
///
///         Run forked:
///           forge test --match-path "contracts-v4/test/fork/YPNV1PaymentCoreFork.t.sol" \
///             --fork-url https://base-sepolia-rpc.publicnode.com -vvv
///         Without --fork-url the Aave Pool address has no code → every test SELF-SKIPS (safe in the
///         normal, non-forked suite).
contract YPNV1PaymentCoreForkTest is Test {
    // ── LIVE Base Sepolia Aave v3 (the exact market the deploy route targets) ────────────────────
    address internal constant USDC          = 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f; // Aave-market USDC
    address internal constant AUSDC         = 0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC; // aToken for USDC
    address internal constant AAVE_PROVIDER = 0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00; // PoolAddressesProvider
    address internal constant AAVE_POOL     = 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27; // live Aave v3 Pool

    /// @dev Aave v3 ReserveConfiguration: bits 116-151 (36 bits) hold the supply cap; zero them so the
    ///      adapter can supply (Aave reads `supplyCap == 0` as "no cap").
    uint256 internal constant SUPPLY_CAP_MASK = ~(uint256(0xFFFFFFFFF) << 116);

    address internal owner    = makeAddr("ypnOwner");
    address internal user     = makeAddr("ypnUser");
    address internal receiver = makeAddr("cardRail");

    AaveV3YieldAdapter     internal adapter;
    MintwareYieldVault     internal vault;
    MintwarePaymentGateway internal gateway;
    bool internal forked;

    function setUp() public {
        if (AAVE_POOL.code.length == 0) { forked = false; return; } // not forked → self-skip
        forked = true;

        vm.startPrank(owner);
        adapter = new AaveV3YieldAdapter(IPoolAddressesProvider(AAVE_PROVIDER), USDC, AUSDC, address(0), owner);
        vault   = new MintwareYieldVault(USDC, address(adapter), owner);
        gateway = new MintwarePaymentGateway(address(vault), USDC, owner, owner);
        adapter.setVault(address(vault));
        vault.setGateway(address(gateway));
        vm.stopPrank();

        _liftAaveSupplyCap(USDC); // documented testnet workaround — let the adapter supply into Aave
    }

    /// @notice The full loop: real Aave supply on deposit, real Aave withdraw on settlement, par payout.
    function test_deposit_supplies_aave_then_gateway_settles_at_par() public {
        if (!forked) return;

        uint256 amount = 1_000_000_000; // $1,000 USDC (6dp)
        deal(USDC, user, amount);

        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);
        uint256 shares = vault.deposit(amount, user);
        vm.stopPrank();

        assertGt(shares, 0, "no shares minted");

        // Principal actually landed in REAL Aave (adapter is backed by live aUSDC), not just buffered.
        assertGe(adapter.totalAssets(), amount - 2, "deposit did not reach real Aave");
        assertApproxEqAbs(vault.totalAssets(), amount, 2, "NAV not ~par after deposit");

        // Gateway settles a card charge: burn the user's shares, USDC withdrawn from real Aave → rail.
        uint256 expected = vault.convertToAssets(shares); // pre-burn NAV (rounds down, favors vault)
        uint256 aaveBefore = adapter.totalAssets();

        vm.prank(address(gateway)); // only the gateway may settle
        uint256 redeemed = vault.burnForPayment(user, shares, receiver);

        assertEq(redeemed, expected, "redeemed != quoted NAV");
        assertApproxEqAbs(redeemed, amount, 2, "senior not paid ~par");
        assertEq(IERC20(USDC).balanceOf(receiver), redeemed, "receiver not paid the settled USDC");
        assertLt(adapter.totalAssets(), aaveBefore, "settlement did not withdraw from real Aave");
        assertEq(vault.totalShares(), 0, "shares not fully burned");
    }

    /// @notice Only the wired gateway can settle — a stranger cannot drain the vault.
    function test_only_gateway_can_settle() public {
        if (!forked) return;

        uint256 amount = 100_000_000; // $100
        deal(USDC, user, amount);
        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);
        uint256 shares = vault.deposit(amount, user);
        vm.stopPrank();

        vm.expectRevert(MintwareYieldVault.OnlyGateway.selector);
        vault.burnForPayment(user, shares, receiver); // caller is the test, not the gateway
    }

    function _liftAaveSupplyCap(address asset) internal {
        uint256 cur = IAaveConfig(AAVE_POOL).getConfiguration(asset);
        vm.record();
        IAaveConfig(AAVE_POOL).getConfiguration(asset);
        (bytes32[] memory reads, ) = vm.accesses(AAVE_POOL);
        for (uint256 i; i < reads.length; i++) {
            if (uint256(vm.load(AAVE_POOL, reads[i])) == cur) {
                vm.store(AAVE_POOL, reads[i], bytes32(cur & SUPPLY_CAP_MASK));
                return;
            }
        }
        revert("reserve-config slot not found");
    }
}
