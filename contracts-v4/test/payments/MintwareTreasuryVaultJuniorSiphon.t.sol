// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}  from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}       from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}      from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}     from "@uniswap/v4-core/src/types/Currency.sol";

import {MintwareTreasuryVault} from "../../src/payments/MintwareTreasuryVault.sol";
import {IYieldAdapter}         from "../../src/vaults/IYieldAdapter.sol";

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @dev Yield adapter over any underlying that can be *slashed* to simulate a real yield-source loss
///      (Aave bad debt / a 4626 source booking a loss). `totalAssets()` == the adapter's live balance,
///      exactly like `MockYieldAdapter`; `slash()` just moves underlying out, dropping `totalAssets()`.
contract SlashableYieldAdapter is IYieldAdapter {
    using SafeERC20 for IERC20;
    IERC20 public immutable underlying;
    constructor(address u) { underlying = IERC20(u); }
    function deposit(uint256 amount) external override {
        if (amount == 0) return;
        underlying.safeTransferFrom(msg.sender, address(this), amount);
    }
    function withdraw(uint256 amount) external override returns (uint256 got) {
        uint256 bal = underlying.balanceOf(address(this));
        got = amount < bal ? amount : bal;
        if (got > 0) underlying.safeTransfer(msg.sender, got);
    }
    function totalAssets() external view override returns (uint256) {
        return underlying.balanceOf(address(this));
    }
    function maxWithdrawable() external view override returns (uint256) {
        return underlying.balanceOf(address(this));
    }
    function maxSuppliable() external pure override returns (uint256) { return type(uint256).max; }
    /// Simulate the yield source booking a loss (bad debt) of `amt`.
    function slash(uint256 amt) external { underlying.safeTransfer(address(0xdead), amt); }
}

/// @notice ADVERSARIAL: mint-cheap / redeem-rich against the junior first-loss buffer.
///
/// The senior MINT path prices at `totalSeniorAssets()` (`tsa`, EXCLUDES the junior USDC buffer). The
/// senior REDEEM path prices at `min(par, seniorRealizableAssets())`, and `seniorRealizableAssets()`
/// ADDS the full `juniorUsdcBuffer`. R2-H1 assumed `tsa` is always the *high* (par) side. It isn't:
/// after a real yield-source loss (adapter.totalAssets drops) with the junior buffer intact,
/// `tsa < seniorParLiability` while `realizable >= par`. A fresh depositor then mints shares at the
/// depressed `tsa` and immediately redeems them at the junior-restored `par`, extracting the gap
/// straight out of the junior first-loss capital that was meant to cover the PRE-EXISTING seniors.
contract MintwareTreasuryVaultJuniorSiphonTest is Test {
    PoolManager internal pm;
    MintwareTreasuryVault internal vault;
    SlashableYieldAdapter internal adapter;
    MockERC20 internal usdc;
    MockERC20 internal team;

    address internal owner    = makeAddr("owner");
    address internal teamAddr = makeAddr("team");
    address internal gateway  = makeAddr("gateway");
    address internal alice    = makeAddr("alice");     // honest pre-existing senior
    address internal attacker = makeAddr("attacker");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;

    function setUp() public {
        pm = new PoolManager(address(this));
        usdc = new MockERC20("USD Coin", "USDC", 18);
        team = new MockERC20("Team Token", "TEAM", 18);

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        PoolKey memory key =
            PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(key, INIT_SQRT_PRICE);

        adapter = new SlashableYieldAdapter(address(usdc));
        vault   = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);

        vm.prank(owner);
        vault.setGateway(gateway);

        // Team commits 5M team tokens + a 60k USDC junior first-loss buffer.
        team.mint(teamAddr, 5_000_000e18);
        usdc.mint(teamAddr, 60_000e18);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(5_000_000e18, 60_000e18, 365 days);
        vm.stopPrank();

        // Alice: honest pre-existing senior, 100k USDC (idles fully into the adapter).
        usdc.mint(alice, 100_000e18);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(100_000e18, 0, alice);
        vm.stopPrank();
    }

    /// @notice FIX 1 (junior-siphon, High) — attack now BLOCKED. `_mintNav()` prices at
    ///         `max(totalSeniorAssets(), _redeemNav())`, so after a yield-source loss with the junior buffer
    ///         intact the fresh depositor mints at the junior-restored NAV (not the depressed `tsa`) and the
    ///         mint→redeem round-trip nets ZERO profit — no junior first-loss can be extracted. The R2-H1
    ///         spot-invariance of the mint side is preserved (when `redeemNav <= tsa`, `max == tsa`).
    function test_juniorSiphon_mintCheapRedeemRich_BLOCKED() public {
        // No LP deployed; senior capital is entirely idle in the yield adapter.
        assertEq(vault.deployedFromSenior(), 0, "no LP deployed");
        assertEq(vault.seniorParLiability(), 100_000e18, "par liability = alice deposit");
        assertEq(adapter.totalAssets(), 100_000e18, "adapter holds alice principal");

        // ── The yield source books a 50k loss (Aave bad debt / 4626 impairment). ──────────────
        adapter.slash(50_000e18);

        uint256 tsa  = vault.totalSeniorAssets();       // par view (post-loss senior-own)
        uint256 real = vault.seniorRealizableAssets();  // redeem realizable (junior-inclusive)
        assertEq(tsa,  50_000e18, "tsa dropped to post-loss senior-own value");
        assertEq(real, 110_000e18, "realizable = 50k senior-own + 60k junior buffer");
        // Pre-existing senior (Alice) is still fully covered at par by the junior buffer:
        assertGe(real, vault.seniorParLiability(), "junior fully backstops the existing senior");

        // ── Attacker mints then immediately redeems, hoping to extract the gap out of the junior. ──
        uint256 stake = 40_000e18;
        usdc.mint(attacker, stake);
        vm.startPrank(attacker);
        usdc.approve(address(vault), type(uint256).max);
        uint256 shares = vault.depositUSDC(stake, 0, attacker);
        uint256 out    = vault.redeemSenior(shares, 0);
        vm.stopPrank();

        emit log_named_decimal_uint("attacker stake   ", stake, 18);
        emit log_named_decimal_uint("attacker redeemed", out,   18);

        // FIX 1: the mint was priced at the junior-restored NAV, so the round-trip is NOT profitable.
        // The attacker can never recover more than they staked → the junior-siphon is closed. (Rounds
        // toward the vault, so `out` may be a hair below `stake`; it is never above it.)
        assertLe(out, stake, "BLOCKED: mint-cheap/redeem-rich no longer profitable (priced at redeem NAV)");
        assertApproxEqAbs(out, stake, 1e18, "attacker merely recovers ~their own stake, no junior extraction");

        // Pre-existing senior (Alice) remains fully covered at par after the attempt.
        uint256 aliceShares = vault.seniorShares(alice);
        assertGe(vault.seniorRealizableAssets(), vault.seniorParLiability(), "Alice still backstopped at par");
        vm.prank(alice);
        uint256 aliceOut = vault.redeemSenior(aliceShares, 0);
        emit log_named_decimal_uint("alice redeemed   ", aliceOut, 18);
        assertGe(aliceOut, 99_000e18, "Alice still redeems ~par (junior absorbed the loss, not the attacker)");
    }
}
