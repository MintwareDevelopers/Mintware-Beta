// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, Vm} from "forge-std/Test.sol";

import {PoolManager}  from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}       from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}      from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}     from "@uniswap/v4-core/src/types/Currency.sol";

import {MintwareMatchedLiquidityVault} from "../../src/vaults/MintwareMatchedLiquidityVault.sol";
import {PoolProfile}                   from "../../src/vaults/VaultTypes.sol";
import {HookMiner}                     from "../../src/lib/HookMiner.sol";
import {MWHookCoordinator}             from "../../src/hooks/MWHookCoordinator.sol";

import {MockERC20}      from "../mocks/MockERC20.sol";
import {TestSwapRouter} from "../helpers/TestSwapRouter.sol";

/// @title  LEGAL FACT 3 — the community keeps full, unrestricted MEV / pool-fee yield
/// @notice Guard-tests that lock down the third legal fact for the matched-liquidity vault:
///
///           While the team is locked, swap-fee (and am-AMM MEV rent) yield accrues to the COMMUNITY
///           units only. The team's units are EXCLUDED from the fee denominator — the team earns 0%,
///           the community earns 100% of the LP remainder (net of the fixed Mintware protocol cut).
///           The community's upside is unrestricted: no cap, no team skim, no admin throttle.
///
///         Additive verification only; changes no mechanics. A failure here is a real finding.
contract CommunityFeesUnrestrictedTest is Test {
    address internal deployer = address(this);
    address internal team     = makeAddr("team");
    address internal treasury = makeAddr("treasury");
    address internal trader   = makeAddr("trader");
    address internal a        = makeAddr("lp_a");
    address internal b        = makeAddr("lp_b");
    address internal c        = makeAddr("lp_c");

    PoolManager                   internal pm;
    TestSwapRouter                internal swapRouter;
    MintwareMatchedLiquidityVault internal vault;
    MockERC20 internal proj;
    MockERC20 internal quote;
    bool      internal projIsToken0;
    PoolKey   internal poolKey;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    uint256 internal constant T         = 100_000e18;
    uint256 internal constant CAP       = 100_000e18;
    uint256 internal constant WINDOW    = 7 days;
    uint256 internal constant THRESHOLD = 5_000;
    uint256 internal constant LOCK      = 365 days;

    // keccak256("FeesCollected(uint256,uint256,uint256,uint256)")
    bytes32 internal constant FEES_COLLECTED_SIG =
        keccak256("FeesCollected(uint256,uint256,uint256,uint256)");

    function setUp() public {
        pm         = new PoolManager(deployer);
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));

        proj  = new MockERC20("Project", "PEPE", 18);
        quote = new MockERC20("Quote", "USDC", 18);
        projIsToken0 = address(proj) < address(quote);

        vault = new MintwareMatchedLiquidityVault(
            address(pm), address(proj), address(quote), team, treasury, address(0),
            PoolProfile.MEME, deployer
        );
        address coord = _deployCoord(address(vault));
        vault.setExpectedHook(coord);

        (Currency c0, Currency c1) = projIsToken0
            ? (Currency.wrap(address(proj)), Currency.wrap(address(quote)))
            : (Currency.wrap(address(quote)), Currency.wrap(address(proj)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(coord)});

        proj.mint(team, 1_000_000e18);
        quote.mint(a, 1_000_000e18);
        quote.mint(b, 1_000_000e18);
        quote.mint(c, 1_000_000e18);
        proj.mint(trader, 1_000_000e18);
        quote.mint(trader, 1_000_000e18);

        // Full lifecycle → active, locked, matched liquidity deployed.
        vm.startPrank(team);
        proj.approve(address(vault), T);
        vault.commitTeam(poolKey, INIT_SQRT_PRICE, T, CAP, WINDOW, THRESHOLD, LOCK);
        vm.stopPrank();
        _deposit(a, CAP * 40 / 100);
        _deposit(b, CAP * 40 / 100);
        _deposit(c, CAP - (CAP * 40 / 100) - (CAP * 40 / 100));
        vault.activate();
    }

    function _deployCoord(address vaultAddr) internal returns (address) {
        bytes memory args = abi.encode(IPoolManager(address(pm)), vaultAddr, deployer);
        (address expected, bytes32 salt) =
            HookMiner.find(deployer, uint160(0xAC8), type(MWHookCoordinator).creationCode, args);
        MWHookCoordinator h = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), vaultAddr, deployer);
        require(address(h) == expected, "coord addr");
        return address(h);
    }

    function _deposit(address who, uint256 amt) internal {
        vm.startPrank(who);
        quote.approve(address(vault), amt);
        vault.depositCommunity(amt);
        vm.stopPrank();
    }

    function _genFees() internal {
        vm.startPrank(trader);
        quote.approve(address(swapRouter), type(uint256).max);
        proj.approve(address(swapRouter), type(uint256).max);
        bool quoteIsZero = !projIsToken0;
        swapRouter.swap(poolKey, quoteIsZero, 5_000e18);
        swapRouter.swap(poolKey, !quoteIsZero, 4_000e18);
        vm.stopPrank();
    }

    /// FACT 3 — while locked, the fee DENOMINATOR excludes the team: it equals `totalCommunityShares`,
    /// NOT `totalCommunityShares + teamLiquidity`. This is the exact mechanism by which the team earns 0%
    /// and the community absorbs 100% of the LP fee remainder. Proven directly off the `FeesCollected` event.
    function test_fee_denominator_excludes_team_while_locked() public {
        assertTrue(vault.teamFeesRedirected(), "precondition: locked");
        assertGt(vault.teamLiquidity(), 0, "precondition: team holds locked liquidity");

        _genFees();

        vm.recordLogs();
        vault.collectFees();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 denom;
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == FEES_COLLECTED_SIG && logs[i].emitter == address(vault)) {
                (, , , denom) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                found = true;
                break;
            }
        }
        assertTrue(found, "no FeesCollected event");

        assertEq(denom, vault.totalCommunityShares(), "fee denominator must be community-only while locked");
        assertEq(
            denom + vault.teamLiquidity(),
            vault.totalCommunityShares() + vault.teamLiquidity(),
            "sanity"
        );
        assertLt(
            denom,
            vault.totalCommunityShares() + vault.teamLiquidity(),
            "team was included in the fee denominator (FACT 3 broken)"
        );
    }

    /// FACT 3 — team earns 0% while locked: a team fee claim moves nothing, while the community's claim
    /// pays out real fees. The community's yield is unrestricted (no team skim on it during the lock).
    function test_team_earns_zero_community_earns_during_lock() public {
        _genFees();
        vault.collectFees();

        // Team claim → nothing.
        uint256 teamProjBefore  = proj.balanceOf(team);
        uint256 teamQuoteBefore = quote.balanceOf(team);
        vm.prank(team);
        vault.claimTeamFees();
        assertEq(proj.balanceOf(team),  teamProjBefore,  "team earned proj fees while locked");
        assertEq(quote.balanceOf(team), teamQuoteBefore, "team earned quote fees while locked");

        // Community claim → real yield.
        (uint256 pendA, uint256 qA) = vault.pendingCommunityFees(a);
        assertTrue(pendA > 0 || qA > 0, "community has no claimable fees");
        uint256 pBefore = proj.balanceOf(a);
        uint256 qBefore = quote.balanceOf(a);
        vm.prank(a);
        vault.claimCommunityFees();
        assertTrue(
            proj.balanceOf(a) > pBefore || quote.balanceOf(a) > qBefore,
            "community did not receive its unrestricted fee share"
        );
    }

    /// FACT 3 — the community receives ~100% of the LP fee remainder (net only of the fixed 25% Mintware
    /// protocol cut). Summing the three community LPs' claimable ≈ the full LP remainder, with the team's
    /// zero share confirming nothing is siphoned to the team during the lock.
    function test_community_receives_full_lp_remainder_while_locked() public {
        _genFees();

        vm.recordLogs();
        vault.collectFees();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 projFees;
        uint256 quoteFees;
        uint256 mintCut;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == FEES_COLLECTED_SIG && logs[i].emitter == address(vault)) {
                (projFees, quoteFees, mintCut, ) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                break;
            }
        }
        assertTrue(projFees > 0 || quoteFees > 0, "no fees realized");

        // LP remainder = total realized fees minus the fixed Mintware protocol cut.
        uint256 lpRemainder = (projFees + quoteFees) - mintCut;

        // Sum the three community LPs' claimable across both assets.
        (uint256 pA, uint256 qA) = vault.pendingCommunityFees(a);
        (uint256 pB, uint256 qB) = vault.pendingCommunityFees(b);
        (uint256 pC, uint256 qC) = vault.pendingCommunityFees(c);
        uint256 communityClaimable = pA + qA + pB + qB + pC + qC;

        // Team gets 0% while locked (no team-side accrual in the denominator).
        assertEq(vault.teamProjDebt(), 0, "team accrued proj fees while locked");
        assertEq(vault.teamQuoteDebt(), 0, "team accrued quote fees while locked");

        // Community's claimable ≈ the whole LP remainder (allow tiny floor-dust from per-share division).
        assertApproxEqRel(
            communityClaimable, lpRemainder, 0.001e18,
            "community did not receive ~100% of the LP fee remainder"
        );
    }
}
