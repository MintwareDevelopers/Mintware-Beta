# Routable-Tier Execution Plan — verified against code (v1.0, 2026-08-30)

> **What this is.** The consolidated, code-verified map + phased build plan for the routable-liquidity
> direction. Supersedes the *build order* (not the vision) of `treasury-mesh-shared-liquidity-spec.md`,
> `treasury-mesh-build-spec.md`, and `treasury-mesh-v1-stress-tested-execution.md`. Every "built/partial/
> unbuilt" tag below was verified against source by a 4-front research pass (on-chain contracts, off-chain/
> app, external v4-routability, external economics/legal). **Design + testnet only; external audit +
> securities counsel gate real value. No "deposit/savings/guaranteed/fixed-APY" framing anywhere.**

---

## 1. The architecture in one principle

Everything rides **one spine** — the tranche vault (`MintwareTreasuryVault`) + `edge-auth` + the meta-router
+ the isolation factory — governed by **one invariant that keeps the accounting honest**:

> **Every risky use of capital (LP, RFQ inventory, small-token warehouse) is junior-backed and isolated.
> Spendable senior = idle-in-Aave + stable USDC buffer ONLY — never any LP or token mark.**

**This invariant is already the code's behavior** (verified): the payment Gateway gates spend on
`vault.idleBuffer()` (`MintwarePaymentGateway.sol:183`), and `idleBuffer()` = free senior buffer +
Aave-returnable-this-block, explicitly "without touching the LP" (`MintwareTreasuryVault.sol:638`). The
only gap to make it *non-negotiable* is forcing `minCoverageBps` on (default is 0/OFF today).

**The dumb-pool / clever-vault split is real in the code:** the vault's `poolKey` is set once in the
constructor from an externally-supplied `PoolKey` (`MintwareTreasuryVault.sol:277,296`); nothing in
`deployToLP` requires a particular hook. **You point the vault at a hookless or fee-only routable pool by
passing that `PoolKey` — no vault change.** Aggregators route to the pool; the vault is invisible to routing.

---

## 2. The three tiers

| Tier | Pool / flow | Senior supplier | LVR defense | Whitelist-free? |
|---|---|---|---|---|
| **A — blue-chip / pegged** | routable **hookless** (or `0xC0`) standing pool | treasury senior (thin junior) | structurally tiny (low σ) | ✅ hookless = every router |
| **B — mid / liquid** | routable standing pool **+ owned-flow JIT (off to the side)** + solver (Phase 2) | treasury, selective | dynamic fee + selective fill | ✅ UniswapX permissionless |
| **C — small community token** | **isolated per-token vault**; routable standing pool receives **external** swaps; embed = cream | Mintware/network senior (isolated, risk-priced, **never** spendable-backed) | **price** (`0xC0` dyn fee) + **absorb** (team ≥180% junior) + **isolate** | ✅ standing pool = route follows depth |

Same spine, three risk regimes. **Tier C is a separate isolated product** (own vault per token — the factory
already stamps these out); its capital never touches the treasury/spendable pool.

---

## 3. Routability — the no-whitelist verdict (external-research-confirmed)

- Uniswap's Hook Routing Allowlist policy, verbatim: *"all other hooks are automatically allowlisted"* —
  a form is only required for hooks that use a **delta flag**, have a **`0x91…` address**, or target a
  **major pair**. A `0xC0` dynamic-fee-only hook (no delta, no `hookData`, immutable, small-token pair)
  hits **none** → auto-allowlisted, no gatekeeper. ([developers.uniswap.org/hook-allowlist])
- **Hard rule (now black-letter):** any `*_RETURNS_DELTA` / custom-accounting bit falls off *both* the
  auto-allowlist *and* the "solvers can simulate it safely" bucket. So all cleverness stays in the vault;
  the routable hook is fee-only + immutable. `MWHookCoordinator` (`0xAC8`) carries `beforeSwapReturnDelta`
  (bit 3, `MWHookCoordinator.sol:173`) → it is the **unroutable** hook. The routable pool must not use it.
