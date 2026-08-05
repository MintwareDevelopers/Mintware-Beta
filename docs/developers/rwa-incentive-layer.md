# RWA Incentive Layer — Plan of Record

> **Status:** Design / plan of record (2026-07-28). No code yet — this doc pins the framing,
> the campaign taxonomy, the reuse-vs-new split, and the locked decisions before we build.
> **Read alongside** [`phase3-two-surface-architecture.md`](phase3-two-surface-architecture.md)
> (the vault surfaces this incentivises) and [`.claude/rules/rewards.md`](../../.claude/rules/rewards.md)
> (the campaign engine this extends). Branch: `feature/phase-3`.

---

## 1. Thesis

Mintware was positioned as a DeFi rewards platform. The realisation driving this doc:
**the incentive engine we built is a better fit for RWAs than it ever was for DeFi.**

In DeFi, incentives attract the capital you least want — mercenary TVL that farms the emission
and leaves. Every DeFi rewards program fights its own users.

RWAs invert that, in two ways at once:

**Primary side — capital quality.** An SPV wrapping a 90-day trade-finance note needs capital
whose *duration matches the asset* and whose behaviour is sticky and qualified. Our engine does
not reward quantity of dollars — it rewards **Attribution score × lock duration × referral
quality**. That is a duration-matching, quality-of-capital filter no issuer can buy with raw APY.

**Secondary side — liquidity.** Tokenisation's broken promise is liquidity: everyone can tokenise
an asset, almost nothing tokenised actually *trades*. Secondary markets for tokenised T-bills,
private credit, and trade finance are thin to dead. An RWA you cannot exit is a roach motel. Our
volume / referral / LP campaigns are the machine that makes a tokenised RWA do the one thing
tokenising it was supposed to do — **be liquid.**

This is load-bearing, not decorative: the `vRWA/USDC` oracle-banded Uniswap V4 pool
(see two-surface architecture) is **dead without LPs and volume**. The band is theoretical until
real two-sided liquidity and flow exist. The incentive layer is what turns that surface from a
diagram into a functioning market.

**The pitch to an issuer** is therefore not "we tokenise your asset" (solved, commoditised). It is:
> *"We solve your cold-start, your distribution, and your secondary liquidity — we bring you
> sticky, eligible, relationship-sourced capital, let you reward it by how good it is rather than how
> much it is, and we make the resulting position tradeable."*

Almost nobody has solved **incentivised primary distribution + secondary liquidity weighted by
capital quality** for RWAs. That is the wedge.

---

## 2. The full lifecycle — one engine, both sides

The engine covers the entire RWA lifecycle, not just distribution. The two sides reinforce each
other: **secondary liquidity de-risks the primary** — investors subscribe to a deal when they
believe they can exit it.

| Campaign type | Primary (raise the deal) | Secondary (keep it liquid) |
|---|---|---|
| **Volume** | — | Reward real flow → price discovery, tighter bands, **exit liquidity** |
| **Referral → come buy** | Placement-agent distribution | Demand-side buyer acquisition |
| **LP / vault** | Seed the pool at launch | Attribution-weighted market-making that keeps `vRWA` tradeable |
| **Subscribe / hold** | Duration-matched sticky capital | Hold-to-maturity bonus |

**Why it is cleaner on RWA than DeFi.** In DeFi, volume farming is mostly wash-trading garbage you
pay for. On the RWA surface the **oracle band constrains price**, and where a deal's wrapped token
is permissioned the **token itself constrains who can trade** (on-chain, upstream of us) — so
incentivised volume is far closer to genuine price discovery than mercenary noise. It is not
zero-manipulation, but the band + the token's own gate change its character entirely.

---

## 3. Core architectural decision — surface-agnostic engine, gate lives in the token

### 3.0 The engine adds no gate of its own — the token's transfer rules do (Reg D: allowlist · Reg A+: open)

