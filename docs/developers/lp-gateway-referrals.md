# LP Gateway — Referral Program

> **Status: designed, testnet — NOT live.** The rates and mechanics below are the agreed program design.
> No real rewards are paid on testnet; the program goes live with the mainnet gateway + fee routing.
> Framing discipline is the same as the rest of the stack — see [`lp-gateway.md`](../../.claude/rules/lp-gateway.md)
> and [`framing-and-messaging.md`](../product/framing-and-messaging.md).

## 1. Overview (TL;DR)

Refer someone to the LP Gateway. When their liquidity harvests trading fees, Mintware takes its **10%
performance fee** — and **you earn 20% of *that fee*** (not their money). They get a discount too. Paid in
a stablecoin, at harvest, from our revenue — **never from a token, never from their principal or spendable
buffer.**

## 2. Key definitions

- **Referrer** — the wallet that shares a referral link and earns a share of the perf fee its referrals generate.
- **Referee** — a wallet that arrives via a referral link and deposits into a curated pool.
- **Performance fee** — Mintware's only fee: **10% of harvested trading fees** (`LP_GATEWAY_PERF_FEE_BPS = 1000`).
  It is skimmed at harvest *before* the remaining 90% credits depositors' spendable buffers. It never touches
  principal, staged capital, or the buffer.
- **Harvested fees** — trading fees the deployed LP leg accrues, realized by the zero-liquidity-delta collect.
  Distinct from **principal** (the USDG you deposited) and the **buffer** (your 90% share of harvested fees).
- **Attribution** — the permanent link between a referee wallet and its referrer, set the first time the
  referee arrives via a link and never reassigned (first-valid-referrer-wins).

## 3. How it works

1. **Share your link** — `mintware.finance/ref/<code>`. The code is deterministic from your wallet
   (`mw_` + address slice) and renders instantly; a nicer basename code can be claimed later.
2. **They arrive & deposit** — the `?ref=` param is captured to `sessionStorage` and applied on their first
   connect via `POST /api/referral/apply` (server-gated, 24h referrer time-gate). Attribution is set once.
3. **Their liquidity earns** — when a pool they're in harvests fees, Mintware takes its 10% perf fee.
4. **You both share it** — the referrer accrues **20% of that 10% perf fee**; the referee's perf fee is
   **discounted 10% → 9%** for their referred lifetime. Rewards are paid in stable at harvest.

## 4. Rewards & rates

| Party | Reward | Notes |
|---|---|---|
| **Referrer — Tier 1** | **20%** of Mintware's 10% perf fee on referred harvests (≈ **2%** of the referee's gross harvested fees) | Default on your first referral. |
| **Referrer — Tier 2** | **30%** of the perf fee | Unlocked once your referred base crosses **$250k referred TVL** *or* **$2.5k lifetime perf-fee generated**. Permanent once earned. |
| **Referee** | **Perf fee 10% → 9%** (a 10% discount on the fee) for their referred lifetime | The two-sided hook; beats Hyperliquid's 4% discount. |

**Worked example.** A referee's liquidity harvests **$1,000** of trading fees in a month.
- Mintware perf fee (discounted to 9% for a referred user): **$90** → the referee keeps **$910** in their buffer.
- Referrer (Tier 1, 20% of the perf fee): **$18**. (Tier 2: **$27**.)
- Mintware nets **$72** (Tier 1) — a positive margin it only earns *because* of the referral.

## 5. Eligibility

- **Anyone with a wallet** gets a referral code (deterministic, no gate to *share*).
- **Tier 2** is *earned* by hitting the referred-TVL or lifetime-perf-fee threshold above.
- No KYC on the referral itself (permissionless); real-value payout is gated on the mainnet launch + the
  broader compliance posture (external audit gates real value everywhere).

## 6. Payout & claim

- **Asset:** a stablecoin (USDG / the pool quote asset) — **not a token**.
- **Cadence:** accrues at each harvest; **claimable once accrued > $1** (dust threshold, Hyperliquid-style).
- **Where:** to the referrer's wallet, with an on-chain receipt. A claim feed shows accrued / pending / paid.
- **Testnet:** accrual and claim are **illustrative only** — no real value moves until the mainnet gateway
  and fee-routing are live.

## 7. Caps & limits

- **Lifetime attribution** on the referee wallet (first-valid-referrer-wins, irreversible).
- **Generous volume/duration ceiling** per referred wallet (e.g. accrual tapers past a large referred-TVL-years
  cap) so a single whale can't create unbounded liability — Hyperliquid-style.
- Rewards accrue on **perf fee only** — never on the referee's principal, staged capital, or buffer.

## 8. Anti-abuse

- **Self-referral excluded** — a wallet cannot refer itself; same-funding-source / obvious-Sybil links are
  excluded and gamed rewards may be clawed back.
- **First-valid-referrer-wins, irreversible** — later links to an already-attributed wallet are ignored.
- **24h referrer time-gate** — the referrer must be ≥24h old before an apply succeeds (blocks bot pre-seeding);
  the browser never writes `referral_records` directly, only via `POST /api/referral/apply`.
- **Sybil resistance is structural** — you only earn if referrals generate *real* fees, which needs real
  volume routing through the pool.

## 9. Testnet honesty

Robinhood testnet · unaudited · mock tokens · **no real value**. Referral rewards are **illustrative** and go
live with the mainnet gateway. Nothing here is an offer, a deposit bonus, or investment advice; a liquidity
position carries impermanent loss; the risk score ranks, it never certifies. External audit gates real value.

## 10. FAQ

- **Is this a deposit bonus?** No. You earn a share of *our fee*, only when referred liquidity earns real
  trading fees — nothing on the deposit itself.
- **Do I earn on their principal or buffer?** No — only on Mintware's 10% perf fee.
- **What if they withdraw?** Attribution stays; you simply stop accruing when they stop earning fees.
- **Can I refer myself?** No — self-referral is excluded.
- **When do I get paid?** At harvest, in stable, once accrued > $1 (testnet: illustrative).

## 11. Terms

The program is offered at Mintware's discretion and may be changed or ended with notice; rates, tiers, and
caps are governance-/operator-set. Excluded jurisdictions and standard anti-abuse terms apply. This document
is design/informational, not an offer — see [`/legal`](../../app/legal/page.tsx).

---

### Implementation pointers

- Codes/attribution/stats: `lib/rewards/referral/*`, `app/api/(rewards)/referral{,/apply}`, the
  `wallet_profiles` / `referral_records` / `referral_stats` tables (see [`referrals.md`](../../.claude/rules/referrals.md)).
- V1 surface: `components/web2/v1/V1Referrals.tsx` (`/v1/referrals`).
- **Not yet built (mainnet-gated):** the perf-fee → referrer split routing at harvest, the tier engine, the
  accrual ledger, and the claim flow. Today's page presents the model + shares the link + reads existing
  `referral_stats`; the reward economics turn on with the mainnet gateway.
