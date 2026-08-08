# Mintware — Project Context

Rewards-driven DeFi reputation platform. Three groupings: **Web2 / Web3 / Rewards**.
Stack: Next.js 16, TypeScript, RainbowKit + wagmi, Supabase, Tailwind v4, pnpm.

Today's date: 2026-08-08.

> **▶ Current direction (2026-08-05): reputation-first DeFi.** The RWA surface was **shelved** off the
> platform (preserved on branch `archive/rwa-surface` + PRs #28–34; see [`docs/archive/rwa/SHELVED.md`](docs/archive/rwa/SHELVED.md)).
> Mintware is the on-chain **reputation layer** — Attribution scores behavior, and rewards / social LP
> vaults / agents route value by the score. Vaults are single-surface DeFi (reputation-weighted LP on V4).

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
| Vaults — DeFi social LP, V4 hook, FeeVault, 4626 base | `.claude/rules/vaults.md` |
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