> **⚠ Superseded framing (2026-08-05).** This section originally read "PERMISSIONLESS by
> construction — zero KYC in Mintware." Corrected: for **Reg D** assets the wrapped `vRWA` is
> whitelist-gated at transfer (traders must be KYC-verified via `SPVBeneficiaryRegistry`), so the
> trade/hold reward path necessarily runs over verified holders. **Reg A+** assets still run open.
> The engine-neutrality point below (Mintware adds no gate *of its own*) still holds. See
> [`rwa-compliance-three-role-model.md`](rwa-compliance-three-role-model.md).

**Mintware incentivises the *wrapped* token, and never enforces holder eligibility of its own.**
Eligibility lives entirely in the wrapper, upstream of us:

- **Permissioned token (Reg D — the current tier)** — the token enforces an on-chain allowlist on
  every transfer (`SPVBeneficiaryRegistry`). An ineligible wallet's swap simply reverts on-chain.
  The gate is the *token's*, not Mintware's — but rewarded holders are therefore KYC-verified.
- **Bearer-style transferable token (Reg A+)** — the issuer KYCs at the mint / redeem gateway; the
  token then trades openly. Mintware sees a plain, transferable ERC-20.

Either way the gate is **in the asset**, not in our campaign engine. Mintware's surfaces — pool,
vaults, campaigns, referrals — add no eligibility check of their own; they respect whatever the
token enforces.

**Why this is still the moat.** Incentivised, liquid secondary markets + rewards on RWA-backed
tokens is exactly what walled-garden RWA platforms structurally cannot offer. Mintware never becomes
the gatekeeper — the token's own rules (or the issuer's gateway) do — so referral stays "come trade
this liquid token," not "solicitation into a private placement."

**Consequence for the build:** Mintware's incentive layer has **no `min_kyc_tier` and no eligibility
check of its own** — but for Reg D deals the token's on-chain allowlist means the KYC gate is real
and upstream, enforced for free at transfer. See the
[three-role build plan](rwa-three-role-build-plan.md).

### 3.1 The engine is surface-agnostic

**Locked decision:** we do **not** build a parallel "RWA campaign system." The campaign engine
becomes **surface-agnostic**, and RWA is a **superset user** of it.

A volume campaign, a referral campaign, and an LP-incentive campaign already:
1. verify a swap/deposit on a V4 pool (`verifySwapTx`, `swap-event` route),
2. credit points into `activity` / `epoch_state`,
3. distribute via `distributions` + `MintwareDistributor` Merkle claims.

The `vRWA/USDC` pool is **just another pool to point a campaign at.** Those three campaign types
need essentially *zero* new mechanics to run on RWA.

### Reuse untouched (~80% of the engine)

| Component | File / table | RWA use |
|---|---|---|
| Points Campaign + epoch machinery | `epoch_state`, `distributions` | Coupon-period distribution |
| Merkle distribution + claims | `MintwareDistributor v2` (Base) | Reward / coupon payout — **as-is** |
| Attribution multiplier | `swapHook.ts` `processPoints` | Reward capital *quality* — **as-is** |
| Referral tree + 24h anti-sybil gate | `referral_records`, `/api/referral/apply` | Placement-agent / buyer acquisition |
| Lock tiers | `LockLib.sol` (Flex→Core) | Duration-match to asset maturity |
| Per-tx swap credit | `campaigns/swap-event` | Volume / trade credit on `vRWA/USDC` |
| Oracle EIP-712 signing | claim path | Coupon/reward signatures — **as-is** |

---

## 4. What is genuinely new (the ~20%)

Two net-new pieces. Everything else is config. **Mintware's engine adds no KYC piece of its own** — the wrapped token gates transfers for Reg D (see §3.0).

### 4.1 Hold-snapshot crediting (the one net-new engine part)

DeFi credits per swap **tx**. RWA subscription/hold campaigns credit per **epoch holding**:

```
points = vRWA_held × duration_held × attribution_multiplier
```

- New action types `hold` (per-epoch snapshot) and `subscribe` (primary deposit event).
- New **snapshot cron** that reads `vRWA` balances at epoch close, computes holding-weighted points,
  and writes into the existing `activity` / `epoch_state` tables. This is the only new *mechanic* —
  it feeds the existing distribution rail; it does not replace it.
