// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoolKey}   from "@uniswap/v4-core/src/types/PoolKey.sol";

import {ISeedTarget} from "./MintwareSeedPool.sol";

/// @notice Minimal vault surface the adapter drives.
interface ISeedVault {
    function seedTeamTokens(bytes32 vaultId, address projectToken, uint256 amount, PoolKey calldata key, uint160 sqrtPriceX96) external;
    function rebalance(int24 newTickLower, int24 newTickUpper) external;
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function asset() external view returns (address);
}

/// @title  MintwareSeedAdapter
/// @notice Bridges a `MintwareSeedPool` fair-launch raise into a live
///         `MintwareDeFiVault4626`. Deployed one-per-vault and set as the vault's
///         owner so it can seed the team token. Designed for the seed pool's
///         `fullReserveOnFinalize` mode: the whole project-token reserve is seeded
///         once (initializing the V4 pool), then each tranche of raised quote is
///         deposited into the vault as single-sided liquidity — minting ERC-4626
///         shares to the adapter, which represents the seeded LP position.
///
/// @dev    Only the configured seed pool may drive it. `poolInit` from the pool
///         must equal the configured `vaultId`. LP shares accrue to the adapter;
///         per-contributor distribution is a layer above (out of scope here).
contract MintwareSeedAdapter is ISeedTarget {
    using SafeERC20 for IERC20;

    ISeedVault public immutable vault;
    address    public immutable seedPool;
    bytes32    public immutable vaultId;
    int24      public immutable tickLower; // LP range set right after seeding
    int24      public immutable tickUpper;
    PoolKey    public poolKey;

    uint256 public totalShares; // vault shares held by the adapter (the seeded LP)
    bool    public seeded;

    event Seeded(bytes32 indexed vaultId, uint256 tokenReserve, uint256 quote, uint256 shares);
    event Grown(bytes32 indexed vaultId, uint256 quote, uint256 shares);

    error OnlySeedPool();
    error WrongVault();
    error AlreadySeeded();
    error NotSeeded();

    constructor(address _vault, address _seedPool, bytes32 _vaultId, PoolKey memory _key, int24 _tickLower, int24 _tickUpper) {
        vault     = ISeedVault(_vault);
        seedPool  = _seedPool;
        vaultId   = _vaultId;
        poolKey   = _key;
        tickLower = _tickLower;
        tickUpper = _tickUpper;
    }

    modifier onlySeedPool() {
        if (msg.sender != seedPool) revert OnlySeedPool();
        _;
    }

    /// @inheritdoc ISeedTarget
    function receiveSeed(
        bytes32 poolInit,
        address projectToken,
        uint256 tokenAmount,
        address /*quoteToken*/,
        uint256 quoteAmount,
        uint160 sqrtPriceX96
    ) external onlySeedPool {
        if (poolInit != vaultId) revert WrongVault();
        if (seeded) revert AlreadySeeded();
        seeded = true;

        // Seed the whole project-token reserve → initializes the V4 pool.
        IERC20(projectToken).forceApprove(address(vault), tokenAmount);
        vault.seedTeamTokens(vaultId, projectToken, tokenAmount, poolKey, sqrtPriceX96);

        // Set the LP range (full-range gives ~0 liquidity for 6-dp tokens).
        vault.rebalance(tickLower, tickUpper);

        // Deposit the raised quote → single-sided liquidity, shares to the adapter.
        uint256 shares = _depositQuote(quoteAmount);
        emit Seeded(vaultId, tokenAmount, quoteAmount, shares);
    }

    /// @inheritdoc ISeedTarget
    function receiveGrowth(bytes32 poolInit, uint256 /*tokenAmount*/, uint256 quoteAmount) external onlySeedPool {
        if (poolInit != vaultId) revert WrongVault();
        if (!seeded) revert NotSeeded();
        uint256 shares = _depositQuote(quoteAmount);
        emit Grown(vaultId, quoteAmount, shares);
    }

    function _depositQuote(uint256 quoteAmount) internal returns (uint256 shares) {
        if (quoteAmount == 0) return 0;
        address quote = vault.asset();
        IERC20(quote).forceApprove(address(vault), quoteAmount);
        shares = vault.deposit(quoteAmount, address(this));
        totalShares += shares;
    }
}
