# Mintware — Project Context

On-chain **reputation + liquidity** platform. Three groupings: **Web2 / Web3 / Rewards**.
Stack: Next.js 16 (App Router, webpack build) · TypeScript · Tailwind v4 · **Privy** + wagmi ·
Supabase · Foundry · Rust services. pnpm.

> **▶ Read [`.claude/STATE.md`](.claude/STATE.md) first** — the single "you are here" file:
> what's **live**, what's **shelved** (RWA + Campaigns both are), and where to look. It wins over
> any rule/doc it disagrees with. The through-line is *"Never idle. Never locked. Always yours."*
> ([`docs/product/framing-and-messaging.md`](docs/product/framing-and-messaging.md)).
>
> **How this context layer stays true:** [`.claude/CONTEXT-MAP.md`](.claude/CONTEXT-MAP.md)
> (one-home-per-fact map · `AUTO` blocks via `pnpm context:sync` · reconcile-on-change rule).

## Rules (load by topic)

| Topic | File |
|---|---|
| Current state — live / shelved / direction | `.claude/STATE.md` |
| One-home map + anti-drift rules | `.claude/CONTEXT-MAP.md` |
| Architecture, groupings, file structure, pages | `.claude/rules/architecture.md` |
| CSS, Tailwind tokens, design system, dev server | `.claude/rules/code-style.md` |
| Attribution API, internal routes, helpers | `.claude/rules/api.md` |
| Route handler factory (`createHandler`) | `.claude/rules/route-handler.md` |
| Wallet layer (Privy + wagmi), EAS, auth guard | `.claude/rules/web3.md` |
| Rewards: universal pipeline, epochs, crons (campaigns shelved) | `.claude/rules/rewards.md` |
| Referral system, ref codes, Supabase tables | `.claude/rules/referrals.md` |
| Contracts — live Forge stack (vaults, AIAttribution v3) | `.claude/rules/smart-contracts.md` |
| Vaults — DeFi LP / ULV, V4 hook, 4626 base | `.claude/rules/vaults.md` |
| Supabase schema, migrations, constraints | `.claude/rules/schema.md` |
| Vercel, env vars, build, crons, domains | `.claude/rules/deployments.md` |
| MintGuard, CSP, rate limits, on-chain verification | `.claude/rules/security.md` |
| ERC-8004, AIAttribution SDK, agent leaderboard | `.claude/rules/agents.md` |
| Embeddable campaign widget (concept) | `.claude/rules/ProjectSDK.md` |
| Vitest + Forge — commands + invariants | `.claude/rules/testing.md` |

## Reconcile-on-change (keeps this layer true — see CONTEXT-MAP.md)

- A change isn't done until **its one home is updated in the same PR**. If you add/remove a
  route, page, cron, env flag, or contract — or ship/shelve a surface — update its home **and**
  `.claude/STATE.md`. Never hand-edit an `AUTO` block; run `pnpm context:sync`.
- Shelve a surface → SHELVED banner on its rule + move its doc to `docs/archive/`, same PR.
- Then record what changed + why in the affected rule file (one paragraph max).
