// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MintwareLpGatewayFactory} from "../../src/gateway/MintwareLpGatewayFactory.sol";
import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC4626} from "../mocks/MockERC4626.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {MockSlot0PoolManager} from "../mocks/MockSlot0PoolManager.sol";

contract Stub {}

contract MintwareLpGatewayFactoryTest is Test {
    using PoolIdLibrary for PoolKey;

    MintwareLpGatewayFactory factory;
    MockERC20 usdg;
    MockERC20 pons;
    MockYieldAdapter adapter;
    address stranger = address(0xBEEF);
    address gwOwner = address(0x0011);
    address sink = address(0x5151);

    function setUp() public {
        usdg = new MockERC20("USD Global", "USDG", 6);
        pons = new MockERC20("Pons", "PONS", 18);
        adapter = new MockYieldAdapter(address(usdg));
        address stub = address(new Stub());
        factory = new MintwareLpGatewayFactory(
            IPoolManager(address(new MockSlot0PoolManager())), IPositionManager(stub), IPermit2Minimal(stub), address(this)
        );
    }

    function _key(uint24 fee) internal view returns (PoolKey memory) {
        (address c0, address c1) =
            address(usdg) < address(pons) ? (address(usdg), address(pons)) : (address(pons), address(usdg));
        return PoolKey({currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: fee, tickSpacing: 60, hooks: IHooks(address(0))});
    }

    function test_createGateway_isolatedInstance() public {
        PoolKey memory key = _key(3000);
        (address s, address p) = factory.createGateway(key, IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink, 2000, type(uint256).max);
        assertTrue(s != address(0) && p != address(0));
        assertEq(MintwareLpGatewayStaging(s).controller(), p);
        assertEq(factory.poolCount(), 1);
        (address rs, address rp, bool active) = factory.instanceForPool(PoolId.unwrap(key.toId()));
        assertEq(rs, s);
        assertEq(rp, p);
        assertTrue(active);
        assertTrue(factory.adapterUsed(address(adapter)));
    }

    function test_createGateway_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        factory.createGateway(_key(3000), IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink, 2000, type(uint256).max);
    }

    function test_createGateway_duplicateReverts() public {
        factory.createGateway(_key(3000), IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink, 2000, type(uint256).max);
        MockYieldAdapter adapter2 = new MockYieldAdapter(address(usdg));
        // A duplicate POOL reverts on AlreadyExists regardless of the (fresh) adapter.
        vm.expectRevert(MintwareLpGatewayFactory.AlreadyExists.selector);
        factory.createGateway(_key(3000), IERC20(address(usdg)), adapter2, -22980, 22980, gwOwner, sink, 2000, type(uint256).max);
    }

    // M2: reusing one adapter instance across two different pools would pool their staged capital and
    // cross-contaminate NAV — the factory rejects it. Each gateway needs its own adapter.
    function test_createGateway_adapterReuse_reverts() public {
        factory.createGateway(_key(3000), IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink, 2000, type(uint256).max);
        vm.expectRevert(MintwareLpGatewayFactory.AdapterReused.selector);
        factory.createGateway(_key(500), IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink, 2000, type(uint256).max);
    }

    // A zero band falls back to the factory default (kept easy for the curator).
    function test_createGateway_zeroBand_usesDefault() public {
        (, address p) = factory.createGateway(_key(3000), IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink, 0, type(uint256).max);
        assertEq(MintwareLpGatewayPositionManager(p).maxDeviationBps(), factory.DEFAULT_MAX_DEVIATION_BPS());
    }

    function test_twoPools_isolated() public {
        MockYieldAdapter adapterB = new MockYieldAdapter(address(usdg));
        (, address p1) = factory.createGateway(_key(3000), IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink, 2000, type(uint256).max);
        (, address p2) = factory.createGateway(_key(500), IERC20(address(usdg)), adapterB, -22980, 22980, gwOwner, sink, 2000, type(uint256).max);
        assertTrue(p1 != p2);
        assertEq(factory.poolCount(), 2);
    }

    // ── C-9b (Hacken F-07): the factory verifies the adapter binding before wiring it ─────────────────

    /// Branch 1 — the adapter ANSWERS `asset()` (production `MintwareERC4626YieldAdapter`) with the pool's quote
    /// → accepted.
    function test_adapterBinding_productionAdapter_matchingAsset_passes() public {
        MockERC4626 src = new MockERC4626(IERC20(address(usdg)));
        MintwareERC4626YieldAdapter prod =
            new MintwareERC4626YieldAdapter(address(usdg), address(src), address(0), address(this));
        (address s,) = factory.createGateway(
            _key(3000), IERC20(address(usdg)), IYieldAdapter(address(prod)), -22980, 22980, gwOwner, sink, 0, type(uint256).max
        );
        assertTrue(s != address(0));
    }

    /// Branch 1 — `asset()` answers with a DIFFERENT token than the pool quotes in → AdapterAssetMismatch.
    /// Pre-fix: the instance deployed fine and every deposit reverted (DOA). Note: `adapterUsed` is written
    /// before the probe, but the whole tx reverts so the adapter is NOT burned.
    function test_adapterBinding_productionAdapter_wrongAsset_reverts() public {
        MockERC4626 srcPons = new MockERC4626(IERC20(address(pons)));
        MintwareERC4626YieldAdapter wrong =
            new MintwareERC4626YieldAdapter(address(pons), address(srcPons), address(0), address(this));
        vm.expectRevert(MintwareLpGatewayFactory.AdapterAssetMismatch.selector);
        factory.createGateway(
            _key(3000), IERC20(address(usdg)), IYieldAdapter(address(wrong)), -22980, 22980, gwOwner, sink, 0, type(uint256).max
        );
        assertFalse(factory.adapterUsed(address(wrong)), "revert rolled back the adapterUsed mark");
    }

    /// Branch 2 — an older `IYieldAdapter` with NO `asset()` (MockYieldAdapter exposes `underlying()`): the
    /// fallback sanity call `totalAssets()` succeeds → accepted (its value is 0 for a fresh adapter — fine).
    function test_adapterBinding_legacyAdapter_noAssetGetter_fallsBackToTotalAssets() public {
        assertEq(adapter.totalAssets(), 0, "fresh legacy adapter holds nothing - zero is accepted");
        (address s,) = factory.createGateway(_key(3000), IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink, 0, type(uint256).max);
        assertTrue(s != address(0));
    }

    /// Branch 2 — a contract that answers NEITHER `asset()` nor `totalAssets()` is not an adapter → AdapterUnreadable.
    function test_adapterBinding_notAnAdapter_reverts() public {
        address notAdapter = address(new Stub());
        vm.expectRevert(MintwareLpGatewayFactory.AdapterUnreadable.selector);
        factory.createGateway(
            _key(3000), IERC20(address(usdg)), IYieldAdapter(notAdapter), -22980, 22980, gwOwner, sink, 0, type(uint256).max
        );
    }

    /// Codeless address (EOA): both probes return empty data → AdapterUnreadable (was: DOA instance).
    function test_adapterBinding_eoa_reverts() public {
        vm.expectRevert(MintwareLpGatewayFactory.AdapterUnreadable.selector);
        factory.createGateway(
            _key(3000), IERC20(address(usdg)), IYieldAdapter(address(0xE0A)), -22980, 22980, gwOwner, sink, 0, type(uint256).max
        );
    }

    /// Branch 3 — the adapter's ONE-TIME `vault()` is already wired elsewhere: it can never point at the new
    /// staging, so the instance would be DOA → AdapterAlreadyBound.
    function test_adapterBinding_vaultAlreadyWired_reverts() public {
        MockERC4626 src = new MockERC4626(IERC20(address(usdg)));
        MintwareERC4626YieldAdapter bound =
            new MintwareERC4626YieldAdapter(address(usdg), address(src), address(0xD0D0), address(this));
        vm.expectRevert(MintwareLpGatewayFactory.AdapterAlreadyBound.selector);
        factory.createGateway(
            _key(3000), IERC20(address(usdg)), IYieldAdapter(address(bound)), -22980, 22980, gwOwner, sink, 0, type(uint256).max
        );
    }

    function test_deactivate() public {
        PoolKey memory key = _key(3000);
        factory.createGateway(key, IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink, 2000, type(uint256).max);
        factory.deactivate(PoolId.unwrap(key.toId()));
        (,, bool active) = factory.instanceForPool(PoolId.unwrap(key.toId()));
        assertFalse(active);
        vm.expectRevert(MintwareLpGatewayFactory.NotFound.selector);
        factory.deactivate(bytes32(uint256(0xdead)));
    }
}