- **Hookless = gold standard; `0xC0` = one notch down** (still "a hooked pool"; the Uniswap Foundation
  pays up to $9M to subsidize routing hooked pools → structural under-routing). **Default: `0xC0` standard +
  a hookless mirror on high-value pairs.**
- **Small tokens get ~zero RFQ/intent flow** (makers can't hedge them; OFA is majors-dominated; intent
  solvers fall back to the AMM). **Route follows depth → to capture a small token's external flow you must
  BE its deepest pool.** So Tier C is a *standing pool*, full stop.
- **UniswapX non-exclusive filler = genuinely permissionless** (no whitelist/bond). CoW (bond+KYC) and
  1inch Fusion (KYC+stake+capped) are gated → **excluded**.

---

## 4. Tier-C small-token mechanics

**External swaps (the market):** be the token's **deepest routable pool** (hookless or `0xC0`). A pool fills
whatever hits it — you **cannot decline** a toxic external swap. So the LVR defense on external flow is
**price + absorb**, not dodge:
1. **Price** — `0xC0` directional/surge fee (`MWDynamicFee.lvrSurchargePips`) makes toxic swaps pay (recaptures
   20–80% of LVR on deep pairs, less on thin — [a16z/hackmd research]).
2. **Absorb** — residual LVR lands on the **team's ≥180% junior** (set `minCoverageBps = 18_000`; only the
   rock-solid junior *USDC buffer* counts toward coverage, the volatile junior *token* is excluded —
   `MintwareTreasuryVault.sol:663,178`). LVR on small-caps is **tens of %/yr** (σ²/8), so the thick junior
   is mandatory, not conservatism.
3. **Isolate** — one bad token can't touch a spender, another market, or the treasury.

**Owned flow (the cream):** the embed widget captures the community's own swaps → filled at tight spread,
~no LVR. Honest limit: own-site widget volume is a *single-digit %* slice; **depth + routability wins the
real flow**, the embed is convenience/branding.

**Tier-C team CARD SPEND math** (see memory `tierc_card_spend_math`): a team card-spends **only the realized
stable fees their market earned (their share), held in the idle buffer — never their token junior, never the
senior.** Already enforced by the `idleBuffer()` spend gate + coverage floor. Their token stays locked as
first-loss depth; they spend the *yield*, not the *position*. Spending against the token's value would be a
separate isolated over-collateralized liquidatable **loan** (out of the par path, later product). Honest
limit: bounded by actual fee generation, which is modest for a thin market.

---

## 5. The solver — Phase 2, liquid-only

Demoted by the research from "the external-flow prize" to "a liquid-pairs add-on." Small tokens get no RFQ
flow, so **the solver does not serve Tier C.** It captures liquid external *intent* flow (UniswapX
non-exclusive filler = permissionless), reusing the spine. **Built:** `edge-auth` is already a
decide→reserve→sign engine; `internalize.ts` already filters toxic-flow + size-over-cap with a
`fillOut ≥ externalBest` guarantee; `oracleSettler` + permit store are reusable settlement. **Unbuilt:** an
inventory-scoped RFQ endpoint + a new signed-quote EIP-712 + the on-chain fill/counterparty contract, and a
pricing/hedging brain (build or delegate — Arrakis DVMM/HOT is the productized precedent). Economics:
hedgeable pairs only, **0–10% net with −20–35% drawdowns.**

---

## 6. Treasury Mesh — Phase 3 senior supply

Not dropped — **relocated** to the capital-supply layer. The tiers define the structure; the mesh answers
*where the senior side comes from*. **Phases 0–2:** senior = Mintware's own treasury (one balance sheet).
**Phase 3:** senior supply generalizes to **cross-team** — idle, still-spendable team treasuries fund each
other's markets. Mechanical update from the original spec: cross-team capital funds the **standing routable
pools / solver inventory**, not JIT (JIT is owned-flow-only now). Gated on external audit of the cross-vault
credit window + securities counsel on the tranche + a book of teams. Legally, isolation is load-bearing here
(see §9).

