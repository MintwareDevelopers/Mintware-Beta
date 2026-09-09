# V1 second audit pass — 2026-09-09

## Assessment

Recommendation: **do not treat V1 as ready for production sign-off**. The simple deactivation and dust-floor fixes work in their tested scenarios, but instance replacement and event-order accounting remain unresolved. Concurrent working-tree fixes now address registry read failures, inactive-only fallback, and retirement-time cron targeting; the settlement lifecycle still needs broader verification. A historical Supabase service-role credential also needs revocation evidence. No new on-chain principal-drain exploit was established.

Baseline for this review: `c9c03dde2db4dd2de6ec657b643aee2b2c45b80e`; differential range `edc03502..c9c03dde`. Another editor subsequently modified `app/api/gateway/withdraw/route.ts` to pin the balance read to the receipt block, with tests in `app/api/gateway/deposit/route.test.ts`. That working-tree change is explicitly discussed below. Concurrent edits also changed registry.ts, routeInstance.ts and harvest.ts. This pass added audit artifacts and reproductions, not application fixes; the implementation edits came from another editor.

New findings: one **High-priority historical credential exposure, current validity unverified** (P2-01), and one **Medium fee-settlement lifecycle defect** (P2-02). Residual V1-01 and V1-04 issues retain their earlier priorities rather than being counted as wholly new vulnerabilities.

## P2-01 — Historical service-role credential remains recoverable from Git

Gitleaks scanned 1,460 commits (~559 MB) and produced 27 redacted matches. Six JWT matches at `.claude/settings.local.json:75–77` in commit `3b22a3d5` refer to one unique JWT. Locally decoded payload: issuer `supabase`, role `service_role`, an expiry after this review date, and a project reference. No credential value or project identifier is reproduced here. No authenticated request was made with this key; signature validity, revocation, project activity and current permissions are unverified.

Commit `e6df20e8` removed this file from tracking and explicitly mentioned secrets. That removal does not remove earlier history. This is a confirmed historical disclosure of credential-shaped service-role material, not proof of current database compromise, and may already have been handled operationally. A reader of repository history is the threat actor; no public visibility of this repository was established.

