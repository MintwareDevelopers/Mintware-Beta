# Testing

## Test Suites

| Suite | Runner | Count | Command |
|---|---|---|---|
| Unit tests | Vitest | ~230 | `pnpm test` |
| Contract tests (Phase 2/3) | Forge | 175 | `pnpm forge:test` |

> **⛔ Hardhat suite removed (2026-08-12):** the Hardhat/Mocha `MintwareDistributor` tests + the whole
> Hardhat toolchain were deleted with the shelved campaign stack (see [[campaigns_shelved]] /
> `.claude/rules/smart-contracts.md`). `test:all` is now `pnpm test && pnpm forge:test`. Ignore any
> `hardhat:*` / `.cjs` Mocha references below — historical. Vitest campaign suites (calc, epochProcessor,
> swapHook, merkleBuilder, resolveQuote) were removed too; the count dropped accordingly.

> Counts verified 2026-08-08 (`pnpm test` = 256 green; Forge = 175/175). The old
> "147/72/36" figures were stale by a wide margin. New suites now covered:
> `lib/attribution/*`, `lib/rewards/universal/*`, `lib/rewards/vault/weighted*`.
> (Removed: the RWA `holdSnapshot`/`holdLocks` suites no longer exist.)
| All | — | — | `pnpm test:all` |

## Vitest Suites (`pnpm test`)

- `calc.test.ts` — reward calculation
- `epochProcessor.test.ts` — epoch payout formula
- `utils.test.ts` — shared utilities
- `swapHook.test.ts` — swap hook logic + multipliers
- `merkleBuilder.test.ts` — Merkle tree construction
- `holdSnapshot.test.ts` — RWA hold-credit math + idempotent writer (campaign-scoped tx_hash, rollback-on-rpc-error)
- `holdLocks.test.ts` — R5 lock decode guard: vault `locks()` getter returns `(depositedAt, lockedUntil, tier, initialized)`; `lockedUntil` is index **1** (not 0)

## Hardhat Notes

- Config: `hardhat.config.cts` (`.cts` forces CJS with `"type":"module"`)
- Tests: `contracts/test/MintwareDistributor.test.cjs` (`.cjs` for Mocha 10.x)
- Always use: `TS_NODE_PROJECT=tsconfig.hardhat.json` (baked into `hardhat:*` scripts)
- Never use `.ts`/`.cts` for test files — Mocha CJS-in-ESM bridge requires `.cjs`

## Forge Notes

- Binary: `~/.foundry/bin/forge`
- Add to PATH: `export PATH="$HOME/.foundry/bin:$PATH"`
- Tests in `contracts-v4/test/` — currently stubbed (Phase 2 T1 work)
- `contracts-v4/out/` gitignored

## Key Invariants to Test

- Leaf encoding: `abi.encode` (64-byte), NOT `abi.encodePacked` (52-byte)
- Score multipliers applied at point-credit time only (not payout time)
- `pending_rewards` unique constraint: `(campaign_id, tx_hash, reward_type)`
- Oracle EIP-712 includes `deadline` in typed data
- `verifySwapTx` checks `LIFI_ROUTERS` set (not single address)
