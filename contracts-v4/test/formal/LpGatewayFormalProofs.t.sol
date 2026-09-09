// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import {SeniorSharesMath} from "../../src/lib/SeniorSharesMath.sol";
import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {
    MintwareLpGatewayPositionManager, IPermit2Minimal
} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";

/// @dev Minimal `extsload` responder so the real PM constructor's `StateLibrary.getSlot0` read
///      (`manager.extsload(stateSlot)`) returns a non-zero sqrtPriceX96 and the pool passes the
///      `PoolNotInitialized` gate. v4 packs Slot0 with sqrtPriceX96 in bits 0..159.
contract MockExtsloadPoolManager {
    bytes32 internal immutable _slot0;

    constructor(uint160 sqrtPriceX96) {
        _slot0 = bytes32(uint256(sqrtPriceX96));
    }

    function extsload(bytes32) external view returns (bytes32) {
        return _slot0;
    }
}

/// @dev Exposes the REAL, inherited `_marksHigher` bytecode of the production PM for symbolic
///      execution. Nothing is re-implemented here — the body under test is the contract's own.
contract PmMarksHarness is MintwareLpGatewayPositionManager {
    constructor(IPoolManager pm_, PoolKey memory key_, IERC20 quote_)
        MintwareLpGatewayPositionManager(
            pm_,
            IPositionManager(address(0x1111)),
            IPermit2Minimal(address(0x2222)),
            key_,
            quote_,
            -60,
            60,
            MintwareLpGatewayStaging(address(0x3333)),
            address(0x4444),
            address(0x5555),
            500,
            type(uint256).max // IA-11 principal cap: uncapped -- this test predates/is unrelated to the cap
        )
    {}

    function marksHigher(uint160 a, uint160 b) external view returns (bool) {
        return _marksHigher(a, b);
    }
}