If still valid, a service-role key bypasses RLS and can exercise its granted database privileges. [Supabase documents this privileged behavior and key-management guidance](https://supabase.com/docs/guides/getting-started/api-keys). This matters to the gateway's service-only registry and accounting boundaries; deny-all RLS is not a protection from that role. On-chain signing keys and direct contract theft do not follow automatically from this finding.

Action: verify the exposed key has been revoked; otherwise replace it and revoke the old credential using the project's applicable Supabase key migration/rotation process, updating dependent services. Review access logs. History cleanup alone is insufficient and was not performed. The other 21 generic-key matches were not all individually adjudicated and are not 21 additional confirmed secrets. The redacted report is local at `.audit-output/gitleaks.json`.

## P2-02 — Retired pools leave the fee schedule (target selection fixed in current working tree)

`lib/gateway/harvest.ts:111` builds cron targets exclusively from `listActiveInstances`; both full harvest and index-only modes use those targets. Meanwhile, the V1-01 fix deliberately restores withdrawal from inactive pools. The contract's `lpLegExit` sweeps fees as part of withdrawal (`contracts-v4/src/gateway/MintwareLpGatewayPositionManager.sol:727–729`), and `_sweepFees` sends them to the harvest recipient and emits `Harvested` (`:999–1009`).

Trigger: retire pool A while pool B stays active; holders withdraw from A, or A already has pending fee rows. The cron visits B and never indexes or settles A. Income remains at the fee seat instead of entering the normal restake pipeline; the new dust-floor fix cannot help because A never reaches `harvestGateway`. Manual recovery/reactivation may be possible. No attack privilege is necessary beyond ordinary retirement; this is a lifecycle/accounting defect, not an unauthorized principal transfer.

At c9c03dde, the new Vitest file executed real `harvestAll` and real registry filtering with active and inactive rows, mocking only the indexer and chain configuration. Only B was indexed. A concurrent harvest.ts change now calls listAllInstances and targets both. The test has been converted to assert both are indexed. The corresponding full-harvest exclusion follows the same target list in source. The reproduction does not execute a real withdrawal or a live cron.

Remediation: preserve immutable historical instance identities and run reconciliation/settlement for retired instances while balances, pending rows or unindexed events remain. Define what happens to fee income after the last holder exits; blindly compounding into a zero-share pool is not a complete recovery policy.

## Earlier finding reconciliation

| Finding | Result of this pass |
| --- | --- |
| V1-01 inactive withdrawal discovery | **Partially fixed.** Simple retirement resolves as registry/live:false and is enumerated. Replacement remains; concurrent fixes close the registry-error and inactive-only fallback cases below. |
| V1-02 pending fees below harvest floor | **Fixed for the tested active-instance backlog case.** Existing two-phase claim/compound/mark logic is reused. Retirement omission is P2-02. |
| V1-03 PM parked-quote omission | **Still reproduced.** Existing PoC reports zero for 100 USDG parked in PM. No positionReader fix in reviewed commits. |
| V1-04 delayed/reordered basis | **Confirmed with real SQL.** Historical-block working-tree change addresses one case but not record-order dependence. |
| V1-05 wallet provider | Unchanged in reviewed commits; no wallet/browser transaction verification. |
| V1-06 inactive Swap action | Unchanged; no new execution coverage. |
| V1-07 paired conversion stub | Unchanged; no fork conversion verification. |
| V1-08 partial/stale portfolio | Unchanged; unavailable RPC is still omitted. |
| V1-09 route limits | Unchanged on the earlier identified routes; no deployed load test. |
| V1-10 lint dependency | No application linter remediation in reviewed commits; not rerun in this pass. |
| V1-11 dependencies | No fresh registry advisory check or reachability census in this pass; retain earlier caveats. |

### V1-01 residuals

The line references below describe c9c03dde. Concurrent registry/routeInstance edits now throw on database errors and allow env fallback only for zero total rows. The relevant tests now assert corrected behaviors; replacement remains unresolved.

1. **Replacement still loses old PM discovery.** `registerInstance` updates the same inactive registry row with the new PM at `lib/gateway/registry.ts:484`. `listAllInstances` reads only current rows, not immutable historical PM identities. The new test performs an explicitly authorized synthetic operator-attested replacement; only the replacement PM resolves afterward. Funded old shares remain on-chain, with direct withdrawal available, but normal UI discovery/recording no longer identifies them. This is not an unprivileged registration bypass.
2. **Read failures activate env fallback.** `registry.ts:327–341` discards Supabase errors and returns an empty array. The new test returns `{data:null,error:...}` and observes env resolution rather than a service error. Existing configured env coordinates are required; the attacker does not choose a PM address. Metadata can then drive the frontend's dev-rig deposit eligibility at `V1PoolDetail.tsx:153–155`. No live outage/wallet scenario was exercised.
3. **Inactive-only deposit lookup can still resolve env.** Without `includeInactive`, `routeInstance.ts:143–158` skips retired rows and falls through when no active row exists. A test whose env pool equals the retired pool resolves env. This is a resolver inconsistency; the ordinary metadata path resolves that retired row as registry/live:false, so this test alone does **not** prove the ordinary UI permits deposits into it. The deposit API records an already-mined deposit; it does not itself move user funds.

Remediation: fail closed on registry query errors, allow fallback only after positively confirming zero total registry rows, and use durable chain+pool+PM identity throughout reads, exit discovery, events and positions.

### V1-04 actual PostgreSQL evidence

`tools/v1-audit/basis-reproduction.mjs` loads three unchanged checked-in migrations into ephemeral PGlite, including the real PL/pgSQL functions and actual numeric column types. It does not mock the accounting formulas.

- Deposit 100, withdraw 50, deposit 100 on-chain; delayed withdrawal record uses latest 150 shares: final basis **175**, expected **150**.
- Withdrawal records before initial deposit: the no-row withdrawal still consumes its tx key. Deposit arrives and a withdrawal retry cannot correct basis: **100**, expected **50**.
- Even with the correct historical post-withdraw balance of 50, recording the later 100 deposit first gives basis **100**, expected **150**. Pinning `blockNumber` does not fix this order dependence.
- Control: replaying a deposit does not increment basis twice.
- Control: 50 generated amounts recorded in chain order produce the expected result, seed `20260909`.
- An arrival-order-invariance property fails and shrinks to unit `1`, path `0:0`. This is a deliberately reproduced failing property, not a passing correctness claim.

The immutable event fold must use chain order (block, transaction and log indices) and stable instance identity. A transactional update prevents lost writes but cannot make addition and proportional withdrawal commute. PGlite establishes sequential SQL semantics; no multi-connection race or live Supabase deployment was tested. The concurrent working-tree comment's same-block concern should also be judged against the contract's per-caller action-per-block guard, rather than assumed reachable for the standard deposit/withdraw paths.

## Differential review and blast radius

The reviewed two-commit range changes 15 files (+2682/-103 lines), including audit artifacts. Six production files change: routeInstance, harvest, metadata, position, withdrawal, and pool-detail UI. The large dependency report is historical scan evidence, not freshly validated advisory content. Strategy: focused review of all production changes and tests, with surgical gateway contract context in the separate dossier.

`resolveInstanceStrict` has five production call sites across four API modules (position GET/POST, metadata, deposit, withdrawal); `listResolvableInstances` has one portfolio route caller. `harvestGateway` has one production caller, `harvestAll`, which has one cron-route caller. `collectTx` becoming optional has no outside production field consumer found. UI withdrawal now uses `canWithdraw` separately from deposit eligibility; receipt signer/event/address checks remain intact.

History: resolver policy traces to `74f9b9b14`; dust optimization to `b5829e8e0`; deterministic NotDeployed skip to `28c415e94`. The new fixes do not remove receipt verification or on-chain authorization. Negative controls retain wrong-pool rejection when active registry rows exist and no settlement when disabled. Tests cover ordinary retirement and a nonzero backlog; replacement, registry errors and retired cron coverage were missing and are added as audit reproductions here. No line-coverage percentage was measured.

## Validation

- Focused Vitest: 41 files passed, one skipped; **414 tests passed, four skipped**.
- New second-pass reproductions: **four passed**, asserting the unresolved behaviors above.
- Follow-up run including concurrently edited deposit-route tests: **17 passed** (includes those four; do not add these as disjoint totals).
- Gateway Forge: **88 passed, zero failed/skipped**, seven suites. Command: `forge test --offline --match-path 'contracts-v4/test/gateway/*.t.sol'`.
- Halmos selected real-bytecode checks: **six passed, zero failed** in a clean run. Five `_marksHigher` properties on both quote orientations, plus MIN_TWO_SIDED_BPS constant binding. They do not prove general withdrawal economics or deployment fairness.
- Additional Forge idle-state invariants/regressions: **10 passed, zero failed/skipped**, three suites. Fee-source campaign: 128 runs / 12,288 handler calls; standard idle campaign: 256 runs / 32,768 calls, both zero handler reverts as reported. Includes deterministic 3,000-call witnesses. These are actual run totals, not a claim of 128,000 calls per invariant.
- TypeScript: `pnpm exec tsc --noEmit --incremental false` **passed**, including the final working-tree refresh.
- Semgrep: three local rules, 94 files, two matches; partial parsing warnings in two tests. Matches at V1PoolDetail lines 260 and 305 are legacy unbounded fallbacks gated by `supportsMin`; not independently confirmed exploitable bugs. Capability probing/deployed bytecode still need verification.
- Secret scan: 27 redacted historical matches; one unique service-role JWT confirmed from its payload as described above.

The successful Halmos run required Rich 13.9.4 and a solver executable path without spaces. An earlier attempt emitted PASS despite solver-launch exceptions and was rejected. Other attempts hit assertion timeouts/process-cleanup restrictions; their summary was not accepted as proof. The isolated wrapper imports the unchanged formal suite, compiles with solc 0.8.26/optimizer 200/via-IR, and disables only the isolated post-build Solar lint step because it misresolved external imports after successful Solidity compilation. See `tools/v1-audit/prepare-formal.py`. Main project lint/configuration was not changed.

## Remaining gaps and handoff

Prioritize credential revocation evidence, immutable historical instance resolution, and chain-order cost basis. Verify the new retired-pool targeting through actual settlement and last-holder cases. Retain earlier parked-quote, wallet and paired-conversion work. No implementation patch, deployment, database write, wallet transaction, history rewrite or key rotation was performed here.

The separate context dossier maps contract access, idle-source assumptions, withdrawals/re-credit, deploy swaps and fee sweeps. Residual paired balances after limited swaps, failed pre-sweep fee netting, source haircut adequacy and final-holder fee policy remain questions, not newly proven vulnerabilities. Curator replay also remains unverified. No live browser, fork RPC, production bytecode, multi-connection database, full dependency, Echidna, Medusa or full-repository Forge campaign was completed in this pass.

Logs are local `/tmp/mintware-pass2-*.log`; redacted scanner and formal JSON output is in ignored `.audit-output/`. Reproductions intentionally assert defects and must be changed into regression assertions only alongside reviewed fixes.

## Final working-tree validation

Final focused Vitest refresh: **419 passed, four skipped**, 42 files passed and one skipped. Three of the second-pass assertions now verify concurrently fixed behavior; the fourth still demonstrates old-PM replacement loss. Read `2026-09-09-v1-pass2-snapshot.json` for source hashes at the review cutoff. This avoids treating an actively edited checkout as an immutable commit.
