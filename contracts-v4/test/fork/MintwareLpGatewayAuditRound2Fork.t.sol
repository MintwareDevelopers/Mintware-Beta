// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
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
import {MockERC4626} from "../mocks/MockERC4626.sol";

/// @dev Real-token failure modes: issuer pause + per-address freeze (Paxos USDG `isFrozen` / meme-token blacklist).
contract FailableToken is ERC20 {
    uint8 private immutable _dec;
    bool public paused;
    mapping(address => bool) public frozen;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function setPaused(bool p) external {
        paused = p;
    }

    function setFrozen(address a, bool f) external {
        frozen[a] = f;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!paused, "TOKEN_PAUSED");
        require(!frozen[from] && !frozen[to], "ADDRESS_FROZEN");
        super._update(from, to, value);
    }
}

/// @notice Round-2 audit regressions (Hacken-style F-01/F-02/F-04 + red-team RT-1a/RT-2/RT-5/RT-6/RT-9a) against
///         the REAL Uniswap V4 stack on Robinhood testnet. Self-skips without `LP_FORK_RPC_URL`.
///
///         The gateway is ~10% of pool depth (1.5M external liquidity) so third-party swaps move price realistically.
contract MintwareLpGatewayAuditRound2ForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant RH_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 constant SQRT_1 = 79228162514264337593543950336;
    int24 constant TL = -22980;
    int24 constant TU = 22980;

    bool live;
    IPoolManager poolManager;
    IPositionManager posm;
    MintwareLpGatewayStaging staging;
    MintwareLpGatewayPositionManager pm;
    MintwareERC4626YieldAdapter adapter;
    MockERC4626 yieldSource;
    FailableToken quote;
    FailableToken paired;
    PoolKey key;
    PoolSwapTest swapper;
    PoolModifyLiquidityTest lpRouter;

    address RECIP = address(0xFEE5);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    address whale = address(0x3A1E);

    function setUp() public {
        string memory rpc = vm.envOr("LP_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;

        poolManager = IPoolManager(RH_POOL_MANAGER);
        posm = IPositionManager(RH_POSITION_MANAGER);

        FailableToken a = new FailableToken("Quote", "Q", 18);
        FailableToken b = new FailableToken("Paired", "P", 18);
        (FailableToken c0, FailableToken c1) = address(a) < address(b) ? (a, b) : (b, a);
        quote = a;
        paired = b;
        key = PoolKey({
            currency0: Currency.wrap(address(c0)), currency1: Currency.wrap(address(c1)), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        poolManager.initialize(key, SQRT_1);

        yieldSource = new MockERC4626(IERC20(address(quote)));
        adapter = new MintwareERC4626YieldAdapter(address(quote), address(yieldSource), address(0), address(this));
        staging = new MintwareLpGatewayStaging(IERC20(address(quote)), adapter);
        adapter.setVault(address(staging));
        pm = new MintwareLpGatewayPositionManager(
            poolManager, posm, IPermit2Minimal(PERMIT2), key, IERC20(address(quote)), TL, TU, staging, address(this), RECIP, 500
        );
        staging.setController(address(pm));

        swapper = new PoolSwapTest(poolManager);
        lpRouter = new PoolModifyLiquidityTest(poolManager);

        // External depth: 1.5M/1.5M from a third-party LP so the gateway is a minority of the pool.
        quote.mint(address(this), 10_000_000e18);
        paired.mint(address(this), 10_000_000e18);
        quote.approve(address(lpRouter), type(uint256).max);
        paired.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(key, ModifyLiquidityParams({tickLower: TL, tickUpper: TU, liquidityDelta: 2_200_000e18, salt: 0}), "");

        paired.approve(address(pm), type(uint256).max);
        quote.approve(address(swapper), type(uint256).max);
        paired.approve(address(swapper), type(uint256).max);
        for (uint256 i = 0; i < 4; i++) {
            address u = [alice, bob, carol, whale][i];
            quote.mint(u, 5_000_000e18);
            paired.mint(u, 5_000_000e18);
            vm.startPrank(u);
            quote.approve(address(pm), type(uint256).max);
            quote.approve(address(swapper), type(uint256).max);
            paired.approve(address(swapper), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _swap(address who, bool zeroForOne, int256 amt) internal {
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        vm.prank(who);
        swapper.swap(key, SwapParams({zeroForOne: zeroForOne, amountSpecified: amt, sqrtPriceLimitX96: limit}), PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), "");
    }

    // buy paired with quote (pushes paired price UP = "rally"); quote is currency0 iff quoteIsCurrency0
    function _buyPaired(address who, int256 quoteIn) internal {
        _swap(who, pm.quoteIsCurrency0(), -quoteIn);
    }

    function _sellPaired(address who, int256 pairedIn) internal {
        _swap(who, !pm.quoteIsCurrency0(), -pairedIn);
    }

    function _liq() internal view returns (uint128) {
        return posm.getPositionLiquidity(pm.tokenId());
    }

    function _wealth(address who) internal view returns (uint256) {
        return quote.balanceOf(who) + paired.balanceOf(who); // ~1.0 price, same decimals
    }

    /// Alice deposits 200k; owner deploys 100k quote + 100k paired.
    function _seed() internal {
        vm.prank(alice);
        pm.deposit(200_000e18);
        pm.deploy(100_000e18, 100_000e18, 0, block.timestamp);
        vm.roll(block.number + 1);
    }

    // ── F-01a: sole holder exits after a rally the follower never saw → NOTHING stranded ──────────────

    function test_R2_F01a_soleHolderExitAfterStaleRally_nothingStranded() public {
        if (!live) return;
        _seed();
        uint128 liqBefore = _liq();
        _buyPaired(whale, 600_000e18); // legit rally, no gateway activity → follower stale
        vm.roll(block.number + 5);

        uint256 navSpot = pm.totalNav();
        uint256 w0 = _wealth(alice);
        uint256 sA = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(sA);

        assertEq(_liq(), 0, "sole holder's exit removes ALL liquidity (pre-fix: 25% stranded forever)");
        assertEq(pm.totalShares(), 0);
        assertEq(pm.deployedPrincipal(), 0, "cost basis cleared with the last exit");
        assertGt(liqBefore, 0);
        // She receives the whole position (idle + the full LP at the pool's actual composition). Valued at par
        // (paired now trades ABOVE 1.0 after the rally, so par is a strict under-count) she still clears her
        // 200k deposit plus the owner's 100k paired leg; pre-fix she left 33% of her deposit behind.
        assertGe(_wealth(alice) - w0, 300_000e18, "at least deposit + owner leg back, even at par");
        assertLt(_wealth(alice) - w0, navSpot, "par-valued sum is below spot NAV (sanity: paired > 1.0)");
    }

    // ── F-01b: a remaining holder pumps in the victim's withdraw block → payout stays exactly pro-rata ──

    function test_R2_F01b_remainingHolderPump_cannotExtract() public {
        if (!live) return;
        vm.prank(alice);
        pm.deposit(100_000e18);
        vm.prank(bob);
        pm.deposit(100_000e18);
        pm.deploy(100_000e18, 100_000e18, 0, block.timestamp);
        vm.roll(block.number + 1);

        uint128 liqBefore = _liq();
        uint256 bobW0 = _wealth(bob);
        uint256 pairedBefore = paired.balanceOf(bob);
        _buyPaired(bob, 500_000e18); // Bob pumps
        uint256 pairedBought = paired.balanceOf(bob) - pairedBefore;
        uint256 sA = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(sA); // victim exits in the pumped block
        _sellPaired(bob, int256(pairedBought)); // Bob unwinds

        uint128 removed = liqBefore - _liq();
        // Alice held 50% of shares → she took 50% of the liquidity (±0.01%), regardless of the pumped spot.
        assertApproxEqRel(uint256(removed), uint256(liqBefore) / 2, 0.0001e18, "pro-rata liquidity slice, price-neutral");
        assertLe(_wealth(bob), bobW0, "the pump-and-unwind cost Bob money (pre-fix: +14k extraction)");
    }

    // ── F-02a / RT-6a: paired token paused → idle leg still pays, LP slice re-credited, nothing bricks ──

    function test_R2_F02a_pairedTokenPaused_idleLegStillPays_lpReCredited() public {
        if (!live) return;
        _seed();
        paired.setPaused(true);

        uint256 shares = pm.sharesOf(alice);
        uint256 q0 = quote.balanceOf(alice);
        vm.expectEmit(true, false, false, false);
        emit MintwareLpGatewayPositionManager.LpLegUnavailable(alice, 0);
        vm.prank(alice);
        (uint256 qOut, uint256 pOut) = pm.withdraw(shares); // pre-fix: reverted TOKEN_PAUSED — everything frozen
        assertEq(pOut, 0);
        assertApproxEqRel(qOut, 100_000e18, 0.001e18, "the liquid idle leg (100k) was delivered");
        assertEq(quote.balanceOf(alice) - q0, qOut);
        assertGt(pm.sharesOf(alice), 0, "LP slice re-credited as shares (claim intact)");
        assertGt(_liq(), 0, "LP untouched while the paired token is paused");

        // Token recovers → she exits the LP slice too. No loss.
        paired.setPaused(false);
        vm.roll(block.number + 1);
        uint256 rest = pm.sharesOf(alice);
        vm.prank(alice);
        (uint256 q2, uint256 p2) = pm.withdraw(rest);
        assertGt(q2 + p2, 0);
        assertEq(_liq(), 0);
        assertEq(pm.totalShares(), 0);
    }

    // ── F-02b / RT-6b: USDG freezes the harvestRecipient → withdraws still work (LP leg deferred) ─────

    function test_R2_F02b_harvestRecipientFrozen_withdrawStillPays() public {
        if (!live) return;
        _seed();
        _buyPaired(whale, 20_000e18); // accrue fees on the position
        _sellPaired(whale, 20_000e18);
        vm.roll(block.number + 1);
        quote.setFrozen(RECIP, true); // issuer freezes the operator hot wallet

        uint256 half = pm.sharesOf(alice) / 2;
        vm.prank(alice);
        (uint256 qOut,) = pm.withdraw(half); // pre-fix: reverted ADDRESS_FROZEN
        assertGt(qOut, 0, "idle leg paid despite the frozen fee recipient");
        assertGt(pm.sharesOf(alice), 100_000e18, "half burned + LP half re-credited");
        // Owner-side harvest is what stays blocked until the issuer unfreezes — not depositor exits.
        vm.expectRevert();
        pm.harvest(block.timestamp);
    }

    // ── RT-5a: adapter shortfall is re-credited, NEVER sourced from the LP ─────────────────────────────

    function test_R2_RT5a_adapterShortfall_notSourcedFromLP() public {
        if (!live) return;
        vm.prank(alice);
        pm.deposit(100_000e18);
        vm.prank(bob);
        pm.deposit(100_000e18);
        pm.deploy(100_000e18, 100_000e18, 0, block.timestamp);
        vm.roll(block.number + 1);
        adapter.setPerBlockWithdrawCap(10_000e18); // Morpho illiquid: only 10k of the 100k idle leaves this block

        uint128 liqBefore = _liq();
        uint256 sA = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(sA); // 50% holder
        uint128 removed = liqBefore - _liq();
        // Pre-fix the idle shortfall was pulled from the LP (first mover took the WHOLE position). Now: exactly her
        // 50% slice of the LP, and the unserved idle (50k − 10k) comes back as shares.
        assertApproxEqRel(uint256(removed), uint256(liqBefore) / 2, 0.0001e18, "LP removal is the pro-rata slice only");
        assertGt(pm.sharesOf(alice), 0, "unserved idle re-credited");
        assertGt(_liq(), 0, "Bob's half of the LP is still there");
    }

    // ── RT-9a: a crash cannot re-open the deploy cap (cost basis, not marked value) ───────────────────

    function test_R2_RT9a_crashDoesNotReopenDeployCap() public {
        if (!live) return;
        _seed(); // 200k principal, 100k deployed at cost → cap (50%) is full
        assertEq(pm.deployedPrincipal(), 100_000e18);
        _sellPaired(whale, 900_000e18); // paired token dumps hard → LP marked value collapses
        vm.roll(block.number + 1);
        pm.poke(); // walk the follower so the band check is not what blocks the deploy
        vm.roll(block.number + 1);
        assertLt(pm.totalNav(), 290_000e18, "marked NAV fell from 300k (sanity)");
        // Pre-fix: deployed MARKED value fell → the cap re-opened → the honest cron topped up → 2/3 of principal cycled in.
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployCapExceeded.selector);
        pm.deploy(10_000e18, 10_000e18, 0, block.timestamp);
    }

    // ── RT-1a / F-01c: depositWithMin bounds a same-block pump; poke keeps marks fresh ───────────────

    function test_R2_RT1a_depositWithMin_blocksSandwich() public {
        if (!live) return;
        _seed();
        vm.roll(block.number + 1);
        // Fair share count at the true price, computed by a dry quote: deposit 100k → ~half of alice's 200k-share stake.
        uint256 fairShares = 100_000e18 * pm.totalShares() / pm.totalNav();
        _buyPaired(bob, 500_000e18); // Bob pumps ahead of Carol's deposit → LP mark inflated → fewer shares for Carol
        vm.prank(carol);
        vm.expectRevert(MintwareLpGatewayPositionManager.SlippageExceeded.selector);
        pm.depositWithMin(100_000e18, fairShares * 99 / 100); // Carol tolerates 1% — the sandwich exceeds it → protected
    }

    function test_R2_F04_poke_isPermissionlessAndBounded() public {
        if (!live) return;
        _seed();
        uint256 b0 = block.number; // via-IR can CSE `block.number` across vm.roll — anchor every roll to b0
        _buyPaired(whale, 600_000e18); // +~26% sqrtPrice, no gateway activity → follower stale
        vm.roll(b0 + 1);
        // Fresh principal so the cap has room (cap is full right after _seed) and the BAND is what gates deploy.
        vm.prank(bob);
        pm.deposit(200_000e18);
        vm.roll(b0 + 2);
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployPriceOutOfBand.selector);
        pm.deploy(1e18, 1e18, 0, block.timestamp);
        // Anyone walks the follower one bounded step per block; a few blocks later deploy is possible again.
        for (uint256 i = 3; i < 12; i++) {
            vm.roll(b0 + i);
            vm.prank(carol);
            pm.poke();
        }
        vm.roll(b0 + 12);
        pm.deploy(5_000e18, 5_000e18, 0, block.timestamp); // no DeployPriceOutOfBand after the walk
    }

    // ── RT-2 (structural): full delivery never re-credits shares; spot is read once ──────────────────

    function test_R2_RT2_fullDelivery_noReCredit() public {
        if (!live) return;
        _seed();
        uint256 sA = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(sA);
        assertEq(pm.sharesOf(alice), 0, "no shares re-minted after a full delivery");
        assertEq(pm.totalShares(), 0);
    }

    function test_R2_withdrawWithMin_reverts_whenBelowFloor() public {
        if (!live) return;
        _seed();
        uint256 sA = pm.sharesOf(alice);
        vm.expectRevert(MintwareLpGatewayPositionManager.SlippageExceeded.selector);
        vm.prank(alice);
        pm.withdrawWithMin(sA, 1_000_000e18, 0);
    }
}
