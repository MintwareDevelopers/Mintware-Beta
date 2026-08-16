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

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import {MintwareDeFiPairVault}       from "../src/vaults/MintwareDeFiPairVault.sol";
import {PoolProfile, LockTier}       from "../src/vaults/VaultTypes.sol";
import {
    Mintwarev3ToV4Migrator,
    INonfungiblePositionManagerLike,
    IPairVaultDepositFor
} from "../src/vaults/Mintwarev3ToV4Migrator.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Minimal Uniswap-v3 NonfungiblePositionManager mock — just the surface the migrator drives
///         (positions / decreaseLiquidity / collect / ERC-721 custody). A position holds real token
///         reserves so `collect` pays out physically, letting the migrator round-trip end-to-end.
contract MockV3NPM is INonfungiblePositionManagerLike {
    struct Pos { address token0; address token1; uint128 liquidity; uint256 res0; uint256 res1; uint256 owed0; uint256 owed1; }

    mapping(uint256 => Pos) public pos;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    uint256 public nextId = 1;

    /// Mint a v3 position NFT to `to`, funded with `amt0`/`amt1` of reserves pulled from the caller.
    function mint(address to, address t0, address t1, uint128 liquidity, uint256 amt0, uint256 amt1)
        external
        returns (uint256 id)
    {
        id = nextId++;
        pos[id] = Pos(t0, t1, liquidity, amt0, amt1, 0, 0);
        ownerOf[id] = to;
        if (amt0 > 0) IERC20(t0).transferFrom(msg.sender, address(this), amt0);
        if (amt1 > 0) IERC20(t1).transferFrom(msg.sender, address(this), amt1);
    }

    function positions(uint256 id)
        external
        view
        override
        returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)
    {
        Pos memory p = pos[id];
        return (0, address(0), p.token0, p.token1, 3000, int24(-887220), int24(887220), p.liquidity, 0, 0, uint128(p.owed0), uint128(p.owed1));
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        override
        returns (uint256 amount0, uint256 amount1)
    {
        Pos storage p = pos[params.tokenId];
        require(params.liquidity > 0 && params.liquidity <= p.liquidity, "bad liquidity");
        amount0 = (p.res0 * params.liquidity) / p.liquidity;
        amount1 = (p.res1 * params.liquidity) / p.liquidity;
        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "unwind slippage");
        p.res0 -= amount0;
        p.res1 -= amount1;
        p.owed0 += amount0;
        p.owed1 += amount1;
        p.liquidity -= params.liquidity;
    }

    function collect(CollectParams calldata params) external override returns (uint256 amount0, uint256 amount1) {
        Pos storage p = pos[params.tokenId];
        amount0 = p.owed0 < params.amount0Max ? p.owed0 : params.amount0Max;
        amount1 = p.owed1 < params.amount1Max ? p.owed1 : params.amount1Max;
        p.owed0 -= amount0;
        p.owed1 -= amount1;
        if (amount0 > 0) IERC20(p.token0).transfer(params.recipient, amount0);
        if (amount1 > 0) IERC20(p.token1).transfer(params.recipient, amount1);
    }

    function setApprovalForAll(address op, bool ok) external { isApprovedForAll[msg.sender][op] = ok; }

    function safeTransferFrom(address from, address to, uint256 id) external override {
        require(ownerOf[id] == from, "not owner");
        require(
            msg.sender == from || getApproved[id] == msg.sender || isApprovedForAll[from][msg.sender],
            "not approved"
        );
        ownerOf[id] = to;
        getApproved[id] = address(0);
        if (to.code.length > 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, id, "") == IERC721Receiver.onERC721Received.selector,
                "receiver rejected"
            );
        }
    }
}

