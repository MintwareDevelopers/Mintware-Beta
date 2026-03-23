// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";

/// @notice FeeVault test suite
contract FeeVaultTest is Test {

    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal owner   = makeAddr("owner");

    // ─────────────────────────────────────────────────────────────────────────
    // Epoch lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    function test_epoch_opens_on_deploy() public {
        // TODO: assert currentEpoch == 1 after deploy
    }

    function test_close_epoch_opens_next() public {
        // TODO: owner closes epoch 1, assert currentEpoch == 2
    }

    function test_protocol_share_sent_to_treasury() public {
        // TODO: 1000 USDC accumulated, close epoch
        // assert: treasury receives 100 USDC (10%)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Soft expiry sweep
    // ─────────────────────────────────────────────────────────────────────────

    function test_sweep_before_deadline_reverts() public {
        // TODO: close epoch 1, immediately call sweep(1)
        // assert: reverts EpochNotExpired
    }

    function test_sweep_after_90_days() public {
        // TODO: close epoch 1, warp 91 days, sweep(1)
        // assert: unclaimed added to current epoch bonusPool
        // assert: epoch.swept == true
    }

    function test_sweep_twice_reverts() public {
        // TODO: sweep(1) twice
        // assert: second call reverts AlreadySwept
    }

    function test_swept_funds_go_to_active_lps() public {
        // TODO: sweep adds to next epoch bonus pool
        // assert: epochs[2].bonusPool == unclaimed amount from epoch 1
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fee ingestion
    // ─────────────────────────────────────────────────────────────────────────

    function test_only_hook_or_vault_can_send_fees() public {
        // TODO: random address calls receiveFees
        // assert: reverts
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Share configuration
    // ─────────────────────────────────────────────────────────────────────────

    function test_invalid_shares_revert() public {
        // TODO: setShares(6000, 1500, 1000, 500) — sums to 9000, not 10000
        // assert: reverts InvalidShares
    }
}
