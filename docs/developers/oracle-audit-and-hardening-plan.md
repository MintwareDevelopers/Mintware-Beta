# Oracle audit & industry-leading hardening plan

**Status: audit complete; hardening plan proposed, awaiting approval.**
**Date: 2026-08-07. Scope: the full signed-attestation oracle surface — every place a
Mintware "oracle" signs a weight, root, score, or range, and every place a contract trusts it.**

> **Why this exists.** We are about to make the oracle-attestation pattern *canonical* — the
> load-bearing trust dependency for reputation-weighted rewards across **every** vault (see
> `reward-weighting-decision.md`). Before "the one" carries that weight, it has to be stellar.
> This is the audit + the emergency-lever design that decision record names as a prerequisite.
> Three parallel read-only maps produced it: (1) on-chain verifiers, (2) off-chain signing infra,
> (3) how the attested weights are actually computed. Findings below are cited to `file:line`.

---

## 0. The trust model in one picture

The reward weight is assembled in **three layers**, and the load-bearing input sits in the layer
we control least:

```
LAYER A  —  THE SCORE            external, closed-source Cloudflare Worker
            (percentile, 6       attribution-scorer.ceo-1f9.workers.dev/score
             signals, sharing)   → NOT on-chain, NOT in this repo. A black box.
                 │
                 ▼
LAYER B  —  THE WEIGHT MATH       off-chain, in THIS repo (auditable & reproducible)
            (band→multiplier,     percentile→{1.0/1.25/1.5}×, lock tier, duration,
             lock, duration,      pro-rata share, StandardMerkleTree leaf
             merkle root)         vaultEpochProcessor.ts / vaultMerkleBuilder.ts
                 │
                 ▼  EIP-712 sign, single owner-controlled key
                 ▼
LAYER C  —  THE VERIFY            on-chain (FeeVault / Distributor / base vault / AttributionToken)
            (ECDSA.recover ==     verifies a TRUSTED KEY SIGNED IT.
             oracleSigner)        Never verifies the number is CORRECT. Any uint16 0–100 passes.
```

**One-line trust statement:** *the weight is an off-chain oracle attestation over an external
black-box score; the chain verifies **provenance, never correctness**.* Today that entire chain of
custody reduces to **one hot EOA** and, at the FeeVault, to **one owner's say-so with no signature
check at all.** That is the gap between what we have and "industry-leading."

---

## 1. Severity-ranked findings

Each finding: **what / where → concrete failure scenario → the fix → who holds the emergency lever.**
Severity is by blast-radius on the reward money-path once the oracle is canonical.

### 🔴 CRITICAL

**C1 — FeeVault's oracle attestation is dead code. The reward root is committed on one EOA's say-so.**
`FeeVault.sol:33-34` docstring promises "the oracle signs AttributionSnapshot… FeeVault verifies the
EIP-712 signature before epoch close." It doesn't. `ATTRIBUTION_SNAPSHOT_TYPEHASH` (`:62-64`) is
referenced nowhere; there is **no `_hashTypedDataV4`, no `ECDSA.recover` anywhere in the file**;
`oracleSigner` (`:89`, set at `:300`) is **never read**. `closeEpoch(bytes32 merkleRoot)` (`:181-195`)
is `onlyOwner` and writes the distribution root with **zero cryptographic attestation.**
- *Failure:* a compromised (or fat-fingered) owner EOA commits an arbitrary root → arbitrary reward
  weighting for every LP that epoch, with nothing on-chain to catch it. This is **exactly** the root
  we're about to make canonical across all vaults.
- *Fix:* implement the verification the docstring already promises — `closeEpoch` must take an oracle
  signature over `AttributionSnapshot`/root and `ECDSA.recover(...) == oracleSigner` before writing.
  (In the migration this becomes the two-token weighted distributor's `closeEpoch`; the verify path
  must exist from line one.)
- *Emergency lever today:* **none** — FeeVault has no Pausable, no guardian. Add guardian pause on the
  close path (see C4).