- Snapshot source: vault share balances (on-chain read) + duration since last snapshot.

### 4.2 Duration-matched lock bonus

Tie the lock tier to the deal's maturity so capital that locks *to/through* the asset's settlement
earns a bonus multiplier.

- Wire the campaign's lock config to the deal's `settle_days` (`vault_deals.settle_days`).
- A wallet locked ≥ `settle_days` earns the "duration-matched" bonus on top of its lock-tier
  multiplier (`LockLib`). Rewards holding the exact duration the SPV needs.

---

## 5. Action taxonomy — DeFi → RWA remap

The action ledger (`activity.action_type`) gains RWA verbs. DeFi verbs keep working on the RWA
surface unchanged (volume/referral). Only `subscribe` / `hold` are new mechanics (§4.2).

| DeFi action | RWA equivalent | New mechanic? |
|---|---|---|
| `trade` | `trade` (on `vRWA/USDC`) | No — reuse `swap-event` |
| `bridge` | `subscribe` (primary deposit) | Yes — deposit-event credit |
| — | `hold` (per-epoch snapshot) | Yes — snapshot cron (§4.1) |
| `referral_trade` | `referral_trade` (buyer acquisition) | No |
| `referral_bridge` | `referral_subscribe` (placement) | Rename only |
| LP provision | LP provision (attribution-weighted fee share) | No — `FeeVault` exists |

---

## 6. Data model deltas

Additive only. No breaking changes to the DeFi campaign path.

```sql
-- campaigns: surface + RWA association (no KYC column in the engine — the token gates transfers for Reg D, §3.0)
alter table campaigns add column if not exists surface text not null default 'defi';   -- 'defi' | 'rwa'
alter table campaigns add column if not exists linked_deal_id uuid references vault_deals(id);
alter table campaigns add column if not exists duration_match_days integer;              -- from deal settle_days

-- new RWA action types are values in activity.action_type; no schema change needed
--   'subscribe' | 'hold' | 'referral_subscribe'
```

Shipped as migration `20260728000001_rwa_incentive_surface.sql` (R0).

Holding snapshots reuse `activity` (`action_type = 'hold'`) — no new custody table. Keep the hot
path thin; do the holding-weighted allocation math in the snapshot cron, off-chain, and keep the
cron response JSON-safe (`BigInt` from on-chain reads will 500 under `NextResponse.json` otherwise —
use `ctx.json`).

---

## 7. Reward denomination

Because Mintware incentivises the **wrapped, transferable token** and never enforces holder
eligibility (§3.0), our regulatory posture is that of any DEX + rewards layer over an ERC-20 — we
are not distributing, custodying, or gating a security. The eligibility question sits with the
issuer at the wrapper, not with us.

What remains is a design lever, not a compliance gate: **how a reward is denominated.**

| Reward flavour | Recipient | Denomination |
|---|---|---|
| Hold / subscribe bonus | Holder of `vRWA` | Incentive token |
| Coupon / yield distribution | Holder of `vRWA` | The deal's yield token |
| Volume incentive | Trader | Incentive token |
| Referral | Referrer | Incentive token |

The engine keeps reward classes distinct so each can be denominated (incentive token vs. the deal's
yield token) and switched on/off per campaign. Nothing here gates *who* may participate — the token
does that, if at all.

> **Note:** this is the payoff of the §3.0 decision. By incentivising only the wrapped token we
> stayed out of placement-agent / private-placement territory entirely. Should a future product
> ever touch *primary issuance of a restricted instrument directly* (not the plan), that would
> reopen a real regulatory surface and belongs with counsel — but the incentive layer described
> here does not.

---

## 8. Build tracks & sequencing

