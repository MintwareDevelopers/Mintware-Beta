// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareDeFiPairVault}  from "../../src/vaults/MintwareDeFiPairVault.sol";
import {PoolProfile, LockTier}  from "../../src/vaults/VaultTypes.sol";
import {
    Mintwarev3ToV4Migrator,
    INonfungiblePositionManagerLike,
    IPairVaultDepositFor
} from "../../src/vaults/Mintwarev3ToV4Migrator.sol";

/// @dev The slice of the REAL Uniswap-v3 NonfungiblePositionManager we need to MINT + own a position
///      in-test (the migrator itself only ever touches the `INonfungiblePositionManagerLike` surface —
///      positions/decrease/collect/safeTransferFrom — which the real NPM also implements).
interface IUniV3NPM {
    struct MintParams {
        address token0;
        address token1;
        uint24  fee;
        int24   tickLower;
        int24   tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }
    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    function setApprovalForAll(address operator, bool approved) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IUniV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IUniV3Pool {
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
    function tickSpacing() external view returns (int24);
}

/// @notice FORK PROOF of the v3→v4 migration router against the REAL Uniswap v3 contracts on a forked
///         Base mainnet — unlike `Mintwarev3ToV4Migrator.t.sol`, which drives a MOCK NPM. It mints an
///         actual WETH/USDC Uniswap-v3 LP position through the canonical mainnet
///         NonfungiblePositionManager, then runs the migrator on it end-to-end:
///
///           mint real v3 LP (WETH/USDC)  → NFT owned by the user
///           migrate()                    → real decreaseLiquidity → collect (unwind the LIVE position)
///                                        → (optional) min-out-bounded rebalance on an in-test v4 pool
///                                        → depositFor → ULV shares credited straight to the user
///           assert                       → shares minted to the user, v3 position fully drained,
///                                          NFT returned, no dust stranded in the router
///
///         The v4 side (pair vault + rebalance swap pool) is stood up fresh in-test on a throw-away
///         PoolManager — only the v3 unwind exercises forked mainnet bytecode, which is the whole point.
///
///         Run forked:
///           BASE_RPC_URL=<base-mainnet-rpc> forge test \
///             --match-path "contracts-v4/test/fork/Mintwarev3ToV4MigratorFork.t.sol" -vvv
///         With BASE_RPC_URL unset the fork can't be created → every test SELF-SKIPS (green in CI).
contract Mintwarev3ToV4MigratorForkTest is Test {
    // ── REAL Uniswap v3 on Base mainnet (8453) ──────────────────────────────────────────────────
    address internal constant V3_NPM     = 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1; // NonfungiblePositionManager
    address internal constant V3_FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD; // UniswapV3Factory
    address internal constant WETH       = 0x4200000000000000000000000000000000000006; // token0 (WETH < USDC)
    address internal constant USDC       = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // token1 (native Base USDC)
    uint24  internal constant V3_FEE     = 500; // 0.05% WETH/USDC pool (deep on Base)

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0 (in-test v4 pool)

    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;
    MintwareDeFiPairVault   internal vault;
    Mintwarev3ToV4Migrator  internal migrator;
    PoolKey                 internal poolKey;
    bool                    internal forked;

    address internal treasury = makeAddr("treasury");
    address internal alice    = makeAddr("alice"); // seeds the vault
    address internal bob      = makeAddr("bob");    // migrates a real v3 position

    function setUp() public {
        // Self-skip cleanly when no Base-mainnet RPC is configured (keeps the normal suite green).
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) { forked = false; return; }
        vm.createSelectFork(rpc);
        if (V3_NPM.code.length == 0 || V3_FACTORY.code.length == 0) { forked = false; return; } // not Base mainnet
        forked = true;

        // makeAddr() addresses can collide with REAL deployed contracts on a mainnet fork; force our test
        // actors to be code-less EOAs so the migrator's final ERC-721 safeTransferFrom (which invokes
        // onERC721Received on any contract recipient) lands on a plain wallet, as in production.
        vm.etch(alice, "");
        vm.etch(bob, "");
        vm.etch(treasury, "");

        // ── in-test v4 stack: fresh throw-away PoolManager + the pair vault the migrator mints into ──
        pm       = new PoolManager(address(this));
        lpRouter = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        // WETH < USDC on Base, so currency0 = WETH, currency1 = USDC — matches the real v3 position order.
        poolKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        vault = new MintwareDeFiPairVault(
            address(pm), poolKey, PoolProfile.EMERGING, treasury, address(this), address(this)
        );
        vault.initializePool(INIT_SQRT_PRICE);
        // Sanity: the migrator's pair guard will require exactly this pairing.
        assertEq(address(vault.token0()), WETH, "vault token0 == WETH");
        assertEq(address(vault.token1()), USDC, "vault token1 == USDC");

        migrator = new Mintwarev3ToV4Migrator(
            INonfungiblePositionManagerLike(V3_NPM),
            IPoolManager(address(pm)),
            IPairVaultDepositFor(address(vault)),
            poolKey
        );

        // Deep 1:1 full-range baseline liquidity so the in-test rebalance swap has depth (wei-uniform;
        // the pool is isolated, so real WETH/USDC price is irrelevant here).
        deal(WETH, address(this), 100_000_000e18);
        deal(USDC, address(this), 100_000_000e18);
        IERC20(WETH).approve(address(lpRouter), type(uint256).max);
        IERC20(USDC).approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / 60) * 60;
        int24 hi = (TickMath.MAX_TICK / 60) * 60;
        lpRouter.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 40_000_000e18, salt: bytes32(0)}),
            ""
        );

        // Alice bootstraps the vault so bob's migration is a normal pro-rata deposit (not the genesis mint).
        deal(WETH, alice, 1_000_000e18);
        deal(USDC, alice, 1_000_000e18);
        vm.startPrank(alice);
        IERC20(WETH).approve(address(vault), type(uint256).max);
        IERC20(USDC).approve(address(vault), type(uint256).max);
        vault.deposit(500_000e18, 500_000e18, 0, LockTier.Flex);
        vm.stopPrank();
    }

    /// Mint a REAL WETH/USDC Uniswap-v3 LP position (owned by `to`) through the canonical mainnet NPM,
    /// with a range straddling the live pool tick so both tokens back the position.
    function _mintRealV3Position(address to, uint256 amt0Desired, uint256 amt1Desired)
        internal
        returns (uint256 tokenId)
    {
        address pool = IUniV3Factory(V3_FACTORY).getPool(WETH, USDC, V3_FEE);
        require(pool != address(0), "v3 WETH/USDC pool missing on fork");
        (, int24 tick,,,,,) = IUniV3Pool(pool).slot0();
        int24 spacing = IUniV3Pool(pool).tickSpacing();

        // Floor-align the current tick to the spacing, then straddle it.
        int24 comp = tick / spacing;
        if (tick < 0 && (tick % spacing != 0)) comp -= 1;
        int24 tickLower = (comp - 50) * spacing;
        int24 tickUpper = (comp + 51) * spacing;

        // Fund + approve the NPM to pull both sides.
        deal(WETH, address(this), amt0Desired);
        deal(USDC, address(this), amt1Desired);
        IERC20(WETH).approve(V3_NPM, amt0Desired);
        IERC20(USDC).approve(V3_NPM, amt1Desired);

        (tokenId,,,) = IUniV3NPM(V3_NPM).mint(
            IUniV3NPM.MintParams({
                token0: WETH,
                token1: USDC,
                fee: V3_FEE,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amt0Desired,
                amount1Desired: amt1Desired,
                amount0Min: 0,
                amount1Min: 0,
                recipient: to,
                deadline: block.timestamp + 1 hours
            })
        );
    }

    function _params(uint256 tokenId, bool sellToken0, uint256 swapAmountIn, uint256 minSwapOut)
        internal
        view
        returns (Mintwarev3ToV4Migrator.MigrateParams memory)
    {
        return Mintwarev3ToV4Migrator.MigrateParams({
            tokenId: tokenId,
            recipient: bob,
            amount0MinUnwind: 0,
            amount1MinUnwind: 0,
            sellToken0: sellToken0,
            swapAmountIn: swapAmountIn,
            minSwapOut: minSwapOut,
            minShares: 0,
            tier: LockTier.Flex,
            deadline: block.timestamp + 1 hours
        });
    }

    function _assertDrainedAndReturned(uint256 tokenId) internal view {
        // No value stranded in the router.
        assertEq(IERC20(WETH).balanceOf(address(migrator)), 0, "no WETH stuck in router");
        assertEq(IERC20(USDC).balanceOf(address(migrator)), 0, "no USDC stuck in router");
        // NFT returned to bob, now fully unwound.
        assertEq(IUniV3NPM(V3_NPM).ownerOf(tokenId), bob, "real v3 NFT returned to bob");
        (, , , , , , , uint128 liq, , , , ) =
            INonfungiblePositionManagerLike(V3_NPM).positions(tokenId);
        assertEq(liq, 0, "real v3 position fully drained");
    }

    // ── tests ──────────────────────────────────────────────────────────────────

    /// Mint a REAL two-sided v3 position, migrate WITHOUT a rebalance swap: the live position is unwound
    /// (real decrease→collect) and both tokens are deposited straight into the ULV → shares to bob.
    function test_fork_migrate_real_v3_position_no_rebalance() public {
        if (!forked) { vm.skip(true); return; }

        uint256 id = _mintRealV3Position(bob, 0.5e18, 2_000e6); // 0.5 WETH + 2,000 USDC
        assertEq(IUniV3NPM(V3_NPM).ownerOf(id), bob, "bob owns the freshly minted v3 NFT");

        vm.prank(bob);
        IUniV3NPM(V3_NPM).setApprovalForAll(address(migrator), true);

        vm.prank(bob);
        (uint256 shares, uint256 swapOut) = migrator.migrate(_params(id, true, 0, 0));

        assertGt(shares, 0, "ULV shares minted from the real v3 unwind");
        assertEq(vault.shares(bob), shares, "shares credited to bob (not the router)");
        assertEq(swapOut, 0, "no rebalance swap performed");
        _assertDrainedAndReturned(id);
    }

    /// Same, but WITH a small min-out-bounded rebalance swap on the in-test v4 pool: exercises the full
    /// unwind → rebalance → depositFor path over the REAL v3 position.
    function test_fork_migrate_real_v3_position_with_rebalance() public {
        if (!forked) { vm.skip(true); return; }

        uint256 id = _mintRealV3Position(bob, 0.5e18, 2_000e6);

        vm.prank(bob);
        IUniV3NPM(V3_NPM).setApprovalForAll(address(migrator), true);

        // Sell a tiny slice of the unwound WETH → USDC (minOut 0: the in-test 1:1 pool is deep, and this
        // test is about the plumbing, not price). 1e14 wei (0.0001 WETH) is far below what a 0.5-WETH
        // range position returns, so the swap input is always covered.
        vm.prank(bob);
        (uint256 shares, uint256 swapOut) = migrator.migrate(_params(id, true, 1e14, 0));

        assertGt(shares, 0, "ULV shares minted with a rebalance leg");
        assertEq(vault.shares(bob), shares, "shares credited to bob");
        assertGt(swapOut, 0, "rebalance swap produced output on the real-forked v4 pool");
        _assertDrainedAndReturned(id);
    }
}
