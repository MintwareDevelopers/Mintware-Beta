(* ─────────────────────────────────────────────────────────────────────────────
   MulDivLemmas.v — machine-checked proofs of the 4 nonlinear mulDiv lemmas that
   Halmos / SMT could NOT decide (division by a symbolic value times out).

   These are the exact arithmetic facts asserted by the 4 timed-out specs in
   contracts-v4/test/formal/MWFormalProofs.t.sol. Halmos proved the 3 real-hook-code
   fee-bound properties; SMT is undecidable-in-practice on nonlinear 256-bit
   mul + div-by-symbolic, so those 4 are proved HERE instead — as decidable,
   machine-checked theorems (coqc verifies this file).

   Modelling. Solidity's uint `/` is Euclidean FLOOR division: for D > 0, `X / D`
   is the unique q with  X = D*q + r  and  0 <= r < D. We therefore prove each
   property from that defining relation (nia, over Z with 0 <= bounds — the bounds
   in the Solidity specs keep every product far below 2^256, so Z with nonneg
   constraints faithfully models the uint arithmetic, no overflow), and then give a
   `_div` corollary instantiated with Coq's real `Z.div` so the final statement is
   literally about floor division = the Solidity `/`.

   No axioms, no `Admitted`. `coqc MulDivLemmas.v` succeeding IS the proof.
   ───────────────────────────────────────────────────────────────────────────── *)

Require Import ZArith.
Require Import Lia.
Open Scope Z_scope.

(* q, r are the Solidity floor-division witnesses of X/D:  X = D*q + r, 0 <= r < D. *)

(* ─────────────────────────────────────────────────────────────────────────────
   L4 — check_depositMint_noInflation
   minted = ((TL+V)*liq) / (managed+V);  assert minted * (managed+V) <= (TL+V)*liq
   i.e. the floor property  q*D <= X  for X = (TL+V)*liq, D = managed+V (> 0).
   ───────────────────────────────────────────────────────────────────────────── *)
Lemma floor_mul_le :
  forall X D q r, 0 < D -> 0 <= r < D -> X = D*q + r -> q*D <= X.
Proof. intros. nia. Qed.

Theorem depositMint_no_inflation_div :
  forall TL managed liq V,
    0 <= TL -> 0 <= managed -> 0 <= liq -> 0 < V ->
    (((TL + V) * liq) / (managed + V)) * (managed + V) <= (TL + V) * liq.
Proof.
  intros TL managed liq V HTL Hm Hl HV.
  set (X := (TL + V) * liq). set (D := managed + V).
  assert (HD : 0 < D) by (unfold D; lia).
  assert (HDne : D <> 0) by lia.
  pose proof (Z.div_mod X D HDne) as Hdm.
  pose proof (Z.mod_pos_bound X D HD) as Hmb.
  eapply (floor_mul_le X D (X / D) (X mod D)); lia.
Qed.

(* ─────────────────────────────────────────────────────────────────────────────
   L2a — check_redeemIdle_roundsDown (out <= idle)
   out = (idle*s)/TL;  if s <= TL then out <= idle.
   ───────────────────────────────────────────────────────────────────────────── *)
Lemma floor_ratio_le :
  forall idle s TL q r,
    0 <= idle -> 0 < TL -> 0 <= s -> s <= TL ->
    0 <= r < TL -> idle*s = TL*q + r -> q <= idle.
Proof. intros. nia. Qed.

Theorem redeem_out_le_idle_div :
  forall idle s TL,
    0 <= idle -> 0 < TL -> 0 <= s -> s <= TL ->
    (idle * s) / TL <= idle.
Proof.
  intros idle s TL Hi HT Hs0 HsT.
  assert (HTne : TL <> 0) by lia.
  pose proof (Z.div_mod (idle*s) TL HTne) as Hdm.
  pose proof (Z.mod_pos_bound (idle*s) TL HT) as Hmb.
  eapply (floor_ratio_le idle s TL ((idle*s)/TL) ((idle*s) mod TL)); lia.
Qed.

(* ─────────────────────────────────────────────────────────────────────────────
   L2b — check_redeemIdle_roundsDown (floor: out*TL <= idle*s)
   ───────────────────────────────────────────────────────────────────────────── *)
Lemma floor_times_denom_le :
  forall a b q r, 0 < b -> 0 <= r < b -> a = b*q + r -> q*b <= a.
Proof. intros. nia. Qed.

Theorem redeem_floor_div :
  forall idle s TL,
    0 < TL -> ((idle * s) / TL) * TL <= idle * s.
