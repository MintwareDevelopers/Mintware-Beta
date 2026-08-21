// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test}         from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20}       from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareERC4626YieldAdapter} from "../../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MockERC20}                    from "../../mocks/MockERC20.sol";
import {MockFeeERC4626}               from "../../mocks/MockFeeERC4626.sol";
import {MockRoundingAdverseERC4626}   from "../../mocks/MockRoundingAdverseERC4626.sol";

/// @dev Minimal shape shared by both adverse sources so one handler can drive either.
interface ISimSource {
    function simulateYield(uint256 amount) external;
}

/// @notice GROUP A — adapter conservation fuzz handler (the primary Bunni gap). Drives the REAL
///         `MintwareERC4626YieldAdapter` — the seam whose `totalAssets()` trusts an external 4626's
///         `previewRedeem` — against an adversarial 4626 source. The handler IS the adapter's authorized
///         `vault` (adapters are `onlyVault`). Every action is `bound()`ed and try/caught; a `withdraw`
///         revert is RECORDED (not swallowed) because A3 asserts the best-effort withdraw never reverts.
///
///         Ghosts: `gIn` (Σ underlying supplied), `gOut` (Σ underlying returned to the vault), `gYield`
///         (Σ donated into the source). A1 asserts `gOut ≤ gIn + gYield` — no value minted from the
///         deposit→withdraw seam. `nDeposits`/`nWithdraws` witness non-vacuity.
contract ERC4626AdapterHandler is Test {
    MintwareERC4626YieldAdapter public adapter;
    MockERC20 public underlying;
    address   public source;
    bool      public sourceCanStall; // adverse source exposes setRevertRedeem; the fee source does not

    // Ghosts.
    uint256 public gIn;
    uint256 public gOut;
    uint256 public gYield;
    uint256 public nDeposits;
    uint256 public nWithdraws;
    bool    public withdrawReverted; // A3: a best-effort withdraw reverted (must stay false)

    constructor(MintwareERC4626YieldAdapter _adapter, MockERC20 _underlying, address _source, bool _canStall) {
        adapter        = _adapter;
        underlying     = _underlying;
        source         = _source;
        sourceCanStall = _canStall;
        underlying.approve(address(_adapter), type(uint256).max);
    }

    // ── supply idle capital into the source (vault → adapter → 4626) ─────────────────
    function supply(uint256 amtSeed) public {
        uint256 amt = bound(amtSeed, 1, 1_000_000e6);
        underlying.mint(address(this), amt);
        try adapter.deposit(amt) {
            gIn += amt;
            nDeposits++;
        } catch {
            // A full/paused source can make the 4626 deposit revert — not a conservation event.
        }
    }

    // ── best-effort withdraw back to the vault ──────────────────────────────────────
    function withdrawSome(uint256 amtSeed) public {
        uint256 amt = bound(amtSeed, 0, 2_000_000e6);
        try adapter.withdraw(amt) returns (uint256 got) {
            gOut += got;
            nWithdraws++;
        } catch {
            withdrawReverted = true; // A3 violation — the hot-path withdraw must NEVER revert
        }
    }

    // ── donate yield into the source (raises assets-per-share) ──────────────────────
    function accrueYield(uint256 amtSeed) public {
        uint256 amt = bound(amtSeed, 1, 100_000e6);
        underlying.mint(address(this), amt);
        underlying.approve(source, amt);
        try ISimSource(source).simulateYield(amt) { gYield += amt; } catch {}
    }

    // ── toggle the source stalled/healthy (adverse source only) ─────────────────────
    function stall(uint256 seed) public {
        if (!sourceCanStall) return;
        MockRoundingAdverseERC4626(source).setRevertRedeem(seed % 3 == 0);
    }

    // Underlying the source actually holds attributable to the adapter, via the source's own honest
    // floor accounting — used by the invariant as the "actually realizable now" bound.
    function sourceShares() external view returns (uint256) {
        return IERC20(source).balanceOf(address(adapter));
    }
}