/// @notice End-to-end proof of the v3→v4 migration router against a REAL v4 pool + a mock v3 NPM: a dormant
///         single-sided v3 position → unwind (decrease→collect) → min-out-bounded rebalance swap → ULV
///         shares minted straight to the user via `depositFor`, no stuck dust, NFT returned.
contract Mintwarev3ToV4MigratorTest is Test {
    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;
    MintwareDeFiPairVault   internal vault;
    MockV3NPM               internal npm;
    Mintwarev3ToV4Migrator  internal migrator;

    MockERC20 internal token0;
    MockERC20 internal token1;
    PoolKey   internal poolKey;

    address internal deployer = address(this);
    address internal treasury = makeAddr("treasury");
    address internal alice    = makeAddr("alice"); // seeds the vault
    address internal bob      = makeAddr("bob");    // migrates a v3 position

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0

    function setUp() public {
        pm       = new PoolManager(deployer);
        lpRouter = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        MockERC20 a = new MockERC20("Token A", "AAA", 18);
        MockERC20 b = new MockERC20("Token B", "BBB", 18);
        (Currency c0, Currency c1) = address(a) < address(b)
            ? (Currency.wrap(address(a)), Currency.wrap(address(b)))
            : (Currency.wrap(address(b)), Currency.wrap(address(a)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        token0 = MockERC20(Currency.unwrap(c0));
        token1 = MockERC20(Currency.unwrap(c1));

        vault = new MintwareDeFiPairVault(address(pm), poolKey, PoolProfile.EMERGING, treasury, deployer, deployer);
        vault.initializePool(INIT_SQRT_PRICE);

        npm      = new MockV3NPM();
        migrator = new Mintwarev3ToV4Migrator(
            INonfungiblePositionManagerLike(address(npm)),
            IPoolManager(address(pm)),
            IPairVaultDepositFor(address(vault)),
            poolKey
        );

        // Deep full-range baseline liquidity so the rebalance swap has realistic depth.
        token0.mint(address(this), 100_000_000e18);
        token1.mint(address(this), 100_000_000e18);
        token0.approve(address(lpRouter), type(uint256).max);
        token1.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / 60) * 60;
        int24 hi = (TickMath.MAX_TICK / 60) * 60;
        lpRouter.modifyLiquidity(poolKey, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 40_000_000e18, salt: bytes32(0)}), "");

        // Alice bootstraps the vault (so bob's migration is a normal pro-rata deposit, not the genesis mint).
        token0.mint(alice, 1_000_000e18);
        token1.mint(alice, 1_000_000e18);
        vm.startPrank(alice);
        token0.approve(address(vault), type(uint256).max);
        token1.approve(address(vault), type(uint256).max);
        vault.deposit(500_000e18, 500_000e18, 0, LockTier.Flex);
        vm.stopPrank();
    }

    /// Mint a v3 position NFT to `to`, funded from this test contract.
    function _mintPosition(address to, uint256 amt0, uint256 amt1) internal returns (uint256 id) {
        token0.mint(address(this), amt0);
        token1.mint(address(this), amt1);
        token0.approve(address(npm), amt0);
        token1.approve(address(npm), amt1);
        id = npm.mint(to, address(token0), address(token1), 1_000e18, amt0, amt1);
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

    // ── tests ──────────────────────────────────────────────────────────────────

    /// A dormant SINGLE-SIDED v3 position (all token0) migrates: rebalance ~half → deposit balanced →
    /// ULV shares to bob, no dust stuck in the router, NFT returned.
    function test_migrate_singleSided_position() public {
        uint256 id = _mintPosition(bob, 100_000e18, 0); // 100k token0, 0 token1
        vm.prank(bob);
        npm.setApprovalForAll(address(migrator), true);

        uint256 bob0Before = token0.balanceOf(bob);

        vm.prank(bob);
        (uint256 shares, uint256 swapOut) =
            migrator.migrate(_params(id, true, 50_000e18, 48_000e18)); // swap ~half token0→token1

        assertGt(shares, 0, "ULV shares minted to bob");
        assertEq(vault.shares(bob), shares, "shares credited to bob (not the router)");
        assertGt(swapOut, 48_000e18, "rebalance produced >= min out");
        // No value stranded in the router.
        assertEq(token0.balanceOf(address(migrator)), 0, "no token0 stuck in router");
        assertEq(token1.balanceOf(address(migrator)), 0, "no token1 stuck in router");
        // NFT returned to bob, now empty.
        assertEq(npm.ownerOf(id), bob, "NFT returned to bob");
        (, , , , , , , uint128 liq, , , , ) = npm.positions(id);
        assertEq(liq, 0, "position fully unwound");
        // Bob got some leftover dust back (recipient, never the router).
        assertGt(token0.balanceOf(bob), bob0Before - 0, "bob received dust/change");
    }

    /// A balanced position with swapAmountIn = 0 skips the swap entirely and still deposits.
    function test_migrate_balanced_noSwap() public {
        uint256 id = _mintPosition(bob, 60_000e18, 60_000e18);
        vm.prank(bob);
        npm.setApprovalForAll(address(migrator), true);

        vm.prank(bob);
        (uint256 shares, uint256 swapOut) = migrator.migrate(_params(id, true, 0, 0));

        assertGt(shares, 0, "shares minted without a rebalance swap");
        assertEq(swapOut, 0, "no swap performed");
        assertEq(token0.balanceOf(address(migrator)), 0, "no token0 stuck");
        assertEq(token1.balanceOf(address(migrator)), 0, "no token1 stuck");
        assertEq(vault.shares(bob), shares, "credited to bob");
    }

    /// The rebalance swap's min-out guard reverts a swap that would realize below the floor.
    function test_migrate_reverts_on_swap_slippage() public {
        uint256 id = _mintPosition(bob, 100_000e18, 0);
        vm.prank(bob);
        npm.setApprovalForAll(address(migrator), true);

        // Demand more out than a 50k swap can ever produce (> input) → SlippageExceeded.
        vm.prank(bob);
        vm.expectRevert();
        migrator.migrate(_params(id, true, 50_000e18, 51_000e18));
    }

    /// A position whose tokens don't match the vault's pair is rejected.
    function test_migrate_reverts_on_token_mismatch() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        token0.mint(address(this), 10_000e18);
        other.mint(address(this), 10_000e18);
        token0.approve(address(npm), 10_000e18);
        other.approve(address(npm), 10_000e18);
        uint256 id = npm.mint(bob, address(token0), address(other), 1_000e18, 10_000e18, 10_000e18);

        vm.prank(bob);
        npm.setApprovalForAll(address(migrator), true);
        vm.prank(bob);
        vm.expectRevert(Mintwarev3ToV4Migrator.TokenMismatch.selector);
        migrator.migrate(_params(id, true, 0, 0));
    }

    /// depositFor credits the recipient, not the paying router — the core new vault primitive.
    function test_depositFor_credits_recipient_not_payer() public {
        // Router-less direct check: this contract pays, bob receives.
        token0.mint(address(this), 10_000e18);
        token1.mint(address(this), 10_000e18);
        token0.approve(address(vault), 10_000e18);
        token1.approve(address(vault), 10_000e18);
        uint256 payerShares0 = vault.shares(address(this));
        uint256 s = vault.depositFor(bob, 10_000e18, 10_000e18, 0, LockTier.Flex);
        assertGt(s, 0, "shares minted");
        assertEq(vault.shares(bob), s, "recipient credited");
        assertEq(vault.shares(address(this)), payerShares0, "payer NOT credited");
    }
}
