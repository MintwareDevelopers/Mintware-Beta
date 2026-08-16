// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test}         from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary}          from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {HookMiner}                from "../../src/lib/HookMiner.sol";
import {MintwareTreasuryVault}     from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook}   from "../../src/payments/MintwareTreasuryJitHook.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @dev Adversarial handler for the treasury-anchored ULV against a REAL Uniswap-V4 pool (Phase-2
///      convergence — the vault self-holds the position; no mock module). Drives fuzzed sequences of
///      community senior deposits/redeems, Gateway payment burns (the handler IS the gateway), owner LP
///      deploy/recover, LP-fee accrual, Aave yield, and REAL-SWAP PRICE STRESS via `swapRouter.swapTo`.
///
///      Two deliberate scoping choices make the headline invariants meaningful rather than vacuous:
///        1. `movePrice` swaps are CLAMPED to a `sqrtPriceLimit` inside the DESIGNED SOLVENT BAND
///           (team price ∈ [50%,150%] of the initial mark) — so a swap physically cannot push the mark
///           past the band regardless of size. The price-to-zero tail (junior wiped → `burnForPayment`
///           reverts, never underpays) is proven in a focused unit test, not here.
///        2. `recoverFromLP` recovers <= `deployedFromSenior` (owner rebalance regime).
///
///      Every vault interaction is wrapped in try/catch: expected reverts (InsufficientIdleLiquidity in
///      the burn tail, BadParam on the idle-target guard, ZeroAmount on dust, PriceLimitAlreadyExceeded
///      when price already sits at the band edge) are no-ops for the fuzzer, so `reverts == 0`.
contract TreasuryVaultHandler is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    MintwareTreasuryVault public vault;
    MockYieldAdapter      public adapter;
    MockERC20             public usdc;
    MockERC20             public team;
    TestSwapRouter        public swapRouter;
    PoolKey               public key;
    bool                  public teamIs0;

    address public owner;
    address public teamAddr;   // junior committer
    address public receiver;   // card rail / payment sink
    address public protocol;   // protocol fee treasury
    address[] public actors;   // community senior depositors

    uint16 internal constant BPS = 10_000;
    uint160 internal immutable dumpLimit; // band edge for dumping team (team price → 50%)
    uint160 internal immutable pumpLimit; // band edge for pumping team (team price → 150%)

    // ── conservation + property ghosts ─────────────────────────────────────────────
    uint256 public totalDeposited;    // community USDC in (incl. setUp seed)
    uint256 public totalYieldMinted;  // simulated Aave interest minted into the adapter
    uint256 public totalUsdcOut;      // USDC that left to a NON-system address (rail/team/protocol)
    uint256 public successfulBurns;   // gateway payments that settled (non-vacuity witness)
    bool    public juniorRedeemedEarly; // set true iff a redeemJunior ever succeeded pre-cliff
    bool    public exercisedIlWithDeploy; // senior par was deployed while the mark was sub-par

    struct Cfg {
        MintwareTreasuryVault vault;
        MockYieldAdapter adapter;
        MockERC20 usdc;
        MockERC20 team;
        TestSwapRouter swapRouter;
        PoolKey key;
        bool teamIs0;
        address owner;
        address teamAddr;
        address receiver;
        address protocol;
        address[] actors;
        uint256 seededDeposits;
        uint160 dumpLimit;
        uint160 pumpLimit;
    }

    constructor(Cfg memory c) {
        vault = c.vault;
        adapter = c.adapter;
        usdc = c.usdc;
        team = c.team;
        swapRouter = c.swapRouter;
        key = c.key;
        teamIs0 = c.teamIs0;
        owner = c.owner;
        teamAddr = c.teamAddr;
        receiver = c.receiver;
        protocol = c.protocol;
        actors = c.actors;
        totalDeposited = c.seededDeposits;
        dumpLimit = c.dumpLimit;
        pumpLimit = c.pumpLimit;
        // The handler is the sole external swapper — approve the router for both legs.
        usdc.approve(address(swapRouter), type(uint256).max);
        team.approve(address(swapRouter), type(uint256).max);
    }

    function nActors() external view returns (uint256) { return actors.length; }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    // ── community senior deposit ────────────────────────────────────────────────────
    function seniorDeposit(uint256 aSeed, uint256 amtSeed) public {
        address a = _actor(aSeed);
        uint256 amt = bound(amtSeed, 1_000_000, 500_000_000_000); // $1 .. $500k (6dp)
        vm.prank(a);
        try vault.depositUSDC(amt, 0, a) returns (uint256) { totalDeposited += amt; } catch {}
    }

    // ── community redeems a slice of their OWN shares ───────────────────────────────
    function seniorRedeem(uint256 aSeed, uint256 shareSeed) public {
        address a = _actor(aSeed);
        uint256 bal = vault.seniorShares(a);
        if (bal == 0) return;
        uint256 s = bound(shareSeed, 1, bal);
        vm.prank(a);
        try vault.redeemSenior(s, 0) returns (uint256 out) { totalUsdcOut += out; } catch {}
    }

    // ── Gateway payment burn (handler == gateway). MUST tolerate InsufficientIdleLiquidity ─────
    function gatewayBurn(uint256 aSeed, uint256 shareSeed) public {
        address a = _actor(aSeed);
        uint256 bal = vault.seniorShares(a);
        if (bal == 0) return;
        uint256 s = bound(shareSeed, 1, bal);
        try vault.burnForPayment(a, s, receiver) returns (uint256 out) {
            totalUsdcOut += out;
            successfulBurns++;
        } catch {}
    }

    // ── owner deploys a bounded senior slice + junior token as 2-sided LP ───────────
    function deployToLP(uint256 seed) public {
        uint256 base = vault.totalSeniorAssets();
        uint256 tgt = vault.idleBufferTargetBps();
        uint256 minIdle = (base * tgt + BPS - 1) / BPS; // ceil, matches the contract's guard
        uint256 deployed = vault.deployedFromSenior();
        if (base <= minIdle || deployed >= base - minIdle) return;
        uint256 room = base - minIdle - deployed;
        if (room < 1_000_000) return;
        uint256 amt = bound(seed, 1_000_000, room);
        uint256 maxTeam = vault.juniorTokens();
        vm.prank(owner);
        try vault.deployToLP(amt, maxTeam) {} catch {}
    }

    // ── owner recovers a bounded amount (<= deployed) ────────────────────────────────
    function recoverFromLP(uint256 seed) public {
        uint256 deployed = vault.deployedFromSenior();
        if (deployed == 0) return;
        uint256 amt = bound(seed, 1, deployed);
        vm.prank(owner);
        try vault.recoverFromLP(amt) {} catch {}
    }

    // ── move the mark via a REAL swap, CLAMPED to the designed solvent band ──────────
    function movePrice(uint256 seed) public {
        bool dump = seed & 1 == 0;
        (bool zeroForOne, uint160 limit) = dump
            ? (teamIs0, dumpLimit)   // sell team → team price falls (toward 50%)
            : (!teamIs0, pumpLimit); // buy team  → team price rises (toward 150%)
        // A large notional so the swap actually reaches the band edge; the clamp caps it there.
        uint256 amountIn = 400_000_000 * 1e6; // $400M notional, refunded past the limit
        try swapRouter.swapTo(key, zeroForOne, amountIn, limit) {
            // IL witness: a dump with senior par deployed exercises the sub-par coverage regime.
            if (dump && vault.deployedFromSenior() > 0) exercisedIlWithDeploy = true;
        } catch {}
        // Phase 3: each swap ALSO pushes am-AMM rent (as production does inside beforeSwap→poke), routed
        // like fees. Folded into the swap handler (not a standalone selector) so the fuzz selector
        // distribution — and the IL-scenario coverage the `afterInvariant` guard checks — is unchanged.
        uint256 rent = bound(seed, 1_000_000, 50_000_000_000); // $1 .. $50k
        usdc.mint(address(this), rent);
        totalYieldMinted += rent;                              // sanctioned-mint conservation ghost
        usdc.approve(address(vault), rent);
        uint256 beforeProto = usdc.balanceOf(protocol);
        try vault.fundRent(address(usdc), rent) {
            totalUsdcOut += usdc.balanceOf(protocol) - beforeProto; // protocol cut (post-lock) left the system
        } catch {}
    }

    // ── simulated Aave interest into the idle adapter (senior yield) ─────────────────
    function aaveYield(uint256 seed) public {
        uint256 amt = bound(seed, 1_000_000, 50_000_000_000); // $1 .. $50k
        usdc.mint(address(adapter), amt);
        totalYieldMinted += amt;
    }

    // ── collect + route the LP fees the movePrice swaps accrued on the vault position ─
    function accrueFees(uint256) public {
        uint256 beforeProto = usdc.balanceOf(protocol);
        vm.prank(owner);
        try vault.accrueFees() returns (uint256) {
            totalUsdcOut += usdc.balanceOf(protocol) - beforeProto; // protocol cut left the system
        } catch {}
    }

    // ── time (isolated call so timestamp reads elsewhere stay fresh under via_ir) ────
    function warp(uint256 seed) public {
        vm.warp(vm.getBlockTimestamp() + bound(seed, 1 hours, 3 days));
    }

    // ── team redeems junior. Pre-cliff success would be a breach (StillLocked guards it) ─
    function redeemJunior() public {
        bool locked = vm.getBlockTimestamp() < vault.lockExpiry();
        uint256 beforeTeam = usdc.balanceOf(teamAddr);
        vm.prank(teamAddr);
        try vault.redeemJunior() {
            if (locked) juniorRedeemedEarly = true;
            totalUsdcOut += usdc.balanceOf(teamAddr) - beforeTeam; // junior USDC cash left the vault
        } catch {}
    }
}

