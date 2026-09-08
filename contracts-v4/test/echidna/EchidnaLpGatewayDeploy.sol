// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockSlot0PoolManager} from "../mocks/MockSlot0PoolManager.sol";
import {Audit3FlakySource} from "../audit3/InvariantMocks.sol";
import {MockV4Permit2, MockV4PositionManager} from "./MockV4Periphery.sol";
import {GwActor} from "./EchidnaLpGatewayIdle.sol";

/// @title  Echidna / Medusa property harness — LP gateway, DEPLOYED rig (task priority 3)
/// @notice The idle rig (`EchidnaLpGatewayIdle`) never reaches `deploy`, so `MAX_DEPLOY_BPS` is vacuous there.
///         This rig wires an accounting-faithful v4 periphery stand-in (`MockV4PositionManager`) so
///         `deposit → deploy → withdraw` sequences actually move `deployedPrincipal`, and encodes the cost-basis
///         cap and its neighbours as properties.
///
/// @dev    Read `MockV4Periphery.sol`'s FIDELITY BOUNDARY comment. In short: this rig is sound for the
///         GATEWAY'S OWN state machine (`deployedPrincipal`, the cap, the two-sided guard, the follower band on
///         `deploy`, share conservation) and NOT for pool economics — those stay with the Foundry fork suite.
///         Any counterexample from here must be re-derived against real v4 before it is called a finding.
///
///         Properties:
///           D1 `echidna_deploy_cap_at_deploy`   the cap the contract CHECKS: no deploy ever admitted more than
///                                               MAX_DEPLOY_BPS of principal-at-cost (checked pre-call, exact)
///           D2 `echidna_deploy_cap_continuous`  the STRONGER continuous form: deployedPrincipal is always
///                                               <= MAX_DEPLOY_BPS of (idle + deployedPrincipal). NOT something
///                                               the contract claims — encoded to find out whether a
///                                               withdraw-after-deploy sequence can push past it.
///           D3 `echidna_dp_moves_only_lawfully` deployedPrincipal rises only in `deploy` (by quoteUsed) and
///                                               falls only in `withdraw`, by the liquidity fraction removed
///           D4 `echidna_shares_conserved`       Σ sharesOf == totalShares
///           D5 `echidna_follower_band`          the clamped follower still moves <= one band step per block
///           D6 `echidna_dp_zero_iff_empty`      deployedPrincipal == 0 whenever the position holds no liquidity
contract EchidnaLpGatewayDeploy {
    uint256 internal constant V = 1e6;
    uint256 internal constant N = 4;
    uint160 internal constant SQRT_ONE = 0x1000000000000000000000000;
    uint16 internal constant DEV_BPS = 2000;
    int24 internal constant TICK_LO = -23040;
    int24 internal constant TICK_HI = 23040;

    MintwareLpGatewayPositionManager public pm;
    MintwareLpGatewayStaging public staging;
    MintwareERC4626YieldAdapter public adapter;
    Audit3FlakySource public src;
    MockERC20 public usdg;
    MockERC20 public paired;
    MockSlot0PoolManager public mockPool;
    MockV4PositionManager public posm;
    MockV4Permit2 public permit2;

    GwActor[4] public actors;
    mapping(address => uint256) internal lastAct;

    // ── violation counters ──────────────────────────────────────────────────────────────────
    uint256 public capAtDeployViolations;
    uint256 public capContinuousViolations;
    uint256 public dpMoveViolations;
    uint256 public followerBandViolations;
    uint256 public dpZeroViolations;

    // ── diagnostics ─────────────────────────────────────────────────────────────────────────
    uint256 public worstCapBps; // highest observed deployedPrincipal / (idle + deployedPrincipal) in bps
    uint256 public lastDpBefore;
    uint256 public lastDpAfter;
    uint256 public lastIdleAtBreach;

    // ── witnesses ───────────────────────────────────────────────────────────────────────────
    uint256 public nDeposits;
    uint256 public nDeploys;
    uint256 public nWithdraws;
    uint256 public nDeployRefusals;
    uint256 public nCapRefusals;
    uint256 public nBandRefusals;
    uint256 public nTwoSidedRefusals;
    uint256 public nHarvests;

    constructor() {
        usdg = new MockERC20("Mock USDG", "tUSDG", 6);
        paired = new MockERC20("Mock PAIRED", "tPAIR", 18);
        src = new Audit3FlakySource(IERC20(address(usdg)));
        adapter = new MintwareERC4626YieldAdapter(address(usdg), address(src), address(0), address(this));
        staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        adapter.setVault(address(staging));

        mockPool = new MockSlot0PoolManager();
        permit2 = new MockV4Permit2();
        posm = new MockV4PositionManager(permit2, address(mockPool));
        posm.setTickSqrt(TICK_LO, TickMath.getSqrtPriceAtTick(TICK_LO));
        posm.setTickSqrt(TICK_HI, TickMath.getSqrtPriceAtTick(TICK_HI));

        (address c0, address c1) = address(usdg) < address(paired)
            ? (address(usdg), address(paired))
            : (address(paired), address(usdg));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        pm = new MintwareLpGatewayPositionManager(
            IPoolManager(address(mockPool)),
            IPositionManager(address(posm)),
            IPermit2Minimal(address(permit2)),
            key,
            IERC20(address(usdg)),
            TICK_LO,
            TICK_HI,
            staging,
            address(this), // owner — the harness is the deploy/harvest seat
            address(0xFEE),
            DEV_BPS
        );
        staging.setController(address(pm));

        for (uint256 i; i < N; ++i) {
            actors[i] = new GwActor();
            usdg.mint(address(actors[i]), 1_000_000_000e6);
            actors[i].approve(IERC20(address(usdg)), address(pm));
        }
        // The harness supplies the paired leg on every deploy (the zap the cron does off-chain).
        paired.mint(address(this), 1_000_000_000_000e18);
        paired.approve(address(pm), type(uint256).max);
        usdg.mint(address(this), 1_000_000_000e6);
        usdg.approve(address(src), type(uint256).max);
        // Pre-fund the pool stand-in so a decrease never fails for a reserve reason (see FIDELITY BOUNDARY).
        usdg.mint(address(posm), 1_000_000_000_000e6);
        paired.mint(address(posm), 1_000_000_000_000e18);
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────

    function _idle() internal view returns (bool ok, uint256 idle) {
        try staging.stagedAssets() returns (uint256 v) {
            return (true, v + usdg.balanceOf(address(pm)));
        } catch {
            return (false, 0);
        }
    }

    function _capBps() internal view returns (uint256) {
        (, uint256 idle) = _idle();
        uint256 dp = pm.deployedPrincipal();
        uint256 principal = idle + dp;
        if (principal == 0) return 0;
        return (dp * 10_000) / principal;
    }

    /// Runs after every state-changing call — records the worst observed cost-basis ratio and flags a breach.
    function _observeCap() internal {
        uint256 bps = _capBps();
        if (bps > worstCapBps) worstCapBps = bps;
        if (bps > pm.MAX_DEPLOY_BPS()) {
            ++capContinuousViolations;
            (, lastIdleAtBreach) = _idle();
        }
    }

    function _checkFollower(uint160 refBefore, uint64 refBlockBefore) internal {
        (uint160 refAfter,,) = pm.referencePrice();
        if (refAfter == refBefore) return;
        if (!(block.number > refBlockBefore)) {
            ++followerBandViolations;
            return;
        }
        uint160 maxStep = uint160((uint256(refBefore) * DEV_BPS) / 10_000);
        uint256 delta = refAfter > refBefore ? refAfter - refBefore : refBefore - refAfter;
        if (delta > maxStep) ++followerBandViolations;
    }

    // ── fuzz entry points ───────────────────────────────────────────────────────────────────

    function deposit(uint8 who, uint256 amtSeed) public {
        GwActor a = actors[who % N];
        address addr = address(a);
        uint256 amt = amtSeed % 500_000e6;
        if (amt == 0 || amt > usdg.balanceOf(addr)) return;
        if (lastAct[addr] == block.number) return;
        (uint160 refB, uint64 refBlkB,) = pm.referencePrice();
        (bool ok,) = a.call(address(pm), abi.encodeWithSelector(pm.deposit.selector, amt));
        if (ok) {
            ++nDeposits;
            lastAct[addr] = block.number;
            _checkFollower(refB, refBlkB);
        }
        _observeCap();
    }

    function withdraw(uint8 who, uint256 shareSeed) public {
        GwActor a = actors[who % N];
        address addr = address(a);
        uint256 bal = pm.sharesOf(addr);
        if (bal == 0) return;
        uint256 shares = (shareSeed % bal) + 1;
        if (lastAct[addr] == block.number) return;

        uint256 dpBefore = pm.deployedPrincipal();
        uint128 liqBefore = posm.getPositionLiquidity(pm.tokenId());
        bool lastHolder = shares == pm.totalShares();
        (uint160 refB, uint64 refBlkB,) = pm.referencePrice();

        (bool ok,) = a.call(address(pm), abi.encodeWithSelector(pm.withdraw.selector, shares));
        if (ok) {
            ++nWithdraws;
            lastAct[addr] = block.number;
            uint256 dpAfter = pm.deployedPrincipal();
            lastDpBefore = dpBefore;
            lastDpAfter = dpAfter;
            // D3: a withdraw may only DECREASE deployedPrincipal, and by exactly the liquidity fraction removed.
            if (dpAfter > dpBefore) {
                ++dpMoveViolations;
            } else if (liqBefore > 0 && !lastHolder) {
                uint128 liqAfter = posm.getPositionLiquidity(pm.tokenId());
                uint256 removed = uint256(liqBefore) - uint256(liqAfter);
                uint256 expected = dpBefore - Math.mulDiv(dpBefore, removed, uint256(liqBefore));
                if (dpAfter != expected) ++dpMoveViolations;
            } else if (lastHolder && dpAfter != 0 && liqBefore > 0) {
                ++dpMoveViolations;
            }
            _checkFollower(refB, refBlkB);
        }
        _observeCap();
    }

    /// Owner deploy. The cap is asserted from PRE-state: the contract must refuse anything that would put
    /// `deployedPrincipal + quoteToDeploy` above MAX_DEPLOY_BPS of principal-at-cost.
    function deployLp(uint256 quoteSeed, uint256 pairedSeed) public {
        (bool srcOk, uint256 idle) = _idle();
        uint256 dp = pm.deployedPrincipal();
        uint256 quoteToDeploy = idle == 0 ? (quoteSeed % 1_000e6) : (quoteSeed % (idle + 1));
        uint256 pairedAmount = pairedSeed % 2_000_000e18;
        if (quoteToDeploy == 0 && pairedAmount == 0) return;

        uint256 principal = idle + dp;
        bool expCapRefusal = srcOk && (dp + quoteToDeploy > (principal * uint256(pm.MAX_DEPLOY_BPS())) / 10_000);

        (uint160 refB, uint64 refBlkB,) = pm.referencePrice();
        uint256 dpBefore = dp;

        try pm.deploy(quoteToDeploy, pairedAmount, 0, block.timestamp + 1) {
            ++nDeploys;
            // D1: the contract must NOT have admitted a deploy the cap forbids.
            if (expCapRefusal) {
                ++capAtDeployViolations;
                lastDpBefore = dpBefore;
                lastDpAfter = pm.deployedPrincipal();
            }
            if (pm.deployedPrincipal() < dpBefore) ++dpMoveViolations; // deploy may only add cost basis
            _checkFollower(refB, refBlkB);
        } catch {
            ++nDeployRefusals;
            if (expCapRefusal) ++nCapRefusals;
        }
        _observeCap();
    }

    function harvestFees(uint256 seed) public {
        if (pm.tokenId() == 0) return;
        posm.accrueFees(pm.tokenId(), seed % 1_000e6, (seed >> 8) % 1_000e18);
        (uint160 refB, uint64 refBlkB,) = pm.referencePrice();
        try pm.harvest(block.timestamp + 1) {
            ++nHarvests;
            _checkFollower(refB, refBlkB);
        } catch {}
        _observeCap();
    }

    function donate(uint256 amtSeed) public {
        uint256 amt = amtSeed % 100_000e6;
        if (amt == 0 || amt > usdg.balanceOf(address(this))) return;
        try src.simulateYield(amt) {} catch {}
        _observeCap();
    }

    function setSpot(uint256 seed) public {
        // Stay inside a plausible band around 1.0 so deploys are not permanently out of band.
        uint160 s = uint160(SQRT_ONE / 4 + (seed % (uint256(SQRT_ONE) * 4)));
        if (s == 0) s = 1;
        mockPool.setSqrtPrice(s);
    }

    function pokeFollower() public {
        (uint160 refB, uint64 refBlkB,) = pm.referencePrice();
        pm.poke();
        _checkFollower(refB, refBlkB);
    }

    function setStall(bool f) public {
        src.setFailWithdrawals(f);
    }

    function setSupplyCap(uint256 capSeed) public {
        src.setSupplyCap(capSeed % 4 == 0 ? 0 : src.totalAssets() + (capSeed % 200_000e6));
    }

    // ── properties ──────────────────────────────────────────────────────────────────────────

    /// D1 — the cap the contract actually enforces: no deploy is admitted past MAX_DEPLOY_BPS of cost basis.
    function echidna_deploy_cap_at_deploy() public view returns (bool) {
        return capAtDeployViolations == 0;
    }

    /// D2 — the STRONGER continuous form. The contract only claims the check at deploy time; this asks whether
    ///      any reachable sequence leaves the ratio above the cap afterwards.
    function echidna_deploy_cap_continuous() public view returns (bool) {
        return capContinuousViolations == 0;
    }

    /// D3 — `deployedPrincipal` moves only where and by how much the spec says.
    function echidna_dp_moves_only_lawfully() public view returns (bool) {
        return dpMoveViolations == 0;
    }

    function echidna_shares_conserved() public view returns (bool) {
        uint256 s;
        for (uint256 i; i < N; ++i) s += pm.sharesOf(address(actors[i]));
        return s == pm.totalShares();
    }

    function echidna_follower_band() public view returns (bool) {
        return followerBandViolations == 0;
    }

    /// D6 — cost basis cannot survive an emptied position.
    function echidna_dp_zero_iff_empty() public view returns (bool) {
        if (pm.tokenId() == 0) return pm.deployedPrincipal() == 0;
        if (posm.getPositionLiquidity(pm.tokenId()) != 0) return true;
        return pm.deployedPrincipal() == 0 && dpZeroViolations == 0;
    }
}
