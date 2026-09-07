# Meteora → Mintware V1: Onboarding Modal, IA & Swap — Buildable Spec

**Date:** 2026-09-06 · **Scope:** V1 dark app (`/v1/*`, `components/web2/v1/*`).
**Method note:** Meteora findings gathered via public docs + web search only (their app is a
client-rendered SPA; WebFetch returns the shell). Sources at the bottom. `KEEP / ADAPT / OMIT`
columns say what we take for our own V1.

---

## 0. TL;DR

- **Disclaimer modal:** Meteora ships a first-visit "Welcome" modal → single **Enter** CTA + a
  persist checkbox, gating the app on ToS acceptance. **We already have the equivalent**
  (`components/web2/v1/V1DisclaimerGate.tsx`) and its honest testnet copy is *stronger* than
  Meteora's generic legalese. Spec below = validate + two small deltas (ESC/focus trap, wording nit).
- **IA:** Meteora nav = Discover · Portfolio · Create · Referral(NEW) · Campaigns · search · settings ·
  alerts · Connect. Our V1 keeps the **two that map to our product** (Discover · Portfolio) and
  **adds Swap**; the rest are OMIT (no launchpad/referral/campaigns in V1).
- **Swap:** Meteora doesn't build its own swap — it **embeds Jupiter Terminal** (aggregator). Our
  parallel: build a native dark **Swap page** on our existing LI.FI proxy (`POST /api/swap/quote`,
  server-injected fee) + optional MW meta-router, framed as **"best route"** the same way.

---

## 1. The "Welcome to Meteora" disclaimer / terms modal

### 1a. What Meteora does (observed)

| Element | Meteora behaviour |
|---|---|
| Trigger | First visit to `app.meteora.ag` (pre-wallet, blocks the app behind an overlay). |
| Heading | "Welcome to Meteora" (brand-led). |
| Body tone | Short risk framing + a pointer to full ToS; ToS itself is heavy ALL-CAPS legalese ("AS IS", "AT YOUR SOLE RISK", "NO … GUARANTEE … FUTURE PERFORMANCE", impermanent-loss, "not financial advisory"). |
| Acceptance copy | *"By clicking Enter, you are confirming that you understand and accept the terms of service."* (Enter click == "I ACCEPT"). |
| Checkbox | "Do not show again" style persist toggle. |
| CTA | A **single** primary button: **Enter**. No decline/secondary. |
| Persistence | Dismissal stored client-side (localStorage) so it doesn't reappear on return visits. |

Design read: **one decision, one button, low friction** — it's an acknowledgement gate, not a form.

### 1b. Mapping to our V1 (mostly already built)

Our gate (`V1DisclaimerGate.tsx`, rendered inside `V1Shell`) already matches the pattern:

| Meteora element | Our V1 | Verdict |
|---|---|---|
| First-visit overlay, blocks app | `open` set when no ack in storage; `role="dialog" aria-modal` fixed overlay | **KEEP** |
| "Welcome to Meteora" heading | "Welcome — this is a testnet preview" | **KEEP** (ours is more honest) |
| Generic risk blurb | Explicit: *"unaudited, with no real value … not a deposit, a savings product, or a guaranteed or fixed return … subject to impermanent loss"* | **KEEP** — this is our required legal language |
| "…accept the terms of service" link | "…accept the **terms**" → links **`/legal`** | **KEEP** |
| "Do not show again" checkbox | present; unchecked default | **KEEP** |
| Single **Enter** CTA | present, gradient pill | **KEEP** |
| Persist on dismiss | `sessionStorage` always + `localStorage` only if "Do not show again" checked; all wrapped in try/catch (private-window safe) | **KEEP** (better than Meteora: re-nudges each session unless user opts out) |

**Required copy (locked — do not soften):** must state **testnet · unaudited · not a deposit /
not a savings product · not a guaranteed or fixed return · subject to impermanent loss**, and link
`/legal`. Current copy satisfies all five. (Mirrors `/legal` bright-lines #2–#6 and `V1Discover`'s
footer disclaimer — keep them worded consistently.)

### 1c. Deltas to ship (small)

