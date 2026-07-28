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
> sticky, KYC'd, relationship-sourced capital, let you reward it by how good it is rather than how
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
pay for. On the RWA surface the **oracle band constrains price** and **KYC constrains who trades**,
so incentivised volume is far closer to genuine price discovery than mercenary noise. It is not
zero-manipulation, but the band + identity gate change its character entirely.

---

## 3. Core architectural decision — the engine is surface-agnostic

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

Three net-new pieces. Everything else is config.

### 4.1 KYC gate on campaign participation

RWA campaigns must gate participation and credit on KYC tier — mirroring exactly how Points
Campaigns already gate on `min_score` today.

- Add `min_kyc_tier` to the campaign config (`NONE | BASIC | ACCREDITED`), reusing the
  `kyc_tier_required` enum already on `vault_deals`.
- Check KYC-verified status at **credit time** (in the credit hook) *and* at **claim time**
  (in `/api/claim`), so an un-KYC'd wallet neither accrues nor claims on a gated RWA campaign.
- KYC status source: reuse the redemption KYC path (`vault_redemptions.kyc_verified`) → promote to
  a wallet-level `kyc_status` lookup.

### 4.2 Hold-snapshot crediting (the one net-new engine part)

DeFi credits per swap **tx**. RWA subscription/hold campaigns credit per **epoch holding**:

```
points = vRWA_held × duration_held × attribution_multiplier
```

- New action types `hold` (per-epoch snapshot) and `subscribe` (primary deposit event).
- New **snapshot cron** that reads `vRWA` balances at epoch close, computes holding-weighted points,
  and writes into the existing `activity` / `epoch_state` tables. This is the only new *mechanic* —
  it feeds the existing distribution rail; it does not replace it.
- Snapshot source: vault share balances (on-chain read) + duration since last snapshot.

### 4.3 Duration-matched lock bonus

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
| — | `hold` (per-epoch snapshot) | Yes — snapshot cron (§4.2) |
| `referral_trade` | `referral_trade` (buyer acquisition) | No |
| `referral_bridge` | `referral_subscribe` (placement) | Rename only |
| LP provision | LP provision (attribution-weighted fee share) | No — `FeeVault` exists |

---

## 6. Data model deltas

Additive only. No breaking changes to the DeFi campaign path.

```sql
-- campaigns: surface + RWA gating
alter table campaigns add column if not exists surface text not null default 'defi';   -- 'defi' | 'rwa'
alter table campaigns add column if not exists min_kyc_tier text;                        -- NONE|BASIC|ACCREDITED
alter table campaigns add column if not exists linked_deal_id uuid references vault_deals(id);
alter table campaigns add column if not exists duration_match_days integer;              -- from deal settle_days

-- new RWA action types are values in activity.action_type; no schema change needed
--   'subscribe' | 'hold' | 'referral_subscribe'
```

Holding snapshots reuse `activity` (`action_type = 'hold'`) — no new custody table. Keep the hot
path thin; do the holding-weighted allocation math in the snapshot cron, off-chain, and keep the
cron response JSON-safe (`BigInt` from on-chain reads will 500 under `NextResponse.json` otherwise —
use `ctx.json`).

---

## 7. Compliance-aware reward denomination

This is the part with a real regulatory surface DeFi never had. **Not a blocker — a structuring
requirement.** The engine must let rewards be **denominated and gated per surface and per
recipient class**, because the regulatory weight differs sharply:

| Reward flavour | Recipient | Regulatory character | Engine handling |
|---|---|---|---|
| Hold / subscribe bonus | Investor | Lightest — rewarding one's own holding | Standard credit |
| Coupon / yield distribution | Investor | Yield on the instrument | Denominate in yield token |
| Volume incentive | Trader | Paying for volume *in a security* — has optics | Band + KYC-gated; flag per deal |
| Referral / placement | Distributor | Heaviest — solicitation / placement-agent territory, varies by jurisdiction | Gate; may require distributor status |

**Locked principle:** rewards to the *investor* for holding are categorically different from
rewards to a *distributor* for introductions. The engine keeps them as distinct reward classes so
each can be denominated, gated, disclosed, and (where required) switched off per deal/jurisdiction.
**Structure with counsel** before enabling the distributor/referral class on any regulated RWA.

---

## 8. Build tracks & sequencing

| Track | Work | New mechanics | Depends on |
|---|---|---|---|
| **R0 — Surface flag** | `campaigns.surface`, point campaigns at `vRWA/USDC` pool | None (config) | migration |
| **R1 — Volume + referral on RWA** | Volume/referral campaigns on the RWA pool | None | R0, live vRWA pool |
| **R2 — LP incentive on RWA** | Attribution-weighted LP rewards on RWA pool | None (`FeeVault` exists) | R0 |
| **R3 — KYC gate** | `min_kyc_tier` credit + claim gating | §4.1 | wallet KYC lookup |
| **R4 — Hold-snapshot credit** | `subscribe`/`hold` actions + snapshot cron | §4.2 | R3 |
| **R5 — Duration-match lock** | Lock-to-maturity bonus | §4.3 | R4, `LockLib` |
| **R6 — Reward-class denomination** | Per-class gating/denomination + disclosure | §7 | counsel |

R0–R2 are near-free (config over the existing engine) and can ship as soon as a real `vRWA/USDC`
pool is live. R3–R5 are the genuine build. R6 gates the referral/distributor class behind legal
structuring.

---

## 9. Open questions

- [ ] Wallet-level KYC lookup: promote `vault_redemptions.kyc_verified` to a `wallet_kyc` table, or
      resolve per-campaign against the issuer's KYC provider?
- [ ] Hold-snapshot cadence — align to coupon epoch, or independent weekly snapshot averaged over
      the epoch (smoother, harder to game by end-of-epoch top-ups)?
- [ ] Reward denomination — incentive token vs. the deal's yield token vs. dual. Per-deal choice?
- [ ] Does the referral/placement class require the distributor to hold a status attestation
      on-chain before rewards accrue (compliance gate as a soulbound credential)?
- [ ] Volume-incentive anti-manipulation — is band + KYC sufficient, or add a per-wallet volume cap
      and wash-trade heuristics (round-trip detection) before crediting?

---

*This is the plan of record for the RWA incentive layer. Contracts and routes get documented in
[`.claude/rules/rewards.md`](../../.claude/rules/rewards.md) and
[`smart-contracts.md`](smart-contracts.md) as each track merges — we do not document unbuilt
mechanics ahead of the build.*
