# Session Handoff — Client Acquisition Strategy + Bridge DDQ (2026-09-03)

Consolidated so this survives regardless of which Claude account/session picks it back up. Nothing here
is committed to git yet — that's a deliberate choice, review before deciding what (if anything) should
be tracked, especially the Bridge DDQ material once it names real people/addresses.

## Thread 1 — Client acquisition strategy for token teams/treasuries

**Core thesis (validated with real numbers, not just intuition):** there's a large, real, multi-chain
economy of teams launching tokens (Clanker ~13k/day on Base, Zora creator coins, Flaunch, Virtuals
Protocol multi-chain, Robinhood Chain/Bankr/Doppler) who immediately start earning perpetual trading-fee
income with nowhere purpose-built to receive/track/spend it. That gap is the opportunity.

**Key correction made mid-thread:** initial framing was "get teams to migrate their LP to Mintware" —
this is **categorically impossible** for the biggest segment (Clanker's `LpLockerV2` has no withdraw
function, non-upgradeable, locked forever by design — confirmed via Clanker's own docs). The real,
buildable wedge is capturing the **perpetual creator-fee stream**, not the LP position itself.

**The concrete build unlock — "Reward Router":**
- Clanker's `collectRewards()` is **permissionless** (anyone can call it) and pays out via a
  `creatorRewardRecipient` address mapping (not hardcoded to the deployer wallet).
- Plan: a thin adapter contract a creator points their `creatorRewardRecipient` at. It receives the fee
  payout (usually ETH), swaps to USDC via the **already-built** `MintwareEthSettlement` batch swap, then
  calls the **already-built** `MintwareTreasuryVault.depositUSDC(assets, minShares, to)` — crediting the
  creator inside the *shared* treasury vault. No new vault per team, no `onlyOwner` factory bottleneck,
  no human approval step anywhere.
- Pairs with **one new agent-plugin action** (e.g. `MINTWARE_ROUTE_REWARDS`) added to the already-live
  AgentKit/Eliza/MCP packages, so an autonomous agent (Clanker-style agents, or agents on Virtuals/
  Robinhood Chain) can wire itself into the router in one tool call — zero human in the loop for that
  segment.
- Open technical question before committing further: can `creatorRewardRecipient` be changed *after*
  a token has already launched, or only set at deploy time? Determines whether this only helps new
  launches or also the existing backlog.

**Real competition to know about:** Flaunch already imports fee streams "from Zora, Clanker and others"
into its own TreasuryManager — closest direct competitor for this exact motion. Checked its current
status: not confirmed dead, but wounded (deprecating its "Builders App," its own FLNCHY token market cap
crashed to ~$1.77). Differentiation if pursued: Mintware's version keeps the money yield-bearing +
spendable via cards/payroll, not just streamed to a wallet.

**LP migration (a separate, smaller, more traditional segment — NOT the same as the fee-stream play):**
- `Mintwarev3ToV4Migrator` already exists and is written against a **generic** NFT-position interface
  (`INonfungiblePositionManagerLike`) — not hardcoded to one specific v3 deployment. Likely extends to
  Aerodrome's Slipstream (concentrated-liquidity, NFT-based) with just a new deployment, pending an
  interface diff — cheapest possible win on this list.
- Two genuinely new migrator variants would be needed: (1) fungible-LP-token sources (Uniswap v2,
  Aerodrome "basic" pools — no NFT/tokenId, simpler shape), (2) a different-V4-hook source (V4 uses its
  own PositionManager pattern, not the v3-style NPM interface — a hook can't be swapped onto an existing
  pool, so this is exit-and-reenter same as v2/v3, just a different position-manager shape to drive).
- Real economic hurdle specific to Aerodrome: teams staking LP in gauges earn ongoing AERO
  emissions/bribes — migrating away means giving that up, so the pitch has to genuinely beat it, not
  just offer easier tooling.

**Rejected direction:** adopting a full Aerodrome-style ve(3,3) native-token/vote-escrow/bribe model —
correctly vetoed as reopening exactly the securities-law exposure the priority-buffer/tranche redesign
was built to avoid (see `docs/legal/priority-buffer-redesign.md`), for an unproven mechanism. Lighter
alternative if incentives are wanted later: team-funded, USDC-denominated LP incentives on their own pool
(no new token, no vote-escrow) — funded by the same Reward Router income.

**Cheap distribution levers already built, not yet pointed at this ICP:**
- `/org/[slug]/badge` — embeddable trust badge, zero-CAC viral loop if token teams embed it.
- The `/solutions/*` page pattern (companies/funds/network-states/treasuries) — a `/solutions/token-teams`
  or `/solutions/creators` page is nearly free to add and gives a real link for BD conversations with
  Clanker/Virtuals/Bankr instead of pointing them at generic marketing.

**Not yet started:** no code has been written for any of this — Reward Router, the new agent action, and
the migrator variants are all still at the "talked through, not built" stage per the "talk before
building" preference.

## Thread 2 — Bridge/Stripe DDQ (stablecoin-issuing card program, sponsored by Lead Bank)

**What this is:** a formal regulatory compliance attestation for the real bank-sponsored card-issuing
tier — a materially bigger step than the currently-running Lithic sandbox rail. Real legal/regulatory
weight — treated accordingly (no fabricated compliance attestations).

**Where things stand:**
- Draft email to Osman/Bridge — asking (1) which DDQ items can run on Bridge's own KYC/sanctions
  tooling vs. need Mintware's own infra, (2) whether there's a SOC 2 alternative for an early-stage
  team, (3) for a reference/example DDQ. **Not yet confirmed sent.**
- `docs/legal/bridge-ddq/RD-1-funds-flow-diagram.md` — funds-flow document with a mermaid diagram,
  grounded in the real code (`lib/cards/bridge.ts`, `lib/org/cardAuthorize.ts`,
  `MintwareTreasuryVault.sol`). **Flagged: the custody characterization (custodial vs. non-custodial)
  needs actual legal counsel sign-off before submission — that's a licensing-weight determination.**
- `docs/legal/bridge-ddq/RD-8-fraud-prevention-program.md` — six real, cited controls (belt/suspenders
  auth, system-wide circuit breaker, hot-buffer reserve floor, multi-collateral freshness gating,
  capped/idempotent settlement, fail-closed-by-default). Honestly notes what's NOT built yet (behavioral
  fraud signals).
