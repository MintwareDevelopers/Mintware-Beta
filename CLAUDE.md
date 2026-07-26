# Mintware — Project Context

Rewards-driven DeFi reputation platform. Three groupings: **Web2 / Web3 / Rewards**.
Stack: Next.js 16, TypeScript, RainbowKit + wagmi, Supabase, Tailwind v4, pnpm.

Today's date: 2026-03-27.

> **▶ Current direction — Phase 3 (Two-Surface Vaults):** the platform is evolving into a
> two-surface (DeFi + RWA) Uniswap V4 vault system on a shared ERC-4626 base + factory.
> **Read [`docs/developers/phase3-two-surface-architecture.md`](docs/developers/phase3-two-surface-architecture.md) first** for target
> architecture, locked decisions, and build tracks. Active branch: `feature/phase-3`.

## Rules (load by topic)

| Topic | File |
|---|---|
| Architecture, groupings, file structure, pages | `.claude/rules/architecture.md` |
| CSS, Tailwind tokens, design system, dev server | `.claude/rules/code-style.md` |
| Attribution API, internal routes, helpers | `.claude/rules/api.md` |
| Wagmi, RainbowKit, EAS, auth guard, wallet | `.claude/rules/web3.md` |
| Campaign engine, epoch formula, multipliers, crons | `.claude/rules/rewards.md` |
| Referral system, ref codes, Supabase tables | `.claude/rules/referrals.md` |
| MintwareDistributor v2, AIAttribution v3, deploy | `.claude/rules/smart-contracts.md` |
| Vaults — two-surface (DeFi+RWA), V4 hook, FeeVault, 4626 base | `.claude/rules/vaults.md` |
| **Phase 3 plan of record** — two-surface architecture, tracks | `docs/developers/phase3-two-surface-architecture.md` |
| Supabase schema, migrations, constraints | `.claude/rules/schema.md` |
| Vercel, env vars, build, crons, domains | `.claude/rules/deployments.md` |
| MintGuard, CSP, rate limits, on-chain verification | `.claude/rules/security.md` |
| ERC-8004, AIAttribution SDK, agent leaderboard | `.claude/rules/agents.md` |
| Hardhat, Vitest, Forge — commands + invariants | `.claude/rules/testing.md` |

## Auto-Memory Instruction

After completing any task that introduces new patterns, fixes bugs, or makes decisions:
- Identify which rule file(s) are affected
- Append a brief note with what changed and why
- Keep entries concise — one paragraph max per learning