---

## 7. Verified state — built / partial / unbuilt

**On-chain (the spine is ~85% there):**
- ✅ **Vault decoupled from pool/hook** — `poolKey` constructor-supplied (`MintwareTreasuryVault.sol:277,296`).
- ✅ **Spend gates on `idleBuffer()`** already (`MintwarePaymentGateway.sol:183`); `idleBuffer()` = idle+Aave, no LP (`:638`).
- ✅ **Coverage floor already enforces junior ≥ minCoverageBps×deployed** (`:663`); set 10_000 (par) / 18_000 (Tier-C 180%). Volatile junior token excluded from coverage (`:178`).
- ✅ **`deployToLP` guards** — idle-first, coverage floor, never-touch-junior, never-unwind-LP (`:788–803`).
- ✅ **Solvency-aware redemption** — `_redeemNav` par-while-covered + tail haircut (`:588`), full-or-revert.
- ✅ **Isolation factory** — `MintwareTreasuryVaultFactory.createVault` (CREATE2, onlyFactory, two-phase ownership, registry) stamps out fully-isolated per-token vault+hook+gateway+pool. **Testnet-deployed** (Base Sepolia factory `0x45e4…44F7`, example vault `0x6Ca2…C0D8`).
- ✅ **Reusable pure fee libraries** — `MWDynamicFee` (`lvrSurchargePips`, surge, vol) + `MWOracleGuard`, all `pure`/standalone.
- ⚠️ **`minCoverageBps` defaults 0 (OFF)**, owner-loosenable — must be forced on at provisioning. **[small]**
- ❌ **`0xC0` fee-only hook** — build by subtraction from `MWHookCoordinator` (drop am-AMM+JIT branches, keep the zero-delta fee-override + oracle; declare `beforeSwap+afterSwap` = `0xC0`). The fee path *already returns zero delta* (`:337`), so this is clean. **[medium]**
- ❌ **Factory routable-pool mode → must be a SIBLING factory.** `createVault` hardcodes the JIT hook + `DYNAMIC_FEE_FLAG` hooked pool (`:129–149`); a routable mode assembles a hookless/`0xC0` pool and skips `setJitHook`. **But `MintwareTreasuryVaultFactory` runtime = 25,603 bytes — already OVER EIP-170** (deployed on testnet under a different optimizer profile), so there's no room to add a second `createVault` inline. Build it as a **sibling factory** (reusing the existing vault/registry/deployer machinery unchanged — the vault constructor already takes an arbitrary `PoolKey`). **[medium]**
- ⚠️ **EIP-170:** `MintwareDeFiPairVault` = **23,484 / 24,576** (~1 KB free) and **`MintwareTreasuryVaultFactory` = 25,603 (OVER limit in the `--sizes` profile)** — do NOT extend either. New logic goes in the `0xC0` hook (9 KB, huge headroom) or a sibling factory. `MintwareTreasuryVault` has ~4.4 KB headroom.

