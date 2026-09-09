// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Hacken-style audit PoCs for the LP Gateway V1 contracts (2026-09-08).
///         Two harnesses: `HackenLpGatewayUnitTest` (Stub V4, idle path) and `HackenLpGatewayForkTest`
///         (real Uniswap V4 on Robinhood Chain testnet; self-skips without `LP_FORK_RPC_URL`).
///         Each PoC is named after the report finding it evidences. A PASSING PoC = the behaviour it
///         describes is CONFIRMED on the current code. F-01a/b, F-02a/b and I-03 were FIXED in the
///         pure-pro-rata / best-effort-LP-leg rewrite of `_withdraw` (2026-09-08); those PoCs now carry a
///         `_FIXED` suffix and assert the CURRENT behaviour (they are regression tests for the fixes, kept
///         as evidence of the original finding). F-01c / F-03 / F-04 document accepted residuals / design.
///
///         Run:  LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com \
///               forge test --match-path "contracts-v4/test/audit/HackenContracts.t.sol" -vv

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
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC4626} from "../mocks/MockERC4626.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {MockSlot0PoolManager} from "../mocks/MockSlot0PoolManager.sol";

interface IPermit2AllowanceView {
    function allowance(address user, address token, address spender)
        external
        view
        returns (uint160 amount, uint48 expiration, uint48 nonce);
}

/// @dev Audit token: a plain mintable ERC-20 with the failure modes real quote/paired tokens have —
///      issuer pause, per-address freeze (Paxos USDG `isFrozen`), and an optional re-entrancy probe.
contract AuditToken is ERC20 {
    uint8 private immutable _dec;
    bool public paused;
    mapping(address => bool) public frozen;
    address public reenterTarget; // if set, every transfer INTO this address tries to re-enter it
    bool public reentryAttempted;
    bool public reentryBlocked;

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

    function setReenterTarget(address t) external {
        reenterTarget = t;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!paused, "TOKEN_PAUSED");
        require(!frozen[from] && !frozen[to], "ADDRESS_FROZEN");
        super._update(from, to, value);
        if (reenterTarget != address(0) && to == reenterTarget && from != address(0)) {
            reentryAttempted = true;
            // Probe: can the paired token re-enter the gateway during `take`? (should be blocked)
            (bool ok,) = reenterTarget.call(abi.encodeWithSignature("deposit(uint256)", uint256(1)));
            if (!ok) reentryBlocked = true;
        }
    }
}