**C2 — One hot EOA signs everything; key reuse fuses the weight oracle to the distribution oracle.**
`DISTRIBUTOR_PRIVATE_KEY` signs **both** Merkle roots (`onchainPublisher.ts:180,220`) **and**
AttributionSnapshots (`attribution-snapshot/route.ts:83,96`); the range proposer **falls back to the
same key** (`rangeProposer.ts:207-209`). `FeeVault.sol:88` even comments the weight key is "the same
key used in onchainPublisher.ts." No HSM/KMS/MPC/multisig anywhere — raw hex `privateKeyToAccount` in
a serverless process. On-chain there is a single `oracleSigner` per contract; **no threshold (n-of-m)
signing exists in the system.**
- *Failure:* one key leak forges **weights *and* roots *and* rebalances** simultaneously, across
  every surface, undetectably. Single point of total compromise.
- *Fix:* (a) **separate keys per role** immediately (weight-attestation key ≠ merkle-root key ≠
  range key); (b) move signing to a **KMS/HSM-backed signer**, then to **multisig / threshold
  attestation** (roadmap §3).
- *Emergency lever:* per-contract rotation + guardian pause. Today rotation is instant-and-unsafe on
  two of four contracts (F-series findings).

### 🟠 HIGH

**C3 — The signing oracle is publicly callable. Anyone can make the hot key sign a snapshot for any
wallet.** `app/api/(rewards)/vault/attribution-snapshot/route.ts:3` is `Auth: none`. A public GET
makes the production oracle key sign an `AttributionSnapshot` for an arbitrary wallet.
- *Failure:* free signing-oracle: griefing, snapshot harvesting, an on-demand forgery primitive if any
  downstream ever trusts a snapshot out of epoch context. At minimum it's an unbounded use of the
  crown-jewel key by anonymous callers.
- *Fix:* gate behind `auth: 'signed-message'` or `bearer-token`, rate-limit, and only ever sign the
  *current epoch's* server-computed snapshot — never caller-supplied fields.
- *Emergency lever:* route-level kill (feature flag) + rotate if abused.

**C4 — No emergency lever on the two contracts that matter most for weighting.** Only
`MintwareBaseVault4626` and the hook use the fast `MWGuardianPausable`. `MintwareAttributionToken`
(the on-chain score mirror) and `FeeVault` (the reward root) have **no Pausable and no guardian at
all** (`MintwareAttributionToken.sol:26`, `FeeVault.sol:35`). Even `MintwareDistributor` has only
owner-`pause()`, no fast guardian (`:518`).
- *Failure:* a detected key compromise on the score/fee path **cannot be frozen** — the attacker keeps
  signing for the full 48h (Distributor) or forever (instant-rotation contracts) while you scramble.
- *Fix:* put every signed money-path behind `MWGuardianPausable` with a fast guardian role (already
  the pattern in the vaults/hook — extend it), and `whenNotPaused` on `closeEpoch`/`attest`/`claim`.
- *Emergency lever:* **this finding is the emergency lever** — it's the thing that's missing.

**C5 — On-chain accepts any signed number; no sanity bounds.** `FeeLib`/`FeeVault` accept any
`uint16` 0–100 percentile as long as the signature matches (`FeeVault.sol` verify path; agent-3 map).
The chain has no bound, no rate-of-change guard, no "this wallet's weight can't 10× epoch-over-epoch."
- *Failure:* a subtly-wrong or malicious signer can hand a favored wallet a max multiplier with no
  on-chain circuit breaker; nothing rejects an implausible jump.
- *Fix:* on-chain invariants on the signed inputs — percentile ∈ [0,100] (cheap), per-epoch aggregate
  weight caps, optional per-wallet epoch-over-epoch delta clamp. Cheap defense-in-depth that turns a
  silent forgery into a revert.

**C6 — `sharingPercentile` is a fake signal — the referral dimension we're about to *sell* isn't
wired.** `attribution-snapshot/route.ts:100` sets `sharingPercentile: percentile` — a **duplicate of
the overall percentile.** The referral tree / `referral_stats` / `sharing_score` are **never read**
by the snapshot route, so on-chain `FeeLib.sharingMultiplier` double-counts one opaque number instead
of pricing a real referral signal.
- *Failure:* directly undercuts the approved referral-as-weight design (`reward-weighting-decision.md`)
  — we'd market "referral quality raises your weight" while the code feeds the same score twice.