1. **Keyboard/focus (a11y):** trap focus inside the dialog while open; Enter key = confirm;
   **no ESC-to-dismiss** (dismissal must be an explicit acknowledgement, not an accidental keypress).
2. **Wording nit:** consider "By clicking **Enter** you confirm you have read and accept the
   [terms]" to match Meteora's "understand and accept" precision (currently "understand and accept").
   Optional — current is fine.
3. **Scope check:** gate lives in `V1Shell`, so it covers `/v1`, `/v1/portfolio`, and (new) `/v1/swap`
   automatically. When adding Swap, **do not** add a second gate — one per app shell.

> OMIT from Meteora: geo/restricted-territory blocking and age-affirmation clicks. Our `/legal`
> discloses restricted-territory posture; V1 is testnet with no real value, so a hard geo-gate is
> unwarranted for the preview. Revisit before mainnet.

---

## 2. App information architecture

### 2a. Meteora nav (observed)

| Item | Purpose | Our V1 verdict |
|---|---|---|
| **Discover** | Browse/search pools to LP into | **KEEP** — our `/v1` curated-pool table |
| **Portfolio** | Your positions, yields, LP performance | **KEEP** — our `/v1/portfolio` |
| **Swap** (via Jupiter Terminal launcher) | Swap to the tokens you need to LP | **ADAPT → add native `/v1/swap`** |
| **Create / Invent** | No-code pool + token launch | **OMIT** — no launchpad in V1 |
| **Referral (NEW)** | MET referral staking, fee share | **OMIT** — no token/referral-staking surface in V1 |
| **Campaigns** | Promotions/quests | **OMIT** — campaigns shelved (2026-08-12) |
| **Search** (global pool search) | Find a pool fast | **ADAPT (later)** — table filter on Discover is enough for V1; global search is post-V1 |
| **Settings** (slippage/priority/RPC) | Global tx prefs | **ADAPT** — fold slippage into the Swap card (see §3); no global settings menu in V1 |
| **Alerts / notifications** | Position + tx alerts | **OMIT** — no notification system in V1 |
| **Connect Wallet** (top-right primary) | Wallet connect | **KEEP** — our top-right gradient pill (Privy) |

### 2b. Our V1 nav (target)

`components/web2/v1/V1Shell.tsx` `NAV` becomes:

```
Discover   → /v1
Portfolio  → /v1/portfolio
Swap       → /v1/swap        ← NEW
```

- Everything else in the header stays: logo (→ `/v1`), **Robinhood Testnet** chip, Connect Wallet
  (→ `useMintwarePrivy().login({ loginMethods:['wallet','email'], walletChainType:'ethereum-only' })`),
  connected state shows `shortAddr` pill that disconnects on click.