contract Stub {}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Unit harness (Stub V4 — idle path only)
// ─────────────────────────────────────────────────────────────────────────────────────────────
contract HackenLpGatewayUnitTest is Test {
    MockERC20 usdg;
    MockERC20 pons;
    MockYieldAdapter adapter;
    MintwareLpGatewayStaging staging;
    address stub;
    address slot0Pm;

    function setUp() public {
        usdg = new MockERC20("USD Global", "USDG", 6);
        pons = new MockERC20("Pons", "PONS", 18);
        adapter = new MockYieldAdapter(address(usdg));
        staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        stub = address(new Stub());
        slot0Pm = address(new MockSlot0PoolManager()); // round-3: the PM ctor reads slot0 (XR-2 anchor); build it OUTSIDE expectRevert windows
    }

    function _key(address c0, address c1, address hooks) internal pure returns (PoolKey memory) {
        (address a, address b) = c0 < c1 ? (c0, c1) : (c1, c0);
        return PoolKey({currency0: Currency.wrap(a), currency1: Currency.wrap(b), fee: 3000, tickSpacing: 60, hooks: IHooks(hooks)});
    }

    function _new(PoolKey memory key, int24 tl, int24 tu) internal returns (MintwareLpGatewayPositionManager) {
        return new MintwareLpGatewayPositionManager(
            IPoolManager(slot0Pm), IPositionManager(stub), IPermit2Minimal(stub), key, IERC20(address(usdg)), tl, tu, staging, address(this), address(0x5151), 500,
            type(uint256).max // IA-11 principal cap: uncapped -- this test predates/is unrelated to the cap
        );
    }

    // VERIFIED-SOUND (A-6/A-8 constructor guards — untested in the repo suite): hooked pool rejected.
    function test_VS_ctor_rejectsHookedPool() public {
        vm.expectRevert(MintwareLpGatewayPositionManager.HookedPoolUnsupported.selector);
        _new(_key(address(usdg), address(pons), address(0x1000)), -600, 600);
    }

    // VERIFIED-SOUND: native-ETH pair (paired == address(0)) rejected.
    function test_VS_ctor_rejectsNativeEthPair() public {
        vm.expectRevert(MintwareLpGatewayPositionManager.ZeroAddress.selector);
        _new(_key(address(usdg), address(0), address(0)), -600, 600);
    }

    // VERIFIED-SOUND: unordered / misaligned ticks rejected.
    function test_VS_ctor_rejectsBadTicks() public {
        PoolKey memory k = _key(address(usdg), address(pons), address(0));
        vm.expectRevert(MintwareLpGatewayPositionManager.BadTicks.selector);
        _new(k, 600, -600);
        vm.expectRevert(MintwareLpGatewayPositionManager.BadTicks.selector);
        _new(k, -601, 600);
        vm.expectRevert(MintwareLpGatewayPositionManager.BadTicks.selector);
        _new(k, -600, 601);
    }

    // VERIFIED-SOUND: band bounds (0 and >5000 rejected).
    function test_VS_ctor_rejectsBadBand() public {
        PoolKey memory k = _key(address(usdg), address(pons), address(0));
        vm.expectRevert(MintwareLpGatewayPositionManager.BadDeviationBand.selector);
        new MintwareLpGatewayPositionManager(
            IPoolManager(slot0Pm), IPositionManager(stub), IPermit2Minimal(stub), k, IERC20(address(usdg)), -600, 600, staging, address(this), address(0x5151), 0,
            type(uint256).max // IA-11 principal cap: uncapped -- this test predates/is unrelated to the cap
        );
        vm.expectRevert(MintwareLpGatewayPositionManager.BadDeviationBand.selector);
        new MintwareLpGatewayPositionManager(
            IPoolManager(slot0Pm), IPositionManager(stub), IPermit2Minimal(stub), k, IERC20(address(usdg)), -600, 600, staging, address(this), address(0x5151), 5001,
            type(uint256).max // IA-11 principal cap: uncapped -- this test predates/is unrelated to the cap
        );
    }

    // INFO (I-03) — FIXED. Originally: value left in the gateway when totalShares reached 0 was owned by the
    // VIRTUAL shares and unrecoverable by any later depositor. Now the LAST holder's exit takes ALL of each leg
    // (`lastHolder` branch in `_withdraw`), so leftover NAV is swept by whoever exits last and the gateway is
    // left clean (totalNav == 0) — no value is ever stranded behind the virtual offset.
    function test_I03_leftoverNavAtZeroShares_recoveredByLastHolder_FIXED() public {
        PoolKey memory k = _key(address(usdg), address(pons), address(0));
        MintwareLpGatewayPositionManager pm = _new(k, -600, 600);
        staging.setController(address(pm));
        // Simulate "leftover NAV with zero shares" (the state the ORIGINAL F-01 produced): donate to the reserve.
        usdg.mint(address(adapter), 20_000e6);
        assertEq(pm.totalShares(), 0);
        assertEq(pm.totalNav(), 20_000e6);

        address bob = address(0xB0B);
        usdg.mint(bob, 1_000_000e6);
        vm.prank(bob);
        usdg.approve(address(pm), type(uint256).max);
        vm.prank(bob);
        uint256 s = pm.deposit(1_000_000e6);
        vm.roll(block.number + 1);
        vm.prank(bob);
        (uint256 q,) = pm.withdraw(s);
        // Bob is the sole (last) holder: he recovers his deposit PLUS the 20k leftover, and nothing stays behind.
        assertEq(q, 1_020_000e6, "last holder sweeps the leftover with his deposit");
        assertEq(pm.totalShares(), 0, "clean state: no shares");
        assertEq(pm.totalNav(), 0, "clean state: nothing stranded behind the virtual offset");
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Fork harness (real V4 on Robinhood Chain testnet)
// ─────────────────────────────────────────────────────────────────────────────────────────────
contract HackenLpGatewayForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // Mirror of the PM's event so `vm.expectEmit` can match it (F-02 FIXED PoCs).
    event LpLegUnavailable(address indexed user, uint128 liquidityRequested);

    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant RH_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 constant SQRT_1 = 79228162514264337593543950336;
    int24 constant TL = -22980;
    int24 constant TU = 22980;

    bool live;
    IPoolManager poolManager;
    IPositionManager posm;
    PoolSwapTest swapper;
    PoolModifyLiquidityTest lpHelper;

    // per-rig state
    AuditToken quote;
    AuditToken paired;
    bool quoteIs0;
    PoolKey key;
    MockERC4626 yieldSource;
    MintwareERC4626YieldAdapter adapter;
    MintwareLpGatewayStaging staging;
    MintwareLpGatewayPositionManager pm;

    address RECIP = address(0xFEE5);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);

    function setUp() public {
        string memory rpc = vm.envOr("LP_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        poolManager = IPoolManager(vm.envOr("LP_POOL_MANAGER", RH_POOL_MANAGER));
        posm = IPositionManager(vm.envOr("LP_POSITION_MANAGER", RH_POSITION_MANAGER));
        swapper = new PoolSwapTest(poolManager);
        lpHelper = new PoolModifyLiquidityTest(poolManager);
    }

    /// Fresh isolated rig: 18dp quote + paired, new pool at price 1.0, production adapter, band 500 bps.
    function _rig() internal {
        quote = new AuditToken("Quote", "Q", 18);
        paired = new AuditToken("Paired", "P", 18);
        quoteIs0 = address(quote) < address(paired);
        (address c0, address c1) = quoteIs0 ? (address(quote), address(paired)) : (address(paired), address(quote));
        key = PoolKey({currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        poolManager.initialize(key, SQRT_1);

        yieldSource = new MockERC4626(IERC20(address(quote)));
        adapter = new MintwareERC4626YieldAdapter(address(quote), address(yieldSource), address(0), address(this));
        staging = new MintwareLpGatewayStaging(IERC20(address(quote)), adapter);
        adapter.setVault(address(staging));
        pm = new MintwareLpGatewayPositionManager(
            poolManager, posm, IPermit2Minimal(PERMIT2), key, IERC20(address(quote)), TL, TU, staging, address(this), RECIP, 500,
            type(uint256).max // IA-11 principal cap: uncapped -- this test predates/is unrelated to the cap
        );
        staging.setController(address(pm));

        address[4] memory users = [alice, bob, carol, address(this)];
        for (uint256 i; i < users.length; i++) {
            quote.mint(users[i], 50_000_000e18);
            paired.mint(users[i], 50_000_000e18);
            vm.startPrank(users[i]);
            quote.approve(address(pm), type(uint256).max);
            paired.approve(address(pm), type(uint256).max);
            quote.approve(address(swapper), type(uint256).max);
            paired.approve(address(swapper), type(uint256).max);
            quote.approve(address(lpHelper), type(uint256).max);
            paired.approve(address(lpHelper), type(uint256).max);
            vm.stopPrank();
        }

        // Earn-vs-lp decision (2026-09-08): `deploy` sources the paired leg by swapping the depositor's own quote
        // through THIS pool, so every rig needs third-party depth to trade against -- the "deep curated pool" the
        // docs already require. Tests that want a DEEPER pool still add more on top with `_addExternalLiquidity`.
        _addExternalLiquidity(1_500_000e18);
    }

    /// Third-party depth in the same range (the "deep curated pool" the docs rely on).
    function _addExternalLiquidity(int256 liq) internal {
        lpHelper.modifyLiquidity(key, ModifyLiquidityParams({tickLower: TL, tickUpper: TU, liquidityDelta: liq, salt: 0}), "");
    }

    function _deposit(address who, uint256 amt) internal returns (uint256) {
        vm.prank(who);
        return pm.deposit(amt);
    }

    /// Buy paired with `quoteIn` quote (pumps the paired price → the LP leg's QUOTE value rises).
    function _buyPaired(address who, uint256 quoteIn) internal {
        bool zeroForOne = quoteIs0; // selling quote
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        vm.prank(who);
        swapper.swap(
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(quoteIn), sqrtPriceLimitX96: limit}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    /// Sell `pairedIn` paired for quote (dumps the paired price).
    function _sellPaired(address who, uint256 pairedIn) internal {
        bool zeroForOne = !quoteIs0; // selling paired
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        vm.prank(who);
        swapper.swap(
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(pairedIn), sqrtPriceLimitX96: limit}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function _liq() internal view returns (uint128) {
        return posm.getPositionLiquidity(pm.tokenId());
    }

    function _spot() internal view returns (uint160 s) {
        (s,,,) = poolManager.getSlot0(key.toId());
    }

    /// Paired → quote at the CURRENT pool price (both 18dp).
    function _pairedToQuoteSpot(uint256 p) internal view returns (uint256) {
        uint256 s = _spot();
        uint256 Q96 = 2 ** 96;
        if (quoteIs0) return (p * Q96 / s) * Q96 / s;
        return (p * s / Q96) * s / Q96;
    }

    function _claimOf(address who) internal view returns (uint256) {
        uint256 ts = pm.totalShares();
        if (ts == 0) return 0;
        return pm.totalNav() * pm.sharesOf(who) / ts;
    }

    // ── F-01 · withdraw-side conservative mark + stale follower — FIXED (pure pro-rata exit) ──

    /// F-01(a) — FIXED. Originally: a sole holder exiting after a NATURAL rally (spot above the stale follower)
    /// received only R/S of her LP liquidity, all her shares were burned, and the remainder stayed in the
    /// position with totalShares == 0 → permanently dead (I-03). Now the exit is PURE PRO-RATA and the LAST
    /// holder removes ALL liquidity: no mark is read to size the payout, so a stale reference cannot under-pay,
    /// and nothing is left behind.
    function test_F01a_staleRefRally_soleHolderExitsWhole_noLeftover_FIXED() public {
        if (!live) return;
        _rig();
        _addExternalLiquidity(1_500_000e18); // extra depth on top of the rig's own: gateway ~10% of the pool
        // Earn-vs-lp decision: alice funds the paired leg herself (300k in, 200k staged with half zapped), which
        // reproduces the same idle 100k / LP 200k / NAV 300k position the old owner-funded call produced.
        _deposit(alice, 300_000e18);
        pm.deploy(200_000e18, 100_000e18, 0, 0, block.timestamp); // well within the 100% overdraw guard
        vm.roll(block.number + 1);
        uint128 liqBefore = _liq();
        assertGt(liqBefore, 0);

        // Legit multi-block rally with NO gateway action → follower stays at 1.0 while spot runs.
        _buyPaired(bob, 600_000e18);
        vm.roll(block.number + 5);

        uint256 navAtSpot = pm.totalNav(); // what the sole holder is owed, at the CURRENT price
        uint256 aq0 = quote.balanceOf(alice);
        uint256 ap0 = paired.balanceOf(alice);
        uint256 s = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(s); // full exit by the ONLY holder

        assertEq(_liq(), 0, "FIXED: the last holder removes ALL liquidity - nothing left behind");
        assertLe(pm.totalShares(), 1, "shares burned (dust only)");
        assertEq(pm.deployedPrincipal(), 0, "cost basis cleared with the position");
        uint256 aliceGot = (quote.balanceOf(alice) - aq0) + _pairedToQuoteSpot(paired.balanceOf(alice) - ap0);
        assertApproxEqRel(aliceGot, navAtSpot, 0.0001e18, "FIXED: sole holder receives the whole NAV at spot (+-0.01%)");
        assertLe(pm.totalNav(), 1e12, "no leftover NAV (rounding dust at most)");
        emit log_named_uint("liquidity before (1e18)", liqBefore / 1e18);
        emit log_named_uint("NAV owed at spot (1e18)", navAtSpot / 1e18);
        emit log_named_uint("alice received @spot (1e18)", aliceGot / 1e18);

        // A fresh depositor's round trip is value-neutral: nothing to capture, nothing lost.
        // (Absolute block baselines: on this Arbitrum fork, Foundry serves the test's `block.number` from the L1
        //  block field, so a relative `block.number + 1` re-evaluates to the same value — see report §F-05.)
        uint256 b0 = block.number;
        vm.roll(b0 + 10);
        uint256 sb = _deposit(bob, 1_000_000e18);
        vm.roll(b0 + 11);
        vm.prank(bob);
        (uint256 q, uint256 p) = pm.withdraw(sb);
        assertApproxEqAbs(q + _pairedToQuoteSpot(p), 1_000_000e18, 1e12, "bob's round trip is exact");
        assertEq(_liq(), 0, "still no stranded liquidity after the round trip");
    }

    /// F-01(b) — FIXED. Originally: Bob (a remaining holder) pumped paired in the same block as Alice's
    /// withdraw and reversed; Alice received sub-pro-rata liquidity (R/S) and Bob's claim grew by more than his
    /// swap cost. Now the exit is sized by SHARE FRACTION of liquidity (spot is only a weight), so Alice removes
    /// exactly her pro-rata slice regardless of the pump, and the pumping holder is net-NEGATIVE (fees).
    function test_F01b_remainingHolderPump_withdrawerGetsExactProRata_FIXED() public {
        if (!live) return;
        _rig();
        _addExternalLiquidity(1_500_000e18);
        // 150k each (was 100k): the depositors fund the paired leg now. Still exactly 50/50 holders.
        _deposit(alice, 150_000e18);
        _deposit(bob, 150_000e18);
        pm.deploy(200_000e18, 100_000e18, 0, 0, block.timestamp); // 200k of 300k principal at cost
        vm.roll(block.number + 1);
        // let the follower settle on 1.0 (deploy anchored it there already)

        uint256 bobWealthBefore = quote.balanceOf(bob) + paired.balanceOf(bob) + _claimOf(bob);
        uint256 aliceFairClaim = _claimOf(alice); // pro-rata at fair 1.0 (≈ 150k: 50k idle + 100k LP)
        uint128 liqBefore = _liq();

        // Same block: pump (bob) → alice withdraws → bob reverses.
        uint256 bobQ0 = quote.balanceOf(bob);
        _buyPaired(bob, 500_000e18);
        uint256 pairedBought = paired.balanceOf(bob) - 50_000_000e18;
        uint256 aq0 = quote.balanceOf(alice);
        uint256 ap0 = paired.balanceOf(alice);
        uint256 s = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(s);
        _sellPaired(bob, pairedBought);
        uint256 spotAfter = _spot();
        // price is back near 1.0 (fees only)
        assertApproxEqRel(uint256(spotAfter), uint256(SQRT_1), 0.02e18, "price restored");

        uint256 liqRemoved = liqBefore - _liq();
        // FIXED: exactly the pro-rata 50% of liquidity, pump or no pump (share fraction, not a mark).
        assertApproxEqRel(liqRemoved, uint256(liqBefore) / 2, 0.0001e18, "FIXED: alice removed exactly her 50% slice (+-0.01%)");
        uint256 aliceGot = (quote.balanceOf(alice) - aq0) + _pairedToQuoteSpot(paired.balanceOf(alice) - ap0);
        // Her slice was taken at the pumped composition; valued at the restored price it is worth at least her
        // fair LP claim (holding a snapshot composition beats the LP curve through a round trip).
        assertGe(aliceGot, aliceFairClaim * 99 / 100, "FIXED: alice receives >= ~her fair pro-rata claim");

        uint256 bobWealthAfter = quote.balanceOf(bob) + paired.balanceOf(bob) + _claimOf(bob);
        emit log_named_uint("alice fair claim (1e18)", aliceFairClaim / 1e18);
        emit log_named_uint("alice received @restored (1e18)", aliceGot / 1e18);
        emit log_named_int("bob round-trip quote P&L (1e18)", (int256(quote.balanceOf(bob)) - int256(bobQ0)) / 1e18);
        emit log_named_uint("bob wealth before (1e18)", bobWealthBefore / 1e18);
        emit log_named_uint("bob wealth after (1e18)", bobWealthAfter / 1e18);
        assertLt(bobWealthAfter, bobWealthBefore, "FIXED: the pumping remaining holder is net-NEGATIVE (fees + slippage)");
    }

    /// F-01(c) — RESIDUAL (deposit side, NATURAL crash). Spot drops below the stale reference; a depositor is
    /// priced at max(spot, ref) = the stale high, and her claim immediately after is well below what she paid.
    /// This is the deliberate deposit-side conservative mark (it protects existing holders from a cheapened
    /// entry — see `test_VS_depositAtDeflatedSpot_notCheapened`). Mitigations now in the contract: the depositor
    /// can bound it with `depositWithMin(amount, minSharesOut)` (reverts `SlippageExceeded`), and anyone can
    /// walk the stale follower onto spot beforehand with the permissionless `poke()`.
    function test_F01c_staleRefCrash_depositorOverpays() public {
        if (!live) return;
        _rig();
        _addExternalLiquidity(1_500_000e18);
        _deposit(alice, 300_000e18);
        pm.deploy(200_000e18, 100_000e18, 0, 0, block.timestamp);
        vm.roll(block.number + 1);

        _sellPaired(bob, 600_000e18); // crash, no gateway action → ref stays at 1.0
        vm.roll(block.number + 5);

        _deposit(carol, 100_000e18);
        uint256 carolClaim = _claimOf(carol); // spot-marked claim right after depositing
        emit log_named_uint("carol deposited (1e18)", 100_000);
        emit log_named_uint("carol claim right after (1e18)", carolClaim / 1e18);
        assertLt(carolClaim, 95_000e18, "F-01: depositor after a crash loses >5% to existing holders");
    }

    // ── F-02 · LP-leg / fee-sweep transfers — FIXED (best-effort self-call, idle leg always pays) ──

    /// F-02(a) — FIXED. Originally: a paused paired token (rug / issuer pause) made EVERY withdraw revert,
    /// idle quote included. Now the LP leg runs inside `try this.lpLegExit(...)`: the idle leg pays, the LP
    /// slice is re-credited as shares (`LpLegUnavailable`), and once the token un-pauses the rest is recovered.
    function test_F02a_pairedTokenPaused_idlePaysAndLpSliceReCredited_FIXED() public {
        if (!live) return;
        uint256 b0 = block.number; // absolute baselines (via-IR may CSE `block.number` across `vm.roll`)
        _rig();
        _deposit(alice, 300_000e18);
        pm.deploy(200_000e18, 100_000e18, 0, 0, block.timestamp); // idle 100k, LP 200k (100k quote + ~100k paired @1.0)
        vm.roll(b0 + 1);
        assertGt(staging.maxUnstageable(), 90_000e18, "idle quote is liquid and available");
        uint256 idle = staging.stagedAssets();
        uint256 lpVal = pm.totalNav() - idle;
        uint128 liqBefore = _liq();

        paired.setPaused(true);
        uint256 s = pm.sharesOf(alice);
        uint256 aq0 = quote.balanceOf(alice);
        vm.expectEmit(true, false, false, true, address(pm));
        emit LpLegUnavailable(alice, liqBefore); // sole holder → the whole position was requested
        vm.prank(alice);
        (uint256 q, uint256 p) = pm.withdraw(s); // FIXED: does not revert
        assertEq(q, idle, "idle leg delivered in full");
        assertEq(quote.balanceOf(alice) - aq0, idle);
        assertEq(p, 0, "no paired could be delivered");
        assertEq(_liq(), liqBefore, "LP untouched (the leg reverted atomically)");
        // Re-credit = shares × (undelivered LP claim / total claim) = s × lpVal / (idle + lpVal).
        uint256 expectedReCredit = s * lpVal / (idle + lpVal);
        assertApproxEqRel(pm.sharesOf(alice), expectedReCredit, 0.001e18, "LP slice re-credited as shares");
        assertEq(pm.totalShares(), pm.sharesOf(alice));

        // Token un-pauses → the remaining claim is fully recoverable (last holder takes the whole position).
        paired.setPaused(false);
        vm.roll(b0 + 2);
        uint256 s2 = pm.sharesOf(alice);
        vm.prank(alice);
        (uint256 q2, uint256 p2) = pm.withdraw(s2);
        assertEq(_liq(), 0, "position fully exited after un-pause");
        assertLe(pm.totalShares(), 1);
        assertApproxEqRel(q + q2 + _pairedToQuoteSpot(p2), idle + lpVal, 0.0001e18, "total recovered == full NAV");
    }

    /// F-02(b) — FIXED. Originally: the quote issuer freezing the (immutable) harvestRecipient made `_sweepFees`
    /// revert once any fee accrued, and every LP-touching withdraw reverted with it. Now the sweep runs inside
    /// the best-effort LP leg: withdraw succeeds (idle paid, LP slice re-credited, `LpLegUnavailable`). Owner
    /// `harvest` still reverts while the recipient is frozen — an operator-side residual, not a depositor brick.
    function test_F02b_harvestRecipientFrozen_withdrawStillPays_FIXED() public {
        if (!live) return;
        uint256 b0 = block.number; // absolute baselines (via-IR may CSE `block.number` across `vm.roll`)
        _rig();
        _deposit(alice, 300_000e18); // +100k: the depositor funds the paired leg since the earn-vs-lp decision
        pm.deploy(200_000e18, 100_000e18, 0, 0, block.timestamp);
        vm.roll(b0 + 1);
        _buyPaired(bob, 10_000e18); // accrue some fees
        _sellPaired(bob, 5_000e18);
        vm.roll(b0 + 2);
        uint256 idle = staging.stagedAssets();
        uint128 liqBefore = _liq();

        quote.setFrozen(RECIP, true); // Paxos-style freeze of the fee recipient
        uint256 s = pm.sharesOf(alice);
        uint256 half = s / 2;
        uint256 aq0 = quote.balanceOf(alice);
        vm.expectEmit(true, false, false, false, address(pm));
        emit LpLegUnavailable(alice, 0); // liquidity arg not checked (pro-rata slice of liqBefore)
        vm.prank(alice);
        (uint256 q, uint256 p) = pm.withdraw(half); // FIXED: does not revert
        assertGt(q, 0, "idle leg paid");
        assertApproxEqRel(q, idle * half / (s + 1e6), 0.001e18, "idle leg is the pro-rata slice");
        assertEq(quote.balanceOf(alice) - aq0, q);
        assertEq(p, 0, "LP leg unavailable -> no paired");
        assertEq(_liq(), liqBefore, "LP untouched");
        assertGt(pm.sharesOf(alice), s - half, "LP slice re-credited as shares");
        assertLt(pm.sharesOf(alice), s, "...but the served idle slice was burned");

        // Residual: owner harvest reverts while the recipient is frozen (cannot be rotated — immutable).
        vm.expectRevert(bytes("ADDRESS_FROZEN"));
        pm.harvest(block.timestamp);

        // Un-freeze → full recovery.
        quote.setFrozen(RECIP, false);
        vm.roll(b0 + 3);
        uint256 s2 = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(s2);
        assertEq(_liq(), 0, "position fully exited after un-freeze");
        assertLe(pm.totalShares(), 1);
    }

    // ── F-03 · deploy cap is on quote PRINCIPAL AT COST (by design) ─────────────────────────

    /// F-03 — RE-BASED for the earn-vs-lp decision (2026-09-08). The original answer was "the LP-exposed
    /// fraction of marked NAV exceeds MAX_DEPLOY_BPS, and that is fine, because the paired leg is OWNER capital
    /// added on top and therefore not depositor exposure." BOTH halves of that are now false: MAX_DEPLOY_BPS is
    /// 10000 (the held-back-buffer policy was deleted with the yield that justified it), and the paired leg is
    /// depositor quote that changed form through the in-contract zap, so it IS depositor exposure — the whole
    /// position is. What survives, and is the part that stops the RT-9a crash-cycle from re-opening headroom, is
    /// that `deployedPrincipal` measures the quote leg AT COST and never falls with price.
    function test_F03_deployGuard_isQuoteLegAtCost_wholePositionIsDepositorExposure() public {
        if (!live) return;
        _rig();
        _deposit(alice, 200_000e18);
        pm.deploy(200_000e18, 100_000e18, 0, 0, block.timestamp);
        uint256 nav = pm.totalNav();
        uint256 deployed = nav - staging.stagedAssets();
        emit log_named_uint("deployed bps of NAV", deployed * 10_000 / nav);
        assertGt(deployed * 10_000 / nav, 9_000, "essentially all of NAV is LP-exposed -- and all of it is depositor capital");
        assertApproxEqRel(pm.deployedPrincipal(), 100_000e18, 0.01e18, "deployedPrincipal counts only the QUOTE leg, at cost");
        // Any further deploy is blocked: with the whole principal already at work there is nothing left to pull.
        vm.roll(block.number + 1);
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployCapExceeded.selector);
        pm.deploy(200_000e18, 100_000e18, 0, 0, block.timestamp);
    }

    // ── F-04 · stale follower blocks deploy until walked ────────────────────────────────────

    /// F-04 — RESIDUAL (liveness, no loss). After a legit move with no gateway actions, deploy reverts
    /// `DeployPriceOutOfBand` until the follower is walked (one bounded step per block). This PoC walks it with
    /// owner `harvest`; since the fix the permissionless `poke()` does the same step from any address, so the
    /// walk no longer depends on an owner action.
    function test_F04_staleRef_blocksDeploy_untilWalked() public {
        if (!live) return;
        _rig();
        _addExternalLiquidity(1_500_000e18);
        _deposit(alice, 220_000e18); // +20k: the depositor funds the zapped paired leg
        pm.deploy(40_000e18, 20_000e18, 0, 0, block.timestamp); // small: 40k LP of a 220k NAV ≈ 18% LP-exposed
        vm.roll(block.number + 1);
        _buyPaired(bob, 400_000e18); // legit rally, > band
        uint256 b0 = block.number;
        vm.roll(b0 + 3);
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployPriceOutOfBand.selector);
        pm.deploy(20_000e18, 10_000e18, 0, 0, block.timestamp);
        // walk the follower with owner harvests (one step per block; absolute baselines — see F-01a note)
        uint256 steps;
        for (uint256 i; i < 12; i++) {
            vm.roll(b0 + 4 + i);
            pm.harvest(block.timestamp);
            steps++;
            (bool ok,) = address(pm).call(
                abi.encodeWithSelector(
                    pm.deploy.selector, uint256(20_000e18), uint256(10_000e18), uint256(0), uint128(0), block.timestamp
                )
            );
            if (ok) break;
        }
        emit log_named_uint("harvest steps needed before deploy was back in band", steps);
        assertGt(_liq(), 0);
        assertLt(steps, 12, "deploy eventually possible after walking the follower");
    }

    // ── Verified-sound checks ───────────────────────────────────────────────────────────────

    /// VS — Permit2 allowance to the PositionManager is zero after deploy (L-04 fix holds).
    function test_VS_permit2AllowanceRevokedAfterDeploy() public {
        if (!live) return;
        _rig();
        _deposit(alice, 300_000e18); // +100k: the depositor funds the paired leg since the earn-vs-lp decision
        pm.deploy(200_000e18, 100_000e18, 0, 0, block.timestamp);
        (uint160 aq,,) = IPermit2AllowanceView(PERMIT2).allowance(address(pm), address(quote), address(posm));
        (uint160 ap,,) = IPermit2AllowanceView(PERMIT2).allowance(address(pm), address(paired), address(posm));
        assertEq(aq, 0);
        assertEq(ap, 0);
        assertEq(quote.balanceOf(address(pm)), 0, "no quote at rest in the PM");
        assertEq(paired.balanceOf(address(pm)), 0, "no paired at rest in the PM");
    }

    /// VS — a malicious paired token cannot re-enter the gateway during `take` (nonReentrant holds).
    function test_VS_pairedTokenReentrancyBlocked() public {
        if (!live) return;
        _rig();
        _deposit(alice, 300_000e18); // +100k: the depositor funds the paired leg since the earn-vs-lp decision
        pm.deploy(200_000e18, 100_000e18, 0, 0, block.timestamp);
        vm.roll(block.number + 1);
        paired.setReenterTarget(address(pm));
        uint256 s = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(s / 2);
        assertTrue(paired.reentryAttempted(), "probe fired during take");
        assertTrue(paired.reentryBlocked(), "re-entry into deposit was rejected");
    }

    /// VS — pro-rata sourcing is price-neutral when spot ≤ ref: a dump before withdraw yields exactly the
    /// pro-rata liquidity slice (the withdrawer cannot inflate their claim by manipulating price).
    function test_VS_withdrawAtDeflatedSpot_isExactlyProRata() public {
        if (!live) return;
        _rig();
        _addExternalLiquidity(1_500_000e18);
        // 150k each: the depositors fund the paired leg. Still exactly 50/50 holders.
        _deposit(alice, 150_000e18);
        _deposit(bob, 150_000e18);
        pm.deploy(200_000e18, 100_000e18, 0, 0, block.timestamp);
        vm.roll(block.number + 1);
        uint128 liqBefore = _liq();
        _sellPaired(alice, 300_000e18); // alice dumps then withdraws
        uint256 s = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(s);
        uint256 removed = liqBefore - _liq();
        assertApproxEqRel(removed, uint256(liqBefore) / 2, 0.001e18, "exactly pro-rata liquidity");
    }

    /// VS — deposit-side max(spot, ref) mark: a same-block dump does not cheapen entry.
    function test_VS_depositAtDeflatedSpot_notCheapened() public {
        if (!live) return;
        _rig();
        _addExternalLiquidity(1_500_000e18);
        _deposit(alice, 300_000e18); // +100k: the depositor funds the paired leg since the earn-vs-lp decision
        pm.deploy(200_000e18, 100_000e18, 0, 0, block.timestamp);
        vm.roll(block.number + 1);
        uint256 navFair = pm.totalNav();
        _sellPaired(bob, 400_000e18);
        assertLt(pm.totalNav(), navFair, "spot NAV deflated (sanity)");
        uint256 sBob = _deposit(bob, 100_000e18);
        // fair shares at the un-manipulated NAV
        uint256 fairShares = 100_000e18 * (pm.totalShares() - sBob) / navFair;
        assertLe(sBob, fairShares + fairShares / 1000, "no extra shares from the dump");
    }
}