/// @dev Base wiring shared by the fee-source and adverse-source concrete suites.
abstract contract ERC4626AdapterInvariantBase is StdInvariant, Test {
    MintwareERC4626YieldAdapter internal adapter;
    ERC4626AdapterHandler       internal handler;
    MockERC20                   internal usdc;

    address internal owner = makeAddr("owner");

    function _wire(address source, bool canStall) internal {
        // Deploy the adapter with no vault yet (chicken-and-egg), create the handler, then set the
        // handler as the adapter's one-time authorized vault.
        adapter = new MintwareERC4626YieldAdapter(address(usdc), source, address(0), owner);
        handler = new ERC4626AdapterHandler(adapter, usdc, source, canStall);
        vm.prank(owner);
        adapter.setVault(address(handler));

        bytes4[] memory sels = new bytes4[](4);
        sels[0] = ERC4626AdapterHandler.supply.selector;
        sels[1] = ERC4626AdapterHandler.withdrawSome.selector;
        sels[2] = ERC4626AdapterHandler.accrueYield.selector;
        sels[3] = ERC4626AdapterHandler.stall.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
    }

    // ── A1: no free value out of the deposit→withdraw seam ──────────────────────────
    function invariant_A1_adapter_no_free_value() public view {
        assertLe(handler.gOut(), handler.gIn() + handler.gYield(), "A1: Sigma out > Sigma in + yield");
    }

    // ── A3: best-effort withdraw never reverts (a bricked settlement is the failure mode) ──
    function invariant_A3_adapter_withdraw_never_reverts() public view {
        assertFalse(handler.withdrawReverted(), "A3: a best-effort withdraw reverted");
    }

    // ── non-vacuity: the fuzzer actually exercised the seam ─────────────────────────
    function afterInvariant() public view {
        assertGt(handler.nDeposits() + handler.nWithdraws(), 0, "vacuous: no deposit/withdraw executed");
        assertGt(handler.nWithdraws(), 0, "vacuous: no withdraw executed");
    }
}

/// @notice A1–A3 against `MockFeeERC4626` — the XyloVault-shaped fee source whose `convertToAssets`/
///         `maxWithdraw` over-report. Proves the adapter's fee-net `previewRedeem` NAV never exceeds the
///         value actually realizable, and always stays at/below the over-reporting `convertToAssets`.
contract ERC4626AdapterFeeInvariantTest is ERC4626AdapterInvariantBase {
    MockFeeERC4626 internal source;

    function setUp() public {
        usdc   = new MockERC20("USD Coin", "USDC", 6);
        source = new MockFeeERC4626(IERC20(address(usdc)), 10); // 0.10% exit fee (exactly XyloVault)
        _wire(address(source), false);
    }

    /// A2: reported NAV never over-states the fee-net realizable amount, and never exceeds the source's
    /// (fee-ignorant, over-reporting) `convertToAssets` — i.e. the adapter picked the conservative view.
    function invariant_A2_totalAssets_not_overstated() public view {
        uint256 sh = handler.sourceShares();
        assertLe(adapter.totalAssets(), source.previewRedeem(sh), "A2: NAV > fee-net realizable");
        assertLe(adapter.totalAssets(), source.convertToAssets(sh), "A2: NAV above the over-reported view");
    }
}

/// @notice A1–A3 against `MockRoundingAdverseERC4626` — a NO-FEE source that over-reports purely by
///         rounding in the redeemer's favor (the direct Bunni rounding-direction analog). With the source
///         honest (default), the adapter's `previewRedeem` NAV equals the true realizable value; the teeth
///         check (`setNavLies(true)`) proves A2 fails the instant the adapter would trust the adverse view.
contract ERC4626AdapterAdverseInvariantTest is ERC4626AdapterInvariantBase {
    MockRoundingAdverseERC4626 internal source;

    function setUp() public {
        usdc   = new MockERC20("USD Coin", "USDC", 6);
        source = new MockRoundingAdverseERC4626(IERC20(address(usdc)));
        _wire(address(source), true);
    }

    /// A2: reported NAV never over-states the source's TRUE honest (floor) value — the amount a redeem
    /// actually pays — and stays at/below the adverse `convertToAssets`, proving the conservative choice.
    function invariant_A2_totalAssets_not_overstated() public view {
        uint256 sh = handler.sourceShares();
        assertLe(adapter.totalAssets(), source.honestValue(sh), "A2: NAV overstates true realizable");
        assertLe(adapter.totalAssets(), source.convertToAssets(sh), "A2: NAV above the over-reported view");
    }
}
