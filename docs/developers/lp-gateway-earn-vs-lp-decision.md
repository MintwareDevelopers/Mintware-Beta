# LP Gateway V1 — Earn vs LP: the money-model decision

> **Status:** DECIDED (2026-09-08), **BUILT** (2026-09-08, same day). Both open decisions resolved: the zap
> swap runs **in-contract/atomic** (not an off-chain keeper); the deploy ratio is a **constant set to 10000**
> (not an immutable constructor arg). This doc is the single reference for the rebuild and for the external
> auditors. It supersedes the fused "stage → hold 50% → deploy with an owner-supplied paired leg" model that
> the testnet rigs (a–g) actually ran. **This landed BEFORE the external audit** — auditing the owner-subsidy
> design being abandoned would have been wasted spend.
>
> One-home updates this decision forced, DONE: `.claude/rules/lp-gateway.md`, `deployments.md` (the
> `LP_GATEWAY_*` table). **Still open:** `docs/developers/lp-gateway-external-audit-scope.md` (§1 system
> description, §6 invariants) — needs a pass reflecting the new `deploy()` signature + the deleted subsidy
> path before it's handed to auditors. **Also still open:** whether to retire `MintwareIdleYieldAdapter.sol`
> (marked "(candidate)" in the table below, never resolved) — the "load-bearing plumbing" quote below still
> applies to it regardless of the deploy-ratio change, so it was left untouched pending a separate call.
> **Test suite:** every `deploy()`-touching Forge test is being migrated to the new signature + a
> seeded-liquidity real-V4 rig (the in-contract swap needs real pool liquidity to trade against, in tests
> exactly like in production) — see `.claude/rules/lp-gateway.md`'s test-count staleness note for where that
> stands.

## The decision in one paragraph

Mintware offers **two separate products with different risk, never fused**: **(1) LP** — the user provides
liquidity to a curated pool via a **zap** (their single USDG is split by an on-chain swap into both legs);
the user holds both tokens and **bears 100% of the impermanent loss**; **Mintware never supplies the paired
token and never takes IL** (enforced on-chain, not promised). **(2) Earn** — the user supplies USDG to a
**lending** market (Morpho ERC-4626); true single-asset, **no pairing, no IL**; opt-in, gated on real
capacity. **Spend** (a later, cards-phase concern) is **against the wallet balance**, never a
protocol-custodied buffer. The old 50% held-back buffer, the protocol spend-buffer/ledger, and the
owner-supplied paired leg are all **removed**.

## Why this changed (the forcing facts)

- **Morpho has zero open capacity** on Robinhood mainnet (0 of 39 USDG vaults have room). The idle reserve
  can't earn today, so holding capital back to "earn while idle" is pure drag.