- **No sub-nav.** Flat, 3-item nav. (Meteora's sub-nav lives under Create/Discover product families
  we don't have.)

### 2c. Connect-wallet flow & not-connected states

| Surface | Meteora pattern | Our V1 |
|---|---|---|
| Global | Connect is top-right; most browse surfaces are **view-public** (you can Discover without connecting) | **KEEP** — Discover + Swap render unconnected; connect prompted at action time |
| Portfolio empty (disconnected) | "Connect wallet to view positions" | **KEEP** — `V1Portfolio` already shows a Connect Wallet CTA + "Pick a pool" pointer to Discover |
| Swap disconnected | Widget renders; button says "Connect Wallet" until connected | **ADAPT** — see button states §3d (connect-on-action) |

**Empty/not-connected copy principle (ours):** never dead-end. Discover empty → "screening the
hottest pools, first curated ones appear here" (already shipped). Portfolio empty → route to Discover.
Swap disconnected → still quote, connect only to execute.

---

## 3. The Swap surface

### 3a. Meteora's approach (observed)

Meteora **does not build a first-party swap** — it embeds **Jupiter Terminal** (open-source lite
Jupiter), launched from a Jupiter icon (bottom-left). Jupiter is *the* Solana aggregator, so the
framing is inherently **"best route across all venues."** Swap-to-LP is the job-to-be-done: get the
tokens a pool needs. Fields users see (Jupiter Terminal): from/to token selectors, amount input,
quoted output, **price impact** (% diff input vs output value), slippage setting, route, swap button.

**Our parallel:** we already own the aggregator layer — LI.FI proxy (`POST /api/swap/quote`,
server-injects fee + referrer) and the optional MW meta-router (`lib/web2/router/*`, pools-first then
LI.FI, flag `NEXT_PUBLIC_MW_ROUTER_ENABLED`). So we build a **native dark Swap card** with the same
"best route" framing rather than embedding a third party.

### 3b. Element-by-element mapping

| Swap element | Meteora / Jupiter | Our V1 Swap | Verdict |
|---|---|---|---|
| **From token selector** | Token search modal, balances | Token select (testnet set: USDG + Robinhood-Chain pool tokens; extend to LI.FI chains if enabled) | **ADAPT** |
| **To token selector** | Token search modal | Same picker | **ADAPT** |
| **Amount input** | Numeric, MAX button, USD value under | Numeric + **MAX** (from balance) + USD estimate | **KEEP** |
| **Flip from/to** | Swap-direction arrow between fields | Center flip button | **KEEP** |
| **Quote / output** | Live quoted receive amount | From `/api/swap/quote` (debounced on input) | **KEEP** |
| **Route display** | Jupiter route (venues hopped) | "Best route" line: **MW pool** vs **LI.FI** winner when MW router on; else "via LI.FI" | **ADAPT** — our best-route framing |
| **Price impact** | % shown, warns when high | Show %; **warn ≥1%**, **red confirm ≥3%** | **KEEP** |
| **Min received** | Amount after slippage | `out × (1 − slippage)`, shown in review row | **KEEP** |
| **Slippage settings** | In global/settings gear | **Inline** in the card (gear opens a small popover: 0.1 / 0.5 / 1.0 / custom %) | **ADAPT** — inline, not global |
| **Fee disclosure** | Jupiter/venue fees | Our fee is **server-injected** in the proxy; surface it read-only in the review row ("Mintware fee: X bps") for honesty | **ADAPT** |
| **Swap button** | Multi-state (see 3d) | Multi-state | **KEEP** |
| **Best-route / aggregator framing** | "Jupiter — best rates" | "Best price across routes" (MW pools-first → LI.FI) | **ADAPT** |
| Limit orders / DCA | Meteora/Jup extras | — | **OMIT** — spot swap only in V1 |
| Global tx settings menu | priority fee, RPC | — | **OMIT** — inline slippage only |

### 3c. Layout (dark V1 skin)

Reuse `V1Shell` chrome + tokens from `V1Discover`/`V1DisclaimerGate`
(bg `#0B0B12`, card `#12121C`, hairline `rgba(255,255,255,0.07)`, periwinkle `#8A82F4`,
coral `#F0A183`, muted `#9B9BAD`, faint `#63636F`, `font-atx-display` / `font-mono`).

```
/v1/swap  (wrapped in V1Shell — inherits nav + disclaimer gate)
┌──────────────────────────────────────────────┐
│  Kicker: "Swap · Robinhood Chain"             │
│  H1: "Get the tokens your pool needs."        │
│  Sub: one line — best route, testnet          │
├──────────────────────────────────────────────┤
│  ┌── Swap card (max-w ~460px, centered) ──┐   │
│  │  [From]  amount        balance · MAX   │   │
│  │          token ▾            ~$USD      │   │
│  │            ↕ (flip)                     │   │
│  │  [To]    amount (quoted)   balance     │   │
│  │          token ▾            ~$USD      │   │
│  │  ── review (collapsible) ──            │   │
│  │  Rate · Route(best) · Price impact ·  │   │
│  │  Min received · Mintware fee · Slippage⚙│  │
│  │  [  Primary button (state) ]           │   │
│  └────────────────────────────────────────┘   │
│  Footer disclaimer (testnet/IL) → /legal      │
└──────────────────────────────────────────────┘
```

- **Card-centric, nothing above the widget** (mirror the existing `/app/swap` intent, restyled dark).
- Slippage is a **gear popover** on the review row (not a separate page).
- Footer disclaimer = same one-liner as `V1Discover` (testnet · not a deposit/guaranteed · IL · Legal →).

### 3d. Swap button states

| State | Condition | Label | Style |
|---|---|---|---|
| Connect | not connected | **Connect Wallet** | gradient pill, triggers Privy login |
| Enter amount | connected, no/zero input | "Enter an amount" | disabled |
| Quoting | request in flight | "Finding best route…" | disabled + spinner |
| Insufficient | amount > balance | "Insufficient {TOKEN}" | disabled |
| High impact | price impact ≥3% | "Swap anyway (high impact)" | coral/red, requires the shown impact |
| Ready | valid quote | "Swap {A} → {B}" | primary gradient |
| Submitting | tx pending | "Confirming…" | disabled + spinner |
| Error | quote/tx failed | "Try again" + inline reason | neutral |

Connect-on-action: unconnected users still get live quotes; connecting is required only to execute.

### 3e. Data wiring

- **Quote:** `POST /api/swap/quote` (server hides LI.FI key, injects fee/referrer, records the
  server-computed USD to `swap_quotes`, returns `mw_quote_id`). Debounce input ~350ms.
- **Best route:** if `NEXT_PUBLIC_MW_ROUTER_ENABLED === 'true'`, call `/api/swap/best-route`
  (`lib/web2/router/*`) — price an MW V4 pool, use it when it beats LI.FI by the min margin, else
  LI.FI. Render which won. Flag off → LI.FI-only, label "via LI.FI".
- **Execution:** reuse the existing `SwapWidget` execution path (LI.FI `executeRoute`) — do **not**
  re-implement signing. Options: (A) fastest — restyle/wrap `components/rewards/swap/SwapWidget`
  for the dark skin; (B) cleaner — new `V1Swap` presentational component calling the same
  quote/execute libs. Prefer (A) for V1 speed, (B) if the widget is too light-coupled.
- **Testnet tokens:** default to USDG + curated Robinhood-Chain pool tokens (align with
  `/api/gateway/instances`); expose broader LI.FI chains only if the router flag is on.

---

## 4. Build checklist (V1)

- [ ] `V1Shell` `NAV`: add `{ label:'Swap', href:'/v1/swap' }`.
- [ ] `app/v1/swap/page.tsx` → renders `<V1Shell><V1Swap/></V1Shell>`.
- [ ] `components/web2/v1/V1Swap.tsx` — dark swap card (§3c/§3d) on the quote/execute libs (§3e).
- [ ] Slippage gear popover (inline; 0.1/0.5/1.0/custom).
- [ ] Best-route line honoring `NEXT_PUBLIC_MW_ROUTER_ENABLED`.
- [ ] Price-impact warn (≥1%) / hard-confirm (≥3%); min-received + fee in review row.
- [ ] Footer disclaimer one-liner → `/legal` (reuse `V1Discover` wording).
- [ ] Disclaimer gate: add focus trap + no-ESC (§1c); confirm it still covers `/v1/swap` via shell.
- [ ] Not-connected: quotes render; button = Connect Wallet (connect-on-action).

**Do NOT:** add a second disclaimer gate, a global settings menu, Create/Referral/Campaigns nav,
or "deposit/savings/guaranteed/APY" copy anywhere on the swap surface.

---

## Sources

- Meteora Terms of Service — https://docs.meteora.ag/resources/legal/terms-of-service
- Meteora docs (product IA) — https://docs.meteora.ag
- Meteora app — https://app.meteora.ag/
- How to Swap Tokens (Jupiter Terminal integration) — https://docs.meteora.ag/user-guide/guides/how-to-swap-tokens
- Coin Bureau, Meteora DEX Review 2026 — https://coinbureau.com/review/meteora-dex-review
- Meteora Portfolio (positions/yields surface) — https://meteora-portfolio.vercel.app/
- Internal: `components/web2/v1/{V1Shell,V1DisclaimerGate,V1Discover,V1Portfolio}.tsx`,
  `app/app/swap/page.tsx`, `app/legal/page.tsx`, `.claude/rules/deployments.md` (MW router flag).
