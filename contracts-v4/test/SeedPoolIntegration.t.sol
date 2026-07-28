// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}          from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}         from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}               from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}              from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}             from "@uniswap/v4-core/src/types/Currency.sol";

import {FeeVault}              from "../src/FeeVault.sol";
import {MWSocialHook}          from "../src/MWSocialHook.sol";
import {HookMiner}             from "../src/lib/HookMiner.sol";
import {MintwareDeFiVault4626} from "../src/vaults/MintwareDeFiVault4626.sol";
import {VaultSurface, VaultConfig} from "../src/vaults/VaultTypes.sol";

import {MintwareSeedPool}    from "../src/MintwareSeedPool.sol";
import {MintwareSeedAdapter} from "../src/MintwareSeedAdapter.sol";
import {MockERC20}           from "./mocks/MockERC20.sol";

/// @notice End-to-end: SeedPool raise → adapter → REAL MintwareDeFiVault4626 on a
///         real V4 PoolManager. Proves the whole fair-launch → live-pool handoff:
///         finalize seeds the reserve + inits the pool + deposits raised quote as
///         liquidity, growth adds more, and LP shares accrue to the adapter.
contract SeedPoolIntegrationTest is Test {
    address internal deployer = address(this);
    address internal team     = makeAddr("team");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal oracle   = makeAddr("oracle");
    address internal treasury = makeAddr("treasury");
    address internal feeTreasury = makeAddr("feeTreasury");
    address internal dist     = makeAddr("distributor");

    PoolManager internal pm;
    FeeVault    internal feeVault;
    MWSocialHook internal hook;
    MintwareDeFiVault4626 internal vault;
    MintwareSeedPool    internal seedPool;
    MintwareSeedAdapter internal adapter;

    MockERC20 internal usdc;
    MockERC20 internal proj;
    PoolKey internal poolKey;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    bytes32 internal constant VAULT_ID = keccak256("defi-vault");
    bytes32 internal constant SEED = keccak256("seed-1");

    uint256 internal constant RESERVE = 100_000e6; // project token (6dp)
    uint256 internal constant TEAM_QUOTE = 4_000e6; // USDC
    uint256 internal constant PUBLIC_TARGET = 6_000e6; // USDC
    // quoteTarget 10_000e6 ; threshold @ 50% = 5_000e6

    function _cfg() internal view returns (VaultConfig memory) {
        return VaultConfig({
            surface:             VaultSurface.DeFi,
            provider:            deployer,
            underlyingToken:     address(usdc),
            treasury:            feeTreasury,
            name:                "MW DeFi Vault Share",
            symbol:              "mwDEFI",
            minDeposit:          0,
            entryFeeBps:         0,
            exitFeeBps:          0,
            enableMEVProtection: true,
            enableIdleCapital:   false,
            idleTargetRatio:     0
        });
    }

    function setUp() public {
        pm = new PoolManager(deployer);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        proj = new MockERC20("Project Token", "PROJ", 6);
        bool usdcIsToken0 = address(usdc) < address(proj);

        feeVault = new FeeVault(address(usdc), dist, oracle, treasury);

        bytes memory hookArgs = abi.encode(
            IPoolManager(address(pm)), address(usdc), address(feeVault),
            treasury, address(0), address(0), deployer
        );
        (, bytes32 salt) = HookMiner.find(deployer, uint160(0x0AC4), type(MWSocialHook).creationCode, hookArgs);
        hook = new MWSocialHook{salt: salt}(
            IPoolManager(address(pm)), address(usdc), address(feeVault),
            treasury, address(0), address(0), deployer
        );

        vault = new MintwareDeFiVault4626(_cfg(), address(pm), address(feeVault));
        hook.setSocialVault(address(vault));
        feeVault.setSocialVault(address(vault));
        feeVault.setHook(address(hook));

        (Currency c0, Currency c1) = usdcIsToken0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(proj)))
            : (Currency.wrap(address(proj)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(hook))});

        seedPool = new MintwareSeedPool();
        adapter = new MintwareSeedAdapter(address(vault), address(seedPool), VAULT_ID, poolKey, -60000, 60000);

        // The adapter drives owner-only seed/rebalance → make it the vault owner.
        vault.transferOwnership(address(adapter));

        proj.mint(team, RESERVE);
        usdc.mint(team, TEAM_QUOTE);
        usdc.mint(alice, 10_000e6);
        usdc.mint(bob, 10_000e6);
    }

    function _open() internal {
        vm.startPrank(team);
        proj.approve(address(seedPool), RESERVE);
        usdc.approve(address(seedPool), TEAM_QUOTE);
        seedPool.openSeed(
            SEED,
            MintwareSeedPool.OpenParams({
                projectToken: address(proj),
                quoteToken: address(usdc),
                target: address(adapter),
                tokenReserve: RESERVE,
                teamQuote: TEAM_QUOTE,
                publicQuoteTarget: PUBLIC_TARGET,
                deployThresholdBps: 5_000,
                raiseDeadline: uint64(block.timestamp + 14 days),
                sqrtPriceX96: INIT_SQRT_PRICE,
                poolInit: VAULT_ID,
                fullReserveOnFinalize: true
            })
        );
        vm.stopPrank();
    }

    function _contribute(address who, uint256 amt) internal {
        vm.startPrank(who);
        usdc.approve(address(seedPool), amt);
        seedPool.contributeQuote(SEED, amt);
        vm.stopPrank();
    }

    // ── the end-to-end test ──────────────────────────────────────────────────
    function test_seedPool_to_liveVault_finalize_and_grow() public {
        _open();
        _contribute(alice, 1_000e6); // raised 5_000e6 == threshold

        // FINALIZE → adapter seeds the vault, inits the pool, deposits raised USDC.
        seedPool.finalizeSeed(SEED);

        assertTrue(adapter.seeded(), "adapter seeded");
        assertGt(adapter.totalShares(), 0, "LP shares minted to adapter");
        assertEq(vault.balanceOf(address(adapter)), adapter.totalShares(), "adapter holds the shares");
        assertGt(vault.totalLiquidity(), 0, "pool liquidity deployed");
        assertEq(vault.totalPrincipal(), 5_000e6, "principal = raised quote so far");

        uint256 sharesAfterSeed = adapter.totalShares();
        uint256 liqAfterSeed = vault.totalLiquidity();

        // GROW → fill the target, deploy the new USDC as more liquidity.
        _contribute(bob, 5_000e6); // raised 10_000e6 (full target)
        seedPool.growLiquidity(SEED);

        assertGt(adapter.totalShares(), sharesAfterSeed, "more shares from growth");
        assertGt(vault.totalLiquidity(), liqAfterSeed, "liquidity grew");
        assertEq(vault.totalPrincipal(), 10_000e6, "principal = full raised quote");

        // Seed pool reached its grown terminal state.
        (MintwareSeedPool.Phase phase, , , , uint256 dQuote) = seedPool.getState(SEED);
        assertEq(uint256(phase), uint256(MintwareSeedPool.Phase.Grown), "seed grown");
        assertEq(dQuote, 10_000e6, "all quote deployed");

        // The whole reserve landed in the vault; the seed pool holds no leftovers.
        assertEq(proj.balanceOf(address(seedPool)), 0, "no reserve stranded in pool");
        assertEq(usdc.balanceOf(address(seedPool)), 0, "no quote stranded in pool");
    }
}
