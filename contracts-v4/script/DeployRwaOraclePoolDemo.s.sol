// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PoolManager}   from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}  from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}        from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}       from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}      from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary}  from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath}      from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}  from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest}  from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {HookMiner}          from "../src/lib/HookMiner.sol";
import {MintwareOracleHook} from "../src/rwa/MintwareOracleHook.sol";
import {MockERC20}          from "../test/mocks/MockERC20.sol";

/// @notice ONE-SHOT testnet demo of the RWA SECONDARY market: the vRWA/USDC
///         oracle-banded Uniswap V4 pool. Deploys a self-contained stack (fresh
///         PoolManager + test tokens + LP/swap routers + a CREATE2-mined
///         MintwareOracleHook), initializes the dynamic-fee pool, sets the NAV
///         appraisal + ±core/±spec bands, seeds liquidity, and runs an in-band
///         swap so the band fee actually fires. This is the surface R1 volume +
///         R2 LP campaigns point at — the "make tokenized RWA tradeable" half.
///
///         Self-contained (fresh test tokens, no faucet) — the deployer only needs
///         Base Sepolia ETH for gas. Dry-run verified on anvil. Not a production
///         deploy: a real pool uses the deal's live vRWA token + a real keeper NAV.
///
/// ─── Required env ────────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY  — funded with Base Sepolia ETH (plays LP + swapper + keeper)
///
/// ─── Run ─────────────────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY=0x… pnpm forge:rwa-oracle-pool:base-sepolia
contract DeployRwaOraclePoolDemo is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    address constant C2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint160 constant HOOK_FLAGS = 0xA80;                                  // beforeAddLiq+beforeRemoveLiq+beforeSwap
    uint160 constant INIT_SQRT_PRICE = 79228162514264337593543950336;     // 1:1 @ tick 0
    uint16  constant CORE_BPS = 1500;                                     // ±15%
    uint16  constant SPEC_BPS = 4500;                                     // ±45%

    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me  = vm.addr(key);

        console.log("=== Mintware RWA Oracle Pool Demo ===");
        console.log("Chain:      ", block.chainid);
        console.log("Deployer:   ", me);

        vm.startBroadcast(key);

        // 1) Fresh PoolManager + test tokens + routers
        PoolManager pm  = new PoolManager(me);
        MockERC20 usdc  = new MockERC20("Test USDC", "tUSDC", 6);
        MockERC20 vrwa  = new MockERC20("Mintware vRWA", "vRWA", 6);
        usdc.mint(me, 1_000_000_000e6);
        vrwa.mint(me, 1_000_000_000e6);

        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(pm);
        PoolSwapTest            swapRouter = new PoolSwapTest(pm);

        // 2) Mine + deploy the oracle hook. vault = lpRouter so LP is allowed (the hook
        //    gates modifyLiquidity to `vault`); keeper = me (posts the appraisal); owner = me.
        bytes memory ctorArgs = abi.encode(IPoolManager(address(pm)), address(lpRouter), me, me);
        (address hookAddr, bytes32 salt) =
            HookMiner.find(C2_FACTORY, HOOK_FLAGS, type(MintwareOracleHook).creationCode, ctorArgs);
        MintwareOracleHook hook =
            new MintwareOracleHook{salt: salt}(IPoolManager(address(pm)), address(lpRouter), me, me);
        require(address(hook) == hookAddr, "hook address mismatch");

        // 3) vRWA/USDC pool — DYNAMIC fee (the hook overrides per-swap), hook attached.
        bool vFirst = address(vrwa) < address(usdc);
        PoolKey memory pk = PoolKey({
            currency0:   Currency.wrap(vFirst ? address(vrwa) : address(usdc)),
            currency1:   Currency.wrap(vFirst ? address(usdc) : address(vrwa)),
            fee:         LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks:       IHooks(address(hook))
        });
        pm.initialize(pk, INIT_SQRT_PRICE);

        // 4) Band config + NAV appraisal (1:1 → Q96 = 2^96). Bands: ±15% core / ±45% spec.
        PoolId id = pk.toId();
        hook.configurePool(id, CORE_BPS, SPEC_BPS);
        hook.setAppraisal(id, hook.priceX96FromSqrt(INIT_SQRT_PRICE));

        // 5) Seed liquidity via the router (the hook's `vault`), ±600 ticks around par.
        usdc.approve(address(lpRouter), type(uint256).max);
        vrwa.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            pk,
            ModifyLiquidityParams({ tickLower: -600, tickUpper: 600, liquidityDelta: 1e12, salt: bytes32(0) }),
            ""
        );

        // 6) In-band swap — small enough to stay inside the core band → core fee (0.75%).
        usdc.approve(address(swapRouter), type(uint256).max);
        vrwa.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(
            pk,
            SwapParams({ zeroForOne: true, amountSpecified: -1_000e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1 }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );

        vm.stopBroadcast();

        (uint160 sqrtAfter,,,) = IPoolManager(address(pm)).getSlot0(id);
        (uint256 bandLo, uint256 bandHi) = hook.getActiveBands(id);

        console.log("--- addresses ---");
        console.log("PoolManager: ", address(pm));
        console.log("OracleHook:  ", address(hook), "(flags 0xA80)");
        console.log("tUSDC:       ", address(usdc));
        console.log("vRWA:        ", address(vrwa));
        console.log("LP router:   ", address(lpRouter));
        console.log("Swap router: ", address(swapRouter));
        console.log("--- pool ---");
        console.log("appraisal Q96:", hook.priceX96FromSqrt(INIT_SQRT_PRICE));
        console.log("core band lo/hi (Q96):", bandLo, bandHi);
        console.log("sqrtPrice after in-band swap:", uint256(sqrtAfter));
        console.log("current band fee (pips):", hook.previewFee(id, hook.priceX96FromSqrt(sqrtAfter)));
        console.log("=> vRWA/USDC oracle-banded pool live: swap succeeded inside band, band fee applied.");
    }
}
