// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {RTFlaky4626} from "../audit/RedTeamOnchainTokens.sol";

/// @notice Round-3 (Fable) independent check of scope invariant 11 ("lastKnownIdle is conservative").
///         The invariant as stated only considers YIELD accruing during a source outage (stale value too LOW ->
///         conservative). This probes the other direction: a LOSS realised in the source during the outage makes
///         `lastKnownIdle` stale-HIGH, and an outage-time exit re-credits shares against the inflated figure.
///         Question: does the exiting holder offload part of the loss onto the remaining holder?
contract Round3StaleIdleLossForkTest is Test {
    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant RH_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 constant SQRT_1 = 79228162514264337593543950336;
    int24 constant TL = -22980;
    int24 constant TU = 22980;

    bool live;
    IPoolManager poolManager;
    IPositionManager posm;
    MintwareLpGatewayStaging staging;
    MintwareLpGatewayPositionManager pm;
    MintwareERC4626YieldAdapter adapter;
    RTFlaky4626 source;
    MockERC20 quote;
    MockERC20 paired;
    PoolKey key;
    PoolModifyLiquidityTest lpRouter;

    address RECIP = address(0xFEE5);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address sink = address(0x10055); // where the "loss" goes

    function setUp() public {
        string memory rpc = vm.envOr("LP_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;

        poolManager = IPoolManager(RH_POOL_MANAGER);
        posm = IPositionManager(RH_POSITION_MANAGER);

        MockERC20 a = new MockERC20("Quote", "Q", 18);
        MockERC20 b = new MockERC20("Paired", "P", 18);
        (MockERC20 c0, MockERC20 c1) = address(a) < address(b) ? (a, b) : (b, a);
        quote = a;
        paired = b;
        key = PoolKey({
            currency0: Currency.wrap(address(c0)), currency1: Currency.wrap(address(c1)), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        poolManager.initialize(key, SQRT_1);

        source = new RTFlaky4626(IERC20(address(quote)));
        adapter = new MintwareERC4626YieldAdapter(address(quote), address(source), address(0), address(this));
        staging = new MintwareLpGatewayStaging(IERC20(address(quote)), adapter);
        adapter.setVault(address(staging));
        pm = new MintwareLpGatewayPositionManager(
            poolManager, posm, IPermit2Minimal(PERMIT2), key, IERC20(address(quote)), TL, TU, staging, address(this), RECIP, 500
        );
        staging.setController(address(pm));

        lpRouter = new PoolModifyLiquidityTest(poolManager);
        quote.mint(address(this), 10_000_000e18);
        paired.mint(address(this), 10_000_000e18);
        quote.approve(address(lpRouter), type(uint256).max);
        paired.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(key, ModifyLiquidityParams({tickLower: TL, tickUpper: TU, liquidityDelta: 2_200_000e18, salt: 0}), "");
        paired.approve(address(pm), type(uint256).max);

        for (uint256 i = 0; i < 2; i++) {
            address u = [alice, bob][i];
            quote.mint(u, 1_000_000e18);
            vm.prank(u);
            quote.approve(address(pm), type(uint256).max);
        }
    }

    function _wealth(address who) internal view returns (uint256) {
        return quote.balanceOf(who) + paired.balanceOf(who); // price ~1.0, same decimals
    }

    /// Alice + Bob 100k each. Owner deploys 100k quote + 100k paired (cap-full). Idle = 100k, LP ~ 200k.
    /// Then the source LOSES 20% of the idle (20k) and simultaneously goes unreadable. Alice exits during the
    /// outage; the source recovers; Bob exits. Compare with the fair split (both should share the 20k loss).
    function test_R3_staleIdle_lossDuringOutage_outageExiterOffloadsLoss() public {
        if (!live) return;
        vm.prank(alice);
        pm.deposit(100_000e18);
        vm.prank(bob);
        pm.deposit(100_000e18);
        pm.deploy(100_000e18, 100_000e18, 0, block.timestamp);
        uint256 b0 = block.number;
        vm.roll(b0 + 1);

        uint256 navBefore = pm.totalNav(); // ~300k: 100k idle + 200k LP (owner leg included)
        // A loss inside the source (bad debt realised): 20k of the 100k idle is gone. Then the source goes dark.
        vm.prank(address(source));
        quote.transfer(sink, 20_000e18);
        source.setRevertPreview(true);
        assertFalse(pm.sourceReadable(), "source is unreadable (sanity)");

        // Alice exits during the outage. lastKnownIdle is the PRE-loss 100k (last successful read was in deploy/deposit).
        uint256 aliceW0 = _wealth(alice);
        uint256 sA = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(sA);
        uint256 aliceLpOut = _wealth(alice) - aliceW0; // only the LP leg pays during the outage
        uint256 aliceKept = pm.sharesOf(alice); // idle claim re-credited, sized off the STALE 100k

        // Source recovers. Bob exits fully, then Alice exits her re-credited shares.
        source.setRevertPreview(false);
        vm.roll(b0 + 2);
        uint256 bobW0 = _wealth(bob);
        uint256 sB = pm.sharesOf(bob);
        vm.prank(bob);
        pm.withdraw(sB);
        uint256 bobOut = _wealth(bob) - bobW0;
        vm.roll(b0 + 3);
        uint256 aliceW1 = _wealth(alice);
        uint256 sA2 = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(sA2);
        uint256 aliceRestOut = _wealth(alice) - aliceW1;
        uint256 aliceTotal = aliceLpOut + aliceRestOut;

        // Fair: both held 50%; the 20k loss should be shared 10k / 10k. navBefore - 20k split in two.
        uint256 fairEach = (navBefore - 20_000e18) / 2;
        emit log_named_uint("navBefore", navBefore);
        emit log_named_uint("alice total out", aliceTotal);
        emit log_named_uint("bob total out", bobOut);
        emit log_named_uint("fair each", fairEach);
        emit log_named_uint("alice kept shares after outage exit", aliceKept);
        // The probe: if Alice ends above fair and Bob below by the same amount, the outage exit transferred loss.
        assertGt(aliceKept, 0, "idle leg was re-credited during the outage (sanity)");
        // Record the transfer magnitude for the report (no assert direction here — the number is the finding).
        if (aliceTotal > fairEach) emit log_named_uint("TRANSFER alice gained vs fair", aliceTotal - fairEach);
        if (bobOut < fairEach) emit log_named_uint("TRANSFER bob lost vs fair", fairEach - bobOut);
        // Value conservation must still hold regardless (nothing minted from thin air).
        assertLe(aliceTotal + bobOut, navBefore - 20_000e18 + 1e12, "no value created");
    }
}