Proof.
  intros idle s TL HT.
  assert (HTne : TL <> 0) by lia.
  pose proof (Z.div_mod (idle*s) TL HTne) as Hdm.
  pose proof (Z.mod_pos_bound (idle*s) TL HT) as Hmb.
  eapply (floor_times_denom_le (idle*s) TL ((idle*s)/TL) ((idle*s) mod TL)); lia.
Qed.

(* ─────────────────────────────────────────────────────────────────────────────
   L2c — check_redeemIdle_roundsDown (exact: s == TL -> out == idle)
   ───────────────────────────────────────────────────────────────────────────── *)
Lemma floor_exact_full :
  forall idle TL q r,
    0 <= idle -> 0 < TL -> 0 <= r < TL -> idle*TL = TL*q + r -> q = idle.
Proof. intros. nia. Qed.

Theorem redeem_exact_full_div :
  forall idle TL,
    0 <= idle -> 0 < TL -> (idle * TL) / TL = idle.
Proof.
  intros idle TL Hi HT.
  assert (HTne : TL <> 0) by lia.
  pose proof (Z.div_mod (idle*TL) TL HTne) as Hdm.
  pose proof (Z.mod_pos_bound (idle*TL) TL HT) as Hmb.
  eapply (floor_exact_full idle TL ((idle*TL)/TL) ((idle*TL) mod TL)); lia.
Qed.

(* ─────────────────────────────────────────────────────────────────────────────
   L3 — check_redeemIdle_sumNeverExceedsBacking
   o1 = (idle*s1)/TL, o2 = (idle*s2)/TL; if s1+s2 <= TL then o1+o2 <= idle (solvency).
   ───────────────────────────────────────────────────────────────────────────── *)
Lemma floor_sum_le_backing :
  forall idle s1 s2 TL q1 r1 q2 r2,
    0 <= idle -> 0 < TL -> 0 <= s1 -> 0 <= s2 -> s1 + s2 <= TL ->
    0 <= r1 < TL -> 0 <= r2 < TL ->
    idle*s1 = TL*q1 + r1 -> idle*s2 = TL*q2 + r2 ->
    q1 + q2 <= idle.
Proof. intros. nia. Qed.

Theorem redeem_sum_le_backing_div :
  forall idle s1 s2 TL,
    0 <= idle -> 0 < TL -> 0 <= s1 -> 0 <= s2 -> s1 + s2 <= TL ->
    (idle * s1) / TL + (idle * s2) / TL <= idle.
Proof.
  intros idle s1 s2 TL Hi HT H1 H2 Hsum.
  assert (HTne : TL <> 0) by lia.
  pose proof (Z.div_mod (idle*s1) TL HTne) as Hd1.
  pose proof (Z.mod_pos_bound (idle*s1) TL HT) as Hb1.
  pose proof (Z.div_mod (idle*s2) TL HTne) as Hd2.
  pose proof (Z.mod_pos_bound (idle*s2) TL HT) as Hb2.
  eapply (floor_sum_le_backing idle s1 s2 TL
            ((idle*s1)/TL) ((idle*s1) mod TL)
            ((idle*s2)/TL) ((idle*s2) mod TL)); lia.
Qed.

(* ─────────────────────────────────────────────────────────────────────────────
   L1 — check_splitFee_conservesAndFavorsLP
   BPS = 10000. t = (fee*tBps)/BPS, b = (fee*bBps)/BPS, lp = fee - t - b,
   lpNominal = (fee*(BPS - tBps - bBps))/BPS.  Constraint: tBps + bBps <= 4000.
   Prove (i) conservation  t + b <= fee  (so lp = fee - t - b is exact, t+b+lp = fee)
   and   (ii) rounding favors LP  lpNominal <= lp = fee - t - b.
   (t,b,ln here are the three floor-division witnesses; rt/rb/rn their remainders.)
   ───────────────────────────────────────────────────────────────────────────── *)
Lemma splitFee_conserves_and_favors_LP :
  forall fee tBps bBps t rt b rb ln rn,
    0 <= fee -> 0 <= tBps -> 0 <= bBps -> tBps + bBps <= 4000 ->
    0 <= rt < 10000 -> fee * tBps = 10000 * t + rt ->
    0 <= rb < 10000 -> fee * bBps = 10000 * b + rb ->
    0 <= rn < 10000 -> fee * (10000 - tBps - bBps) = 10000 * ln + rn ->
    t + b <= fee /\ ln <= fee - t - b.
Proof. intros. nia. Qed.