- *Fix:* the migration must feed a **real** referral/sharing input (quality-weighted referred-LP
  Attribution), and `sharingPercentile` must derive from the referral tree, not alias the score.

### 🟡 MEDIUM

**C7 — Instant, un-timelocked, no-zero-check signer rotation on two contracts.**
`MintwareBaseVault4626.sol:447` and `MintwareAttributionToken.sol:62` allow `setOracleSigner` **instant,
no timelock, no zero-address check** (contrast Distributor's 48h two-step `:275/290`, and FeeVault's
zero-check-but-unused `:301`). A compromised owner can instantly swap the signer to an attacker key —
or brick it to `address(0)`.
- *Fix:* standardize rotation: 48h timelocked propose→confirm + `cancel`, zero-address check, on
  **every** contract. Pair with guardian pause so *response* isn't gated on the 48h *rotation*.

**C8 — Daily-cron liveness with no automated fallback; missed epoch stalls claims.** All EVM oracle
signing is cron-gated once/day (`vercel.json`); a missed run leaves `oracle_signature=null`,
`distributions.status='pending'`, and `/api/claim` returns **500** (`epoch-end:200-204`). Recovery is a
**hand-run SQL template** (`onchainPublisher.ts:258-266`); stuck/unsigned states are **log-only**
(`epoch-end:334-340`) — no alert, no manual re-sign endpoint, no redundant signer.
- *Failure:* one missed cron = a full day of frozen claims for everyone, discovered only when a user
  complains. On Hobby, cron reliability is not something to bet the reward path on.
- *Fix:* grace-window + retry with alerting (PagerDuty/Slack, not `console.log`); an authenticated
  manual re-sign endpoint; a **permissionless fallback** so users aren't hostage to liveness (roadmap
  §3 — carry-forward last root, or self-claim against a committed input).

**C9 — Silent `percentile = 0` fallback collapses everyone to 1.0× on any worker outage.** On any
`/score` fetch error the code **defaults percentile to 0** (`attribution-snapshot/route.ts:55-59`,
`epochProcessor.ts:155`, `vaultEpochProcessor.ts:123-128`).
- *Failure:* a Cloudflare-worker blip silently signs a whole epoch at 1.0× for everyone — a
  wrong-but-signed weight, no error surfaced, no way for an LP to know their score was dropped.
