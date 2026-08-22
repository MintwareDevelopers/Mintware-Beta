// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareStagedLiquidityRouter, IPairVaultLike} from "../../src/vaults/MintwareStagedLiquidityRouter.sol";
import {LockTier}         from "../../src/vaults/VaultTypes.sol";
import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";

/// @dev Pair-vault seam (unused by these invariants — no pairing in the handler — but required by
///      the router's constructor-time token reads during `stage`).
contract MockPairVault is IPairVaultLike {
    IERC20 public t0;
    IERC20 public t1;
    constructor(IERC20 a, IERC20 b) { t0 = a; t1 = b; }
    function token0() external view returns (IERC20) { return t0; }
    function token1() external view returns (IERC20) { return t1; }
    function depositFor(address, uint256 a0, uint256 a1, uint256, LockTier)
        external pure returns (uint256) { return a0 + a1; }
}

/// @dev Bounded actor over the staged router's per-adapter 4626 yield pool: stage / unstage / accrue.
///      All stages use ONE dedicated adapter (the router's documented invariant that an adapter is
///      dedicated + denominated in the staged token), so `poolShares[adapter]` is the whole pool.
contract StagedHandler is Test {
    MintwareStagedLiquidityRouter public router;
    MockERC20 public token;
    MockYieldAdapter public adapter;
    IPairVaultLike public vault;

    uint256[] public activeIds;
    uint256 public accrued;   // total yield donated (for reference)
    uint256 public maxStageId; // monotonic witness

    constructor(
        MintwareStagedLiquidityRouter _router,
        MockERC20 _token,
        MockYieldAdapter _adapter,
        IPairVaultLike _vault
    ) {
        router  = _router;
        token   = _token;
        adapter = _adapter;
        vault   = _vault;
        token.mint(address(this), 1e30);
    }

    function activeCount() external view returns (uint256) { return activeIds.length; }

    function stage(uint256 amount) external {
        amount = bound(amount, 1, 1e24);
        token.approve(address(router), amount);
        uint256 id = router.stage(vault, true /* token0 */, amount, adapter);
        activeIds.push(id);
        if (id + 1 > maxStageId) maxStageId = id + 1;
    }

    function unstage(uint256 seed) external {
        uint256 n = activeIds.length;
        if (n == 0) return;
        uint256 idx = bound(seed, 0, n - 1);
        uint256 id = activeIds[idx];
        router.unstage(id);
        activeIds[idx] = activeIds[n - 1];
        activeIds.pop();
    }

    /// Donate yield straight into the adapter (raises assets-per-share, not shares).
    function accrue(uint256 amount) external {
        amount = bound(amount, 0, 1e24);
        if (amount == 0) return;
        token.mint(address(adapter), amount);
        accrued += amount;
    }

    /// Sum of the shares field across every still-active stage.
    function sumActiveShares() external view returns (uint256 s) {
        for (uint256 i; i < activeIds.length; ++i) {
            (,,,,,, uint256 sh) = router.stages(activeIds[i]);
            s += sh;
        }
    }

    /// Sum of redeemable assets across every still-active stage.
    function sumStagedAssets() external view returns (uint256 s) {
        for (uint256 i; i < activeIds.length; ++i) {
            s += router.stagedAssets(activeIds[i]);
        }
    }
}

/// @title  Audit Layer-3 invariants — staged-router per-adapter yield pool
/// @notice The existing invariant suites cover the distributor (claims ≤ funding, conservation),
///         the matched vault, and the treasury/pair vaults. The staged router's internal 4626
///         share pool had NO invariant suite. These add three firm-level guarantees:
///           (1) SOLVENCY   — Σ redeemable stagedAssets ≤ adapter.totalAssets (redemption never
///                            rounds in the user's favor; the virtual offset stays conservative).
///           (2) CONSERVATION — Σ active-stage shares == poolShares[adapter] (no phantom shares).
///           (3) MONOTONIC  — nextStageId never decreases (stable, non-reused ids).
contract SuiteInvariants is Test {
    MintwareStagedLiquidityRouter internal router;
    MockERC20 internal token;
    MockYieldAdapter internal adapter;
    MockPairVault internal vault;
    StagedHandler internal handler;

    uint256 internal lastNextId;

    function setUp() public {
        token   = new MockERC20("USDC", "USDC", 18);
        MockERC20 quote = new MockERC20("Q", "Q", 18);
        adapter = new MockYieldAdapter(address(token));
        vault   = new MockPairVault(IERC20(address(token)), IERC20(address(quote)));
        router  = new MintwareStagedLiquidityRouter();

        handler = new StagedHandler(router, token, adapter, IPairVaultLike(address(vault)));

        bytes4[] memory sel = new bytes4[](3);
        sel[0] = StagedHandler.stage.selector;
        sel[1] = StagedHandler.unstage.selector;
        sel[2] = StagedHandler.accrue.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
        targetContract(address(handler));
    }

    /// SOLVENCY: the pool can always cover every stage's redeemable value.
    function invariant_solvency_assetsCoverStakes() public view {
        assertLe(handler.sumStagedAssets(), adapter.totalAssets(), "staged assets exceed adapter assets");
    }

    /// CONSERVATION: no share is created or destroyed outside stage/unstage accounting.
    function invariant_shareConservation() public view {
        assertEq(
            handler.sumActiveShares(),
            router.poolShares(address(adapter)),
            "sum(active stage shares) != poolShares[adapter]"
        );
    }

    /// MONOTONIC: the stage-id counter only ever advances (ids are never reused).
    function invariant_nextStageIdMonotonic() public {
        uint256 cur = router.nextStageId();
        assertGe(cur, lastNextId, "nextStageId decreased");
        lastNextId = cur;
    }

    /// Non-vacuity: over a run the fuzzer must actually have opened stages.
    function afterInvariant() public view {
        assertGe(handler.maxStageId(), 1, "handler never staged - vacuous run");
    }
}
