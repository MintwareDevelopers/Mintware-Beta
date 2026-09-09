// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";
import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MockERC4626} from "../mocks/MockERC4626.sol";
import {MockHostileYieldAdapter} from "../mocks/MockHostileYieldAdapter.sol";
import {RTMintableERC20, RTBlacklistERC20, RTHookERC20, RTFeeOnTransferERC20, IRTTokenReceiver} from "./RedTeamOnchainTokens.sol";

/// @dev Attacker contract for RT-2: a depositor whose PAIRED token calls it back on receipt. Inside the
///      callback (fired from `_decreaseAndTake`'s safeTransfer, AFTER the PositionManager unlocked) it dumps
///      the paired it just received into the pool, so the `_spot()` the A-1 re-credit reads is depressed.
contract RTHookAttacker is IRTTokenReceiver {
    MintwareLpGatewayPositionManager public pm;
    PoolSwapTest public swapper;
    PoolKey public key;
    RTHookERC20 public paired;
    IERC20 public quote;
    bool public pairedIsToken0;
    bool public armed;
    uint256 public dumped;

    constructor(MintwareLpGatewayPositionManager pm_, PoolSwapTest swapper_, PoolKey memory key_, RTHookERC20 paired_, IERC20 quote_) {
        pm = pm_;
        swapper = swapper_;
        key = key_;
        paired = paired_;
        quote = quote_;
        pairedIsToken0 = Currency.unwrap(key_.currency0) == address(paired_);
        quote.approve(address(pm_), type(uint256).max);
        paired.approve(address(swapper_), type(uint256).max);
        quote.approve(address(swapper_), type(uint256).max);
        paired.registerHook(true);
    }

    function deposit(uint256 amt) external returns (uint256) {
        return pm.deposit(amt);
    }

    function attackWithdraw(uint256 shares) external returns (uint256 q, uint256 p) {
        armed = true;
        (q, p) = pm.withdraw(shares);
        armed = false;
    }

    function plainWithdraw(uint256 shares) external returns (uint256 q, uint256 p) {
        return pm.withdraw(shares);
    }

    function buyBack(uint256 quoteIn) external {
        swapper.swap(
            key,
            SwapParams({
                zeroForOne: !pairedIsToken0,
                amountSpecified: -int256(quoteIn),
                sqrtPriceLimitX96: !pairedIsToken0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function onRTTokenReceived(address from, uint256 amount) external override {
        if (!armed || msg.sender != address(paired) || from != address(pm)) return;
        armed = false; // fire once — the fee sweep goes to the recipient, this is the principal leg
        dumped = amount;
        swapper.swap(
            key,
            SwapParams({
                zeroForOne: pairedIsToken0,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: pairedIsToken0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }
}

/// @title  LP Gateway V1 — on-chain red-team (fork, real Uniswap V4 stack)
/// @notice Adversarial harness against the REAL V4 PoolManager / PositionManager on Robinhood Chain testnet.
///         Every test is named `test_RT_<n>_<scenario>_(SUCCEEDS|FAILS)`: SUCCEEDS = the attack works (the
///         asserts prove the extraction / brick / grief); FAILS = the defense held (the asserts prove it).
///         RT-2, RT-5a, RT-6a/b/c and RT-9a/b were SUCCEEDS on the first pass and flipped to FAILS after the
///         pure-pro-rata / best-effort-LP-leg / cost-basis-cap fix (2026-09-08); their asserts now prove the
///         defense while keeping the original attack script as evidence. SELF-SKIPS when `LP_FORK_RPC_URL` is unset.
///
///         Run:  LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com \
///               forge test --match-contract RedTeamOnchainFork -vv
contract RedTeamOnchainForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant RH_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 constant SQRT_1 = 79228162514264337593543950336;
    uint256 constant Q96 = 0x1000000000000000000000000;
    int24 constant TL = -22980;
    int24 constant TU = 22980;
    int24 constant FULL_TL = -887220;
    int24 constant FULL_TU = 887220;
    uint16 constant BAND = 500; // factory default (5% sqrtPrice/block ≈ 10% price)

    struct Rig {
        RTMintableERC20 quote;
        address paired;
        PoolKey key;
        bool q0;
        int24 tl;
        int24 tu;
        MockERC4626 src;
        MintwareERC4626YieldAdapter adapter;
        IYieldAdapter adapterUsed;
        MintwareLpGatewayStaging staging;
        MintwareLpGatewayPositionManager pm;
    }

    // Mirror of the PM's event so `vm.expectEmit` can match it (RT-6 FAILS proofs).
    event LpLegUnavailable(address indexed user, uint128 liquidityRequested);

    bool internal live;
    uint256 internal blk; // own block counter: via-IR may CSE `block.number` across `vm.roll`, so never roll relative to it
    IPoolManager internal poolManager;
    IPositionManager internal posm;
    PoolSwapTest internal swapper;
    PoolModifyLiquidityTest internal lpHelper;
    Rig internal g;

    address internal RECIP = address(0xFEE5);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal mallory = address(0x3A110);
    address internal walker = address(0x3A1C);
    address internal mallory2 = address(0x3A111);

    function setUp() public {
        string memory rpc = vm.envOr("LP_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            live = false;
            return;
        }
        vm.createSelectFork(rpc);
        live = true;
        blk = block.number;
        poolManager = IPoolManager(vm.envOr("LP_POOL_MANAGER", RH_POOL_MANAGER));
        posm = IPositionManager(vm.envOr("LP_POSITION_MANAGER", RH_POSITION_MANAGER));
        swapper = new PoolSwapTest(poolManager);
        lpHelper = new PoolModifyLiquidityTest(poolManager);
        _buildRig(address(0), 18, SQRT_1, TL, TU, address(0));
    }

    // ── rig ─────────────────────────────────────────────────────────────────────────────────

    /// Builds a fresh (pool + staging + PM) rig. `pairedToken == 0` → a plain 18dp mock. `adapterOverride != 0`
    /// → use that IYieldAdapter instead of the production 4626 adapter (for hostile-source scenarios).
    function _buildRig(address pairedToken, uint8 quoteDec, uint160 sqrtInit, int24 tl, int24 tu, address adapterOverride) internal {
        g.quote = new RTMintableERC20("Quote", "Q", quoteDec);
        g.paired = pairedToken == address(0) ? address(new RTMintableERC20("Paired", "P", 18)) : pairedToken;
        (address c0, address c1) =
            address(g.quote) < g.paired ? (address(g.quote), g.paired) : (g.paired, address(g.quote));
        g.q0 = c0 == address(g.quote);
        g.key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        poolManager.initialize(g.key, sqrtInit);
        g.tl = tl;
        g.tu = tu;

        if (adapterOverride == address(0)) {
            g.src = new MockERC4626(IERC20(address(g.quote)));
            g.adapter = new MintwareERC4626YieldAdapter(address(g.quote), address(g.src), address(0), address(this));
            g.adapterUsed = IYieldAdapter(address(g.adapter));
        } else {
            g.adapterUsed = IYieldAdapter(adapterOverride);
        }
        g.staging = new MintwareLpGatewayStaging(IERC20(address(g.quote)), g.adapterUsed);
        if (adapterOverride == address(0)) g.adapter.setVault(address(g.staging));
        g.pm = new MintwareLpGatewayPositionManager(
            poolManager, posm, IPermit2Minimal(PERMIT2), g.key, IERC20(address(g.quote)), tl, tu, g.staging, address(this), RECIP, BAND,
            type(uint256).max // IA-11 principal cap: uncapped -- this test predates/is unrelated to the cap
        );
        g.staging.setController(address(g.pm));

        _fund(address(this), 10_000_000 * 10 ** quoteDec, 1e32); // issuer-scale paired inventory for the dump loops

        // Earn-vs-LP decision (2026-09-08): `deploy()` sources the paired leg by swapping part of the user's
        // own quote through THIS pool, in-contract. A freshly-initialised pool has nothing to swap into, so
        // every rig needs third-party depth first — which is also the only kind of pool the gateway is ever
        // meant to target (an existing, curated, already-liquid one). Best-effort: a deliberately hostile
        // paired token (fee-on-transfer, blacklisting) may refuse to seed, and that refusal is itself the
        // scenario those tests are about.
        try lpHelper.modifyLiquidity(
            g.key, ModifyLiquidityParams({tickLower: tl, tickUpper: tu, liquidityDelta: int256(2_200_000e18), salt: 0}), ""
        ) {} catch {}
    }

    function _fund(address who, uint256 q, uint256 p) internal {
        if (q > 0) g.quote.mint(who, q);
        if (p > 0) RTMintableERC20(g.paired).mint(who, p);
        vm.startPrank(who);
        g.quote.approve(address(g.pm), type(uint256).max);
        IERC20(g.paired).approve(address(g.pm), type(uint256).max);
        g.quote.approve(address(swapper), type(uint256).max);
        IERC20(g.paired).approve(address(swapper), type(uint256).max);
        g.quote.approve(address(lpHelper), type(uint256).max);
        IERC20(g.paired).approve(address(lpHelper), type(uint256).max);
        vm.stopPrank();
    }

    /// alice deposits, owner deploys a balanced position, roll one block.
    ///
    /// Earn-vs-LP decision (2026-09-08): there is no owner-supplied paired leg any more — `deploy()` stages
    /// `dq + dp` of the USER's quote and zaps `dp` of it into the paired token through the pool. Alice
    /// therefore deposits `aliceDep + dp`, which reproduces the EXACT post-state the old owner-funded call
    /// produced (idle `aliceDep - dq`, LP `dq` quote + `dp` paired, NAV `aliceDep + dp`) — the only
    /// difference is that alice now HOLDS shares for the paired leg she funded, so her share count is
    /// `aliceDep + dp` rather than `aliceDep`.
    function _standard(uint256 aliceDep, uint256 dq, uint256 dp) internal {
        _fund(alice, aliceDep + dp, 0);
        vm.prank(alice);
        g.pm.deposit(aliceDep + dp);
        g.pm.deploy(dq + dp, dp, 0, 0, block.timestamp);
        // The zap moves spot inside the follower band before the deploy's own `_anchorFollow`, so the
        // reference lands on the POST-swap spot (it used to land on the untouched pre-deploy spot).
        assertEq(_ref(), _spot(), "storage-slot probe of _refSqrtPrice matches the deploy-time anchor");
        _roll(1);
    }

    function _roll(uint256 n) internal {
        blk += n;
        vm.roll(blk);
    }

    // ── pool helpers ────────────────────────────────────────────────────────────────────────

    function _spot() internal view returns (uint160 s) {
        (s,,,) = poolManager.getSlot0(g.key.toId());
    }

    function _ref() internal view returns (uint160) {
        // _refSqrtPrice is internal; read via vm.load. `forge inspect … storage-layout`: _owner=0, _pendingOwner=1
        // (ReentrancyGuard is transient here), _poolKey=2..4, tokenId=5, _refSqrtPrice(uint160)+_refBlock(uint64)=6.
        // `_standard` asserts the probe against the first anchor.
        // Slot 7 after `deployedPrincipal` (RT-9a fix) was added. The 2026-09-08 closeout (harvestRecipient rotation +
        // C-10 `lastKnownIdle`) APPENDED its storage after `paused` (slots 11-13) precisely so this probe stays valid —
        // verified with `forge inspect … storage-layout`; `_standard` re-asserts it against the first anchor.
        bytes32 raw = vm.load(address(g.pm), bytes32(uint256(7)));
        return uint160(uint256(raw));
    }

    /// value of `pairedAmt` in quote terms at sqrtPrice `s` (mirrors the PM's `_pairedToQuote`).
    function _p2q(uint256 pairedAmt, uint160 s) internal view returns (uint256) {
        if (pairedAmt == 0) return 0;
        if (g.q0) {
            uint256 inter = FullMath.mulDiv(pairedAmt, Q96, s);
            return FullMath.mulDiv(inter, Q96, s);
        } else {
            uint256 inter = FullMath.mulDiv(pairedAmt, s, Q96);
            return FullMath.mulDiv(inter, s, Q96);
        }
    }

    /// paired amount worth `quoteAmt` at sqrtPrice `s`.
    function _q2p(uint256 quoteAmt, uint160 s) internal view returns (uint256) {
        if (quoteAmt == 0) return 0;
        if (g.q0) {
            uint256 inter = FullMath.mulDiv(quoteAmt, s, Q96);
            return FullMath.mulDiv(inter, s, Q96);
        } else {
            uint256 inter = FullMath.mulDiv(quoteAmt, Q96, s);
            return FullMath.mulDiv(inter, Q96, s);
        }
    }

    function _worth(uint256 q, uint256 p, uint160 s) internal view returns (uint256) {
        return q + _p2q(p, s);
    }

    /// paired price (quote per 1e18 paired) at spot.
    function _pairedPrice() internal view returns (uint256) {
        return _p2q(1e18, _spot());
    }

    /// Swap exact-input as `who`. sellQuote=true → quote in, paired out (pumps paired). Returns amount out.
    function _swapAs(address who, bool sellQuote, uint256 amountIn) internal returns (uint256 out) {
        bool zeroForOne = sellQuote ? g.q0 : !g.q0;
        IERC20 tokenOut = sellQuote ? IERC20(g.paired) : IERC20(address(g.quote));
        uint256 before = tokenOut.balanceOf(who);
        vm.prank(who);
        swapper.swap(
            g.key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        out = tokenOut.balanceOf(who) - before;
    }

    function _swap(bool sellQuote, uint256 amountIn) internal returns (uint256) {
        return _swapAs(address(this), sellQuote, amountIn);
    }

    /// Third-party LP depth in the gateway's range (models "the gateway is one LP among many").
    function _addExternalLiquidity(int256 liq) internal {
        lpHelper.modifyLiquidity(
            g.key, ModifyLiquidityParams({tickLower: g.tl, tickUpper: g.tu, liquidityDelta: liq, salt: 0}), ""
        );
    }

    function _gatewayLiq() internal view returns (uint128) {
        return g.pm.tokenId() == 0 ? 0 : posm.getPositionLiquidity(g.pm.tokenId());
    }

    /// sqrtPrice deviation of spot from the follower reference, in bps of ref.
    function _devBps() internal view returns (uint256) {
        uint160 s = _spot();
        uint160 r = _ref();
        if (r == 0) return 0;
        uint256 d = s > r ? s - r : r - s;
        return (d * 10_000) / r;
    }

    /// Walk the clamped follower onto spot by calling owner `harvest` in successive blocks (anyone could
    /// do the same with a dust deposit). Returns blocks used.
    function _walkFollower(uint256 maxBlocks) internal returns (uint256 used) {
        while (_devBps() > BAND && used < maxBlocks) {
            _roll(1);
            g.pm.harvest(block.timestamp);
            used++;
        }
    }

    /// Push spot by selling `chunk` of quote (or paired) per step until the sqrtPrice deviation vs the
    /// follower reaches `targetBps`. Returns the total sold + total received.
    function _pushToDeviation(address who, bool sellQuote, uint256 chunk, uint256 targetBps)
        internal
        returns (uint256 sold, uint256 got)
    {
        for (uint256 i = 0; i < 400 && _devBps() < targetBps; i++) {
            got += _swapAs(who, sellQuote, chunk);
            sold += chunk;
        }
    }

    address internal arber = address(0xA5B);

    /// A third-party arbitrageur restores spot to `target` (within 30 bps) so NAV can be marked at a FAIR price
    /// instead of wherever the attacker's last swap left it. Sized off pool liquidity, undershooting each step.
    function _arbBack(uint160 target) internal {
        if (g.quote.balanceOf(arber) == 0) _fund(arber, 100_000_000e18, 1e32);
        for (uint256 i = 0; i < 200; i++) {
            uint160 s = _spot();
            uint256 dev = s > target ? ((s - target) * 10_000) / target : ((target - s) * 10_000) / target;
            if (dev <= 30) break;
            uint128 L = poolManager.getLiquidity(g.key.toId());
            uint256 delta = s > target ? s - target : target - s;
            uint256 amt = (FullMath.mulDiv(L, delta, Q96) * 9) / 10;
            if (amt < 1e15) amt = 1e15;
            bool zeroForOne = s > target; // selling token0 lowers sqrtPrice
            _swapAs(arber, zeroForOne == g.q0, amt);
        }
    }

    function _logQ(string memory label, uint256 v) internal pure {
        console2.log(label, v / 1e18, "(quote units)");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // 1. External LP / MEV persona
    // ═══════════════════════════════════════════════════════════════════════════════════════

    /// Deposit sandwich on a THIN pool (gateway is the only LP): pump → victim deposits → dump. The
    /// depositor is priced at max(spot, ref) = the PUMPED spot, so the conservative mark protects the pool
    /// but not the depositor; `deposit()` has no minSharesOut. Existing holders capture the dilution.
    function test_RT_1a_depositSandwich_thinPool_SUCCEEDS() public {
        if (!live) return;
        _standard(100_000e18, 50_000e18, 50_000e18); // NAV 150k = 50k idle + 100k LP; alice = 100% of shares
        _fund(bob, 100_000e18, 0);
        uint256 navFair = g.pm.totalNav();
        uint256 qBefore = g.quote.balanceOf(address(this));
        uint256 pBefore = IERC20(g.paired).balanceOf(address(this));

        // (1) pump: buy paired with 30k quote (same block as the victim's deposit)
        uint256 pGot = _swap(true, 30_000e18);
        uint256 navPumped = g.pm.totalNav();
        // (2) victim deposit at the pumped NAV
        vm.prank(bob);
        uint256 sBob = g.pm.deposit(100_000e18);
        // (3) dump: sell exactly the paired bought → price back near fair; attacker's only cost = fees + residual slippage
        _swap(false, pGot);
        uint256 cost = qBefore - g.quote.balanceOf(address(this));
        assertEq(IERC20(g.paired).balanceOf(address(this)), pBefore, "paired inventory fully unwound");

        // evaluate: bob exits next block at ~fair spot
        _roll(1);
        uint160 s = _spot();
        vm.prank(bob);
        (uint256 q, uint256 p) = g.pm.withdraw(sBob);
        uint256 bobValue = _worth(q, p, s);
        uint256 bobLoss = 100_000e18 - bobValue;
        uint256 aliceValue = g.pm.totalNav(); // alice is the sole remaining holder
        uint256 aliceGain = aliceValue > navFair ? aliceValue - navFair : 0;

        _logQ("navFair", navFair);
        _logQ("navPumped", navPumped);
        _logQ("attacker round-trip cost", cost);
        _logQ("victim (bob) loss", bobLoss);
        _logQ("holder (alice) gain", aliceGain);
        console2.log("loss/cost ratio x", bobLoss / (cost == 0 ? 1 : cost));

        assertGt(navPumped, (navFair * 120) / 100, "pump inflated deposit NAV by >20%");
        assertGt(bobLoss, 10_000e18, "victim lost >10% of a 100k deposit");
        assertGt(aliceGain, cost * 20, "existing holder captured >20x the attacker's fee cost");
    }

    /// The depositor-side mitigation for RT-1a: `depositWithMin(amount, minSharesOut)`. Bob quotes his shares
    /// at the FAIR NAV before the block and asks for >= 99% of them; the pumped mark would mint fewer, so the
    /// deposit reverts `SlippageExceeded` and the sandwich has nothing to bite. FAILS. Off the pump (next
    /// block, price restored) the SAME floor is met and the deposit goes through.
    function test_RT_1a_depositSandwich_depositWithMin_blocks_FAILS() public {
        if (!live) return;
        _standard(100_000e18, 50_000e18, 50_000e18); // NAV 150k = 50k idle + 100k LP; alice = 100% of shares
        _fund(bob, 100_000e18, 0);
        uint256 navFair = g.pm.totalNav();
        // shares = assets * (totalShares + VIRTUAL) / (nav + VIRTUAL) — bob's fair quote, 1% tolerance
        uint256 fairShares = FullMath.mulDiv(100_000e18, g.pm.totalShares() + 1e6, navFair + 1e6);
        uint256 minShares = (fairShares * 99) / 100;

        uint256 pGot = _swap(true, 30_000e18); // (1) pump
        assertGt(g.pm.totalNav(), (navFair * 120) / 100, "pump inflated deposit NAV by >20% (sanity, as RT-1a)");
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.SlippageExceeded.selector);
        g.pm.depositWithMin(100_000e18, minShares); // (2) victim's floor rejects the pumped mark
        _swap(false, pGot); // (3) attacker unwinds — paid fees for nothing
        assertEq(g.pm.sharesOf(bob), 0, "no shares minted at the pumped price");

        _roll(1);
        _arbBack(SQRT_1); // price back to fair
        vm.prank(bob);
        uint256 sBob = g.pm.depositWithMin(100_000e18, minShares);
        assertGe(sBob, minShares, "same floor clears at the fair price");
        console2.log("fair shares", fairShares / 1e18, "minted off-pump", sBob / 1e18);
    }

    /// Same attack with 10x third-party depth in range: the pump costs more and inflates less, but is still
    /// strongly profitable at 0.30% fee — depth reduces, does not remove, the exposure.
    function test_RT_1a_depositSandwich_deepPool10x_SUCCEEDS() public {
        if (!live) return;
        _standard(100_000e18, 50_000e18, 50_000e18);
        _addExternalLiquidity(int256(uint256(_gatewayLiq())) * 10);
        _fund(bob, 100_000e18, 0);
        uint256 navFair = g.pm.totalNav();
        uint256 qBefore = g.quote.balanceOf(address(this));

        uint256 pGot = _swap(true, 300_000e18); // 10x the capital for a comparable move
        uint256 navPumped = g.pm.totalNav();
        vm.prank(bob);
        uint256 sBob = g.pm.deposit(100_000e18);
        _swap(false, pGot);
        uint256 cost = qBefore - g.quote.balanceOf(address(this));

        _roll(1);
        uint160 s = _spot();
        vm.prank(bob);
        (uint256 q, uint256 p) = g.pm.withdraw(sBob);
        uint256 bobLoss = 100_000e18 - _worth(q, p, s);
        uint256 aliceGain = g.pm.totalNav() - navFair;

        _logQ("navFair", navFair);
        _logQ("navPumped", navPumped);
        _logQ("attacker round-trip cost (10x depth)", cost);
        _logQ("victim loss", bobLoss);
        _logQ("holder gain", aliceGain);
        assertGt(bobLoss, 10_000e18, "still >10% victim loss with 10x depth");
        assertGt(aliceGain, cost * 3, "still >3x profit over fee cost");
    }

    /// No mempool needed: pump, HOLD for blocks (the follower walks toward the pump; deposit is priced at
    /// max(spot, ref) = spot anyway), any depositor in the window is diluted, then unwind.
    function test_RT_1e_heldPump_noMempool_dilutesLaterDeposit_SUCCEEDS() public {
        if (!live) return;
        _standard(100_000e18, 50_000e18, 50_000e18);
        _fund(bob, 100_000e18, 0);
        uint256 navFair = g.pm.totalNav();
        uint256 qBefore = g.quote.balanceOf(address(this));

        uint256 pGot = _swap(true, 30_000e18);
        _roll(3); // victim shows up three blocks later — no front-running involved
        vm.prank(bob);
        uint256 sBob = g.pm.deposit(100_000e18);
        _swap(false, pGot);
        uint256 cost = qBefore - g.quote.balanceOf(address(this));

        _roll(1);
        uint160 s = _spot();
        vm.prank(bob);
        (uint256 q, uint256 p) = g.pm.withdraw(sBob);
        uint256 bobLoss = 100_000e18 - _worth(q, p, s);
        _logQ("victim loss (held pump)", bobLoss);
        _logQ("attacker cost", cost);
        assertGt(bobLoss, 10_000e18, "held pump dilutes a later deposit just the same");
        assertGt(g.pm.totalNav(), navFair + cost * 20, "holder gain >> cost");
    }

    /// Withdraw sandwich (dump → victim withdraws → pump back): FAILS. Pro-rata liquidity sourcing means the
    /// victim receives their exact share of the position at whatever composition — worth at least fair
    /// once the price is restored (holding beats LP through a round trip).
    function test_RT_1b_withdrawSandwich_dumpVictimPump_FAILS() public {
        if (!live) return;
        _fund(bob, 100_000e18, 0);
        vm.prank(bob);
        uint256 sBob = g.pm.deposit(100_000e18);
        _standard(100_000e18, 50_000e18, 50_000e18); // NAV 250k / 250k shares (alice funded the paired leg herself)
        uint256 fairBob = (g.pm.totalNav() * sBob) / g.pm.totalShares();

        uint256 pBefore = IERC20(g.paired).balanceOf(address(this));
        uint256 qGot = _swap(false, 30_000e18); // dump paired
        vm.prank(bob);
        (uint256 q, uint256 p) = g.pm.withdraw(sBob);
        _swap(true, qGot); // buy back with the same quote → quote-neutral, the loss shows up as missing paired
        uint160 s = _spot();
        uint256 attackerCost = _p2q(pBefore - IERC20(g.paired).balanceOf(address(this)), s);
        uint256 bobValue = _worth(q, p, s);
        _logQ("bob fair", fairBob);
        _logQ("bob got (valued at restored spot)", bobValue);
        _logQ("attacker cost", attackerCost);
        assertGe(bobValue, (fairBob * 995) / 1000, "victim withdrawer not shortchanged by the sandwich");
    }

    /// Two-address bypass of the same-block guard (A deposits, B — a holder — withdraws in one block, with a
    /// pump in between): FAILS. Deposit at max(spot,ref) overpays, withdraw is pro-rata → the attacker's
    /// combined position never exceeds what they put in.
    function test_RT_1c_twoAddressSameBlockRoundTrip_FAILS() public {
        if (!live) return;
        _fund(mallory, 100_000e18, 0);
        vm.prank(mallory);
        uint256 sM = g.pm.deposit(100_000e18); // holder leg (B)
        _standard(100_000e18, 50_000e18, 50_000e18); // NAV 250k / 250k shares (alice funded the paired leg herself)
        uint256 fairM = (g.pm.totalNav() * sM) / g.pm.totalShares();
        _fund(mallory2, 100_000e18, 0);

        uint256 qBefore = g.quote.balanceOf(address(this));
        uint256 pGot = _swap(true, 20_000e18); // pump
        vm.prank(mallory2);
        uint256 sM2 = g.pm.deposit(100_000e18); // A deposits at pumped NAV
        vm.prank(mallory);
        (uint256 q1, uint256 p1) = g.pm.withdraw(sM); // B withdraws same block
        _swap(false, pGot);
        uint256 cost = qBefore - g.quote.balanceOf(address(this));

        _roll(1);
        vm.prank(mallory2);
        (uint256 q2, uint256 p2) = g.pm.withdraw(sM2);
        uint160 s = _spot();
        uint256 totalOut = _worth(q1 + q2, p1 + p2, s);
        uint256 totalIn = fairM + 100_000e18;
        _logQ("attacker in (fair)", totalIn);
        _logQ("attacker out", totalOut);
        _logQ("swap cost", cost);
        assertLt(totalOut, totalIn, "no gain from bypassing the same-block guard with two addresses");
    }

    /// Multi-block follower walk then withdraw: pump 2x, hold ~15 blocks so the follower converges onto the
    /// pumped price (min(spot,ref) == spot), withdraw everything, unwind. FAILS: pro-rata sourcing hands the
    /// attacker exactly their share of liquidity at the pumped composition (mostly quote) — the round trip
    /// costs fees + slippage and extracts nothing from the idle reserve or other holders.
    function test_RT_1d_followerWalk_pumpHoldWithdraw_FAILS() public {
        if (!live) return;
        _fund(mallory, 200_000e18, 0);
        vm.prank(mallory);
        uint256 sM = g.pm.deposit(100_000e18);
        _standard(100_000e18, 50_000e18, 50_000e18); // NAV 250k / 250k shares (alice funded the paired leg herself)
        uint256 fairM = (g.pm.totalNav() * sM) / g.pm.totalShares();
        uint256 fairA = (g.pm.totalNav() * g.pm.sharesOf(alice)) / g.pm.totalShares();

        uint256 mQ0 = g.quote.balanceOf(mallory);
        uint256 pGot = _swapAs(mallory, true, 30_000e18); // pump
        uint256 blocks = _walkFollower(40);
        console2.log("blocks to walk follower onto pump", blocks);
        assertLe(_devBps(), BAND, "follower converged onto the pumped price");

        vm.prank(mallory);
        (, uint256 p) = g.pm.withdraw(sM);
        _swapAs(mallory, false, pGot + p); // unwind everything to quote
        // mQ0 = her quote AFTER depositing 100k; what she netted from the shares = (quote now − mQ0)
        uint256 nettedFromShares = g.quote.balanceOf(mallory) - mQ0;
        _arbBack(SQRT_1); // her unwind overshot on the thinned pool; a third party restores fair so alice's mark is honest
        _logQ("mallory fair claim", fairM);
        _logQ("mallory netted from shares after pump/walk/withdraw/unwind", nettedFromShares);
        _logQ("alice fair", fairA);
        _logQ("alice remaining NAV (at restored fair price)", g.pm.totalNav());
        assertLt(nettedFromShares, fairM, "attacker ends below her fair claim");
        assertGe(g.pm.totalNav(), (fairA * 99) / 100, "alice's remaining value intact (>=99% fair)");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // 2. A-1 re-credit abuse
    // ═══════════════════════════════════════════════════════════════════════════════════════

    /// A paired token with a receive-hook (ERC777-style / malicious meme): the callback fires from
    /// `_decreaseAndTake`'s transfer to the withdrawer, AFTER the PositionManager unlocked, so the attacker
    /// dumps the paired leg it just received mid-exit. First pass: the A-1 path valued `delivered` at the
    /// DEPRESSED `_spot()` while `claimValue` was pre-dump → shares RE-CREDITED after full delivery (SUCCEEDS).
    /// FAILS now: spot is read ONCE before any external call and used only as a weight, so the mid-exit dump
    /// cannot move the re-credit — zero shares re-credited, and the attacker ends BELOW fair (dump fees).
    function test_RT_2_hookPaired_reCreditAfterFullDelivery_FAILS() public {
        if (!live) return;
        RTHookERC20 hook = new RTHookERC20("HookMeme", "HM", 18);
        _buildRig(address(hook), 18, SQRT_1, TL, TU, address(0));
        RTHookAttacker atk = new RTHookAttacker(g.pm, swapper, g.key, hook, IERC20(address(g.quote)));
        _fund(address(atk), 100_000e18, 0);
        atk.deposit(100_000e18);
        _standard(100_000e18, 50_000e18, 50_000e18); // alice 150k, atk 100k, LP 100k, idle 150k → NAV 250k
        uint256 sAtk = g.pm.sharesOf(address(atk));
        uint256 fairAtk = (g.pm.totalNav() * sAtk) / g.pm.totalShares();
        uint128 liqBefore = _gatewayLiq();
        uint160 spotBefore = _spot();
        uint256 pairedPriceBefore = _pairedPrice();

        (uint256 q, uint256 p) = atk.attackWithdraw(sAtk);
        assertGt(atk.dumped(), 0, "the hook fired and dumped the paired leg mid-exit (attack executed)");
        assertLt(_pairedPrice(), pairedPriceBefore, "the paired price was depressed inside the exit");
        uint256 reCredited = g.pm.sharesOf(address(atk));
        console2.log("shares withdrawn", sAtk / 1e18);
        console2.log("shares re-credited after full delivery (wei)", reCredited);
        assertEq(reCredited, 0, "FAILS: zero re-credit - delivery valued at the cached pre-dump spot");
        assertApproxEqRel(liqBefore - _gatewayLiq(), uint256(liqBefore) / 2, 0.0001e18, "exactly her 50% liquidity slice");
        assertGe(q + _p2q(p, spotBefore), (fairAtk * 999) / 1000, "delivered == fair at the cached spot");

        // the paired it received was dumped inside the callback → it now holds quote; buy the paired back so
        // the attacker's inventory is comparable, then value everything at the restored spot
        uint256 quoteFromDump = g.quote.balanceOf(address(atk)) - q;
        atk.buyBack(quoteFromDump);
        _roll(1);
        uint160 s = _spot();
        uint256 worth = _worth(g.quote.balanceOf(address(atk)), IERC20(g.paired).balanceOf(address(atk)), s);
        _logQ("attacker fair claim", fairAtk);
        _logQ("attacker ended with", worth);
        assertLe(worth, fairAtk, "attacker nets nothing over fair (paid two swap fees for the dump)");
    }

    /// Control: with a plain ERC20 paired token the re-credit is dust-only (floor rounding) — no callback
    /// surface exists, so `delivered` is valued at the same spot the removal was sized at. FAILS.
    function test_RT_2b_plainPaired_reCreditIsDustOnly_FAILS() public {
        if (!live) return;
        _standard(100_000e18, 50_000e18, 50_000e18);
        uint256 s0 = g.pm.sharesOf(alice);
        vm.prank(alice);
        g.pm.withdraw(s0 / 2);
        uint256 reCredit = g.pm.sharesOf(alice) - (s0 - s0 / 2);
        console2.log("re-credit on a healthy half-exit (wei of shares)", reCredit);
        assertLt(reCredit, 1e6, "re-credit is rounding dust only");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // 3. Deploy path
    // ═══════════════════════════════════════════════════════════════════════════════════════

    /// Sandwich the owner's deploy INSIDE the 5% band (push spot ~4.8%, let the deploy mint at that
    /// composition, reverse against the deeper pool). SUCCEEDS but marginal: the attacker nets a few quote on
    /// a 20k deploy — the band bounds the mis-pricing to a fraction of a percent of the deployed amount, and
    /// the cron's `minLiquidity` (not exercised here, passed as 0) narrows it further. Low.
    function test_RT_3a_deploySandwichWithinBand_marginal_SUCCEEDS() public {
        if (!live) return;
        _standard(100_000e18, 20_000e18, 20_000e18); // 40k LP / 120k NAV — room for another deploy
        _fund(mallory, 1_000_000e18, 1_000_000e18);
        uint256 navBefore = g.pm.totalNav();
        uint256 mQ = g.quote.balanceOf(mallory);
        (uint256 sold, uint256 got) = _pushToDeviation(mallory, true, 200e18, 450);
        console2.log("deviation bps before deploy", _devBps());
        assertLe(_devBps(), BAND, "inside the band, deploy will pass");
        g.pm.deploy(20_000e18, 10_000e18, 0, 0, block.timestamp); // owner deploy lands at the pushed price
        _swapAs(mallory, false, got); // reverse
        int256 pnl = int256(g.quote.balanceOf(mallory)) - int256(mQ);
        console2.log("attacker PnL (quote wei, negative = loss)", pnl);
        console2.log("sold in the push (quote)", sold / 1e18);
        _logQ("NAV before", navBefore);
        _logQ("NAV after sandwich (the zapped 10k is the depositor's own quote)", g.pm.totalNav());
        assertGt(pnl, 0, "in-band deploy sandwich is (barely) profitable at 30 bps");
        assertLt(pnl, int256(20_000e18) / 500, "...but bounded to <20 bps of the 20k deployed by the band");
    }

    /// Griefing: push spot >5% right before each deploy attempt → `DeployPriceOutOfBand`. SUCCEEDS as a
    /// cheap DoS (fees only), but every fee goes to the pool's LPs — including the gateway's own position.
    function test_RT_3b_deployPriceBandDoS_cheapPerBlock_SUCCEEDS() public {
        if (!live) return;
        _standard(100_000e18, 20_000e18, 20_000e18);
        _fund(mallory, 1_000_000e18, 1_000_000e18);
        uint256 mQ = g.quote.balanceOf(mallory);
        uint256 blocked;
        for (uint256 i = 0; i < 3; i++) {
            (, uint256 got) = _pushToDeviation(mallory, true, 200e18, BAND + 60);
            vm.expectRevert(MintwareLpGatewayPositionManager.DeployPriceOutOfBand.selector);
            g.pm.deploy(20_000e18, 10_000e18, 0, 0, block.timestamp);
            blocked++;
            _swapAs(mallory, false, got);
            _roll(1);
        }
        uint256 cost = mQ - g.quote.balanceOf(mallory);
        console2.log("deploys blocked", blocked);
        _logQ("griefer total cost for 3 blocks", cost);
        assertEq(blocked, 3);
        assertLt(cost, 500e18, "griefing 3 deploy attempts cost the attacker < 500 quote");
        // and the owner deploys fine the moment the griefer stops
        g.pm.deploy(20_000e18, 10_000e18, 0, 0, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // 4. Dust / drained states
    // ═══════════════════════════════════════════════════════════════════════════════════════

    /// Exact-zero drain (idle short → whole LP removed) leaves tokenId != 0, liq == 0 and a STALE follower.
    /// If the pool then moves 50%, the next deploy reverts out-of-band — but the follower can be walked in
    /// a handful of blocks and everything recovers. FAILS (no brick).
    function test_RT_4_drainedPositionStaleFollower_recoverable_FAILS() public {
        if (!live) return;
        _standard(100_000e18, 50_000e18, 50_000e18);
        _addExternalLiquidity(int256(uint256(_gatewayLiq())) * 4); // so the pool has depth after the drain
        g.adapter.setPerBlockWithdrawCap(10_000e18);
        uint256 s = g.pm.sharesOf(alice);
        vm.prank(alice);
        g.pm.withdraw(s);
        assertEq(_gatewayLiq(), 0, "exact-zero LP");
        g.adapter.setPerBlockWithdrawCap(0);
        _roll(1);
        // price moves 50%+ while the gateway is idle-only
        _swap(true, 200_000e18);
        _roll(1);
        _fund(alice, 100_000e18, 0);
        vm.prank(alice);
        g.pm.deposit(100_000e18);
        _roll(1);
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployPriceOutOfBand.selector);
        g.pm.deploy(40_000e18, 20_000e18, 0, 0, block.timestamp);
        uint256 used = _walkFollower(60);
        console2.log("blocks to re-anchor after the drain", used);
        g.pm.deploy(40_000e18, 20_000e18, 0, 0, block.timestamp);
        assertGt(_gatewayLiq(), 0, "redeployed after walking the follower");
        _roll(1);
        g.pm.harvest(block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // 5. Adapter / source adversary
    // ═══════════════════════════════════════════════════════════════════════════════════════

    /// Yield source paused with a live LP leg. First pass: the FIRST withdrawer's idle shortfall was pushed
    /// onto the LP, so she exited with the ENTIRE position while later holders were left 100% in the paused
    /// reserve (SUCCEEDS as a first-mover liveness advantage). FAILS now: each leg is sourced by SHARE FRACTION
    /// and re-credited independently — she removes exactly her pro-rata liquidity, the unserved idle comes
    /// back as shares, and the second holder's LP slice is still there for her.
    function test_RT_5a_sourcePaused_firstMoverTakesWholeLP_FAILS() public {
        if (!live) return;
        _fund(mallory, 100_000e18, 0);
        vm.prank(mallory);
        uint256 sM = g.pm.deposit(100_000e18);
        // Earn-vs-lp decision: alice deposits 150k (she funds the zapped paired leg), so the state is the SAME
        // -- NAV 250k = idle 150k + LP 100k -- but the share split is mallory 100k / alice 150k, i.e. 40/60
        // rather than 50/50. Every claim below is therefore pinned to the share fraction, not to "half".
        _standard(100_000e18, 50_000e18, 50_000e18); // NAV 250k: idle 150k, LP 100k; mallory 40% / alice 60%
        uint128 liqBefore = _gatewayLiq();
        uint256 tsBefore = g.pm.totalShares();
        uint256 idle = g.staging.stagedAssets();
        uint256 lpVal = g.pm.totalNav() - idle;
        g.src.setFailWithdrawals(true); // paused Morpho

        vm.prank(mallory);
        (uint256 q, uint256 p) = g.pm.withdraw(sM);
        uint160 s = _spot();
        _logQ("first mover took (LP only, idle frozen)", _worth(q, p, s));
        assertApproxEqRel(
            liqBefore - _gatewayLiq(),
            FullMath.mulDiv(liqBefore, sM, tsBefore + 1e6),
            0.0001e18,
            "FAILS: exactly her pro-rata slice of the LP (+-0.01%)"
        );
        // re-credit = shares x (unserved idle claim / total claim) = sM x (idle/2) / (idle/2 + lp/2) = sM x idle/(idle+lp)
        uint256 expectedReCredit = FullMath.mulDiv(sM, idle, idle + lpVal);
        assertApproxEqRel(g.pm.sharesOf(mallory), expectedReCredit, 0.001e18, "re-credited for the idle shortfall only (A-1)");

        // alice, next block, source still paused: her LP slice is still there — she gets her pro-rata share of
        // what remains (the LP is not gone), and is re-credited for her idle slice.
        _roll(1);
        uint128 liqMid = _gatewayLiq();
        uint256 stagedMid = g.staging.stagedAssets();
        uint256 sA = g.pm.sharesOf(alice);
        uint256 tsMid = g.pm.totalShares();
        vm.prank(alice);
        (uint256 qa, uint256 pa) = g.pm.withdraw(sA);
        assertEq(g.staging.stagedAssets(), stagedMid, "no idle can be served while the source is paused");
        assertGt(pa, 0, "...but her LP slice is served (both legs of it)");
        assertApproxEqAbs(qa, _p2q(pa, s), 1e12, "qa is the quote leg of the LP slice, not idle (balanced @1.0)");
        assertApproxEqRel(liqMid - _gatewayLiq(), FullMath.mulDiv(liqMid, sA, tsMid + 1e6), 0.0001e18, "alice removes her pro-rata slice of what is left");
        assertGt(g.pm.sharesOf(alice), 0, "alice keeps shares for her unserved idle");

        // unpause → both recover their idle from the reserve; nothing was taken from either by the other
        g.src.setFailWithdrawals(false);
        _roll(1);
        sA = g.pm.sharesOf(alice);
        vm.prank(alice);
        (uint256 qb, uint256 pb) = g.pm.withdraw(sA);
        _roll(1);
        uint256 sM2 = g.pm.sharesOf(mallory);
        vm.prank(mallory);
        (uint256 qm, uint256 pm2) = g.pm.withdraw(sM2);
        uint256 aliceTotal = _worth(qa + qb, pa + pb, s);
        uint256 malTotal = _worth(q + qm, p + pm2, s);
        _logQ("alice total recovered", aliceTotal);
        _logQ("mallory total recovered", malTotal);
        // 60/40 on a 250k NAV: alice put in 150k and gets 150k, mallory put in 100k and gets 100k. Nobody's
        // entry order changed anybody's outcome, which is the whole claim.
        assertApproxEqRel(aliceTotal, 150_000e18, 0.001e18, "alice's value preserved (exactly her 150k deposit)");
        assertApproxEqRel(malTotal, 100_000e18, 0.001e18, "first mover got exactly her share, no more");
        assertLe(g.pm.totalShares(), 1);
    }

    /// An OVER-REPORTING idle source (phantom `totalAssets`) lets a withdrawer pull real LP principal from
    /// co-depositors: claim is pro-rata of the phantom NAV, the idle serves what it actually has, and the
    /// shortfall is sourced from the LP. SUCCEEDS only against a lying source — Morpho does not do this; a
    /// curator-selected 4626 that does is a direct theft vector.
    function test_RT_5c_overReportingSource_drainsLPFromCoDepositors_SUCCEEDS() public {
        if (!live) return;
        // a rig whose staging uses the hostile adapter (it holds raw quote, so the quote must exist first)
        RTMintableERC20 q = new RTMintableERC20("Quote", "Q", 18);
        MockHostileYieldAdapter hostile = new MockHostileYieldAdapter(address(q));
        address paired = address(new RTMintableERC20("Paired", "P", 18));
        (address c0, address c1) = address(q) < paired ? (address(q), paired) : (paired, address(q));
        g.quote = q;
        g.paired = paired;
        g.q0 = c0 == address(q);
        g.key = PoolKey({currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        poolManager.initialize(g.key, SQRT_1);
        g.tl = TL;
        g.tu = TU;
        g.adapterUsed = IYieldAdapter(address(hostile));
        g.staging = new MintwareLpGatewayStaging(IERC20(address(q)), g.adapterUsed);
        g.pm = new MintwareLpGatewayPositionManager(
            poolManager, posm, IPermit2Minimal(PERMIT2), g.key, IERC20(address(q)), TL, TU, g.staging, address(this), RECIP, BAND,
            type(uint256).max // IA-11 principal cap: uncapped -- this test predates/is unrelated to the cap
        );
        g.staging.setController(address(g.pm));
        _fund(address(this), 10_000_000e18, 10_000_000e18);

        _fund(mallory, 100_000e18, 0);
        vm.prank(mallory);
        uint256 sM = g.pm.deposit(100_000e18);
        _standard(100_000e18, 50_000e18, 50_000e18); // idle 150k (real), LP 100k, NAV 250k, 250k shares
        uint256 fairM = (g.pm.totalNav() * sM) / g.pm.totalShares();
        hostile.setReportedExtra(150_000e18); // source now claims 300k idle → NAV 400k
        vm.prank(mallory);
        (uint256 qq, uint256 pp) = g.pm.withdraw(sM);
        uint160 s = _spot();
        uint256 got = _worth(qq, pp, s);
        _logQ("mallory fair", fairM);
        _logQ("mallory got vs a lying source", got);
        _logQ("alice left with (real idle + LP, phantom excluded)", g.quote.balanceOf(address(hostile)) + (g.pm.totalNav() - g.staging.stagedAssets()));
        assertGt(got, fairM + 40_000e18, "withdrawer took >40k of co-depositor principal via the phantom NAV");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // 6. Token adversary (paired token controlled by a hostile deployer)
    // ═══════════════════════════════════════════════════════════════════════════════════════

    /// Paired token blacklists the gateway PM. First pass: EVERY withdraw reverted — the idle (Morpho) leg
    /// included — because any withdraw with a live LP routed through `_sweepFees`/`_decreaseAndTake`
    /// (TAKE_PAIR → the paired transfer to the PM reverts) (SUCCEEDS: full freeze). FAILS now: the LP leg is a
    /// best-effort self-call — the idle leg pays, `LpLegUnavailable` fires, the LP slice is re-credited as
    /// shares, and after un-blacklisting the rest is recovered. Residuals: owner harvest/deploy still revert
    /// while blacklisted (operator-side, no depositor loss), and deposits are still accepted unless the owner
    /// pauses (`setPaused`).
    function test_RT_6a_blacklistPairedFreezesPM_allWithdrawsBrick_FAILS() public {
        if (!live) return;
        RTBlacklistERC20 meme = new RTBlacklistERC20("Meme", "MEME", 18);
        _buildRig(address(meme), 18, SQRT_1, TL, TU, address(0));
        _standard(100_000e18, 50_000e18, 50_000e18);
        _swap(true, 2_000e18);
        _swap(false, 2_000e18); // some fees accrue (so the zero-amount TAKE skip doesn't mask the sweep path)
        uint256 idle = g.staging.stagedAssets();
        uint256 lpVal = g.pm.totalNav() - idle;
        uint128 liqBefore = _gatewayLiq();
        meme.setBlacklisted(address(g.pm), true);

        uint256 s = g.pm.sharesOf(alice);
        vm.expectEmit(true, false, false, true, address(g.pm));
        emit LpLegUnavailable(alice, liqBefore); // sole holder → the whole position was requested
        vm.prank(alice);
        (uint256 q, uint256 p) = g.pm.withdraw(s); // FAILS (attack): does not revert
        assertEq(q, idle, "idle (Morpho) leg delivered in full");
        assertEq(p, 0, "LP leg unavailable");
        assertEq(_gatewayLiq(), liqBefore, "LP untouched - the leg reverted atomically");
        assertApproxEqRel(g.pm.sharesOf(alice), FullMath.mulDiv(s, lpVal, idle + lpVal), 0.01e18, "LP slice re-credited as shares");
        // residuals: owner ops revert while the PM is blacklisted; deposits still accepted (owner should pause)
        vm.expectRevert();
        g.pm.harvest(block.timestamp);
        vm.expectRevert();
        g.pm.deploy(2_000e18, 1_000e18, 0, 0, block.timestamp);
        _fund(bob, 10_000e18, 0);
        vm.prank(bob);
        uint256 sBob = g.pm.deposit(10_000e18);
        assertGt(sBob, 0, "residual: deposits still accepted while the LP leg is unavailable");

        // un-blacklist → alice recovers her LP slice (bob is now a co-holder, so pro-rata, not last-holder)
        meme.setBlacklisted(address(g.pm), false);
        _roll(1);
        uint256 s2 = g.pm.sharesOf(alice);
        vm.prank(alice);
        (uint256 q2, uint256 p2) = g.pm.withdraw(s2);
        uint160 sp = _spot();
        uint256 aliceTotal = _worth(q + q2, p + p2, sp);
        _logQ("alice total recovered", aliceTotal);
        assertApproxEqRel(aliceTotal, idle + lpVal, 0.01e18, "alice's full claim recovered once the token relents");
        assertEq(g.pm.sharesOf(alice), 0);
    }

    /// Paired token blacklists the harvestRecipient. First pass: once any paired fee accrued, `_sweepFees`
    /// reverted on the recipient transfer → withdraw / harvest / deploy all reverted (SUCCEEDS: freeze via the
    /// immutable recipient). FAILS now: the sweep runs inside the best-effort LP leg, so withdraw pays the idle
    /// leg and re-credits the LP slice (`LpLegUnavailable`). Harvest still reverts (operator residual).
    function test_RT_6b_blacklistHarvestRecipient_bricksExitsOnceFeesAccrue_FAILS() public {
        if (!live) return;
        RTBlacklistERC20 meme = new RTBlacklistERC20("Meme", "MEME", 18);
        _buildRig(address(meme), 18, SQRT_1, TL, TU, address(0));
        _standard(100_000e18, 50_000e18, 50_000e18);
        _swap(true, 2_000e18);
        _swap(false, 2_000e18); // both-side fees accrue
        uint256 idle = g.staging.stagedAssets();
        uint128 liqBefore = _gatewayLiq();
        meme.setBlacklisted(RECIP, true);
        uint256 s = g.pm.sharesOf(alice);
        vm.expectEmit(true, false, false, true, address(g.pm));
        emit LpLegUnavailable(alice, liqBefore);
        vm.prank(alice);
        (uint256 q, uint256 p) = g.pm.withdraw(s); // FAILS (attack): does not revert
        assertEq(q, idle, "idle leg delivered");
        assertEq(p, 0);
        assertEq(_gatewayLiq(), liqBefore, "LP untouched");
        assertGt(g.pm.sharesOf(alice), 0, "LP slice re-credited");
        vm.expectRevert();
        g.pm.harvest(block.timestamp); // residual: owner harvest reverts while the recipient is blacklisted
        meme.setBlacklisted(RECIP, false);
        _roll(1);
        uint256 s2 = g.pm.sharesOf(alice);
        vm.prank(alice);
        (, uint256 p2) = g.pm.withdraw(s2); // recovers the LP slice once the token admin relents
        assertGt(p2, 0);
        assertEq(_gatewayLiq(), 0, "position fully exited");
        assertLe(g.pm.totalShares(), 1);
    }

    /// Paired token blacklists ONE depositor. First pass: that depositor could never withdraw — not even their
    /// idle share (SUCCEEDS: targeted freeze). FAILS now: the idle leg pays (the quote token is not the meme),
    /// the LP slice is re-credited, others are unaffected, and un-blacklisting recovers the rest.
    function test_RT_6c_blacklistSingleDepositor_targetedFreeze_FAILS() public {
        if (!live) return;
        RTBlacklistERC20 meme = new RTBlacklistERC20("Meme", "MEME", 18);
        _buildRig(address(meme), 18, SQRT_1, TL, TU, address(0));
        _fund(bob, 100_000e18, 0);
        vm.prank(bob);
        uint256 sBob = g.pm.deposit(100_000e18);
        _standard(100_000e18, 50_000e18, 50_000e18); // idle 150k, LP 100k, NAV 250k; alice 60% (she funds the zap) / bob 40%
        uint256 idle = g.staging.stagedAssets();
        uint256 lpVal = g.pm.totalNav() - idle;
        uint128 liqBefore = _gatewayLiq();
        meme.setBlacklisted(alice, true);
        uint256 sA = g.pm.sharesOf(alice);
        uint256 ts = g.pm.totalShares();
        vm.expectEmit(true, false, false, false, address(g.pm));
        emit LpLegUnavailable(alice, 0); // liquidity arg not checked (her pro-rata slice)
        vm.prank(alice);
        (uint256 q, uint256 p) = g.pm.withdraw(sA); // FAILS (attack): does not revert
        assertApproxEqRel(q, FullMath.mulDiv(idle, sA, ts + 1e6), 0.0001e18, "idle leg: her pro-rata slice, delivered");
        assertEq(p, 0, "LP leg unavailable (transfer to a blacklisted recipient)");
        assertEq(_gatewayLiq(), liqBefore, "LP untouched");
        assertApproxEqRel(g.pm.sharesOf(alice), FullMath.mulDiv(sA, lpVal, idle + lpVal), 0.001e18, "LP slice re-credited");
        vm.prank(bob);
        (uint256 qb, uint256 pb) = g.pm.withdraw(sBob); // others unaffected
        assertGt(qb, 0);
        assertGt(pb, 0);
        // un-blacklist → alice recovers the rest (now the last holder: takes the remaining position whole)
        meme.setBlacklisted(alice, false);
        _roll(1);
        uint256 s2 = g.pm.sharesOf(alice);
        vm.prank(alice);
        (uint256 q2, uint256 p2) = g.pm.withdraw(s2);
        uint160 sp = _spot();
        assertApproxEqRel(_worth(q + q2, p + p2, sp), 150_000e18, 0.001e18, "alice's full claim recovered (her whole 150k deposit)");
        assertEq(_gatewayLiq(), 0);
    }

    /// Fee-on-transfer paired: the in-contract zap (earn-vs-lp decision) takes the swap output from the pool
    /// but the FoT skim means the PM holds less than the swap reported, so liquidity is computed off a balance
    /// the PM does not have → SETTLE_PAIR under-funded → deploy always reverts (DOA, no loss). (Such a token
    /// also refuses to seed third-party depth in `_buildRig`, which is the same refusal one step earlier.)
    /// Idle deposit/withdraw fine.
    function test_RT_6d_feeOnTransferPaired_deployDOA_noLoss_FAILS() public {
        if (!live) return;
        RTFeeOnTransferERC20 fot = new RTFeeOnTransferERC20("FoT", "FOT", 18, 100);
        _buildRig(address(fot), 18, SQRT_1, TL, TU, address(0));
        _fund(alice, 100_000e18, 0);
        vm.prank(alice);
        uint256 s = g.pm.deposit(100_000e18);
        vm.expectRevert();
        g.pm.deploy(100_000e18, 50_000e18, 0, 0, block.timestamp);
        _roll(1);
        vm.prank(alice);
        (uint256 q,) = g.pm.withdraw(s);
        assertApproxEqAbs(q, 100_000e18, 2, "idle path unaffected; nothing lost");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // 9. Compromised owner / hostile token issuer economics
    // ═══════════════════════════════════════════════════════════════════════════════════════

    /// Crash-cycle vs the deploy cap. First pass: MAX_DEPLOY_BPS was on MARKED value — crash the paired token →
    /// the LP marks near zero → the cap re-opens → more idle quote is deployed into the same dying pool → crash
    /// again; the HONEST cron rule cycled >60% of principal into the pool (SUCCEEDS). FAILS now: the guard is on
    /// `deployedPrincipal` (quote at COST) against (staged + deployedPrincipal), which never falls with price —
    /// the first re-opened deploy reverts `DeployCapExceeded`.
    ///
    /// ⚠ RE-BASED for the earn-vs-lp decision (2026-09-08). TWO of this test's premises were deleted with the
    /// owner-subsidy design and this test can no longer assert them:
    ///   • MAX_DEPLOY_BPS is now 10000 (100%) — there is no "half stays in the reserve" policy, so the old
    ///     `staged >= 50% of principal` bound is GONE BY DESIGN, not by regression. What survives (and is the
    ///     load-bearing half) is that the guard is measured at COST, so a crash never re-opens headroom.
    ///   • The issuer no longer supplies the paired leg at all, so it can no longer inject paired into the
    ///     position and dump it back out; the extraction surface is now only the trading it does against a
    ///     position funded entirely with depositor quote.
    /// TODO(needs review): the residual numeric ceilings below ("extraction < the honest first deploy's IL")
    /// were derived on the 50%-cap rig and should be re-measured on a live fork before they are cited again.
    function test_RT_9a_crashCycle_honestCron_bypassesTotalDeployCap_FAILS() public {
        if (!live) return;
        _buildRig(address(0), 18, SQRT_1, FULL_TL, FULL_TU, address(0)); // full range: stays in range through crashes
        _fund(alice, 100_000e18, 0);
        vm.prank(alice);
        g.pm.deposit(100_000e18);
        address issuer = address(this); // owner runs the cron rule; `this` also plays the issuer with free paired
        uint256 issuerQ0 = g.quote.balanceOf(issuer);
        uint256 cumQuoteDeployed;
        uint256 cycles;
        uint256 capReverts;
        uint256 firstDeployIL; // honest first deploy's IL from the /16 crash (in quote terms)

        for (uint256 i = 0; i < 6; i++) {
            uint256 nav = g.pm.totalNav();
            uint256 staged = g.staging.stagedAssets();
            uint256 deployedNow = nav > staged ? nav - staged : 0;
            uint256 target = nav / 2;
            uint256 room = target > deployedNow ? target - deployedNow : 0;
            if (room < 1_000e18) break;
            // The cron now stages the WHOLE amount and zaps half of it into the paired leg in-contract; the
            // "issuer-side paired" of the old call site simply has no equivalent.
            uint256 quoteToDeploy = room; // half funds the mint's quote leg, half is swapped into paired
            (bool ok, bytes memory ret) = address(g.pm).call(
                abi.encodeWithSelector(
                    g.pm.deploy.selector, quoteToDeploy, quoteToDeploy / 2, uint256(0), uint128(0), block.timestamp
                )
            );
            if (!ok) {
                assertEq(bytes4(ret), MintwareLpGatewayPositionManager.DeployCapExceeded.selector, "the re-opened deploy is refused by the cost-basis cap");
                capReverts++;
                console2.log("cycle", i, "deploy refused: DeployCapExceeded; requested (quote)", quoteToDeploy / 1e18);
                break; // the honest cron would keep being refused — same state every cycle
            }
            cumQuoteDeployed += quoteToDeploy;
            cycles++;
            // invariant: principal at cost in the LP never exceeds principal at cost (the 100% overdraw guard)
            uint256 dp = g.pm.deployedPrincipal();
            assertLe(dp, g.staging.stagedAssets() + dp, "deployedPrincipal <= principal at cost after every deploy");
            uint256 lpBefore = nav - staged + quoteToDeploy;
            // issuer dumps until the paired price is /16 — then walks the follower (anyone can, ~28 blocks)
            uint256 p0 = _pairedPrice();
            for (uint256 k = 0; k < 400 && _pairedPrice() > p0 / 16; k++) {
                _swap(false, 20_000e18);
            }
            if (i == 0) {
                uint256 lpAfter = g.pm.totalNav() - g.staging.stagedAssets();
                firstDeployIL = lpBefore > lpAfter ? lpBefore - lpAfter : 0;
            }
            _walkFollower(120);
        }
        uint256 issuerGain = g.quote.balanceOf(issuer) - issuerQ0; // quote drained out of the LP by dumping
        uint256 dpEnd = g.pm.deployedPrincipal();
        _logQ("cumulative depositor quote deployed", cumQuoteDeployed);
        _logQ("deployedPrincipal at end (cost basis)", dpEnd);
        _logQ("alice idle reserve at the end (never LP-exposed)", g.staging.stagedAssets());
        _logQ("alice NAV at the end (marked at crashed spot)", g.pm.totalNav());
        _logQ("issuer's net quote gain", issuerGain);
        _logQ("honest first deploy's IL from the /16 crash", firstDeployIL);
        console2.log("cycles executed", cycles, "cap reverts", capReverts);
        assertGt(capReverts, 0, "FAILS: the crash-cycle's re-opened deploy reverts DeployCapExceeded");
        assertLe(cumQuoteDeployed, 100_000e18, "cumulative principal deployed never exceeds what was deposited");
        assertLe(dpEnd, g.staging.stagedAssets() + dpEnd, "deployedPrincipal never exceeds principal at cost");
        assertLe(issuerGain, cumQuoteDeployed, "extraction bounded by the quote actually deployed (at cost)");
        // The crash cycle adds nothing the FIRST deploy did not already expose: every later deploy is refused
        // by the cost-basis guard, so there is no compounding — which is the claim that survives the decision.
        assertLe(issuerGain, firstDeployIL, "total extraction <= the honest first deploy's IL");
    }

    /// Same loop as a compromised owner (deploys the FULL room each cycle). First pass: >65% of principal
    /// pushed into the pool despite the cap (SUCCEEDS). FAILS now: every re-opened deploy after a crash reverts
    /// `DeployCapExceeded`, because the guard is measured at COST and a crash cannot re-open it.
    ///
    /// ⚠ RE-BASED for the earn-vs-lp decision (2026-09-08), same two premises as RT-9a: MAX_DEPLOY_BPS is 100%
    /// (so "half stays in the reserve" is gone by design — a compromised key's worst case is now bounded by
    /// principal, not by half of it), and the owner supplies no paired token, so it cannot inject and reclaim
    /// value of its own. TODO(needs review): re-measure the extraction ceiling on a live fork.
    function test_RT_9b_crashCycle_compromisedOwner_worstCaseLoss_FAILS() public {
        if (!live) return;
        _buildRig(address(0), 18, SQRT_1, FULL_TL, FULL_TU, address(0));
        _fund(alice, 100_000e18, 0);
        vm.prank(alice);
        g.pm.deposit(100_000e18);
        uint256 issuerQ0 = g.quote.balanceOf(address(this));
        uint256 cum;
        uint256 capReverts;
        for (uint256 i = 0; i < 6; i++) {
            uint256 nav = g.pm.totalNav();
            uint256 staged = g.staging.stagedAssets();
            uint256 deployedNow = nav > staged ? nav - staged : 0;
            uint256 room = nav / 2 > deployedNow ? nav / 2 - deployedNow : 0;
            if (room < 1_000e18) break;
            uint256 qd = room - 1;
            // Earn-vs-lp decision: no owner paired argument exists — the compromised owner can only move the
            // DEPOSITOR's own quote, half of it zapped into paired through the pool.
            (bool ok, bytes memory ret) = address(g.pm).call(
                abi.encodeWithSelector(g.pm.deploy.selector, qd, qd / 2, uint256(0), uint128(0), block.timestamp)
            );
            if (!ok) {
                assertEq(bytes4(ret), MintwareLpGatewayPositionManager.DeployCapExceeded.selector);
                capReverts++;
                console2.log("cycle", i, "deploy refused: DeployCapExceeded; requested (quote)", qd / 1e18);
                if (capReverts >= 2) break; // refused twice in a row — the cap does not re-open
                // keep crashing anyway (the compromised owner would), then try once more
            } else {
                cum += qd;
                uint256 dp = g.pm.deployedPrincipal();
                assertLe(dp, g.staging.stagedAssets() + dp, "deployedPrincipal <= principal at cost after every deploy");
            }
            uint256 p0 = _pairedPrice();
            for (uint256 k = 0; k < 400 && _pairedPrice() > p0 / 16; k++) {
                _swap(false, 20_000e18);
            }
            _walkFollower(120);
        }
        uint256 dpEnd = g.pm.deployedPrincipal();
        uint256 gain = g.quote.balanceOf(address(this)) - issuerQ0;
        _logQ("cumulative principal deployed (compromised owner)", cum);
        _logQ("deployedPrincipal at end (cost basis)", dpEnd);
        _logQ("alice idle reserve at end (never LP-exposed)", g.staging.stagedAssets());
        _logQ("alice NAV at end", g.pm.totalNav());
        _logQ("owner/issuer quote gain", gain);
        console2.log("cap reverts", capReverts);
        assertGt(capReverts, 0, "FAILS: every re-opened deploy reverts DeployCapExceeded");
        assertLe(cum, 100_000e18, "never more than the deposited principal is pushed into the pool");
        assertLe(dpEnd, g.staging.stagedAssets() + dpEnd, "deployedPrincipal never exceeds principal at cost");
        assertLe(gain, cum, "extraction bounded by the quote actually deployed (at cost)");
    }

    /// Owner pumps 2x, walks the follower (harvest/block), deploys the max room at the pumped price, dumps.
    /// Quantifies the mis-priced-mint loss the band + cap leave to a compromised key.
    function test_RT_9c_ownerPumpWalkDeployDump_boundedLoss_SUCCEEDS() public {
        if (!live) return;
        _standard(100_000e18, 10_000e18, 10_000e18); // NAV 120k: 90k idle + 20k LP
        uint256 navFair = g.pm.totalNav();
        uint256 ownerQ0 = g.quote.balanceOf(address(this));
        uint256 pGot = _swap(true, 6_000e18); // pump ~2x on the thin gateway-only pool
        uint256 blocks = _walkFollower(40);
        uint256 nav = g.pm.totalNav();
        uint256 staged = g.staging.stagedAssets();
        // Earn-vs-LP decision: the owner funds nothing. `room` quote goes to the mint and `room` more is
        // zapped into the paired leg -- both out of the DEPOSITOR's staged capital, which is the whole point:
        // a compromised key can mis-price the mint, but it cannot add (or later reclaim) value of its own.
        uint256 room = nav / 2 - (nav - staged) - 1;
        g.pm.deploy(2 * room, room, 0, 0, block.timestamp);
        _swap(false, pGot); // dump against the freshly minted gateway liquidity
        _roll(1);
        _arbBack(SQRT_1); // third party restores fair so the LP is marked honestly (the dump alone leaves spot high)
        uint256 navAfter = g.pm.totalNav();
        // There is no owner donation any more (the owner-supplied paired leg was deleted), so the
        // no-manipulation baseline is simply the pre-attack NAV: every wei in the position is depositor money.
        uint256 expectedNoManip = navFair;
        uint256 loss = expectedNoManip > navAfter ? expectedNoManip - navAfter : 0;
        int256 ownerQuotePnl = int256(g.quote.balanceOf(address(this))) - int256(ownerQ0);
        console2.log("blocks walked", blocks);
        _logQ("NAV fair before attack", navFair);
        _logQ("owner paired contributed (structurally zero since the earn-vs-lp decision)", uint256(0));
        _logQ("NAV after pump-deploy-dump", navAfter);
        _logQ("depositor loss vs no-manipulation", loss);
        console2.log("depositor loss bps of pre-attack NAV", (loss * 10_000) / navFair);
        console2.log("owner quote PnL (wei; the owner contributes no paired at all now)", ownerQuotePnl);
        assertGt(loss, 0, "a compromised owner can still mis-price its own deploy inside the band");
        assertLt(loss, navFair / 4, "...but the band + cap keep it well under 25% of NAV");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // Decimal-mix sanity (gap #7): 6dp quote x 18dp paired on the real V4 stack
    // ═══════════════════════════════════════════════════════════════════════════════════════

    function test_RT_x_6dpQuote18dpPaired_valueConserved_FAILS() public {
        if (!live) return;
        // paired = 0.001 quote → 1 quote unit (1e6) buys 1000 paired (1e21). Ordering decides P.
        RTMintableERC20 q6 = new RTMintableERC20("USDG", "USDG", 6);
        address p18 = address(new RTMintableERC20("Meme", "M", 18));
        uint160 sqrtInit;
        if (address(q6) < p18) {
            // P = token1/token0 = 1e21/1e6 = 1e15 → sqrt = 31622776.6
            sqrtInit = uint160(FullMath.mulDiv(31622776, Q96, 1));
        } else {
            sqrtInit = uint160(FullMath.mulDiv(Q96, 1, 31622776));
        }
        // build manually with these tokens
        g.quote = q6;
        g.paired = p18;
        (address c0, address c1) = address(q6) < p18 ? (address(q6), p18) : (p18, address(q6));
        g.q0 = c0 == address(q6);
        g.key = PoolKey({currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        poolManager.initialize(g.key, sqrtInit);
        g.tl = FULL_TL;
        g.tu = FULL_TU;
        g.src = new MockERC4626(IERC20(address(q6)));
        g.adapter = new MintwareERC4626YieldAdapter(address(q6), address(g.src), address(0), address(this));
        g.adapterUsed = IYieldAdapter(address(g.adapter));
        g.staging = new MintwareLpGatewayStaging(IERC20(address(q6)), g.adapterUsed);
        g.adapter.setVault(address(g.staging));
        g.pm = new MintwareLpGatewayPositionManager(
            poolManager, posm, IPermit2Minimal(PERMIT2), g.key, IERC20(address(q6)), FULL_TL, FULL_TU, g.staging, address(this), RECIP, BAND,
            type(uint256).max // IA-11 principal cap: uncapped -- this test predates/is unrelated to the cap
        );
        g.staging.setController(address(g.pm));
        _fund(address(this), 10_000_000e6, 1e32);
        // Earn-vs-lp decision: the in-contract zap needs an already-liquid pool (see `_buildRig`). This rig is
        // built by hand, so seed its third-party depth by hand too.
        lpHelper.modifyLiquidity(
            g.key, ModifyLiquidityParams({tickLower: FULL_TL, tickUpper: FULL_TU, liquidityDelta: int256(1e21), salt: 0}), ""
        );

        _fund(alice, 100_000e6, 0);
        vm.prank(alice);
        uint256 s = g.pm.deposit(100_000e6);
        // Earn-vs-lp decision: 100k staged, half zapped into the 18dp paired leg in-contract. NAV is
        // CONSERVED across the deploy now (there is no owner paired leg adding value) -- that conservation
        // across a 6dp x 18dp zap is exactly the decimal-mix property this test exists to check.
        g.pm.deploy(100_000e6, 50_000e6, 0, 0, block.timestamp);
        uint256 nav = g.pm.totalNav();
        console2.log("NAV after 6dp/18dp deploy (quote 6dp units)", nav);
        assertApproxEqRel(nav, 100_000e6, 0.01e18, "NAV ~= the 100k principal; the zap moves value, never creates it");
        _roll(1);
        vm.prank(alice);
        (uint256 q, uint256 p) = g.pm.withdraw(s);
        uint256 got = _worth(q, p, _spot());
        console2.log("alice received (quote 6dp)", got);
        assertApproxEqRel(got, nav, 0.01e18, "value conserved through a 6dp x 18dp deploy + full exit");
    }
}
