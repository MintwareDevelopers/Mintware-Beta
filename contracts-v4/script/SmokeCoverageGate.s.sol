// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";

/// @title  SmokeCoverageGate — testnet smoke for the YPN coverage-ratio floor gate (pre-audit #7b)
/// @notice The one money-path step no existing script/route covers (see docs/developers/testnet-smoke-runbook.md
///         step 5). Exercises the DEPLOYED converged `MintwareTreasuryVault` coverage gate against live testnet
///         state and asserts the on-chain behavior, mirroring the `test_coverage_gate_*` Forge tests.
///
/// @dev    Run as a FORK SIMULATION (no `--broadcast`): it forks the live chain, pranks the vault owner, and
///         proves the gate via require() — zero real transactions, zero gas, fully repeatable.
///
///           TREASURY_VAULT=0x… forge script contracts-v4/script/SmokeCoverageGate.s.sol --rpc-url base_sepolia
///
///         Preconditions: the vault must be activated (commitTeam done) AND have deployedFromSenior > 0
///         (run the deposit + commit + deployToLP steps of the runbook first). If nothing is deployed yet, the
///         script logs a clear message and exits without asserting (coverage is +inf, so the floor is untestable).
interface ITreasuryVaultSmoke {
    function owner() external view returns (address);
    function juniorTokens() external view returns (uint256);
    function juniorUsdcBuffer() external view returns (uint256);
    function deployedFromSenior() external view returns (uint256);
    function minCoverageBps() external view returns (uint256);
    function coverageBps() external view returns (uint256);
    function setMinCoverage(uint16 bps) external;
    function deployToLP(uint256 usdcAmount, uint256 maxTeamToken) external;
    error CoverageTooLow();
}

contract SmokeCoverageGate is Script {
    uint256 internal constant BPS = 10_000;

    function run() external {
        address vaultAddr = vm.envAddress("TREASURY_VAULT");
        ITreasuryVaultSmoke vault = ITreasuryVaultSmoke(vaultAddr);

        address owner = vault.owner();
        uint256 buf = vault.juniorUsdcBuffer();
        uint256 deployed = vault.deployedFromSenior();
        uint256 covNow = vault.coverageBps();
        console2.log("vault           ", vaultAddr);
        console2.log("owner           ", owner);
        console2.log("juniorUsdcBuffer", buf);
        console2.log("deployedFromSenior", deployed);
        console2.log("coverageBps (now)", covNow);

        // The gate is only meaningful once there is at-risk senior to cover. If nothing is deployed,
        // coverageBps() == type(uint256).max — run the deposit+commit+deployToLP runbook steps first.
        if (deployed == 0) {
            console2.log("SKIP: deployedFromSenior == 0 (coverage is +inf). Run deployToLP first, then re-run.");
            return;
        }
        require(covNow <= type(uint16).max, "coverageBps too high to express a uint16 floor at this state");

        // Pick a floor JUST ABOVE the current coverage: a further deploy must breach it.
        uint16 floorAbove = uint16(covNow + 1);
        // A tiny deploy amount that, if allowed, would grow deployedFromSenior and drop coverage below `floorAbove`.
        uint256 tinyDeploy = deployed / 100 + 1; // ~1% more at-risk senior
        uint256 jt = vault.juniorTokens();

        vm.startPrank(owner);

        // 1. Gate OFF is the default — sanity.
        require(vault.minCoverageBps() == 0, "expected gate off by default");

        // 2. Set the floor above current coverage; a further deployToLP MUST revert CoverageTooLow.
        vault.setMinCoverage(floorAbove);
        bool reverted;
        try vault.deployToLP(tinyDeploy, jt) {
            reverted = false;
        } catch (bytes memory reason) {
            reverted = _isCoverageTooLow(reason);
        }
        require(reverted, "GATE FAIL: deployToLP did NOT revert CoverageTooLow above the floor");
        console2.log("OK: deployToLP reverts CoverageTooLow above the floor (bps)", floorAbove);

        // 3. Lower the floor to the current coverage; the SAME deploy now proceeds.
        vault.setMinCoverage(uint16(covNow));
        try vault.deployToLP(tinyDeploy, jt) {
            // proceeded — good; coverage must still hold at/above the floor
            uint256 covAfter = vault.coverageBps();
            require(covAfter >= covNow, "coverage dropped below the active floor after a covered deploy");
            console2.log("OK: covered deploy proceeds; coverageBps after", covAfter);
        } catch {
            revert("GATE FAIL: a covered deployToLP unexpectedly reverted");
        }

        // 4. Reset the gate to its default (off).
        vault.setMinCoverage(0);
        vm.stopPrank();

        console2.log("PASS: coverage-ratio gate behaves as specified on the deployed vault.");
    }

    function _isCoverageTooLow(bytes memory reason) internal pure returns (bool) {
        if (reason.length < 4) return false;
        bytes4 sel;
        assembly {
            sel := mload(add(reason, 0x20))
        }
        return sel == ITreasuryVaultSmoke.CoverageTooLow.selector;
    }
}
