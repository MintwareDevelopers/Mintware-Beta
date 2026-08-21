// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test}         from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Math}         from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20}       from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareYieldVault} from "../../../src/payments/MintwareYieldVault.sol";
import {MockERC20}          from "../../mocks/MockERC20.sol";
import {MockYieldAdapter}   from "../../mocks/MockYieldAdapter.sol";

/// @notice GROUP B — the explicit Bunni micro-withdrawal regression, on the real `MintwareYieldVault`
///         (v1 flat-senior USDC vault, the live Arc-testnet instance). Bunni V2 was drained by crushing a
///         balance to a few wei then ratcheting it down with 44 sequential micro-withdrawals, so each
///         ±1-wei rounding was a multi-percent error and the active leg fell faster than shares burned.
///
///         This handler reproduces that regime: it drives per-holder claims into the single/double-digit-wei
///         range (via near-full drains) and fires DUST-BURST redeem loops, asserting:
///           • **B1** a holder can never extract MORE than their starting claim across a dust burst
///             (`Σ assetsOut ≤ convertToAssets(sharesAtStart)`), and
///           • **B3** every redeem removes no larger a fraction of the active leg (`totalAssets`) than the
///             fraction of shares burned — `Δactive ≤ ceil(activeBefore · burned / supplyBefore)`, the
///             direct Bunni monotone-proportionality invariant, checked in the wei regime.
contract MicroWithdrawHandler is Test {
    using Math for uint256;

    MintwareYieldVault public vault;
    MockERC20 public usdc;
    MockYieldAdapter public adapter;
    address[] public actors;

    // Ghosts.
    bool    public b1Violated;      // a dust burst extracted more than the starting claim
    bool    public b3Violated;      // a redeem removed a disproportionate slice of the active leg
    uint256 public redeemsExecuted;
    uint256 public dustRedeems;     // individual redeems inside micro-bursts (wei regime witness)
    uint256 public microBursts;
    uint256 public gYield;

    constructor(MintwareYieldVault _vault, MockERC20 _usdc, MockYieldAdapter _adapter, address[] memory _actors) {
        vault = _vault; usdc = _usdc; adapter = _adapter; actors = _actors;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    // Check B3 around a single successful redeem given the pre-redeem snapshot.
    function _checkProportionality(uint256 activeBefore, uint256 supplyBefore, uint256 burned) internal {
        if (supplyBefore == 0 || burned == 0) return;
        uint256 activeAfter = vault.totalAssets();
        uint256 dActive = activeBefore > activeAfter ? activeBefore - activeAfter : 0;
        // ceil(activeBefore * burned / supplyBefore) — the max fraction of the active leg a `burned`-share
        // redemption may ever remove. Bunni violated exactly this in the sub-100-wei regime.
        uint256 ceilBound = Math.mulDiv(activeBefore, burned, supplyBefore, Math.Rounding.Ceil);
        if (dActive > ceilBound) b3Violated = true;
    }

    // ── ordinary flows ───────────────────────────────────────────────────────────
    function deposit(uint256 actorSeed, uint256 amtSeed) public {
        address a = _actor(actorSeed);
        uint256 amt = bound(amtSeed, 1e3, 1_000e6); // dust..1,000 USDC
        vm.prank(a);
        try vault.deposit(amt, a) {} catch {}
    }

    function redeemSome(uint256 actorSeed, uint256 sharesSeed) public {
        address a = _actor(actorSeed);
        uint256 sh = vault.shares(a);
        if (sh == 0) return;
        uint256 burn = bound(sharesSeed, 1, sh);
        uint256 activeBefore = vault.totalAssets();
        uint256 supplyBefore = vault.totalShares();
        vm.prank(a);
        try vault.redeem(burn) {
            redeemsExecuted++;
            _checkProportionality(activeBefore, supplyBefore, burn);
        } catch {}
    }

    /// Drive a holder's claim toward the wei regime: redeem all but a tiny residue of shares.
    function drainToWei(uint256 actorSeed) public {
        address a = _actor(actorSeed);
        uint256 sh = vault.shares(a);
        if (sh <= 5) return;
        uint256 burn = sh - bound(sh, 1, 5); // leave 1..5 shares → sub-double-digit claim
        uint256 activeBefore = vault.totalAssets();
        uint256 supplyBefore = vault.totalShares();
        vm.prank(a);
        try vault.redeem(burn) {
            redeemsExecuted++;
            _checkProportionality(activeBefore, supplyBefore, burn);
        } catch {}
    }

    /// THE Bunni dust burst: N sequential 1..3-share redeems by one holder, asserting the holder cannot
    /// extract more than the claim they held when the burst began (B1), and each step obeys B3.
    function microBurst(uint256 actorSeed, uint256 dustSeed) public {
        address a = _actor(actorSeed);
        uint256 startShares = vault.shares(a);
        if (startShares == 0) return;
        uint256 c0 = vault.convertToAssets(startShares); // the holder's whole claim at burst start
        uint256 sumOut;
        microBursts++;

        uint256 seed = dustSeed;
        for (uint256 k; k < 50; ++k) {
            uint256 sh = vault.shares(a);
            if (sh == 0) break;
            seed = uint256(keccak256(abi.encode(seed, k)));
            uint256 burn = 1 + (seed % 3); // 1..3 shares — the ±1-wei-quantum regime
            if (burn > sh) burn = sh;

            uint256 activeBefore = vault.totalAssets();
            uint256 supplyBefore = vault.totalShares();
            uint256 balBefore = usdc.balanceOf(a);
            vm.prank(a);
            try vault.redeem(burn) {
                redeemsExecuted++;
                dustRedeems++;
                sumOut += usdc.balanceOf(a) - balBefore;
                _checkProportionality(activeBefore, supplyBefore, burn);
            } catch {
                break;
            }
        }
        // B1: sequential dust redemption cannot mint value — never more than the starting claim.
        if (sumOut > c0) b1Violated = true;
    }

    /// Accrue yield by donating USDC into the adapter (raises NAV, as aToken rebasing would).
    function accrueYield(uint256 amtSeed) public {
        uint256 amt = bound(amtSeed, 1, 10_000e6);
        usdc.mint(address(adapter), amt); // adapter.totalAssets == underlying balance → NAV rises
        gYield += amt;
    }
}

/// @notice B1 + B3 invariants for `MintwareYieldVault` under Bunni-style dust bursts.
contract MicroWithdrawInvariantTest is StdInvariant, Test {
    MintwareYieldVault internal vault;
    MockERC20 internal usdc;
    MockYieldAdapter internal adapter;
    MicroWithdrawHandler internal handler;

    address internal owner = makeAddr("owner");
    address internal a = makeAddr("a");
    address internal b = makeAddr("b");
    address internal c = makeAddr("c");

    function setUp() public {
        usdc    = new MockERC20("USD Coin", "USDC", 6);
        adapter = new MockYieldAdapter(address(usdc));
        vault   = new MintwareYieldVault(address(usdc), address(adapter), owner);

        address[] memory actors = new address[](3);
        actors[0] = a; actors[1] = b; actors[2] = c;
        for (uint256 i; i < 3; ++i) {
            usdc.mint(actors[i], 1_000_000e6);
            vm.prank(actors[i]);
            usdc.approve(address(vault), type(uint256).max);
            // seed a starting position so dust bursts have shares from block 0 (non-vacuity).
            vm.prank(actors[i]);
            vault.deposit(1_000e6, actors[i]);
        }

        handler = new MicroWithdrawHandler(vault, usdc, adapter, actors);

        bytes4[] memory sels = new bytes4[](5);
        sels[0] = MicroWithdrawHandler.deposit.selector;
        sels[1] = MicroWithdrawHandler.redeemSome.selector;
        sels[2] = MicroWithdrawHandler.drainToWei.selector;
        sels[3] = MicroWithdrawHandler.microBurst.selector;
        sels[4] = MicroWithdrawHandler.accrueYield.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
    }

    /// B1: no dust burst ever extracts more than the holder's claim at the start of the burst.
    function invariant_B1_micro_withdraw_no_extraction() public view {
        assertFalse(handler.b1Violated(), "B1: a dust burst extracted more than the starting claim");
    }

    /// B3: every redeem obeys monotone proportionality (Δactive ≤ ceil(activeBefore·burned/supplyBefore)),
    /// including in the single/double-digit-wei regime — the direct Bunni analog.
    function invariant_B3_monotone_proportionality() public view {
        assertFalse(handler.b3Violated(), "B3: a redeem removed a disproportionate slice of the active leg");
    }

    /// Backstop: the vault stays solvent — total shares never exceed total assets (par backing intact).
    function invariant_B_solvent() public view {
        assertLe(vault.totalShares(), vault.totalAssets(), "vault insolvent: totalShares > totalAssets");
    }

    function afterInvariant() public view {
        assertGt(handler.redeemsExecuted(), 0, "vacuous: no redeem executed");
        assertGt(handler.dustRedeems(), 0, "vacuous: no dust-burst redeem executed");
        assertGt(handler.microBursts(), 0, "vacuous: no micro-burst executed");
    }
}