/// @title  LpGatewayFormalProofs — round-3 fix classes (Halmos / bundled solver)
/// @notice Symbolic proofs for the three round-3 fixes in `MintwareLpGatewayPositionManager` that are
///         small, self-contained arithmetic/comparison facts rather than economic models:
///           F1        — single-offset `_withdraw` claim split ⇒ a fully delivered exit re-credits nothing.
///           R3-INV-3  — `_marksHigher(0, b)` is NEVER true (an unset bucket is never holder-favourable).
///           INV-15    — the `DeployNotTwoSided` band check at MIN_TWO_SIDED_BPS = 5000.
///
/// @dev    Run: `forge build --ast && halmos --root . --forge-build-out contracts-v4/out \
///                 --contract LpGatewayFormalProofs`
///         Bundled solver only (no --solver bitwuzla/cvc5) so the run is CI-reproducible, matching the
///         MWFormalProofs constraint. Where a check calls the real contract/library it proves the real
///         bytecode; where it restates an inline expression the restatement is a byte-for-byte copy of
///         the source line and is labelled LEMMA (same house convention as MWFormalProofs).
///         Fuzzing SAMPLES; Halmos PROVES over all inputs within the stated bounds.
contract LpGatewayFormalProofs is Test {
    uint256 constant VIRTUAL = 1e6; // PM's inflation-defense offset
    uint16 constant MIN_TWO_SIDED_BPS = 5000; // PM public constant — bound to source by check_invariant15_constantBinding
    uint256 constant BPS = 10_000;
    uint256 constant AMT_CAP = 1e30; // token-amount bound: a*b <= 1e60 << 2^256, no mul overflow

    PmMarksHarness internal pmQuote0; // quoteIsCurrency0 == true
    PmMarksHarness internal pmQuote1; // quoteIsCurrency0 == false

    address constant TOKEN_LO = address(uint160(0xA1));
    address constant TOKEN_HI = address(uint160(0xB2));

    function setUp() public {
        MockExtsloadPoolManager pm = new MockExtsloadPoolManager(uint160(1 << 96));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(TOKEN_LO),
            currency1: Currency.wrap(TOKEN_HI),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        // quote == currency0 ⇒ quoteIsCurrency0 true; quote == currency1 ⇒ false.
        pmQuote0 = new PmMarksHarness(IPoolManager(address(pm)), key, IERC20(TOKEN_LO));
        pmQuote1 = new PmMarksHarness(IPoolManager(address(pm)), key, IERC20(TOKEN_HI));
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // TARGET 2 — R3-INV-3: the unset entry-memory bucket. REAL BYTECODE (inherited `_marksHigher`).
    //
    // The bug: `_marksHigher` compared a zero (unset) bucket as if it were a sqrtPrice. On a
    // quote-is-currency0 pool "higher mark" means sqrtPrice LOWER, so sqrtPrice 0 beat every real
    // price and marked the LP leg at its range-edge maximum for the first entry period after
    // creation. The fix adds the two zero guards. The property: zero NEVER wins, either direction.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// @notice a == 0 is never "higher" (never holder-favourable), for ANY b, on BOTH pool orientations.
    function check_marksHigher_zeroNeverWins(uint160 a, uint160 b) public view {
        vm.assume(a == 0);
        assert(pmQuote0.marksHigher(a, b) == false);
        assert(pmQuote1.marksHigher(a, b) == false);
    }

    /// @notice The dual guard: an unset incumbent (b == 0) is always displaced by a real value a > 0,
    ///         so the memory bucket initialises rather than staying pinned at zero.
    function check_marksHigher_zeroIncumbentAlwaysDisplaced(uint160 a) public view {
        vm.assume(a != 0);
        assert(pmQuote0.marksHigher(a, 0) == true);
        assert(pmQuote1.marksHigher(a, 0) == true);
    }

    /// @notice Well-foundedness: `_marksHigher` is a STRICT order — irreflexive, and asymmetric
    ///         (never both directions true). Without this `_recordEntryHigh`/`_entryHigh` could
    ///         oscillate or latch. Proven over all (a, b) on both orientations.
    function check_marksHigher_isStrictOrder(uint160 a, uint160 b) public view {
        assert(pmQuote0.marksHigher(a, a) == false); // irreflexive
        assert(pmQuote1.marksHigher(a, a) == false);
        assert(!(pmQuote0.marksHigher(a, b) && pmQuote0.marksHigher(b, a))); // asymmetric
        assert(!(pmQuote1.marksHigher(a, b) && pmQuote1.marksHigher(b, a)));
    }

    /// @notice Totality on non-zero, distinct values: exactly one of the two directions holds, so the
    ///         holder-favourable extreme across the two buckets is always well defined.
    function check_marksHigher_totalOnDistinctNonZero(uint160 a, uint160 b) public view {
        vm.assume(a != 0 && b != 0 && a != b);
        assert(pmQuote0.marksHigher(a, b) != pmQuote0.marksHigher(b, a));
        assert(pmQuote1.marksHigher(a, b) != pmQuote1.marksHigher(b, a));
    }

    /// @notice Direction binding: "higher mark" is sqrtPrice-DOWN when quote is currency0 and
    ///         sqrtPrice-UP when it is currency1 (the `_pairedToQuote` orientation). Pins the fix so a
    ///         later refactor cannot silently flip the sense of the guard.
    function check_marksHigher_directionality(uint160 a, uint160 b) public view {
        vm.assume(a != 0 && b != 0);
        assert(pmQuote0.marksHigher(a, b) == (a < b));
        assert(pmQuote1.marksHigher(a, b) == (a > b));
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // TARGET 1 — F1: the phantom-share bug. Single virtual offset applied ONCE to the whole claim.
    //
    // The bug: the old `_withdraw` applied the offset PER LEG
    //   fromIdle = toAssets(shares, idle, ts, V)  and  lpEntitled = toAssets(shares, lpVal, ts, V)
    // so fromIdle + lpEntitled overshot the deliverable claim by ≈ shares·V/(ts+V). `denomHigh` was
    // therefore larger than anything the legs could deliver and EVERY partial exit re-credited unbacked
    // shares. The fix prices the whole claim once and splits it by un-offset leg weights.
    //
    // Stated in two layers: (a) the re-credit LOGIC over an arbitrary split (fully tractable), and
    // (b) the end-to-end claim arithmetic against the real mulDiv bytecode (division-heavy).
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// @notice F1 core (LEMMA — exact copy of the `_withdraw` re-credit block, lines 590-611).
    ///         A FULLY DELIVERED exit re-credits nothing: idleGot == fromIdle and the LP leg
    ///         succeeded ⇒ reCredit == 0 ⇒ sharesBurned == shares. Proven for an ARBITRARY symbolic
    ///         split (fromIdle, lpEntitled), i.e. independently of how the claim was computed — so it
    ///         holds for the fixed math and would ALSO have held for the old per-leg math had the legs
    ///         actually delivered the (over-stated) entitlement. The distinguishing half is
    ///         check_F1_claimSplit_isExactAndDeliverable below: only the single-offset split is
    ///         deliverable, which is what makes the antecedent reachable.
    function check_F1_fullDelivery_neverRecredits(
        uint256 shares,
        uint256 fromIdle,
        uint256 lpEntitled,
        uint128 liqToRemove
    ) public pure {
        vm.assume(shares > 0 && shares <= AMT_CAP);
        vm.assume(fromIdle <= AMT_CAP && lpEntitled <= AMT_CAP);
        vm.assume(liqToRemove > 0); // an LP leg exists to deliver
        uint256 idleGot = fromIdle; // idle leg fully delivered
        bool lpFailed = false; // LP leg did not revert

        uint256 reCredit;
        if (idleGot == 0 && (lpFailed || liqToRemove == 0)) {
            reCredit = shares;
        } else {
            uint256 denomHigh = fromIdle + lpEntitled;
            if (fromIdle > idleGot && denomHigh > 0) {
                reCredit = FullMath.mulDiv(shares, fromIdle - idleGot, denomHigh);
            }
            // lpFailed == false ⇒ the LP re-credit term is unreachable
            if (reCredit > shares) reCredit = shares;
        }
        uint256 sharesBurned = reCredit > 0 ? shares - reCredit : shares;

        assert(reCredit == 0); // no phantom shares minted back
        assert(sharesBurned == shares); // the whole burn sticks
    }

    /// @notice F1 monotonicity (LEMMA): the re-credit is bounded by the UNDELIVERED fraction — a
    ///         partial idle delivery can never return more shares than were burned, and returns
    ///         strictly fewer than `shares` whenever anything was delivered. This is the property the
    ///         old per-leg offset violated (denomHigh > deliverable ⇒ reCredit > 0 at full delivery).
    function check_F1_recredit_boundedByShortfall(
        uint256 shares,
        uint256 fromIdle,
        uint256 lpEntitled,
        uint256 idleGot
    ) public pure {
        vm.assume(shares > 0 && shares <= AMT_CAP);
        vm.assume(fromIdle <= AMT_CAP && lpEntitled <= AMT_CAP);
        vm.assume(idleGot <= fromIdle);
        uint256 denomHigh = fromIdle + lpEntitled;
        vm.assume(denomHigh > 0);

        uint256 reCredit;
        if (fromIdle > idleGot) reCredit = FullMath.mulDiv(shares, fromIdle - idleGot, denomHigh);
        if (reCredit > shares) reCredit = shares;

        assert(reCredit <= shares); // never re-credits more than was burned
        if (idleGot == fromIdle) assert(reCredit == 0); // full delivery ⇒ nothing back
    }

    /// @notice F1 end-to-end, REAL BYTECODE (`SeniorSharesMath.toAssets` + v4 `FullMath.mulDiv`).
    ///         The single-offset claim split is EXACT and DELIVERABLE:
    ///           fromIdle + lpEntitled == claimTotal   (no dust, no overshoot — the F1 fix)
    ///           fromIdle   <= idle                     (the idle leg can actually pay it)
    ///           lpEntitled <= lpVal                    (the LP leg can actually pay it)
    ///         Division-heavy (symbolic denominator `navW`): expected to be the intractable one.
    function check_F1_claimSplit_isExactAndDeliverable(uint256 shares, uint256 ts, uint256 idle, uint256 lpVal)
        public
        pure
    {
        vm.assume(ts > 0 && shares > 0 && shares < ts); // partial exit (lastHolder is the exact branch)
        vm.assume(ts <= AMT_CAP && shares <= AMT_CAP && idle <= AMT_CAP && lpVal <= AMT_CAP);

        uint256 navW = idle + lpVal;
        uint256 claimTotal = SeniorSharesMath.toAssets(shares, navW, ts, VIRTUAL, Math.Rounding.Floor);
        if (claimTotal > navW) claimTotal = navW;
        uint256 fromIdle = navW == 0 ? 0 : FullMath.mulDiv(claimTotal, idle, navW);

        assert(claimTotal <= navW); // never claims more than exists
        assert(fromIdle <= claimTotal); // the subtraction below cannot underflow
        uint256 lpEntitled = claimTotal - fromIdle;
        assert(fromIdle + lpEntitled == claimTotal); // exact split — zero dust (F1)
        assert(fromIdle <= idle); // deliverable from the reserve
        assert(lpEntitled <= lpVal); // deliverable from the position
    }

    /// @notice F1 end-to-end, PLAIN-ARITHMETIC restatement of the same fact. Identical semantics to
    ///         the check above under the stated no-overflow bounds (`a*b <= 1e60 << 2^256`, where
    ///         `FullMath.mulDiv(a,b,d) == (a*b)/d` and `Math.mulDiv(..., Floor)` likewise), with the
    ///         512-bit assembly paths removed. Included so the property has a chance of proving even
    ///         if the real-bytecode variant times out on the 512-bit path.
    function check_F1_claimSplit_isExactAndDeliverable_plain(
        uint256 shares,
        uint256 ts,
        uint256 idle,
        uint256 lpVal
    ) public pure {
        vm.assume(ts > 0 && shares > 0 && shares < ts);
        vm.assume(ts <= AMT_CAP && shares <= AMT_CAP && idle <= AMT_CAP && lpVal <= AMT_CAP);

        uint256 navW = idle + lpVal;
        uint256 claimTotal = (shares * (navW + VIRTUAL)) / (ts + VIRTUAL);
        if (claimTotal > navW) claimTotal = navW;
        uint256 fromIdle = navW == 0 ? 0 : (claimTotal * idle) / navW;

        assert(claimTotal <= navW);
        assert(fromIdle <= claimTotal);
        uint256 lpEntitled = claimTotal - fromIdle;
        assert(fromIdle + lpEntitled == claimTotal);
        assert(fromIdle <= idle);
        assert(lpEntitled <= lpVal);
    }

    /// @notice F1 supporting lemma, isolated so the intractable part is identifiable: the idle split
    ///         `mulDiv(claimTotal, idle, navW)` never exceeds `idle` when `claimTotal <= navW`. This
    ///         single fact (mulDiv with a SYMBOLIC denominator) is what the deliverability proof rests
    ///         on and is the known Halmos wall — the MulDivLemmas.v Coq counterpart.
    function check_F1_idleSplit_neverExceedsLeg(uint256 claimTotal, uint256 idle, uint256 navW) public pure {
        vm.assume(navW > 0 && idle <= navW);
        vm.assume(claimTotal <= navW && navW <= AMT_CAP);
        uint256 fromIdle = (claimTotal * idle) / navW;
        assert(fromIdle <= idle);
        assert(fromIdle <= claimTotal);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // TARGET 3 — INV-15: the DeployNotTwoSided band, MIN_TWO_SIDED_BPS = 5000.
    //
    // Source (deploy(), lines 721-724):
    //   if (pairedUsedVal < (quoteUsed * MIN_TWO_SIDED_BPS) / 10_000
    //       || quoteUsed < (pairedUsedVal * MIN_TWO_SIDED_BPS) / 10_000) revert DeployNotTwoSided();
    // Intended: reject everything outside a [0.5x, 2x] value band on the amounts ACTUALLY used.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// @dev Byte-for-byte restatement of the source predicate. `true` == the deploy REVERTS.
    function _rejects(uint256 quoteUsed, uint256 pairedUsedVal) internal pure returns (bool) {
        return pairedUsedVal < (quoteUsed * MIN_TWO_SIDED_BPS) / BPS
            || quoteUsed < (pairedUsedVal * MIN_TWO_SIDED_BPS) / BPS;
    }

    /// @notice Binds the lemma's 5000 to the deployed contract's real public constant, so the proofs
    ///         below cannot drift away from the source if the constant is ever changed.
    function check_invariant15_constantBinding() public view {
        assert(pmQuote0.MIN_TWO_SIDED_BPS() == MIN_TWO_SIDED_BPS);
        assert(pmQuote0.MIN_TWO_SIDED_BPS() == 5000);
    }

    /// @notice SOUNDNESS (no false rejects): every pair genuinely inside the [0.5x, 2x] band is
    ///         ACCEPTED. An honest balanced deploy is never blocked by the guard.
    function check_invariant15_acceptsEveryInBandPair(uint256 quoteUsed, uint256 pairedUsedVal) public pure {
        vm.assume(quoteUsed <= AMT_CAP && pairedUsedVal <= AMT_CAP);
        vm.assume(2 * pairedUsedVal >= quoteUsed); // paired ≥ 0.5x quote
        vm.assume(2 * quoteUsed >= pairedUsedVal); // quote  ≥ 0.5x paired
        assert(_rejects(quoteUsed, pairedUsedVal) == false);
    }

    /// @notice COMPLETENESS, as actually enforced. Integer floor division relaxes the band by exactly
    ///         one unit in the numerator: the guard admits `q <= 2p + 1` and `p <= 2q + 1` rather than
    ///         the ideal `q <= 2p` / `p <= 2q`. This states the TRUE enforced band; the ideal band is
    ///         NOT what the code implements — see check_invariant15_idealBandIsRelaxedByOne.
    function check_invariant15_acceptedImpliesWithinOneUnitOfBand(uint256 quoteUsed, uint256 pairedUsedVal)
        public
        pure
    {
        vm.assume(quoteUsed <= AMT_CAP && pairedUsedVal <= AMT_CAP);
        vm.assume(_rejects(quoteUsed, pairedUsedVal) == false);
        assert(quoteUsed <= 2 * pairedUsedVal + 1);
        assert(pairedUsedVal <= 2 * quoteUsed + 1);
    }

    /// @notice The economically meaningful half of completeness: the floor slack is ONE ABSOLUTE UNIT
    ///         at every magnitude, so the RELATIVE band error is O(1 / min(q, p)) and vanishes at any
    ///         real size. Concretely, with both legs ≥ 1 USDG (1e6 at 6 dp) the widest accepted ratio
    ///         is 2 + 1e-6 rather than the ideal 2. Stated multiplicatively (no division) so the
    ///         claim is exact, not an approximation.
    ///         NB the slack is NOT confined to dust in absolute terms — (q, p) = (5, 2) is accepted at
    ///         a 2.5x ratio — it is only ever ±1 unit, which is what makes it benign. See the report.
    function check_invariant15_relativeSlackVanishesAtScale(uint256 quoteUsed, uint256 pairedUsedVal)
        public
        pure
    {
        uint256 ONE_USDG = 1e6;
        vm.assume(quoteUsed <= AMT_CAP && pairedUsedVal <= AMT_CAP);
        vm.assume(quoteUsed >= ONE_USDG && pairedUsedVal >= ONE_USDG);
        vm.assume(_rejects(quoteUsed, pairedUsedVal) == false);
        assert(quoteUsed > 0 && pairedUsedVal > 0); // never one-sided at this scale
        // q/p <= 2 + 1/ONE_USDG, cross-multiplied.
        assert(quoteUsed * ONE_USDG <= (2 * ONE_USDG + 1) * pairedUsedVal);
        assert(pairedUsedVal * ONE_USDG <= (2 * ONE_USDG + 1) * quoteUsed);
    }

    /// @notice The attack INV-15 exists to stop: a compromised owner seat walking the follower to the
    ///         range edge and minting an ALL-QUOTE position (paired returned to itself). Proven
    ///         rejected for every non-dust quote amount, and symmetrically for an all-paired mint.
    function check_invariant15_rejectsOneSidedMint(uint256 amount) public pure {
        vm.assume(amount >= 2 && amount <= AMT_CAP);
        assert(_rejects(amount, 0) == true); // all-quote position — rejected
        assert(_rejects(0, amount) == true); // all-paired position — rejected
    }
}