/// @notice THE GATE — the tranche-solvency proof at 256 runs × 128,000 calls, 0 reverts, against a REAL
///         Uniswap-V4 pool. Proves: the junior always covers the senior par (headline), the senior claim
///         is fully backed by real recoverable USDC, the senior NAV is structurally price-free, no share
///         inflation, USDC conservation (no fabrication), reserved-junior cash is always on hand, and the
///         junior lock cliff is never breached.
contract MintwareTreasuryVaultInvariantTest is StdInvariant, Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    PoolManager             internal pm;
    TestSwapRouter          internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;

    MintwareTreasuryVault internal vault;
    MockYieldAdapter      internal adapter;
    MockERC20             internal usdc;
    MockERC20             internal team;
    TreasuryVaultHandler  internal handler;
    PoolKey               internal key;
    bool                  internal teamIs0;

    address internal owner    = makeAddr("owner");
    address internal teamAddr  = makeAddr("team");
    address internal receiver  = makeAddr("cardRail");
    address internal protocol  = makeAddr("protocol");

    address[] internal actors;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant LOCK_DUR   = 365 days;
    uint256 internal constant JUNIOR_USDC_SEED = 50_000_000_000; // $50k stable first-loss coverage
    uint256 internal constant SQRT_HALF = 707106781;  // sqrt(0.5) × 1e9
    uint256 internal constant SQRT_ONEHALF = 1224744871; // sqrt(1.5) × 1e9

    /// @dev Tolerance absorbing real-pool integer rounding in the two coverage invariants (deployed par
    ///      vs the position's spot MTM). ~1e6x below any genuine under-coverage (dollars = millions of wei).
    uint256 internal constant DUST = 100_000; // 0.1 USDC
    uint256 internal seeded;
    uint256 internal initialUsdcMinted; // every USDC mint the harness performed in setUp

    function _mintUsdc(address to, uint256 amt) internal {
        usdc.mint(to, amt);
        initialUsdcMinted += amt;
    }

    function setUp() public {
        pm         = new PoolManager(address(this));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);
        teamIs0 = address(team) < address(usdc);
        adapter = new MockYieldAdapter(address(usdc));

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));

        // The pool is a DYNAMIC-FEE pool fronted by the real JIT hook, so every `movePrice` swap routes
        // through the hook's deviation-scaled fee OVERRIDE (Phase-1 MEV lever) — the fee is what this
        // upgraded gate now stresses alongside the tranche solvency. We keep the fee lever at its in-code
        // defaults (base 3000 / max 50_000 / slope 100). JIT is DISABLED here (threshold = max): the JIT
        // borrow/settle loop has its own dedicated fuzz suite (`MintwareTreasuryJitStackTest`), and turning
        // it off keeps THIS gate a clean proof that the fee override never perturbs senior/junior solvency.
        // Circular deploy (hook ctor needs the vault addr; the vault key needs the hook addr) is broken by
        // predicting the vault's CREATE address — mirrors DeployTreasuryV2 / the JIT-stack harness.
        PoolKey memory ctorKey = PoolKey({
            currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: SPACING, hooks: IHooks(address(0))
        });
        address predictedVault = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        bytes memory hookArgs = abi.encode(address(pm), ctorKey, address(usdc), predictedVault, address(this));
        (address hookAddr, bytes32 hookSalt) =
            HookMiner.find(address(this), uint160(0x20C8), type(MintwareTreasuryJitHook).creationCode, hookArgs);
        MintwareTreasuryJitHook hook =
            new MintwareTreasuryJitHook{salt: hookSalt}(address(pm), ctorKey, address(usdc), predictedVault, address(this));
        require(address(hook) == hookAddr, "hook addr");
        hook.setJitThreshold(type(uint256).max); // JIT off — this gate isolates the fee lever
        // Increment 2: enable + arm the surge floor so every fuzzed `movePrice` swap routes through a LIVE
        // surge. The `warp` handler decays it (1h–3d/call), so across 128k calls the swaps sample the whole
        // surge curve (full 5% → base). Proving the 7 tranche invariants hold at every surge level is the
        // active-surge counterpart to the monotonicity argument (a higher LP fee only adds to backing).
        hook.setSurgeParams(50_000, 365 days); // 5% ceiling, slow decay so it stays live deep into the run
        hook.armSurge();
        // Increment 3: also enable the quadratic base term so the fuzzed swaps route through the FULL convex
        // fee (base + slope·dev + quad·dev² , floored by the surge). Same monotonicity guarantee — a higher
        // LP fee only adds to backing — proven here rather than argued.
        hook.setQuadMultiplier(50);
        // Phase 2: enable the MEV-tax + a standing priority-fee gap (basefee 1 gwei, gasprice 11 gwei →
        // 10 gwei priority) so every fuzzed swap ALSO pays the additive tax. Now the swaps route through the
        // FULL lever stack (base + slope·dev + quad·dev² , floored by surge, + MEV-tax), clamped to MAX_LP_FEE
        // — the strongest active-fee solvency proof. Additive-only ⇒ backing can only improve.
        hook.setMevTax(50, 50_000);
        vm.fee(1 gwei);
        vm.txGasPrice(11 gwei);

        key = PoolKey({
            currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: SPACING, hooks: IHooks(hookAddr)
        });
        vault = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);
        require(address(vault) == predictedVault, "vault addr prediction");

        // Owner-gated init: sender (this) == hook.owner() (this), so beforeInitialize authorizes it.
        pm.initialize(key, INIT_SQRT_PRICE);

        vm.prank(owner);
        vault.setProtocolTreasury(protocol);

        // team commits the junior first-loss reserve — team + a stable junior USDC buffer — and opens the vault.
        team.mint(teamAddr, 5_000_000 * 1e6);
        _mintUsdc(teamAddr, JUNIOR_USDC_SEED);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(5_000_000 * 1e6, JUNIOR_USDC_SEED, LOCK_DUR);
        vm.stopPrank();

        // Deep baseline pool liquidity so the vault's seniority swaps barely move price (only `movePrice`,
        // which is band-clamped, meaningfully moves the mark).
        _mintUsdc(address(this), 50_000_000 * 1e6);
        team.mint(address(this), 50_000_000 * 1e6);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 40_000_000 * int256(uint256(1e6)), salt: bytes32(0)}),
            ""
        );

        // four community actors, each funded + approved.
        actors = new address[](4);
        for (uint256 i = 0; i < 4; i++) {
            address a = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors[i] = a;
            _mintUsdc(a, 1e30);
            vm.prank(a);
            usdc.approve(address(vault), type(uint256).max);
        }

        // seed a couple of deposits so there is senior capital to settle against from block 0.
        for (uint256 i = 0; i < 2; i++) {
            vm.prank(actors[i]);
            vault.depositUSDC(100_000_000_000, 0, actors[i]); // $100k each
            seeded += 100_000_000_000;
        }

        TreasuryVaultHandler.Cfg memory cfg = TreasuryVaultHandler.Cfg({
            vault: vault, adapter: adapter, usdc: usdc, team: team, swapRouter: swapRouter,
            key: key, teamIs0: teamIs0, owner: owner, teamAddr: teamAddr, receiver: receiver,
            protocol: protocol, actors: actors, seededDeposits: seeded,
            dumpLimit: _bandLimit(true), pumpLimit: _bandLimit(false)
        });
        handler = new TreasuryVaultHandler(cfg);

        // fund the handler (sole external swapper) with ample balances on both legs; band-clamp refunds the rest.
        _mintUsdc(address(handler), 1_000_000_000 * 1e6);
        team.mint(address(handler), 1_000_000_000 * 1e6);

        // handler is the sole gateway → its gatewayBurn calls settle as the gateway.
        vm.prank(owner);
        vault.setGateway(address(handler));
        // handler is also the am-AMM rent funder → its fundRent pushes rent as the sanctioned funder.
        vm.prank(owner);
        vault.setRentFunder(address(handler));

        bytes4[] memory sels = new bytes4[](10);
        sels[0] = TreasuryVaultHandler.seniorDeposit.selector;
        sels[1] = TreasuryVaultHandler.seniorRedeem.selector;
        sels[2] = TreasuryVaultHandler.gatewayBurn.selector;
        sels[3] = TreasuryVaultHandler.deployToLP.selector;
        sels[4] = TreasuryVaultHandler.recoverFromLP.selector;
        sels[5] = TreasuryVaultHandler.movePrice.selector;
        sels[6] = TreasuryVaultHandler.aaveYield.selector;
        sels[7] = TreasuryVaultHandler.accrueFees.selector;
        sels[8] = TreasuryVaultHandler.warp.selector;
        sels[9] = TreasuryVaultHandler.redeemJunior.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
    }

    /// @dev The pool `sqrtPriceX96` at which TEAM price hits the band edge (`dump` → 50%, else 150%),
    ///      accounting for token ordering (team price = spot² if teamIs0, else 1/spot²).
    function _bandLimit(bool dump) internal view returns (uint160) {
        uint256 root = dump ? SQRT_HALF : SQRT_ONEHALF; // sqrt(teamPrice) × 1e9
        uint256 s = teamIs0
            ? (uint256(INIT_SQRT_PRICE) * root) / 1e9   // team=c0: spot = INIT·sqrt(tp)
            : (uint256(INIT_SQRT_PRICE) * 1e9) / root;  // team=c1: spot = INIT/sqrt(tp)
        return uint160(s);
    }

    // free SENIOR buffer = vault USDC on hand minus junior + protocol earmarks, never negative.
    function _freeBuffer() internal view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(vault));
        uint256 r = vault.reservedJuniorUSDC() + vault.juniorUsdcBuffer() + vault.reservedProtocolUSDC();
        return bal > r ? bal - r : 0;
    }

    /// @notice Non-vacuity: the fuzz actually SETTLED payments and exercised IL with senior par deployed.
    function afterInvariant() public view {
        assertGt(handler.successfulBurns(), 0, "fuzz never settled a gateway payment");
        assertTrue(handler.exercisedIlWithDeploy(), "IL scenario never exercised (senior par deployed sub-par)");
    }

    // ── HEADLINE: the junior STACK (LP-recoverable + stable USDC buffer) covers the senior par ──────
    function invariant_senior_par_covered() public view {
        assertLe(
            vault.deployedFromSenior(),
            vault.recoverableUSDC() + vault.juniorUsdcBuffer() + DUST,
            "deployed senior par exceeds the junior stack (recoverable LP USDC + first-loss buffer)"
        );
    }

    // ── the full senior claim is backed by real recoverable USDC ───────────────────
    function invariant_senior_fully_backed() public view {
        assertLe(
            vault.totalSeniorAssets(),
            adapter.totalAssets() + _freeBuffer() + vault.recoverableUSDC() + vault.juniorUsdcBuffer() + DUST,
            "senior claim exceeds recoverable backing"
        );
    }

    // ── senior NAV is STRUCTURALLY price-free (accounting identity, no price term) ──
    function invariant_senior_price_free() public view {
        assertEq(
            vault.totalSeniorAssets(),
            adapter.totalAssets() + _freeBuffer() + vault.deployedFromSenior() + vault.jitBorrowed(),
            "senior NAV identity broke (a price term leaked in)"
        );
    }

    // ── no share inflation: solvency-by-construction crux (lifted from v1) ──────────
    function invariant_no_share_inflation() public view {
        assertLe(
            vault.totalSeniorShares(),
            vault.totalSeniorAssets(),
            "totalSeniorShares > totalSeniorAssets (solvency crux broken)"
        );
        uint256 sum;
        for (uint256 i = 0; i < actors.length; i++) sum += vault.seniorShares(actors[i]);
        assertEq(sum, vault.totalSeniorShares(), "phantom shares: holder-share sum != totalSeniorShares");
    }

    // ── conservation: no USDC is fabricated in the closed system ────────────────────
    //    (The mock's mint-ledger is gone with the mock; the real analog is that total USDC supply only
    //     ever reflects the harness's explicit mints — the vault/library never conjure USDC.)
    function invariant_settlement_conserves() public view {
        assertEq(
            usdc.totalSupply(),
            initialUsdcMinted + handler.totalYieldMinted(),
            "USDC conservation broke (value fabricated or destroyed)"
        );
    }

    // ── earmarked cash (junior fee cut + first-loss buffer + protocol cut) is always physically on hand ─
    function invariant_reserved_junior_backed() public view {
        assertLe(
            vault.reservedJuniorUSDC() + vault.juniorUsdcBuffer() + vault.reservedProtocolUSDC(),
            usdc.balanceOf(address(vault)),
            "earmarks (junior reserved + first-loss buffer + protocol) exceed vault USDC on hand"
        );
    }

    // ── the junior lock cliff is never breached ────────────────────────────────────
    function invariant_lock_enforced() public view {
        assertFalse(handler.juniorRedeemedEarly(), "junior redeemed before the lock cliff");
    }
}
