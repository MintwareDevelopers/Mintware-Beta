// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {RTMintableERC20, RTBlacklistERC20, RTFlaky4626} from "../audit/RedTeamOnchainTokens.sol";

/// @notice Audit-closeout regressions (consolidated 2026-09-08 C-10 + the F-02 rec. 3 harvest-recipient rotation)
///         against the REAL Uniswap V4 stack on Robinhood testnet. Self-skips without `LP_FORK_RPC_URL`.
///
///         C-10 needs a DEPLOYED position to prove the "LP leg still pays while the yield source is down" path, and
///         the rotation needs real accrued fees to prove where a sweep lands — neither is reachable on the Stub rig.
contract MintwareLpGatewayCloseoutForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant RH_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 constant SQRT_1 = 79228162514264337593543950336;
    int24 constant TL = -22980;
    int24 constant TU = 22980;

    bool live;
    uint256 blk; // own block counter (via-IR may CSE `block.number` across vm.roll)
    IPoolManager poolManager;
    IPositionManager posm;
    MintwareLpGatewayStaging staging;
    MintwareLpGatewayPositionManager pm;
    MintwareERC4626YieldAdapter adapter;
    RTFlaky4626 src;
    RTBlacklistERC20 quote; // Paxos-USDG shape: issuer can freeze an address (the F-02b scenario)
    RTMintableERC20 paired;
    PoolKey key;
    PoolSwapTest swapper;
    PoolModifyLiquidityTest lpRouter;

    address RECIP = address(0xFEE5);
    address NEW_RECIP = address(0xFEE6);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address whale = address(0x3A1E);

    function setUp() public {
        string memory rpc = vm.envOr("LP_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        blk = block.number;

        poolManager = IPoolManager(vm.envOr("LP_POOL_MANAGER", RH_POOL_MANAGER));
        posm = IPositionManager(vm.envOr("LP_POSITION_MANAGER", RH_POSITION_MANAGER));

        quote = new RTBlacklistERC20("Quote", "Q", 18);
        paired = new RTMintableERC20("Paired", "P", 18);
        (address c0, address c1) =
            address(quote) < address(paired) ? (address(quote), address(paired)) : (address(paired), address(quote));
        key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        poolManager.initialize(key, SQRT_1);

        src = new RTFlaky4626(IERC20(address(quote)));
        adapter = new MintwareERC4626YieldAdapter(address(quote), address(src), address(0), address(this));
        staging = new MintwareLpGatewayStaging(IERC20(address(quote)), adapter);
        adapter.setVault(address(staging));
        pm = new MintwareLpGatewayPositionManager(
            poolManager, posm, IPermit2Minimal(PERMIT2), key, IERC20(address(quote)), TL, TU, staging, address(this), RECIP, 500
        );
        staging.setController(address(pm));

        swapper = new PoolSwapTest(poolManager);
        lpRouter = new PoolModifyLiquidityTest(poolManager);

        // External depth so the gateway is a minority of the pool (same shape as the round-2 rig).
        quote.mint(address(this), 10_000_000e18);
        paired.mint(address(this), 10_000_000e18);
        quote.approve(address(lpRouter), type(uint256).max);
        paired.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(key, ModifyLiquidityParams({tickLower: TL, tickUpper: TU, liquidityDelta: 2_200_000e18, salt: 0}), "");

        paired.approve(address(pm), type(uint256).max);
        quote.approve(address(pm), type(uint256).max);
        quote.approve(address(swapper), type(uint256).max);
        paired.approve(address(swapper), type(uint256).max);
        for (uint256 i = 0; i < 3; i++) {
            address u = [alice, bob, whale][i];
            quote.mint(u, 5_000_000e18);
            paired.mint(u, 5_000_000e18);
            vm.startPrank(u);
            quote.approve(address(pm), type(uint256).max);
            quote.approve(address(swapper), type(uint256).max);
            paired.approve(address(swapper), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _roll(uint256 n) internal {
        blk += n;
        vm.roll(blk);
    }

    function _swap(address who, bool zeroForOne, int256 amt) internal {
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        vm.prank(who);
        swapper.swap(key, SwapParams({zeroForOne: zeroForOne, amountSpecified: amt, sqrtPriceLimitX96: limit}), PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), "");
    }

    /// Round-trip swap: accrues fees on the position, leaves price ~where it was.
    function _accrueFees(uint256 size) internal {
        _swap(whale, pm.quoteIsCurrency0(), -int256(size));
        _swap(whale, !pm.quoteIsCurrency0(), -int256(size));
    }

    function _liq() internal view returns (uint128) {
        return posm.getPositionLiquidity(pm.tokenId());
    }

    function _wealth(address who) internal view returns (uint256) {
        return quote.balanceOf(who) + paired.balanceOf(who); // ~1.0 price, same decimals
    }

    function _fees(address who) internal view returns (uint256) {
        return quote.balanceOf(who) + paired.balanceOf(who);
    }

    /// Alice deposits 200k; owner deploys 100k quote + 100k paired → NAV ≈ 100k idle + 200k LP.
    function _seed() internal {
        vm.prank(alice);
        pm.deposit(200_000e18);
        pm.deploy(100_000e18, 100_000e18, 0, block.timestamp);
        _roll(1);
        assertEq(pm.lastKnownIdle(), 100_000e18, "fallback tracks the post-deploy reserve");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // C-10 / RT-5f — yield source `previewRedeem` reverts while a position is deployed
    // ═══════════════════════════════════════════════════════════════════════════════════════════════

    /// Partial exit during the outage: the LP slice is delivered in full, the idle leg (sized off `lastKnownIdle`)
    /// is re-credited as shares, deposits fail closed, and once the source answers again the remainder exits with
    /// NO loss versus the pre-outage NAV. Pre-fix: every one of these calls reverted (total brick, RT-5f).
    function test_CF_C10_partialExitDuringOutage_lpPays_idleReCredited_noLoss() public {
        if (!live) return;
        _seed();
        uint256 navBefore = pm.totalNav(); // ≈ 300k (200k deposit + the owner's 100k paired leg)
        uint256 idleBefore = staging.stagedAssets();
        uint256 w0 = _wealth(alice);
        uint256 sA = pm.sharesOf(alice);

        src.setRevertPreview(true);
        assertFalse(pm.sourceReadable());
        assertEq(pm.totalNav(), navBefore, "view falls back to lastKnownIdle - no revert, same figure (no yield moved)");

        // deposits: fail closed
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.SourceUnavailable.selector);
        pm.deposit(1_000e18);

        // withdraw half: LP leg pays, idle leg re-credited
        uint128 liqBefore = _liq();
        vm.expectEmit(true, false, false, false);
        emit MintwareLpGatewayPositionManager.IdleLegUnavailable(alice, 0);
        vm.prank(alice);
        (uint256 qOut, uint256 pOut) = pm.withdraw(sA / 2);
        assertGt(qOut, 0);
        assertGt(pOut, 0, "the LP slice's paired leg was delivered");
        assertApproxEqRel(uint256(liqBefore - _liq()), uint256(liqBefore) / 2, 0.0001e18, "exactly her pro-rata LP slice");
        assertEq(quote.balanceOf(address(src)), idleBefore, "idle reserve untouched - unstage never called");
        // claim = 50k idle (last known) + 100k LP; delivered = 100k LP → 2/3 of the requested shares burned, 1/3 back.
        uint256 burned = sA - pm.sharesOf(alice);
        assertApproxEqRel(burned, (sA / 2) * 2 / 3, 0.005e18, "burned = shares x delivered / (lpEntitled + lastKnownIdle)");
        assertApproxEqRel(qOut + pOut, 100_000e18, 0.005e18, "LP slice ~ 100k at par");

        // source recovers → the rest exits; total received ≈ the whole pre-outage NAV. No loss.
        src.setRevertPreview(false);
        _roll(1);
        uint256 rest = pm.sharesOf(alice);
        vm.prank(alice);
        (uint256 q2, uint256 p2) = pm.withdraw(rest);
        assertGt(q2 + p2, 0);
        assertEq(pm.totalShares(), 0);
        assertEq(_liq(), 0);
        assertEq(pm.deployedPrincipal(), 0);
        assertApproxEqRel(_wealth(alice) - w0, navBefore, 0.005e18, "received the full NAV across the two exits");
        assertLe(quote.balanceOf(address(src)), 1, "reserve drained to the last holder (dust only)");
    }

    /// Sole holder's FULL exit during the outage: the whole LP comes out (nothing stranded, A-2 clean), the entire
    /// idle claim comes back as shares, and it is recovered after the source returns.
    function test_CF_C10_lastHolderFullExitDuringOutage_nothingStranded() public {
        if (!live) return;
        _seed();
        uint256 navBefore = pm.totalNav();
        uint256 w0 = _wealth(alice);
        uint256 sA = pm.sharesOf(alice);
        src.setRevertPreview(true);

        vm.prank(alice);
        pm.withdraw(sA);
        assertEq(_liq(), 0, "full LP delivered");
        assertEq(pm.deployedPrincipal(), 0);
        assertGt(pm.sharesOf(alice), 0, "idle claim re-credited");
        assertEq(pm.totalShares(), pm.sharesOf(alice), "she is still the sole holder");
        assertApproxEqRel(pm.sharesOf(alice), sA / 3, 0.005e18, "1/3 of the claim (100k of 300k) was undeliverable");

        src.setRevertPreview(false);
        _roll(1);
        uint256 rest = pm.sharesOf(alice); // read BEFORE the prank (a pranked view call would eat the prank)
        vm.prank(alice);
        (uint256 q2, uint256 p2) = pm.withdraw(rest);
        assertEq(p2, 0);
        assertApproxEqRel(q2, 100_000e18, 0.001e18, "the whole idle reserve, as last holder");
        assertEq(pm.totalShares(), 0);
        assertApproxEqRel(_wealth(alice) - w0, navBefore, 0.005e18, "no loss");
    }

    /// Co-depositor fairness during an outage: Alice's LP-only exit doesn't touch Bob's idle or LP slice.
    function test_CF_C10_outageExit_doesNotTouchCoDepositor() public {
        if (!live) return;
        vm.prank(alice);
        pm.deposit(100_000e18);
        vm.prank(bob);
        pm.deposit(100_000e18);
        pm.deploy(100_000e18, 100_000e18, 0, block.timestamp);
        _roll(1);
        uint256 idle0 = staging.stagedAssets();
        uint128 liq0 = _liq();
        uint256 sB = pm.sharesOf(bob);

        src.setRevertPreview(true);
        uint256 sA = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(sA);
        assertApproxEqRel(uint256(liq0 - _liq()), uint256(liq0) / 2, 0.0001e18, "Alice took exactly her half of the LP");
        assertEq(quote.balanceOf(address(src)), idle0, "idle reserve untouched");
        assertEq(pm.sharesOf(bob), sB, "Bob's shares untouched");

        src.setRevertPreview(false);
        _roll(1);
        uint256 wB = _wealth(bob);
        vm.prank(bob);
        pm.withdraw(sB);
        // Bob (50% holder, 100k deposit) gets his half of idle (50k) + his half of the LP (≈100k at par) = ≈150k.
        assertApproxEqRel(_wealth(bob) - wB, 150_000e18, 0.01e18, "Bob's pro-rata value intact after Alice's outage exit");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // F-02 rec. 3 — timelocked harvestRecipient rotation: where do sweeps land?
    // ═══════════════════════════════════════════════════════════════════════════════════════════════

    /// During the 48h window EVERY sweep (harvest + the H-02 pre-decrease sweep in withdraw) still pays the OLD
    /// recipient; after `acceptHarvestRecipient` they pay the NEW one. A compromised owner key gets nothing
    /// redirected for 48h.
    function test_CF_rotation_sweepsFollowRecipientOnlyAfterAccept() public {
        if (!live) return;
        _seed();
        uint256 t0 = block.timestamp;

        // ── window open: propose, then harvest — fees land on the OLD recipient ──
        pm.proposeHarvestRecipient(NEW_RECIP);
        _accrueFees(20_000e18);
        _roll(1);
        uint256 oldBefore = _fees(RECIP);
        (uint256 qf, uint256 pf) = pm.harvest(block.timestamp);
        assertGt(qf + pf, 0, "fees accrued");
        assertEq(_fees(RECIP) - oldBefore, qf + pf, "harvest during the window -> OLD recipient");
        assertEq(_fees(NEW_RECIP), 0, "proposed recipient receives nothing before the delay");

        // ── the pre-decrease sweep inside a withdraw also still routes to OLD ──
        _accrueFees(20_000e18);
        _roll(1);
        oldBefore = _fees(RECIP);
        uint256 quarter = pm.sharesOf(alice) / 4;
        vm.prank(alice);
        pm.withdraw(quarter);
        assertGt(_fees(RECIP), oldBefore, "withdraw's fee sweep -> OLD recipient during the window");
        assertEq(_fees(NEW_RECIP), 0);

        // ── early accept refused; accept at the eta ──
        vm.expectRevert(MintwareLpGatewayPositionManager.RotationNotReady.selector);
        pm.acceptHarvestRecipient();
        vm.warp(t0 + 48 hours);
        pm.acceptHarvestRecipient();
        assertEq(pm.harvestRecipient(), NEW_RECIP);

        // ── after rotation: harvest AND the withdraw sweep pay NEW; OLD is frozen at its balance ──
        uint256 oldFrozen = _fees(RECIP);
        _accrueFees(20_000e18);
        _roll(1);
        (qf, pf) = pm.harvest(block.timestamp);
        assertGt(qf + pf, 0);
        assertEq(_fees(NEW_RECIP), qf + pf, "harvest after rotation -> NEW recipient");
        assertEq(_fees(RECIP), oldFrozen, "OLD recipient gets nothing more");

        _accrueFees(20_000e18);
        _roll(1);
        uint256 newBefore = _fees(NEW_RECIP);
        quarter = pm.sharesOf(alice) / 4;
        vm.prank(alice);
        pm.withdraw(quarter);
        assertGt(_fees(NEW_RECIP), newBefore, "withdraw's fee sweep after rotation -> NEW recipient");
        assertEq(_fees(RECIP), oldFrozen);
    }

    /// The F-02b recovery the immutable recipient could never offer: the quote issuer freezes the hot wallet →
    /// `harvest` reverts (the owner-side brick; depositor exits were already unaffected via the best-effort LP leg,
    /// C-2). The operator rotates to a fresh address; after 48h `harvest` works again and the frozen address is out
    /// of the fee path. Pre-fix: no on-chain recovery short of the issuer unfreezing.
    function test_CF_rotation_recoversHarvestAfterRecipientFreeze() public {
        if (!live) return;
        _seed();
        _accrueFees(20_000e18);
        _roll(1);
        quote.setBlacklisted(RECIP, true); // issuer freezes the operator hot wallet
        vm.expectRevert(bytes("BLACKLISTED"));
        pm.harvest(block.timestamp);

        uint256 t0 = block.timestamp;
        pm.proposeHarvestRecipient(NEW_RECIP);
        vm.expectRevert(bytes("BLACKLISTED"));
        pm.harvest(block.timestamp); // still bricked during the window — the current recipient is still the sink
        vm.warp(t0 + 48 hours);
        pm.acceptHarvestRecipient();

        uint256 oldBal = _fees(RECIP);
        (uint256 qf, uint256 pf) = pm.harvest(block.timestamp); // recovered
        assertGt(qf + pf, 0);
        assertEq(_fees(RECIP), oldBal, "frozen address is out of the fee path");
        assertEq(_fees(NEW_RECIP), qf + pf);
    }
}