**Off-chain / app:**
- ✅ **edge-auth** = decide→reserve→sign, multi-leg (`portfolio.rs`), **already gates spendable on the idle buffer** (`nav.rs`); Railway-hosted, fail-closed.
- ✅ **Frontend fully cut over to pair-vault ABI** (dual-token deposit, two-phase redeem) — deploy-gated on a live vault address (none in `deployments.json`).
- ✅ **Meta-router** owned-flow best-execution (`resolveSwapRoute`) built; quoter reader real (`viemQuoteSimulate`); `internalize.ts` toxic/size brain built.
- ✅ **x402 settle plumbing** (`oracleSettler`, permit store, `Settler` port) reusable for solver fills.
- ⚠️ **Router turn-on gotchas:** no `MWRouter`/`V4Quoter` deployed; `router_pools` registry empty; **`mwInternal.ts` client provider imported by nobody** (must be wired into the swap `useQuote` flow).
- ❌ **ProjectSDK embed** — pure concept, zero code. Smallest path: `/embed/swap/[token]` iframe reusing `/api/swap/quote` + `/api/swap/best-route` + route-scoped CORS/frame-ancestors. **[small]**
- ❌ **edge-auth → allocator + RFQ** — split settleable into buckets (template = `PortfolioGuard.min_liquidity_reserve_usdc`), track deployed-vs-idle, RFQ endpoint, RFQ signed-quote. **[medium]**
- ⚠️ **Branch drift:** the treasury spend ledger (#436 — `lib/treasury/`, migration, `/activity` page) is **NOT on `feat/app-tier-slice1-vault-actions`.** Build off a branch that has it.

**Deploy truth (`config/deployments.json`):** only mainnet contract = `AIAttribution` v3 (fundless). Treasury
factory stack + example vault are real on Base Sepolia. No pair vault, router, or quoter address recorded.
`.claude/rules/*` overstate liveness (ULV/StagedRouter/Arc addresses not in deploy-truth) — reconcile.

---

## 8. Honest numbers (bake into all copy)

- **Senior ≈ 4–5%** (Aave USDC) — the only durable anchor; >6% sustained takes rate/peg/emission risk.
- **Blended active-LP/MM ≈ 0–10% net** (NOT the 8–15% gross headlines — ~50–60% of quoted ALM APY is
  emissions), with recurring **−20% to −35% drawdowns** + event tails (JELLY-type).
- **Junior = no bankable APY, only a fat −100% tail** — model as 2–3× leveraged senior carry with an
  explicit blow-up probability.
- **LVR = σ²/8:** stables sub-bps; ETH/USDC ~4.5–12.5%/yr; **small-caps tens of %/yr.** ~49.5% of v3 LPs
  historically lost vs holding (74% in volatile pools).
- **Idle-yield allocator:** only **clean ERC-4626 venues** — Morpho Vaults, Yearn v3, Pendle PT (~4–10%).
  **AVOID** HLP (not EVM, 4-day lock, JELLY tail), GMX (async, counterparty), Drift (Solana, first-loss),
  **Elixir (collapsed −98%, Nov 2025).** Idle yield backs the risk/junior bucket, never the spendable senior.

---

## 9. Legal posture

Combine three precedents (research-sourced; not legal advice):
- **Pendle PT/YT** = the clean senior/junior split, **non-custodial, no *promised* return** (market-priced,
  not protocol-promised) — the posture that avoids BarnBridge's *Reves* note trap.
- **CLO OC test** = the ≥180% junior mechanism. A real investment-grade CLO protects its *AAA* with only
  ~132% OC + ~8–10% first-loss; **≥180% is materially thicker than AAA** — a strong, honest framing.
- **SEC v BarnBridge** = the do-not-do list: (1) no single **commingled pool** (that triggered the '40 Act
  finding) → **per-token isolation is legally load-bearing**; (2) no **"guaranteed/fixed/deposit/savings"**
  language; (3) **don't raise the protocol's own capital** / don't pay the team from the offering (fee-for-
  service ≠ raising investment capital); (4) real decentralization in substance.

---

## 10. Phased build plan

**Cross-cutting gate:** external smart-contract audit + securities counsel before any real value. Everything
below is testnet-first, flag/env-gated off in prod.