| Track | Work | Status | Depends on |
|---|---|---|---|
| **R0 — Surface flag** | `campaigns.surface` / `linked_deal_id` / `duration_match_days` + create-route | ✅ built | migration `20260728000001` |
| **R1 — RWA campaign creation** | `/api/vaults/deals` + surface picker + deal-linking in creator | ✅ built | R0 |
| **R2 — LP incentive on RWA** | Attribution-weighted LP rewards | ✅ by reuse — the existing `vault-epoch-close` cron + `processVaultEpoch` + `FeeVault` cover any vault, including RWA | a real RWA vault on those contracts |
| **R4 — Hold-snapshot credit** | `hold` action + weekly snapshot cron | ✅ built (16 unit tests) — cron skips `no_vault_token` until a live vault | live `vRWA` vault for real balances |
| **R5 — Duration-match lock** | Lock-to-maturity bonus | ✅ live — cron reads the vault's `locks(address)` per wallet; remaining-lock ≥ `settle_days` earns the bonus | R4, `MintwareBaseVault4626.locks` |
| **R6 — Reward denomination** | Incentive vs. yield-token rewards | ✅ by construction — the creator's token selection (Step 1) *is* the denomination lever | — |

> **R3 (KYC gate) lives in the token, not the engine** — Mintware's incentive layer adds no KYC gate
> of its own, but for Reg D deals the wrapped token's transfer whitelist enforces it upstream (§3.0).
> Track numbers R1–R6 are kept stable for continuity; there is no separate R3 in the engine.

**What remains before this runs end-to-end in production:** (1) ~~apply migration `20260728000001`~~
✅ applied; (2) deploy an RWA vault so the hold-snapshot cron reads live balances — see §9 below
(demo vault live on Base Sepolia); (3) ~~wire an on-chain `lockDays` source~~ ✅ done — the cron reads
`MintwareBaseVault4626.locks(address)` per wallet.

---

## 9. Going live — deploy an RWA vault + wire the hold snapshot

The RWA 4626 vault is **reserve-only in v1** (USDC held in the vault, no V4 pool), so a hold-credit
deploy needs no hook mining. `DeployRwaVaultDemo.s.sol` is a self-contained one-shot that deploys the
stack (test USDC → FeeVault → SPV registry → vRWA → RWA vault) and seeds two holders with real share
balances. Dry-run verified on a local EVM (holders end with 10,000 / 5,000 shares).

```bash
DEPLOYER_PRIVATE_KEY=0x… pnpm forge:rwa-vault-demo:base-sepolia
```

It prints a `VAULT` address. Point a seeded deal's vault at it so the cron reads its balances (example
wires the Sovereign T-Bill deal — swap the id + address):

```sql
update social_vaults
set contract_address = '0xYOUR_DEPLOYED_VAULT', chain_id = 84532
where id = 'bae63093-98f6-44ba-80d0-c5453b64290f';  -- Sovereign T-Bill vault
```

Then close the loop: create an RWA campaign linked to that deal (creator → surface = RWA → pick the
deal) with an `actions.hold` rate, have the share-holders join as participants, and the weekly
`rwa-hold-snapshot` cron credits them. The **vRWA/USDC oracle-banded pool** (for R1 volume/LP on the
secondary market) is a separate, heavier deploy (oracle hook + CREATE2 mining) — the next milestone.

---

## 10. Open questions

- [ ] Hold-snapshot cadence — align to coupon epoch, or independent weekly snapshot averaged over
      the epoch (smoother, harder to game by end-of-epoch top-ups)?
- [ ] Reward denomination — incentive token vs. the deal's yield token vs. dual. Per-deal choice?
- [ ] Volume-incentive anti-manipulation — is band + token permissioning sufficient, or add a
      per-wallet volume cap and wash-trade heuristics (round-trip detection) before crediting?
- [ ] `vRWA` balance source for the hold snapshot — vault share balance on-chain vs. an indexed
      subgraph entity (cheaper reads, one more moving part)?

---

*This is the plan of record for the RWA incentive layer. Contracts and routes get documented in
[`.claude/rules/rewards.md`](../../.claude/rules/rewards.md) and
[`smart-contracts.md`](smart-contracts.md) as each track merges — we do not document unbuilt
mechanics ahead of the build.*