- *Fix:* fail **closed**, not silent — if the score source is unavailable, **abort the epoch**
  (don't sign a degraded snapshot); alert; carry forward the previous epoch's weights rather than
  zeroing. Never sign a snapshot built on a swallowed error.

**C10 — The score itself is unverifiable, and a second black box hides behind it.** The `percentile`
is produced by closed-source worker code over analytics an LP can't see; there is **no input
commitment, no re-derivation path, no dispute mechanism** (`lib/web2/api.ts:1`, consumed at
`epochProcessor.ts:109` / `attribution-snapshot/route.ts:57`). EAS attestation re-signs the worker's
own JSON (`eas.ts:115`) — it attests *"we received this,"* not *"this is correct."* And
`referral_stats` is a **Supabase-dashboard view whose SQL isn't in the repo** (`docs/schema.sql:96`).
- *Failure:* an LP disputing "why is my percentile 12 not 60?" has **nothing** to check against —
  in-repo or on-chain. This is the ceiling on how trust-minimized "the one" can honestly claim to be.
- *Fix:* verifiability roadmap §3 — publish the scoring methodology + an input commitment (hash of the
  wallet's scored inputs) with each attestation; version-control the `referral_stats` SQL; long-term,
  make the score reproducible or optimistically disputable.

### 🟢 LOW / hygiene

- **C11 — Unauthenticated rotation-status endpoint.** `app/api/(admin)/oracle/rotation/route.ts` is
  read-only but `Auth: none` and self-flags "add IP allowlist or admin JWT before deploying public"
  (`:24-26`). Add auth.
- **C12 — Non-constant-time bearer compare.** `routeHandler.ts:205` uses `header !== \`Bearer ${secret}\``
  — a timing side-channel on cron/oracle secrets. Use a constant-time compare.
- **C13 — Comment/schedule drift misleads operators.** `pool-settle/route.ts:4,8` claims "every 15
  minutes", `epoch-end:7` claims hourly; real cadence is once/day. `universal-distribution-bridge`
  calls `publishDistribution` (`distributionBridge.ts:226`) with **no `vercel.json` schedule at all**.
  Fix comments; confirm the bridge's trigger is intentional.
- **C14 — No rotation path for the Solana (`SOL_ORACLE_PRIVATE_KEY`) or EAS (`EAS_ATTESTER_PRIVATE_KEY`)
  keys.** Only EVM contract-side rotation exists. Add operational rotation runbooks for all keys.

### ✅ What's already good (keep)

- `MintwareDistributor` is the reference: 48h timelocked two-step rotation + cancel (`:275/290/307`),
  `deadline` freshness + per-`(campaign,epoch,wallet)` claim-once replay guard, chainId-bound EIP-712,
  correct OZ StandardMerkleTree leaf encoding. **Make everything else look like this — then go past it.**
- **Key-exposure history is (per the map) clean** for `DISTRIBUTOR_PRIVATE_KEY`: `.env*` gitignored and
  untracked, and the only history matches are the env-var *name* in a help string, not a value.
  ⚠ **Caveat / must-verify:** `deployments.md` records a *separate* prior exposure of `ORACLE_PRIVATE_KEY`
  (audit 2026-07-31) that "must be rotated on-chain." The map didn't clear that specific key — **grep
  git history for `ORACLE_PRIVATE_KEY` values and rotate it on-chain regardless** before it signs
  anything canonical. Don't treat "clean" as settled until that key is checked.

---

## 2. What "industry-leading" means here (the bar)

A stellar signed-attestation oracle is judged on five axes. Where Mintware sits today:

| Axis | Today | Industry-leading target |
|---|---|---|
| **Key security** | 1 hot EOA, reused across roles, in a serverless process | KMS/HSM signer → multisig/threshold (n-of-m) attestation |
| **Liveness** | 1 daily cron, missed run freezes claims, log-only alerts | redundant signer + grace window + alerting + permissionless fallback |
| **Censorship-resistance** | omit a wallet → undetectable, un-appealable | inclusion guarantee + permissionless self-claim against a committed input |
| **Verifiability** | chain verifies provenance, never correctness; score is a black box | on-chain sanity bounds + published methodology + input commitment → optimistic/ZK dispute |
| **Emergency control** | fragmented; no pause on FeeVault/AttributionToken | fast guardian pause across every signed money-path + timelocked rotation |

The migration should not just "move vaults onto the oracle" — it should move them onto an oracle that
has climbed each of these axes at least to the "Tier 0/1" line below.

---

## 3. The hardening plan (tiered, so we ship what matters first)

### Tier 0 — MUST-fix before the oracle is canonical (blocks the pair-vault migration)
These are the ones that make "the one" trustworthy at all. All in-scope for the migration deliverable.
1. **C1** — real signature verification in `closeEpoch` (the two-token weighted distributor is built
   with the verify path from line one; FeeVault's dead attestation is never carried forward).
2. **C2 (part 1)** — **separate keys per role** (weight ≠ root ≠ range). Cheap, immediate, huge
   blast-radius reduction.
3. **C3** — authenticate + rate-limit the snapshot signing route; sign only server-computed current-epoch data.
4. **C4** — `MWGuardianPausable` + `whenNotPaused` on every signed money-path (FeeVault/new distributor,
   AttributionToken, and a fast guardian on Distributor).
5. **C5** — on-chain sanity bounds on signed inputs (percentile range + per-epoch aggregate cap).
6. **C7** — standardize 48h timelocked rotation + zero-check on **all** contracts.
7. **C9** — fail-closed on score-source outage (abort/carry-forward, never sign a swallowed error).
8. **C6** — wire the **real** referral/sharing signal (this is also the approved referral design; the
   two land together — you can't ship "referral raises weight" on top of a faked `sharingPercentile`).

### Tier 1 — key management & liveness (ship alongside or immediately after Tier 0)
9. **C2 (part 2)** — move signers to **KMS/HSM-backed** signing (no raw hex in process); then to a
   **2-of-3 multisig of independent signers** for the weight/root attestation.
10. **C8** — grace window + retry + real alerting + an authenticated manual re-sign endpoint;
    a redundant signer that can take over a missed epoch.
11. **C11–C14** — auth the rotation endpoint, constant-time secret compare, fix schedule drift/confirm
    the bridge trigger, rotation runbooks for Solana + EAS keys, **and verify+rotate `ORACLE_PRIVATE_KEY`**.

### Tier 2 — verifiability (the "stellar" differentiator; roadmap, not a launch blocker)
12. **Input commitment**: each attestation carries `keccak256(scored inputs)` so a disputing LP has a
    fixed target; publish the scoring methodology + version the `referral_stats` SQL into the repo (C10).
13. **Permissionless fallback claim** (censorship-resistance): last-good-root carry-forward, or a
    self-claim path against the committed input, so no wallet is hostage to the signer omitting it.
14. **Decentralize the attestation**: single KMS signer → committee/threshold → **optimistic dispute
    window** (anyone can challenge a signed weight against the committed input within N hours) →
    long-term ZK-proved scoring. This is the credible path from "nicer hot key" to "trust-minimized."

**Sequencing rule (from the decision record):** the migration is its **own scoped session** with a
**fresh invariant-fuzz pass** (the matched vault's 256×128k suite tests the accumulator logic we'd be
replacing) and a **separate review**. Tier 0 is the content of that session; Tier 1 rides with it;
Tier 2 is the published roadmap.

---

## 4. What this changes about the pair-vault migration

The framing shifts: **we are not "adding weighting to the pair vaults" and we are not "moving them onto
the existing oracle."** We are building the **real signed-attestation reward path the system never
actually had** (C1), on **separated, KMS-backed keys** (C2), behind a **guardian** (C4), with
**on-chain sanity bounds** (C5), a **real referral signal** (C6), and **fail-closed liveness** (C9) —
then routing both pair vaults' two-token fees through it as the canonical distributor. The approved
referral-as-weight design (`reward-weighting-decision.md`) is a *consumer* of this hardened oracle, not
a separate feature.

**Recommended decision:** approve **Tier 0 + Tier 1** as the scope of the migration session, publish
**Tier 2** as the trust-minimization roadmap, and — independently and now — do the two things that
don't need the migration: **verify/rotate `ORACLE_PRIVATE_KEY`** and **authenticate the snapshot +
rotation routes** (C3, C11), since those are live-surface exposure today.

---

## 5. Live-surface fixes — status (done 2026-08-07)

**Decision: Tier 0+1 approved as the scoped migration; Tier 2 = roadmap. The two live fixes done now.**

- ✅ **C3 — snapshot route authenticated.** `app/api/(rewards)/vault/attribution-snapshot/route.ts`
  now `auth: 'bearer-token'`; its only caller (`lib/rewards/vault/vaultEpochProcessor.ts`, server-side,
  cron-driven) forwards `Authorization: Bearer <CRON_SECRET>`. No client/wallet flow existed to break.
  Typecheck clean.
- ✅ **C11 — rotation-status route authenticated.** `app/api/(admin)/oracle/rotation/route.ts` now
  `auth: 'bearer-token'`. No in-repo caller; operator dashboards pass the secret.
- ⏳ **`ORACLE_PRIVATE_KEY` rotation — OPERATOR ACTION (runbook below).** Exposure CONFIRMED: git commit
  `dd48a569 "security: scrub exposed oracle signer key from deployments.md"` proves the signer key was
  committed to `deployments.md` and later scrubbed. **A scrub does not remove the value from history** —
  it is still recoverable at the pre-scrub commit. The key must be rotated on-chain; the scrub alone is
  not remediation.

### Rotation runbook (requires the contract-owner key — an operator step, not automatable here)

The exposed `ORACLE_PRIVATE_KEY` is the signer for the range-proposal path (`rangeProposer.ts`) and the
AI-agent attestation path (`agents/campaigns/record` → AIAttribution v3, Base mainnet
`0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421`). `DISTRIBUTOR_PRIVATE_KEY` is a *separate* key (roots +
FeeVault snapshots) and per the map has a clean history — but see step 4.

1. **Generate a fresh key in the secret manager** (Vercel env / 1Password) — never on disk, never in a
   file that could be committed. Record only the new *address*.
2. **Enumerate every deployed contract whose `oracleSigner` == the OLD address** and rotate each to the
   new address using that contract's rotation function (e.g. AIAttribution v3's oracle-set path; the
   base vault's `setOracleSigner` where deployed). Use the read-only `/api/admin/oracle/rotation` route
   to confirm the active signer before and after. For any contract with the 48h timelock, this is a
   propose→wait→confirm; for instant-rotation contracts it's one tx.
3. **Swap `ORACLE_PRIVATE_KEY` in Vercel** to the new key and redeploy so signing uses it.
4. **Belt-and-suspenders:** the map cleared `DISTRIBUTOR_PRIVATE_KEY`'s *history*, but since a signer key
   was demonstrably committed once, treat both keys as suspect until each address's on-chain signer has
   been rotated at least once post-audit. Cheap insurance.
5. **Confirm** old address can no longer produce an accepted signature on any live contract, and delete
   the old key material from the secret manager.

This runbook also becomes redundant defense once Tier 1 lands (KMS/HSM signer + per-role key separation +
multisig) — but the exposed mainnet key should be rotated **now**, ahead of that work.

---

## 6. Migration build log — Tier 0+1 scoped session

### ✅ Slice 1 — `MintwareWeightedDistributor` (2026-08-07)
`contracts-v4/src/MintwareWeightedDistributor.sol` + tests. The canonical two-token, multi-tenant,
oracle-signed Merkle distributor — the reward path FeeVault pretended to be. **Tier-0 fixes built in
from line one:**
- **C1** — `closeEpoch` verifies an EIP-712 `EpochRoot` signature (`ECDSA.recover == oracleSigner`)
  before any root is committed. Not dead code this time — the very reason it exists.
- **C5** — the signed `total0/total1` must be ≤ the funded `pot0/pot1` (`OverAllocated`), and cumulative
  claims are re-checked against the totals: **a root can never pay out more than was funded.**
- **C4** — inherits `MWGuardianPausable`; `closeEpoch` + `claim` are `whenNotPaused` (guardian fast-pause).
- **C7** — 48h timelocked oracle rotation (propose/confirm/cancel), mirroring `MintwareDistributor`.
- Design: the contract enforces **provenance + no-over-allocation**; the OFF-CHAIN builder owns the
  weighting formula (attribution/lock/referral) — the correct trust separation. Leaf =
  `keccak256(bytes.concat(keccak256(abi.encode(wallet, amount0, amount1))))` (OZ StandardMerkleTree).
- Tests: **30 unit** (`MintwareWeightedDistributor.t.sol`) covering every guard + replay-across-epochs +
  rotation cutover, and **3 invariants** (`…Invariant.t.sol`) — token conservation + solvency, **256
  runs × 128k calls, 0 failures.** Full contracts-v4 suite: **165 passing, 0 failing.** NOT committed.

### ✅ Slice 3 — two-token weighted distribution + referral (2026-08-07)
`lib/rewards/vault/weightedDistribution.ts` + `twoTokenMerkleBuilder.ts` + tests. The off-chain
weighting formula the contract verifies — and the **real referral signal that kills the faked
`sharingPercentile` (C6)**. Delivers the approved referral-as-weight design:
- **Base pot (fees)** split pro-rata by `liquidity-time × attribution × lock`. Referral is deliberately
  NOT in the base weight → a referred LP's bonus can never dilute another LP (proven by a non-dilution
  unit test).
- **Margin pot (protocol top-up)** funds two bonuses off the base earning, both LIFETIME + double-sided:
  **referee boost = +10%** (locked); **referrer reward = 20%** (locked) of each referred LP's base,
  **scaled linearly by the referred LP's Attribution percentile** (anti-sybil — a score-0 referee earns
  its referrer ~0). `marginRequired` is exactly what the treasury must fund; the contract's C5 guard
  then forces that funding to be real.
- Two-token merkle leaf `keccak256(bytes.concat(keccak256(abi.encode(wallet, amount0, amount1))))` —
  **cross-checked byte-for-byte against the Solidity encoding via viem** in the test suite.
- Tests: **13 vitest** (base split + conservation, non-dilution, referee/referrer math, anti-sybil
  scaling, margin/total reconciliation, per-token decimals, leaf-encoding agreement). tsc clean; full
  vitest **185 passing**. NOT committed. Remaining for the end-to-end path (belongs to slice 4): DB
  orchestration (fetch `referrerOf` + percentiles), wiring into the epoch processor, and oracle-signing
  the `EpochRoot`.

### ✅ Slice 2 — timelocked rotation everywhere + per-role key separation (2026-08-07)
On-chain (**C7**) and off-chain (**C2**) both hardened.
- **`MWTimelockedOracleSigner`** (`contracts-v4/src/lib/MWTimelockedOracleSigner.sol`) — one reusable
  48h-timelocked rotation primitive (propose/confirm/cancel + zero-check + one-time init), access-control-
  agnostic (internal logic; each contract adds `onlyOwner` wrappers). `MintwareWeightedDistributor`
  refactored onto it (no more inline copy); `MintwareBaseVault4626` and `MintwareAttributionToken`
  converted from **instant `setOracleSigner` (no timelock, no zero-check)** → one-time init + timelocked
  rotation. 5 rotation tests added to the attribution-token suite (one-time-init, timelock+cutover,
  cancel, zero-check, onlyOwner). Full contracts-v4: **170 passing, 0 failing.**
- **`lib/web3/oracleKeys.ts`** — role-keyed signer resolver (`root` / `weight` / `range` / `agent`),
  each with a **same-family** fallback so the root/merkle key and the range/agent key never cross.
  **Removed the dangerous `rangeProposer` → `DISTRIBUTOR_PRIVATE_KEY` fallback (C2)** — range signing can
  no longer borrow the root key. Repointed all four signing sites (`onchainPublisher`=root,
  `attribution-snapshot`=weight, `rangeProposer`=range, `agents/campaigns/record`=agent). Non-breaking:
  provision `WEIGHT_/RANGE_/AGENT_/ROOT_ORACLE_PRIVATE_KEY` in prod to complete the physical split.
  tsc clean (for these files); full vitest **185 passing**. NOT committed.

### ◐ Slice 4 — pair-vault fee routing into the distributor (on-chain done 2026-08-07)
The on-chain money-path wiring — the riskiest part — is complete and tested. **Both** pair vaults now
route their LP fee portion to `MintwareWeightedDistributor` when wired:
- `MintwareDeFiPairVault._realizeFees` and `MintwareMatchedLiquidityVault._realizeFees` gained a
  `weightedDistributor` branch: when set (one-time `setWeightedDistributor(dist, vaultId)`, owner-only,
  registers the pair + grants pull allowance), the LP fee pot is `fundFees`'d to the distributor
  instead of credited to the on-chain pro-rata accumulator. The accumulator path is preserved as the
  pre-wiring fallback (keeps its existing fuzz coverage valid); the matched vault keeps its team-
  redirection and `denom==0 → protocol` semantics unchanged.
- Tests: DeFi pair (`fees route to distributor` — exact pot match, accumulator stays 0, one-time,
  onlyOwner) + matched vault (community fees route, one-time). Full contracts-v4 suite green (see below).
  The distributor's own 256×128k conservation/solvency invariants already bound what the routed pot can
  pay out. NOT committed.

### ✅ Slice 4 (off-chain core) — epoch orchestrator + fail-closed liveness (2026-08-07)
`lib/rewards/vault/weightedEpochOrchestrator.ts` + tests. Ties the pipeline together:
`computeWeightedDistribution` (slice 3) → `buildTwoTokenMerkleTree` → **oracle-signed `EpochRoot`**,
producing exactly the `closeEpoch(...)` args the contract verifies.
- **C9 fail-closed liveness built in:** if scores are unavailable (`scoresAvailable=false`) or any LP
  percentile is missing/out-of-range, it **throws `ScoreSourceUnavailableError` and refuses to sign** —
  the caller leaves the epoch open and retries. Never reproduces FeeVault's silent percentile→0 collapse.
- Signs with the **weight-role key** (slice-2 resolver); the signature recovers to the address that must
  be the distributor's on-chain `oracleSigner`. The `EpochRoot` binds vaultId + epochNumber (no cross-
  epoch / cross-vault replay).
- Tests: **6 vitest** — signature recovery via `recoverTypedDataAddress`, closeEpoch-arg consistency,
  leaf-per-wallet, and three fail-closed cases (unavailable / NaN / out-of-range). Full vitest **191
  passing**; tsc clean. NOT committed.

**The reward pipeline is now built and tested end-to-end:** vault fees → distributor pot → weighted
allocation → two-token tree → oracle-signed EpochRoot → on-chain verify (C1) + no-over-allocation (C5) +
guardian (C4) → claim.

### ✅ Slice 4 (deployment glue) — cron + claim route + schema (2026-08-07)
- `lib/rewards/vault/weightedEpochCloser.ts` — `assembleLpInputs` (joins referral + percentiles onto raw
  LP positions; **fail-closed** — a null score map or a per-wallet miss yields `scoresAvailable=false` /
  NaN, never a fabricated 0), `buildClaimIndex`, and a thin `submitCloseEpoch` (keeper viem write; keeper
  pays gas only, holds no reward authority). 4 vitest.
- `app/api/(rewards)/cron/vault-weighted-epoch-close/route.ts` — bearer-gated cron: loads wired vaults →
  LP positions + referral graph + percentiles → orchestrator → `closeEpoch` on-chain → persists tree.
  **Env-gated to no-op cleanly** until `KEEPER_PRIVATE_KEY` + a deployed/wired distributor exist;
  fail-closed per vault (skips, leaves epoch open). Wired into `vercel.json` (`0 1 * * 1`).
- `app/api/(rewards)/vault/weighted-claim/route.ts` — public claim/proof server from the persisted tree.
- `supabase/migrations/20260807000002_weighted_epoch_schema.sql` — `vault_weighted_epochs` sink +
  `vault_lp_positions` + `social_vaults` wiring columns (idempotent).

Full vitest **195**; tsc clean; Forge **175** (unchanged). **The migration is code-complete.**

### ▶ Remaining — operator / infra only (no code)
1. **Deploy** `MintwareWeightedDistributor`; `setWeightedDistributor()` on each pair vault; set
   `NEXT_PUBLIC_*`/keeper envs; apply the migration; stand up the `vault_lp_positions` indexer.
2. **Rotate `ORACLE_PRIVATE_KEY`** on-chain (§5 runbook — exposure confirmed) and provision the per-role
   keys (`WEIGHT_/RANGE_/AGENT_/ROOT_ORACLE_PRIVATE_KEY`) to complete the physical key split.
3. **Tier 1** — KMS/HSM signer → 2-of-3 multisig; alerting; remaining hygiene (C8/C12/C13/C14).

> ⚠ **Unrelated concurrent breakage noticed (not this work):** another session is mid-refactor removing
> `lib/web2/providers/molten.ts` (staged deletion) while `hooks/useSwap.ts` still imports it — 2 tsc
> errors in `useSwap.ts` / `vault/create/page.tsx`. Left untouched to avoid colliding with that session.
