// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";
import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";

/// @notice End-to-end LP-gateway proof against a REAL Uniswap V4 PositionManager + a REAL Morpho
///         ERC-4626 adapter on a fork of the target chain (Robinhood Chain testnet first). SELF-SKIPS
///         when `LP_FORK_RPC_URL` is unset (mirrors the repo's other fork harnesses), so `forge test`
///         stays green everywhere; the operator runs it with the pool + adapter env set.
///
///         Proven here when configured: deploy the gateway → deposit USDG → it stages into Morpho and
///         mints entry-NAV shares → NAV reads back. The owner-only deploy()→harvest() round-trip needs
///         the paired token funded + a live range and is exercised by the operator's runbook (the same
///         env this harness reads), not hardcoded here.
contract MintwareLpGatewayForkTest is Test {
    bool internal live;
    MintwareLpGatewayStaging internal staging;
    MintwareLpGatewayPositionManager internal pm;
    IERC20 internal usdg;

    address internal alice = address(0xA11CE);

    function setUp() public {
        string memory rpc = vm.envOr("LP_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            live = false;
            return;
        }
        vm.createSelectFork(rpc);
        live = true;

        usdg = IERC20(vm.envAddress("LP_QUOTE_ASSET"));
        IYieldAdapter adapter = IYieldAdapter(vm.envAddress("LP_YIELD_ADAPTER"));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(vm.envAddress("LP_POOL_CURRENCY0")),
            currency1: Currency.wrap(vm.envAddress("LP_POOL_CURRENCY1")),
            fee: uint24(vm.envUint("LP_POOL_FEE")),
            tickSpacing: int24(vm.envInt("LP_POOL_TICK_SPACING")),
            hooks: IHooks(vm.envAddress("LP_POOL_HOOKS"))
        });

        staging = new MintwareLpGatewayStaging(usdg, adapter);
        pm = new MintwareLpGatewayPositionManager(
            IPoolManager(vm.envAddress("LP_POOL_MANAGER")),
            IPositionManager(vm.envAddress("LP_POSITION_MANAGER")),
            IPermit2Minimal(vm.envAddress("LP_PERMIT2")),
            key,
            usdg,
            int24(vm.envInt("LP_TICK_LOWER")),
            int24(vm.envInt("LP_TICK_UPPER")),
            staging,
            address(this),
            address(this)
        );
        staging.setController(address(pm));
    }

    function test_fork_deposit_stagesAndMintsEntryNavShares() public {
        if (!live) return; // self-skip without a fork RPC

        uint256 amount = 1_000e6; // 1,000 USDG (6dp)
        deal(address(usdg), alice, amount);

        vm.startPrank(alice);
        usdg.approve(address(pm), amount);
        uint256 shares = pm.deposit(amount);
        vm.stopPrank();

        assertGt(shares, 0, "shares minted");
        // idle USDG now earns in the real Morpho adapter; NAV reflects the deposit (± the adapter's rounding).
        assertApproxEqRel(pm.totalNav(), amount, 0.001e18);
        assertEq(pm.sharesOf(alice), shares);
    }
}
