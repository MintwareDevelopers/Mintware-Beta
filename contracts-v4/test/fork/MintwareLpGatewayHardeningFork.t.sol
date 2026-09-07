// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";
import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";

/// @notice Fork validation of the firm-grade HARDENING (findings H-02 / H-03 / M-06) against the REAL
///         Uniswap V4 stack (Robinhood Chain testnet by default). Deploys its own mock rig + a fresh pool,
///         then drives real swaps through `PoolSwapTest` to accrue fees + move price — the paths the
///         Stub unit tests can't reach. SELF-SKIPS when `LP_FORK_RPC_URL` is unset (CI stays green).
///
///         Run:  LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com \
///               forge test --match-contract MintwareLpGatewayHardeningFork -vv
contract MintwareLpGatewayHardeningForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // Verified-canonical V4 on Robinhood Chain (testnet + mainnet); overridable via env for another fork.
    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant RH_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 constant SQRT_1 = 79228162514264337593543950336; // price 1.0 (tick 0)

    bool internal live;
    IPoolManager internal poolManager;
    MintwareLpGatewayStaging internal staging;
    MintwareLpGatewayPositionManager internal pm;
    MockERC20 internal quote; // 18dp — the gateway quote asset
    MockERC20 internal paired; // 18dp
    PoolKey internal key;
    PoolSwapTest internal swapper;

    address internal RECIP = address(0xFEE5);
    address internal alice = address(0xA11CE);
    int24 internal constant TL = -22980;
    int24 internal constant TU = 22980;

    function setUp() public {
        string memory rpc = vm.envOr("LP_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            live = false;
            return;
        }
        vm.createSelectFork(rpc);
        live = true;

        poolManager = IPoolManager(vm.envOr("LP_POOL_MANAGER", RH_POOL_MANAGER));
        IPositionManager posm = IPositionManager(vm.envOr("LP_POSITION_MANAGER", RH_POSITION_MANAGER));

        // Two 18-dp mock tokens (same decimals → clean price math for the assertions).
        MockERC20 a = new MockERC20("Quote", "Q", 18);
        MockERC20 b = new MockERC20("Paired", "P", 18);
        (MockERC20 c0, MockERC20 c1) = address(a) < address(b) ? (a, b) : (b, a);
        quote = a;
        paired = b;

        MockYieldAdapter adapter = new MockYieldAdapter(address(quote));
        key = PoolKey({
            currency0: Currency.wrap(address(c0)),
            currency1: Currency.wrap(address(c1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        poolManager.initialize(key, SQRT_1);

        staging = new MintwareLpGatewayStaging(IERC20(address(quote)), adapter);
        pm = new MintwareLpGatewayPositionManager(
            poolManager, posm, IPermit2Minimal(PERMIT2), key, IERC20(address(quote)), TL, TU, staging, address(this), RECIP, 500
        );
        staging.setController(address(pm));

        swapper = new PoolSwapTest(poolManager);

        // fund alice (depositor) + this test (deploy paired + swaps)
        quote.mint(alice, 1_000_000e18);
        quote.mint(address(this), 1_000_000e18);
        paired.mint(address(this), 1_000_000e18);
        vm.prank(alice);
        quote.approve(address(pm), type(uint256).max);
        paired.approve(address(pm), type(uint256).max);
        quote.approve(address(swapper), type(uint256).max);
        paired.approve(address(swapper), type(uint256).max);

        // alice deposits, owner deploys a balanced position → the pool now has the gateway's liquidity.
        vm.prank(alice);
        pm.deposit(100_000e18);
        pm.deploy(50_000e18, 50_000e18, 0, block.timestamp);
        vm.roll(block.number + 1);
    }

    // Swap `amt` of the quote→paired (or reverse) to accrue fees + move price.
    function _swap(bool zeroForOne, int256 amt) internal {
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        swapper.swap(
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: amt, sqrtPriceLimitX96: limit}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    // H-02: harvest collects ONLY fees to the recipient; principal liquidity is untouched.
    function test_fork_H02_harvestSweepsFeesToRecipient() public {
        if (!live) return;
        uint128 liqBefore = IPositionManager(address(pm.positionManager())).getPositionLiquidity(pm.tokenId());
        uint256 recipBefore = quote.balanceOf(RECIP) + paired.balanceOf(RECIP);

        // churn swaps both directions → fee accrual to the gateway position
        _swap(true, -2_000e18);
        _swap(false, -2_000e18);
        _swap(true, -2_000e18);

        vm.roll(block.number + 1);
        pm.harvest(block.timestamp);

        uint128 liqAfter = IPositionManager(address(pm.positionManager())).getPositionLiquidity(pm.tokenId());
        uint256 recipAfter = quote.balanceOf(RECIP) + paired.balanceOf(RECIP);

        assertGt(recipAfter, recipBefore, "harvest routed fees to recipient");
        assertEq(liqAfter, liqBefore, "principal liquidity untouched by harvest");
    }

    // H-02 (withdraw leg): a withdrawal that touches the LP sweeps the position's fees to the recipient
    // FIRST, so the withdrawer never pockets them.
    function test_fork_H02_withdrawDoesNotLeakFees() public {
        if (!live) return;
        _swap(true, -3_000e18);
        _swap(false, -3_000e18);
        vm.roll(block.number + 1);

        uint256 recipBefore = quote.balanceOf(RECIP) + paired.balanceOf(RECIP);
        uint256 s = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(s); // full exit → forces the LP leg (idle can't cover it all)
        uint256 recipAfter = quote.balanceOf(RECIP) + paired.balanceOf(RECIP);

        assertGt(recipAfter, recipBefore, "withdraw swept fees to the buffer, not the withdrawer");
    }

    // H-03: a single-block pump can't inflate a withdrawal claim — the conservative min(spot, ref) mark
    // holds it near the pre-pump value even though spot moved a lot.
    function test_fork_H03_conservativeMarkCapsPump() public {
        if (!live) return;
        // fair-price reference: what a full exit is worth now (quote-terms), before any manipulation.
        uint256 navFair = pm.totalNav();

        // pump: large one-directional swap moves spot far in one block.
        _swap(false, -40_000e18);
        vm.roll(block.number + 1);

        // spot NAV is now inflated; the conservative withdraw NAV must NOT be.
        uint256 navSpot = pm.totalNav();
        assertGt(navSpot, navFair, "spot NAV rose with the pump (sanity)");

        uint256 qBefore = quote.balanceOf(alice);
        uint256 pBefore = paired.balanceOf(alice);
        uint256 s = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(s);
        // value the withdrawer actually received, marked at the fair (pre-pump) price ≈ 1.0:
        uint256 gotQuote = quote.balanceOf(alice) - qBefore;
        uint256 gotPaired = paired.balanceOf(alice) - pBefore; // ~1.0 price, same decimals
        uint256 valueOut = gotQuote + gotPaired;

        // H-03: the claim is bounded by the CONSERVATIVE mark, not the pumped spot — so a pump can never
        // inflate it (it may even mark below fair, which is the safe direction). It must still pay a real,
        // conservative amount (not zeroed).
        assertLt(valueOut, navSpot, "conservative mark held the claim below the pumped spot NAV (no inflation)");
        assertGt(valueOut, navFair / 2, "conservative claim is still a real payout, not zeroed");
    }
}
