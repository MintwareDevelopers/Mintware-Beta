// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Minimal view of MintwareWeightedDistributor used for oracle-weighted LP-fee routing.
interface IMWWeightedDistributorFees {
    function fundFees(bytes32 vaultId, uint256 amount0, uint256 amount1) external;
}

/// @title  MWFeeLib
/// @notice STATELESS, delegatecall-linked library holding the realized-swap-fee + am-AMM-rent
///         distribution CORE of MintwareDeFiPairVault (`_realizeFees` / `_splitFee` / `fundRent`),
///         extracted verbatim to keep the vault under the EIP-170 24,576-byte runtime limit — the
///         same stateless-library pattern as MWJitLib / MWIdleLib. Delegatecalled from the vault,
///         so `address(this)`, `c.pm.unlock(...)` (which re-enters the vault's `unlockCallback` as
///         the vault), and every `token.safeTransfer`/`forceApprove` resolve AS the vault.
///
/// @dev    Owns NO storage. The fee-routing-mutable counters travel in `FeeState` (in → out); the
///         vault's `_loadFee`/`_storeFee` mirror the COMPLETE set (accFee0PerShare, accFee1PerShare,
///         feeReserve0, feeReserve1, rentDust0, rentDust1) in and back out. A missed field on either
///         side is silent state corruption. Vault immutables + routing config travel in `Ctx`.
///         Behavior is byte-for-byte identical to the pre-extraction inline code: same three-way
///         split + round-DOWN (LP-favoring remainder), same buyback-sink fold, same H3 per-call
///         approve→fundFees→reset-to-0, same M6 try/catch fall-back to the pro-rata accumulator +
///         segregated reserve, same carried rent-dust remainder, same `FeesCollected` /
///         `FeesRoutedToDistributor` / `RentFunded` events (emitted here under delegatecall ⇒ logged
///         with the vault's address + identical topic0/data).
///
///         The `_realizeFees` short-circuit guard (`!poolInitialized || totalLiquidity == 0 ||
///         positionLiquidity == 0`) and the whole `fundRent` intake (guards + balance-diff transfer)
///         stay in the vault wrappers; this library begins after the collect / after the intake.
library MWFeeLib {
    using SafeERC20 for IERC20;

    /// @dev MUST equal the vault's constants (BPS=10000, ACC_PRECISION=1e18). `treasuryFeeBps` /
    ///      `buybackFeeBps` are configurable and travel in `Ctx`.
    uint256 private constant BPS           = 10_000;
    uint256 private constant ACC_PRECISION = 1e18;

    /// @dev Same action set + order as MintwareDeFiPairVault.Action, so the abi-encoded action word the
    ///      vault's `unlockCallback` decodes matches by index (Deploy=0, Remove=1, Rebalance=2,
    ///      Collect=3, SweepClaims=4).
    enum Action { Deploy, Remove, Rebalance, Collect, SweepClaims }

    /// @dev Emitted on every realize. Signature MUST match the vault's declaration exactly so topic0 is
    ///      identical and indexers/tests keyed on the vault address keep matching.
    event FeesCollected(
        uint256 fee0, uint256 fee1,
        uint256 treasury0, uint256 treasury1,
        uint256 buyback0, uint256 buyback1
    );
    event FeesRoutedToDistributor(bytes32 indexed vaultId, uint256 lp0, uint256 lp1);
    event RentFunded(address indexed token, uint256 amount);

    /// @dev Vault immutables + routing config the library needs but cannot read under delegatecall.
    struct Ctx {
        IPoolManager pm;
        IERC20       t0;
        IERC20       t1;
        address      treasury;
        address      weightedDistributor;
        bytes32      distributorVaultId;
        address      buybackSink;
        uint16       treasuryFeeBps;
        uint16       buybackFeeBps;
        uint128      totalLiquidity;
    }

    /// @dev The COMPLETE set of fee-routing-mutable vault storage. Loaded before the call, written back
    ///      after. `realizeFees` touches only the accumulators + reserve; `fundRent` additionally the
    ///      rent-dust remainders. Carrying all six in both wrappers is a safe superset (unchanged fields
    ///      pass through untouched).
    struct FeeState {
        uint256 accFee0PerShare;
        uint256 accFee1PerShare;
        uint256 feeReserve0;
        uint256 feeReserve1;
        uint256 rentDust0;
        uint256 rentDust1;
    }

    /// @notice Realize accrued swap fees on the live V4 position (via the vault's `Collect` unlock) and
    ///         split them via the configurable three-way value-capture template (LP / treasury /
    ///         buyback+burn). Mirrors the old `_realizeFees` body EXACTLY, minus the short-circuit guard
    ///         kept in the vault wrapper. Returns the updated state + the raw collected fee amounts.
    function realizeFees(Ctx memory c, FeeState memory s)
        external
        returns (FeeState memory, uint256 fee0, uint256 fee1)
    {
        bytes memory res = c.pm.unlock(abi.encode(Action.Collect, bytes("")));
        (fee0, fee1) = abi.decode(res, (uint256, uint256));
        if (fee0 == 0 && fee1 == 0) return (s, 0, 0);

        (uint256 treasury0, uint256 buyback0, uint256 lp0) = _splitFee(c, fee0);
        (uint256 treasury1, uint256 buyback1, uint256 lp1) = _splitFee(c, fee1);

        // Route the two NON-LP legs. If no buyback sink is wired, fold the buyback cut into the
        // treasury transfer — never strand it, never transfer to address(0).
        address sink = c.buybackSink;
        if (sink == address(0)) {
            uint256 t0 = treasury0 + buyback0;
            uint256 t1 = treasury1 + buyback1;
            if (t0 > 0) c.t0.safeTransfer(c.treasury, t0);
            if (t1 > 0) c.t1.safeTransfer(c.treasury, t1);
        } else {
            if (treasury0 > 0) c.t0.safeTransfer(c.treasury, treasury0);
            if (treasury1 > 0) c.t1.safeTransfer(c.treasury, treasury1);
            if (buyback0 > 0)  c.t0.safeTransfer(sink, buyback0);
            if (buyback1 > 0)  c.t1.safeTransfer(sink, buyback1);
        }

        // LP leg → the EXISTING routing, unchanged.
        if (c.weightedDistributor != address(0)) {
            // Canonical path: route LP fees to the oracle-weighted distributor.
            if (lp0 > 0 || lp1 > 0) {
                // AUDIT H3: grant EXACTLY the fee legs for this one pull, then reset to 0 — never leave the
                // distributor a standing unbounded allowance over the vault's entire (principal-bearing) balance.
                if (lp0 > 0) c.t0.forceApprove(c.weightedDistributor, lp0);
                if (lp1 > 0) c.t1.forceApprove(c.weightedDistributor, lp1);
                // AUDIT M6: `_realizeFees` runs on the REDEMPTION path — the distributor's liveness must not
                // gate exits. If `fundFees` reverts, reset the approval and fall back to the pro-rata
                // accumulator so the fees stay in the vault backing claims and the redemption proceeds.
                try IMWWeightedDistributorFees(c.weightedDistributor).fundFees(c.distributorVaultId, lp0, lp1) {
                    if (lp0 > 0) c.t0.forceApprove(c.weightedDistributor, 0);
                    if (lp1 > 0) c.t1.forceApprove(c.weightedDistributor, 0);
                    emit FeesRoutedToDistributor(c.distributorVaultId, lp0, lp1);
                } catch {
                    if (lp0 > 0) c.t0.forceApprove(c.weightedDistributor, 0);
                    if (lp1 > 0) c.t1.forceApprove(c.weightedDistributor, 0);
                    s.accFee0PerShare += (lp0 * ACC_PRECISION) / c.totalLiquidity;
                    s.accFee1PerShare += (lp1 * ACC_PRECISION) / c.totalLiquidity;
                    s.feeReserve0 += lp0;
                    s.feeReserve1 += lp1;
                }
            }
        } else {
            // Legacy path: pro-rata per-share accrual (pre-wiring / un-migrated vaults).
            s.accFee0PerShare += (lp0 * ACC_PRECISION) / c.totalLiquidity;
            s.accFee1PerShare += (lp1 * ACC_PRECISION) / c.totalLiquidity;
            s.feeReserve0 += lp0; // these tokens stay in the vault to back claims — segregate them
            s.feeReserve1 += lp1;
        }
        emit FeesCollected(fee0, fee1, treasury0, treasury1, buyback0, buyback1);
        return (s, fee0, fee1);
    }

    /// @dev Split a realized fee into (treasuryCut, buybackCut, lpAmt) under the configurable three-way
    ///      template. BOTH protocol cuts round DOWN; the LP takes the EXACT remainder, so
    ///      (treasuryCut + buybackCut + lpAmt == fee) always holds and any rounding loss accrues to LPs.
    function _splitFee(Ctx memory c, uint256 fee)
        private
        pure
        returns (uint256 treasuryCut, uint256 buybackCut, uint256 lpAmt)
    {
        treasuryCut = (fee * c.treasuryFeeBps) / BPS;
        buybackCut  = (fee * c.buybackFeeBps) / BPS;
        lpAmt       = fee - treasuryCut - buybackCut; // remainder → LP (favors LPs)
    }

    /// @notice Route already-received am-AMM rent (`received` of one pool token) to LPs EXACTLY like
    ///         realized swap fees — via the weighted distributor if wired, else the pro-rata per-share
    ///         accumulator with a carried sub-threshold remainder. Mirrors the old `fundRent` body from
    ///         after the balance-diff intake onward; the guards + `safeTransferFrom` intake stay in the
    ///         vault wrapper. `isToken0` selects the side (`received` is the balance-diff amount).
    function fundRent(Ctx memory c, FeeState memory s, bool isToken0, uint256 received)
        external
        returns (FeeState memory)
    {
        IERC20 token = isToken0 ? c.t0 : c.t1;

        bool routed = false;
        if (c.weightedDistributor != address(0)) {
            (uint256 r0, uint256 r1) = isToken0 ? (received, uint256(0)) : (uint256(0), received);
            // AUDIT R2-H3: per-call approve → fundFees → reset-to-0. Rent arrives in exactly ONE token, so
            // grant that one leg, then reset (both paths). Plus M6-style try/catch: a paused/buggy
            // distributor must not brick rent intake — fall back to the pro-rata accumulator.
            token.forceApprove(c.weightedDistributor, received);
            try IMWWeightedDistributorFees(c.weightedDistributor).fundFees(c.distributorVaultId, r0, r1) {
                routed = true;
            } catch {}
            token.forceApprove(c.weightedDistributor, 0);
        }
        if (!routed) {
            if (c.totalLiquidity == 0) {
                // No LPs to credit — forward to treasury rather than strand it or divide by zero.
                token.safeTransfer(c.treasury, received);
            } else if (isToken0) {
                uint256 pool0 = s.rentDust0 + received;
                uint256 add0  = (pool0 * ACC_PRECISION) / c.totalLiquidity;
                s.accFee0PerShare += add0;
                s.rentDust0 = pool0 - (add0 * c.totalLiquidity) / ACC_PRECISION;
                s.feeReserve0 += received; // rent tokens stay in the vault to back claims — segregate
            } else {
                uint256 pool1 = s.rentDust1 + received;
                uint256 add1  = (pool1 * ACC_PRECISION) / c.totalLiquidity;
                s.accFee1PerShare += add1;
                s.rentDust1 = pool1 - (add1 * c.totalLiquidity) / ACC_PRECISION;
                s.feeReserve1 += received;
            }
        }
        emit RentFunded(address(token), received);
        return s;
    }
}
