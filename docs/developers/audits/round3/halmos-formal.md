# Halmos formal proofs — `LpGatewayFormalProofs.t.sol` (2026-09-09)

**Status: BLOCKED on this host — tooling incompatibility, not a finding.** Halmos 0.2.6 is genuinely
installed and runnable (confirmed: `halmos --version` → `halmos 0.2.6`), superseding the older
`halmos_env_blocker` memory note ("Halmos can't run on this Mac"). This session got further than that —
it actually invokes and attempts symbolic execution — but every one of the file's 15 `check_*` functions
fails with an internal Halmos error before producing a real proof or counterexample.

## What was tried

1. **Plain run** (`forge build --ast && halmos --root . --forge-build-out contracts-v4/out --contract
   LpGatewayFormalProofs`, per the test file's own doc comment): Halmos ignores the pre-built artifacts
   and re-runs `forge build` itself internally — WITHOUT `--ast` — silently stripping the AST info the
   prior `--ast` build produced. Result: `WARNING Skipped VmContractHelperN.json due to parsing failure:
   KeyError: 'ast'` (dozens of times, for forge-std internals) followed by `ERROR IndexError: pop from
   empty list` on all 15 checks. `Symbolic test result: 0 passed; 15 failed; time: 0.81s` — the near-zero
   time confirms these are immediate internal errors, not real (dis)proofs.
2. **Dedicated `[profile.halmos]` foundry profile** (`ast = true`, run via `FOUNDRY_PROFILE=halmos
   halmos ...`) so Halmos's own internal rebuild keeps the AST: same result. Investigation showed Halmos
   doesn't always trigger a real recompile — it can silently reuse a stale, non-AST `build-info` file
   left over from an earlier run.
3. **Removed the stale partial `build-info` file** (a `{id, source_id_to_path, language}`-only JSON with
   no `input`/`output`, per the exact pattern `slither_tooling_workaround` documents for a different
   tool) and forced a clean `FOUNDRY_PROFILE=halmos forge build --force` first, confirmed via a Python
   check that the resulting build-info's `output.sources.*` entries actually contain `ast` this time.
   Re-ran Halmos (which still does its own internal rebuild regardless) — **identical failure.**
4. **Disabled `via_ir`/`optimizer` for the halmos profile**, on the theory that via-IR's heavy inlining
   is a known rough edge for symbolic-execution tools. This didn't reach Halmos's symbolic step at all —
   the underlying `forge build` itself now FAILS project-wide: `contracts-v4/src/payments/lib/
   MWTreasuryPositionLib.sol` genuinely requires `--via-ir` (`Stack too deep` otherwise), so via_ir can't
   be turned off for any profile that compiles the whole project. **Reverted.**

## Conclusion

Root cause not isolated further — most likely a Halmos 0.2.6 / via-IR AST-shape incompatibility at this
codebase's size (300+ files, heavy inlining), not a cache/staleness issue (ruled out by attempt 3). This
is a genuine tooling limitation on this host, not a code finding, and not something worth further
workaround-guessing without either a newer Halmos release or a Linux CI environment to compare against
(the original `halmos_env_blocker` memory's recommendation — "Linux CI = fix" — still holds, just for a
different failure mode than originally noted).

## What still stands behind these 3 property groups, without the formal proof

The 15 `check_*` functions encode three fix classes (F1 phantom-share fix, R3-INV-3 unset-entry-memory
guard, invariant-15 `DeployNotTwoSided` band) that are **not unverified** — they're exercised as fuzz
SAMPLES (not exhaustive proofs) elsewhere in the suite, and pass:

- **F1** (single-offset withdraw claim split): `contracts-v4/test/audit3/EconExit.t.sol` and the
  round-3 stateful invariant fuzzing (`invariant_B2_reCreditNeverMintsValue`,
  `docs/developers/audits/round3/invariant-fuzzing.md` §0) — F1 is listed FIXED there, re-confirmed
  post-fix.
- **R3-INV-3** (`_marksHigher(0, b)` never true): `docs/developers/audits/round3/README.md`'s R3-INV-3
  entry + the fork invariant suite's `invariant_B8_holderMarkIsSpec`.
- **invariant-15** (`DeployNotTwoSided` band, `MIN_TWO_SIDED_BPS = 5000`): exercised directly by
  `contracts-v4/test/gateway/*` and the round-4 fork/invariant suites.

None of this is a substitute for an actual exhaustive proof over the full input space — it's the honest
"what's the next-best evidence given the tool is blocked" answer, not a claim that fuzzing and proving
are equivalent.

## Next step (recorded, not performed here)

Get this running in Linux CI (the original recommendation) or on a newer Halmos release, and compare:
if the SAME `IndexError` reproduces there, it's worth filing upstream with Halmos/a16z with this
project's exact `forge`/`solc`/`halmos` version triple (`forge 1.8.0`, `solc 0.8.26`, `halmos 0.2.6`) and
a minimal repro (this file is already about as minimal as a real project's formal-proof harness gets).
