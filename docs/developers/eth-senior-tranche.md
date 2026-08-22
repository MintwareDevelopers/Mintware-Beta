# The ETH Senior Tranche — a spendable dollar that earns DeFi yield

> **Status (2026-08-21):** the audit-hardened stack is **live on Base Sepolia (testnet + mock + unaudited)**.
> Never present as production. External audit is the gate before real value. The "always $1" property is
> a **design + testnet-proven** invariant, **not** a guarantee, a deposit, or an offer — see the honesty
> and legal notes at the bottom.

## The one-liner

A community deposits **USDC**. It stays **spendable as USDC at par** (cards, x402, settlement) — like cash —
**while it earns real DeFi yield**. The trick: the yield and the volatility are *split into two tranches*, and
the community holds the **senior** side, which is deliberately **price-free**.

- **SENIOR = community USDC.** Par (1 share ≈ $1), card-spendable, and its value **never reads a pool price**.
- **JUNIOR = the team's token/ETH.** First-loss: it absorbs the impermanent loss and price moves the LP takes.

So the community gets *ETH-style DeFi upside* (LP fees + JIT + MEV recapture + Aave lending) on a balance that
still behaves like a dollar, and the team's junior tranche eats the volatility that would otherwise mark that
dollar down. That is the "ETH senior magic": **yield of a DeFi LP, spendability of cash.**

## Where the yield actually comes from (one dollar, stacked)

The same senior dollar is put to work on several layers at once (the ULV thesis):

1. **Rehypothecation floor.** Idle senior USDC sits in Aave (via an `IYieldAdapter`), earning lending
   interest continuously. Idle-first: `idleBufferTargetBps` (default 80%) keeps most of the senior liquid +
   safe, so card spends settle instantly and the IL-bearing slice stays inside the junior's cushion.
2. **JIT-provisioned LP fees.** A bounded slice is JIT-deployed as two-sided V4 liquidity with the team
   token on swaps, captures the fee, and re-idles — size-gated, per-block-capped, PnL-breaker'd (see
   [`ulv-swap-flow.md`](ulv-swap-flow.md)). Naive always-on JIT is *off*; it fires only where it pays.
3. **MEV / LVR recapture.** The V4 hook's dynamic-fee + Diamond-LVR levers route the value arbitrageurs
   would extract back to the pool (see [`smart-contracts.md`](../../.claude/rules/smart-contracts.md)).

All of it accrues to the senior in **USDC terms at par** — the junior token is what moves with the market.

## Why "always $1" is honest — the solvency model (the hardened core)

The senior claim is **price-free by construction** and **solvency-aware on redemption** — this is the part the
2026-08 audit hardened, and it's what makes the promise defensible rather than marketing:

- **Price-free NAV.** `totalSeniorAssets = Aave idle + free senior buffer + deployedFromSenior (at PAR) +
  jitBorrowed (at PAR)`. No pool price appears. A flash pump can't inflate it; the LP's IL/mark lands entirely
  on the junior (seniority: `recover` spends the junior token to make the senior whole first).
- **Coverage invariant** (fuzzed 256×128k): `deployedFromSenior ≤ recoverableUSDC() + juniorUsdcBuffer`, where
  `recoverableUSDC()` is the conservative `min(spot, oracle)` mark. Risk-increasing ops halt below the
  `minCoverageBps` floor.
- **Solvency-aware redemption (AUDIT H1).** Redemptions price against `min(par, realizable)`:
  - **While covered** (junior + recoverable backs the deployed slice) → **redeem at par, 1:1.** This is the
    normal state; the idle-first buffer means it's the overwhelming case.
  - **In the tail** (a crash exhausts the junior first-loss) → the shortfall is shared **pro-rata across all
    senior holders** — *not* paid at par to whoever redeems first while later holders are stuck. No
    first-redeemer run.

  In plain terms: the community's dollar stays a dollar as long as the team's first-loss covers it, and if a
  black-swan blows through that cushion, everyone takes the same fair, transparent haircut — nobody sprints
  for the exit at others' expense.

## The stack (Forge — `contracts-v4/src/payments/`)

| Contract | Role |
|---|---|
| `MintwareTreasuryVault` | senior/junior tranche vault; holds its V4 position via delegatecall; price-free senior NAV + solvency-aware redemption |
| `MintwareTreasuryJitHook` | borrow-idle → JIT → settle atomically; junior backstops; balance-verified return (AUDIT M3) |
| `MintwarePaymentGateway` | card rail — EIP-712 permit → `burnForPayment` (burn shares → pay merchant); per-block burn cap (AUDIT M1) |
| `MintwareEthSettlement` | oracle-bounded ETH→USDC batch settlement to a **pinned** rail (AUDIT H4) |
| off-chain `services/edge-auth` + `services/relayer` | sub-150ms authorize off live NAV · submit settle |

**Live on Base Sepolia (testnet + mock + unaudited, 2026-08-21):** treasury vault
`0xb84776B8CB27C924A3B4e704C0FF826CB4A98A1c` · JIT hook `0xE21D937855a128c79D95305bFE0604Ae660160C8` ·
gateway `0x16609c074C8A1b1CaB826248EA98877D8f5FA96F` · settlement `0x6d0a1520e47bAE8F5304859a6a0193dDa567A9E0`.
Deploy: `contracts-v4/script/DeployEthSeniorStackDemo.s.sol`.

## The honest boundaries (do not drop these)

- **Testnet + mock + unaudited.** Nothing is live with real value. External audit is the gate.
- **"Always $1" is a design/solvency property, not a guarantee, and not a deposit.** The senior interest is
  a claim on an autonomous vault, redeemable at par *while covered* and pro-rata *in the tail* — it is **not**
  a promise by Mintware, not FDIC-anything, not a fixed return.
- **This shape is the #1 legal item.** A par-value, spendable, yield-bearing senior balance is exactly what
  securities/deposit/stablecoin-yield analysis scrutinises — see [`/legal`](../../app/legal/page.tsx) (the
  internal structural-posture memo). **Marketing copy must avoid "deposit / savings / guaranteed / fixed APY"
  framing** and lean on "cash that stays productive" instead.

## See also
- [`../../.claude/rules/payments-ypn.md`](../../.claude/rules/payments-ypn.md) — YPN one-home.
- [`ulv-swap-flow.md`](ulv-swap-flow.md) — what fires on a swap (JIT is Aave-funded + default-off).
- [`self-assessment-security-2026-08-21.md`](self-assessment-security-2026-08-21.md) — the audit + remediation.
- [`../product/framing-and-messaging.md`](../product/framing-and-messaging.md) — "Never idle. Never locked. Always yours."
