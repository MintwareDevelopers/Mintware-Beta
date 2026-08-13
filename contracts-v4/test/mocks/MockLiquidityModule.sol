// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math}      from "@openzeppelin/contracts/utils/math/Math.sol";

import {ILiquidityModule} from "../../src/payments/ILiquidityModule.sol";
import {MockERC20}        from "./MockERC20.sol";

/// @dev Test-only `ILiquidityModule` modeling a CONSTANT-PRODUCT single-LP position — the instrument
///      the tranche-solvency fuzz uses to inflict REAL impermanent loss on the deployed senior par.
///
///      The vault is the pool's only LP. `resUsdc`/`resTeam` are the accounting reserves (k = resUsdc·
///      resTeam is preserved on a price move — an external arb rebalances the pool). `setPrice(P)`
///      re-solves the reserves for the target mark, so a price DROP moves the position OUT of USDC and
///      INTO the depreciating team token: `recoverableUSDC()` = resUsdc + resTeam·P then falls BELOW
///      the senior par that was deposited. That is genuine IL — and it is what forces the junior to
///      cover, making `deployedFromSenior <= recoverableUSDC()` a NON-trivial invariant. (At deploy,
///      recoverable = 2·senior-par; a 50% mark drop leaves ~1.41·par — covered; only a ~75%+ crash,
///      the junior-wiped tail, breaks it, and that is proven in a focused unit test.)
///
///      NO-CUSTODY / CONSERVATION: reserves are accounting; real USDC pulled on `deploy` is just held.
///      On `recover`/`collectFees` the module MINTS the USDC it pays out (a mock swap counterparty),
///      tracking `totalMintedUsdc` so the invariant suite's USDC ledger stays exact.
contract MockLiquidityModule is ILiquidityModule {
    using SafeERC20 for IERC20;

    MockERC20 public immutable usdc;      // 6dp
    MockERC20 public immutable teamToken; // 18dp
    address   public immutable vault;

    uint256 public resUsdc;         // USDC-side reserve (accounting, 6dp)
    uint256 public resTeam;         // team-side reserve (accounting, 18dp)
    uint256 public price;           // USDC(6dp) per 1e18 team  ==  resUsdc*1e18/resTeam
    uint256 public pendingFees;     // USDC queued to hand the vault on collectFees
    uint256 public totalMintedUsdc; // USDC this module minted (swap payouts + fees) — ledger source
    uint256 public minPriceSeen;    // lowest mark observed (non-vacuity witness for IL)

    uint256 private constant ONE = 1e18;

    error OnlyVault();
    modifier onlyVault() { if (msg.sender != vault) revert OnlyVault(); _; }

    constructor(address usdc_, address teamToken_, address vault_, uint256 price_) {
        usdc = MockERC20(usdc_);
        teamToken = MockERC20(teamToken_);
        vault = vault_;
        price = price_;
        minPriceSeen = price_;
    }

    // ── ILiquidityModule ──────────────────────────────────────────────────────────

    function deploy(uint256 usdcAmount, uint256 maxTeamToken) external onlyVault returns (uint256 teamTokenUsed) {
        // pull both legs from the vault (real transfers; reserves are accounting).
        IERC20(address(usdc)).safeTransferFrom(msg.sender, address(this), usdcAmount);

        // balanced team at the current mark (bootstrap to the mark if the pool is empty).
        uint256 balanced = resUsdc == 0
            ? (price == 0 ? 0 : (usdcAmount * ONE) / price)
            : (usdcAmount * resTeam) / resUsdc;
        teamTokenUsed = balanced < maxTeamToken ? balanced : maxTeamToken;
        if (teamTokenUsed > 0) {
            IERC20(address(teamToken)).safeTransferFrom(msg.sender, address(this), teamTokenUsed);
        }

        resUsdc += usdcAmount;
        resTeam += teamTokenUsed;
        _repriceMark();
    }

    function recover(uint256 usdcWanted) external onlyVault returns (uint256 usdcReturned, uint256 teamTokenReturned) {
        uint256 avail = recoverableUSDC();
        uint256 give = usdcWanted < avail ? usdcWanted : avail;

        if (avail > 0 && give > 0) {
            // remove liquidity for `give` of value: shrink both reserves by the value fraction.
            resUsdc -= (resUsdc * give) / avail;
            resTeam -= (resTeam * give) / avail;
            // pay the vault: from the USDC pulled on prior deploys first, mint only the shortfall
            // (a mock swap counterparty supplies the rest). Keeps the USDC ledger exact.
            uint256 bal = usdc.balanceOf(address(this));
            uint256 fromBal = bal < give ? bal : give;
            if (fromBal > 0) IERC20(address(usdc)).safeTransfer(vault, fromBal);
            if (give > fromBal) _mintUsdc(vault, give - fromBal);
        }
        usdcReturned = give;
        teamTokenReturned = 0; // junior upside attribution simplified — see NatSpec
    }

    /// @notice USDC the whole position marks to right now (team side valued at the current price). This
    ///         is the junior-backed USDC behind the senior par — the RHS of the solvency invariant.
    function recoverableUSDC() public view returns (uint256) {
        return resUsdc + (resTeam * price) / ONE;
    }

    function collectFees() external onlyVault returns (uint256 usdcFees) {
        usdcFees = pendingFees;
        pendingFees = 0;
        if (usdcFees > 0) _mintUsdc(vault, usdcFees);
    }

    // ── internals ─────────────────────────────────────────────────────────────────

    function _mintUsdc(address to, uint256 amount) internal {
        usdc.mint(to, amount);
        totalMintedUsdc += amount;
    }

    /// @dev Keep `price` consistent with the reserves after a liquidity change.
    function _repriceMark() internal {
        if (resTeam > 0) price = (resUsdc * ONE) / resTeam;
        if (price < minPriceSeen) minPriceSeen = price;
    }

    // ── test controls ─────────────────────────────────────────────────────────────

    /// @dev Move the mark to `newPrice` by rebalancing the reserves along constant product (external
    ///      arb). A DROP realizes IL: the position rotates out of USDC into the cheaper team token, so
    ///      `recoverableUSDC()` falls — the junior's coverage of the senior par is what is under test.
    function setPrice(uint256 newPrice) external {
        uint256 target = newPrice == 0 ? 1 : newPrice; // clamp: price 0 => reserves blow up (div by 0)
        if (resUsdc > 0 && resTeam > 0) {
            uint256 k = resUsdc * resTeam;              // preserved across the arb swap
            uint256 newTeam = Math.sqrt(Math.mulDiv(k, ONE, target));
            if (newTeam == 0) newTeam = 1;
            resTeam = newTeam;
            resUsdc = k / newTeam;                      // resUsdc/resTeam ~= target/ONE
            _repriceMark();
        } else {
            price = target;
            if (price < minPriceSeen) minPriceSeen = price;
        }
    }

    /// @dev Queue swap fees to be collected as senior/junior yield.
    function addFees(uint256 amount) external { pendingFees += amount; }
}