- `docs/legal/bridge-ddq/line-by-line-answers.md` — full question-by-question working sheet, tagged:
  answerable now (8 fields, including `/terms` and `/risk-disclosures` already satisfying CD-1/CD-2),
  factual-only-the-founder-knows, blocked on Bridge's tooling-scope answer, or a real action item.

**Real action items identified, not yet done:**
- Confirm the actual **legal entity name** (same open question flagged during the UFSF grant application
  — resolve once).
- **Designate a real MLRO** — doesn't need a hire, needs one team member formally taking the role in
  writing.
- **Board sign-off** on the eventual written AML/KYC/sanctions policy — achievable even as a
  founder-only "board," but needs to actually happen, not be answered vaguely.
- **RD-7 (funding plans / run-on-the-asset circuit breakers)** — flagged as answerable now from the same
  real engineering already documented in RD-8 (circuit breaker + hot-buffer reserve + loss-waterfall
  ordering) — **not yet drafted**, offered as the next easy one to knock out.

**Honest overall read:** several DDQ items will likely come back "No" given the company's actual current
stage (SOC 2, dedicated compliance FTEs, a formal AML program) — that's normal for a team this size, but
means this specific DDQ, answered honestly, may not currently clear the bar for the full bank-sponsored
tier without real compliance investment first. That's a real business decision (build out compliance now
vs. stay on the Lithic sandbox rail longer), not a form-filling problem.

## Also parked mid-session, not acted on

- **Base Batches 004** (equity investment, not a grant, $100k from Base Ecosystem Fund, deadline Sep 9,
  2026) — a full field-map draft was built then explicitly dropped by the user ("nvm lol"). Not revived
  here; mentioned only so it doesn't get silently re-discovered as if new.
- **Uniswap Foundation Security Fund (UFSF)** — application **submitted** this session (real submission,
  not draft) for the hook/vault stack audit subsidy. Uses 1 of 3 lifetime applications. Monthly rolling
  cohort, watch `t.me/UFSF_Applicants` for updates.
