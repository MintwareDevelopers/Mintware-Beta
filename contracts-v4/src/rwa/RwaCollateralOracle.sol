// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {MintwareOracleHook}    from "./MintwareOracleHook.sol";

/// @title  RwaCollateralOracle
/// @notice Permissionless, **composable** read oracle over any Mintware oracle-banded RWA pool. It
///         packages the on-chain price-band health that a *consumer* protocol — a lending market, an
///         insurance vault, a structured product — needs to parameterize itself against vRWA
///         collateral, WITHOUT that protocol having to understand Mintware's hook internals.
///
///         This is the "Chainlink move," not the "DeBank move": a consumer integrates against ONE
///         stable oracle address and reads standardized RWA risk for any Mintware pool, on-chain,
///         inside its own transaction (e.g. to set an LTV before minting a loan). No execution, no
///         custody, no gating — pure read-only software over public on-chain state.
///
/// @dev    v1 exposes **oracle-band health only** — price vs keeper appraisal, and whether the pool
///         sits in the ±core band (healthiest), the ±spec band (still tradeable), or out of band.
///         This is real, on-chain data TODAY (MintwareOracleHook). Issuer-level risk (repayment
///         history, appraisal freshness, default rate) is a FUTURE input — see
///         docs/developers/data-layer-build-plan.md §5 — and is deliberately NOT faked here. The LTV
///         helper is ILLUSTRATIVE: a real consumer sets its own risk curve; this just shows the shape.
contract RwaCollateralOracle {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    uint256 public constant BPS = 10_000;

    IPoolManager public immutable poolManager;

    struct RwaRisk {
        bool    configured;    // is this an oracle-banded RWA pool at all?
        uint256 appraisalX96;  // keeper-posted appraisal price (Q96)
        uint256 priceX96;      // current pool price (Q96)
        uint256 deviationBps;  // |price − appraisal| / appraisal, in bps
        bool    inCoreBand;    // within ±core band (healthiest)
        bool    tradeable;     // within ±spec band (a swap here would not revert)
    }

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    /// @notice Standardized on-chain RWA risk for any Mintware oracle-banded pool. Reads the pool's
    ///         own MintwareOracleHook (via `key.hooks`) + the current pool price. Returns zeroed/
    ///         `configured=false` for a pool with no band config.
    function riskOf(PoolKey calldata key) public view returns (RwaRisk memory r) {
        MintwareOracleHook hook = MintwareOracleHook(address(key.hooks));
        (uint256 appraisalX96, uint16 coreBps, uint16 specBps, bool configured) = hook.bands(key.toId());

        r.configured   = configured;
        r.appraisalX96 = appraisalX96;
        if (!configured || appraisalX96 == 0) return r;

        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        uint256 price = hook.priceX96FromSqrt(sqrtP);
        uint256 diff  = price > appraisalX96 ? price - appraisalX96 : appraisalX96 - price;

        r.priceX96     = price;
        r.deviationBps = (diff * BPS) / appraisalX96;
        r.inCoreBand   = r.deviationBps <= coreBps;
        r.tradeable    = r.deviationBps <= specBps;
    }

    /// @notice ILLUSTRATIVE max-LTV signal for vRWA collateral, from band health alone. A consumer
    ///         protocol sets its OWN curve — this reference shows integrators the shape:
    ///         in-core → 70% · in-spec (off-core, still tradeable) → 40% · out-of-band → 0%
    ///         (never lend against collateral you couldn't liquidate — an out-of-band swap reverts).
    function suggestedMaxLtvBps(PoolKey calldata key) external view returns (uint16) {
        RwaRisk memory r = riskOf(key);
        if (!r.configured || !r.tradeable) return 0;
        return r.inCoreBand ? uint16(7000) : uint16(4000);
    }
}