- **`deploy()` pulls the paired token from the owner seat** — `pairedAsset.safeTransferFrom(msg.sender, …)`
  in `MintwareLpGatewayPositionManager.sol`. That means **Mintware funds the other side of every position
  and eats its IL.** Unacceptable — a compounding liability that blows up in exactly the markets where it's
  called (see Bancor's IL-protection suspension, June 2022).
- **No cards exist yet**, so there is nothing to spend a protocol-held buffer against.
- The **50% deploy cap was a policy** ("hold half back") layered on top of load-bearing plumbing; with no
  yield and no spend, it just stranded half the user's money.

**Precedent:** this is exactly how the category leader works. Krystal's Zap-In deposits a single token,
swaps part into the paired asset, the **user holds both and bears IL**, and Krystal **does not supply the
pair from its own reserves** — their docs call IL "a standard characteristic of LP positions across all
DEXes." We are adopting the standard, correct model.

## Plumbing vs. policy (the distinction that resolves the confusion)

- **Load-bearing plumbing (keep, make invisible):** turning single-sided USDG into a two-sided pool
  position requires *something* to briefly hold the USDG and assemble the position. That is the only real
  reason a staging/adapter step exists. It is a doorway, not a feature.
- **Policies bolted on (delete all three):** ① hold back 50%; ② auto-earn on the held-back money;
  ③ make the held-back money a protocol-custodied spendable buffer.

## Product 1 — LP (zap into a curated pool)

| | |
|---|---|
| **User action** | Pick a curated pool, choose an input asset, choose zap or manual, commit `$X`. |
| **Mechanism** | **Zap** (fund with ONE token): swap a portion of the user's input into the correct ratio, then add both legs — one transaction. **Manual** (fund BOTH tokens): user brings both legs in ratio, add directly. Either way **100% of committed value is deployed** (no held-back buffer). |
| **Who funds the pair** | **The user**, always — whether they zapped one token or brought both. **Mintware supplies nothing, in every path.** |
| **Impermanent loss** | **100% the user's.** On exit they receive USDG + the paired token (or a swap back, their slippage). Not principal-protected. |
| **Range** | Fixed wide range (±22980 ticks) for V1 — simpler than Krystal's user-chosen ranges; a deliberate simplification, revisit later. |
| **Fee** | `LP_GATEWAY_PERF_FEE_BPS` (10%) on harvested fees — unchanged. |

**Deposit flexibility (Krystal parity — the target UX).** Match Krystal's provide-liquidity flow:
**(a) choose the input asset** — USDG, the pool's paired token, or (stretch) any token the user holds;
**(b) fund with one token (zap) or both (manual)**; **(c) pick zap or manual** explicitly. Every
combination is **user-funded** — the flexibility is only in how the user brings *their own* capital, so it
never reintroduces an owner subsidy. **V1 scope call:** support input = USDG or the pool's paired token
(the two legs); "any token the user holds" is a broader zap (swap any→both legs) that can follow. Range
selection stays fixed-wide for V1 (Krystal exposes user-chosen ranges — a later parity axis).

**Enforced invariant — "never us":** the owner→paired `safeTransferFrom(msg.sender, …)` path in `deploy()`
is **deleted**. The paired leg may **only** be sourced by swapping the user's own staged USDG through the
swap seam. With no code path that accepts an owner-supplied paired token, "Mintware never provides the pair"
is *impossible to violate*, not a promise. This also retires the `deployedPairedValue`-as-owner-subsidy
accounting (and the IA-11 `principalCap`-covers-the-subsidy complexity): `deployedPairedValue` becomes
simply "user USDG that changed form into the paired leg."

## Product 2 — Earn (lending, no IL)

| | |
|---|---|
| **User action** | Explicit opt-in prompt: *"Put your idle USDG to work."* Choose an amount. |
| **Mechanism** | Supply USDG to a lending market via `MintwareERC4626YieldAdapter` (Morpho ERC-4626). |
| **Who funds the pair** | **N/A — there is no pair.** Single asset in, single asset out. |
| **Impermanent loss** | **None.** Yield is borrow interest, not swap fees. |
| **Status** | **Blocked on capacity only** — ships the day a USDG ERC-4626 source has open room. Not a code gap. |

This is the product a user *actually* means by "pool one asset and earn while staying in that asset." It is
lending, and it is a **separate** surface from LP — never blur the two.

## Spend (cards phase — recorded now so nothing is built prematurely)

- **Spend is against the wallet's USDG balance.** No protocol-custodied buffer. A card authorizes against
  the static stablecoin balance in the user's Privy wallet — which also sidesteps the "can't read live AMM
  NAV inside the ~6s authorization window" problem entirely.
- **Refill** = topping the wallet back up from the user's LP/Earn positions. Physics limit: you cannot
  redeem on-chain *inside* a swipe, so refill is **between/after** swipes, not during.
  - **V1: manual "top up" tap** — one redeem → wallet funded. No delegation, no keeper, no custody.
  - **Later: automatic** — a keeper tops up on a low balance, via a pre-authorized delegated permit.
- **Explicitly NOT built for LP-Gateway V1:** any protocol-custodied spendable buffer, and the A-4
  **harvest-to-buffer ledger** (harvest destination `buffer` → drop; restake / NAV only). LP-Gateway V1
  never grows a buffer.
- **Scope boundary — do not confuse products.** The existing buffer stack in the tree (`lib/cards/buffer*`,
  `lib/org/buffer*`, `card_spend_buffers`, on-chain `refillBuffer`) belongs to the **org / team-treasury
  card rail** (the Lithic PR #401 work) — a **separate product**. This LP-Gateway decision does **not**
  touch or delete it. "Spend against wallet" here is a *don't-add* for the V1 consumer surface, not a
  teardown of the org rail.

## What we are explicitly NOT building / are removing

1. The **50% held-back buffer** (deploy 100% of committed capital).
2. The **owner-supplied paired leg** (`deploy()`'s `safeTransferFrom(msg.sender, …)` for paired) — deleted.
3. A **buffer for LP-Gateway V1** — spend is wallet-native; the A-4 harvest-to-buffer ledger is dropped.
   (The org/team-treasury card buffer is a *separate* product and is **not** in scope here — see Spend
   section's scope boundary.)

## Codebase impact (pending build — nothing changed yet)

This is a decision, not a diff. When built, the net effect on the LP-Gateway surface:

| Change | Effect | Grounding |
|---|---|---|
| Delete owner-paired subsidy path + `deployedPairedValue`-as-subsidy accounting | **Removes** the hardest-to-audit accounting (incl. IA-11 `principalCap`-covers-subsidy). Simpler trust model. | ~13 refs to `deployedPairedValue`/`safeTransferFrom(msg.sender` in the PM |
| Wire the swap seam as the only paired source | **Activates** existing code (no-op today), not a new subsystem. Adds a *bounded* swap surface. | `lib/gateway/routerSwap.ts`, `v4SwapExec.ts` exist as fail-closed no-ops |
| Retire `MintwareIdleYieldAdapter` (candidate) | **Removes** a contract — no idle reserve for LP means no zero-yield custody adapter. | `contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol` |
| Drop A-4 harvest-to-buffer ledger | **Removes** the LP-gateway buffer-crediting path (harvest → restake/NAV only). | harvest destination `buffer` in `opsConfig`/`harvest.ts` |
| Keep `MintwareERC4626YieldAdapter` | Unchanged — it **is** the Earn product. | — |

**Honest read:** the simplification is mostly in *trust model / audit surface*, not raw line count (a
bounded swap replaces the subsidy path). It does **not** shrink the unrelated org/team card code.

## Contract changes required (before external audit)

- **Delete** the owner→paired transfer path in `deploy()`; the swap seam becomes the **only** paired source.
- **Wire the swap seam** (`lib/gateway/routerSwap.ts`, `lib/gateway/v4SwapExec.ts`) — currently a
  fail-closed no-op — as the production paired-sourcing path. Bound it with `LP_GATEWAY_SWAP_SLIPPAGE_BPS`
  (default 100 = 1%); this makes **deep-pool curation non-negotiable** (self-swapping into a thin pool moves
  its price).
- **Reframe `deployedPairedValue`** from owner-subsidy to user-swapped value; simplify the associated
  `principalCap` coverage accordingly. `principalCap` remains the real absolute TVL-at-risk bound.
- **Deploy ratio → 100%**: keep it an **immutable per-instance** value (either the `MAX_DEPLOY_BPS`
  constant set to `10000`, or — preferred — an immutable constructor arg bounded `≤ 10000` and pinned in the
  registry seat-check), so invariant #6 ("un-reopenable") holds and a future 10% cards-phase instance is a
  deploy-time value, not a source edit.

## Open decisions (need a call before build)

1. **Where the zap swap runs:** in-contract/atomic (trustless, more contract surface — *preferred* for a
   money primitive) vs. off-chain keeper (simpler contract, keeper routes user funds).
2. **Deploy-ratio mechanism:** constant-set-to-100% (strongest for audit, source edit per phase) vs.
   immutable constructor arg (flexible, one audit covers all phases — *preferred*).

## Copy rules (hard lines, per the framing constraints)

- **LP:** "provide liquidity, earn trading fees, **carries impermanent loss**." Never imply the USDG stays
  whole; never "deposit / savings / guaranteed / fixed-APY."
- **Earn:** "supply USDG, earn interest" — it is lending, **not** "LP." Do not market it as liquidity
  provision.
- Est. fee APR stays an estimate, never a projection/guarantee. `riskScore` never certifies safety.

## References

- Krystal — Provide Liquidity (Zap-In): https://docs.krystal.app/products/liquidity-management/lp-transactions/provide-liquidity.md
- Krystal — Community Vault V2 (managed aggregate + performance-fee cut): https://docs.krystal.app/products/vaults/community-vault-v2.md
- Bancor IL-protection suspension (June 2022) — why "someone else eats the IL" fails: single-sided-with-ILP is the model that repeatedly breaks under stress.
- Current contract: `contracts-v4/src/gateway/MintwareLpGatewayPositionManager.sol` (`deploy()` paired-source, `MAX_DEPLOY_BPS`, `principalCap`, `deployedPairedValue`).
- Audit scope this amends: `docs/developers/lp-gateway-external-audit-scope.md`.