**Phase 0 — Routable standing pool + senior-safe invariant (mostly built; deploy-wiring + params)**
1. Reconcile onto a branch that has the spend ledger (#436). `[small]`
2. Force `minCoverageBps = 10_000` at treasury provisioning (consider a constructor-immutable floor). `[small]`
3. Tier-A deploy path: `MintwareTreasuryVault` against a **hookless** pool, no JIT hook; confirm spot-fallback valuation acceptable for pegged/blue-chip. `[small]`
4. Router turn-on for owned flow: deploy `MWRouter` + `V4Quoter`, set `MW_ROUTER_ADDRESS_*`/`MW_V4_QUOTER_*`, seed `router_pools`, **wire `mwInternal.ts` into the swap `useQuote` flow**, flip `NEXT_PUBLIC_MW_ROUTER_ENABLED`. `[medium]`
5. Deploy-truth hygiene (fill null addresses, reconcile `.claude/rules/*`). `[small]`
   → **Revenue live:** router fee skim + LP fees on curated low-vol pairs.

**Phase 1 — The `0xC0` fee-only routable hook (one small new contract)**
6. Build `0xC0` by subtraction from `MWHookCoordinator`; Forge invariants (fee determinism, oracle non-manipulability, routability = static-sim shows no delta). `[medium]`
7. Wire `HookMiner.find(deployer, 0xC0, …)` into the deploy script. `[small]`
8. Add the routable-pool deploy mode as a **sibling factory** (hookless OR `0xC0`, no `setJitHook`) — `MintwareTreasuryVaultFactory` is already over EIP-170, so this is a new small factory reusing the existing vault/registry/deployers, not an inline change. `[medium]`
9. A/B `0xC0` vs hookless per pool; keep the hook only where recapture > routing cost.

**Phase 2 — Tier-C isolated small-token markets + embed**
10. Factory routable-pool mode + `minCoverageBps = 18_000` per-token isolated vault; curation gate (qualifying teams, thick junior, price reference). `[medium]`
11. Tier-C card-spend = realized stable fees only (already enforced by idleBuffer gate + coverage — verify + document). `[small]`
12. Minimal embed widget `/embed/swap/[token]` reusing existing quote/best-route + route-scoped CORS/frame-ancestors. `[small]`

**Phase 2b — Solver (liquid Tier-A/B only, optional)**
13. edge-auth: split settleable into buckets (`rfq_reserved_usdc`), track deployed-vs-idle, RFQ decision endpoint, RFQ signed-quote EIP-712, N-leg env wiring. `[medium]`
14. On-chain fill/counterparty contract behind `internalize.ts`. `[large]`
15. UniswapX non-exclusive filler integration OR delegate the MM brain (Arrakis-Pro model). `[medium]`

**Phase 3 — Treasury Mesh (cross-team senior supply)**
16. `MintwareLiquidityAllocator` + cross-team senior supply into the routable pools/solver inventory + the Rust Allocation Service. Gated on audit + scale + counsel. `[large]`

---

## 11. Open decisions to lock before building

1. **Routable-pool default:** `0xC0`-standard + hookless mirror (recommended — LVR recapture + auto-allowlist,
   with hookless for last-mile reach) vs hookless-only (max reach, no recapture).
2. **Tier-B topology:** run *two* pools (routable standing + owned-flow JIT) vs accept one non-routable-clean
   JIT pool. (Design, not code.)
3. **Idle-yield allocator:** which clean 4626 venues to wire first (Morpho / Yearn / Pendle), risk-bucket only.
4. **Solver:** build it at all (liquid-only, doesn't help small-caps) — and if so, build the MM brain vs delegate.
5. **Start point:** Phase 0 is the revenue-bearing, mostly-built entry. Confirm we begin there.

---

## 12. Honest scope

**This plan CAN:** stand up routable, LVR-defended, senior-safe pools reusing ~85% existing on-chain code;
earn real fees (router skim + LP fees) from Phase 0; isolate per-token Tier-C markets on the existing factory;
keep spendable senior backed by idle+stable only (already the code's behavior); and keep every money surface
flag/env-gated off until audited.

**This plan does NOT (yet):** route custom-JIT-hook pools externally (deferred by design); run the solver fill
(Phase 2b, contract unbuilt); do cross-team shared liquidity (Phase 3, audit+counsel-gated); promise any yield
(numbers in §8 are ranges with drawdowns, never fixed); or present anything as live with real value — testnet
+ unaudited until external audit + securities-counsel sign-off.
