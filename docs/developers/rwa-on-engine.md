# RWA owned-pool rollout

Branch: `feat/rwa-owned-pool-rollout`, stacked on `feat/rwa-owned-pool-engine` / PR #557.
Base Sepolia only. No keys read, no broadcast, no push. Installation is still pending.

## Model

`MintwareOwnedPoolMarketEngine` owns the direct PoolManager position and reuses the shared
engine NAV, claim ledger, withdrawal and recenter logic. Its runtime has not grown.
`MintwareRwaAppraisalHook` is the sole permission/appraisal hook and `IMarketAssetMark`.
Its former unpermissioned mode, undated appraisal entrypoints, legacy oracle interface and
vault swap exemption are removed. Every deployment must pin a verified adapter/USDC pool.

The pool sorts adapter and USDC addresses. The engine maps the adapter to its underlying
property asset **without sorting again**. Contributions, NAV, idle adapters and payouts use
that corresponding underlying order. PoolManager holds virtual adapter units; the engine
and idle adapters hold underlying. Settlement measures exact debits/receipts so verification
seed or donations cannot subsidize short funding. `take` burns virtual units and delivers property.

Engine shares are non-transferable. New shares require LP permission for recipient and engine,
plus engine wrapper approval. The pooled engine reports itself through `msgSender()`.
Only it adds/removes liquidity. Adds require current LP/wrapper approval. Removal and collection
ignore permission revocation, checker outages, paused trading, the swap switch and appraisal age.
Recenter is atomic: a refused re-add restores the original position.

Every swap principal needs `SWAP_ALLOWED`. The hook checks wrapper trust before reading the
reported principal. Native issuer transfer eligibility remains separate from these flags.
The adapter, engine, property idle adapter, contributors and payout recipients need native
custody permission. The router's approved principal cannot waive output-recipient restrictions.

Appraisals contain an observation time and report hash. Zero, future and non-increasing dates
are refused. Publication time controls cadence and the rolling absolute-movement cap; observed
time controls freshness. MW-03 charges reversals and expires each move individually at 24 hours.
Fees use the pre-swap band. Trades ending outside the outer band must close the gap while staying
on the same side of appraisal. Guardian pause and stale observations stop new trades.
Keeper/config changes retain 48-hour timelocks; age/grace cannot change after pool pinning.

Full in-kind exits need no mark, including after grace. Incomplete delivery requires a valid
grace mark and retains shares for the undelivered claim. Issuer freezes and unreadable idle
adapter NAV remain exit limitations. No forced recovery, seizure or NFT fallback is added.

## Source pins and routing proof

The existing `contracts-v4/lib/v4-periphery` checkout is unchanged.

| Dependency | Commit |
|---|---|
| v4-periphery-permissioned | `3245c3cb99c48fa1dc2459c3b60abc37d4294aba` |
| v4-hooks-public | `f2aa843e266f8f9b34fdaf94ffb72eda5d9204f9` |
| Universal Router 2.2.0 | `64027f3372aa235734207c4e05667204f6f927e1` |
| Permit2 (router's recursive pin) | `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219` |

`contracts-v4/integration/UniversalRouterOwnedPool.t.sol` exercises command `0x10`, the real
Universal Router dispatcher, permissioned V4 router and Permit2 allowance payment in both
currency orientations. It checks delivery in both directions, unpermitted trader refusal,
untrusted wrapper refusal, missing Permit2 allowance and absence of stranded router funds.
Permit2 uses its pinned upstream `DeployPermit2` helper's precompiled runtime, not a payment mock.

The router dispatch dependencies are initialized under
`contracts-v4/lib/v4-hooks-public/lib/`:

- `https://github.com/Uniswap/v2-core@4dd59067c76dea4a0e8e4bfdda41877a6b16dedc`
- `https://github.com/Uniswap/v3-core@d8b1c635c275d2a9450bd6a78f3fa2484fef73eb`

Run `FOUNDRY_PROFILE=permissioned_router forge test` for the real Universal Router proof.
The default profile targets only `contracts-v4/test`; integration tests live separately.
The ordinary suite exercises the real upstream abstract router via its test-only allowance
entrypoint, with exact permission/band errors and engine custody assertions.

## Canonical installer

Use `contracts-v4/script/DeployRwaOwnedPool.s.sol`. It is separate from the hookless installer
because adapter verification and hook pin/initialize/bind must precede activation. It reads no
private key. `vm.startBroadcast(owner)` records unsigned transactions during a dry-run.

Inputs:

| Variable | Meaning |
|---|---|
| `RWA_OWNER`, `RWA_KEEPER`, `RWA_GUARDIAN` | Issuer governance addresses |
| `RWA_PROPERTY`, `RWA_CHECKER` | Existing issuer token and ERC-165 allowlist checker |
| `RWA_FACTORY` | Optional existing official factory; unset creates one from pinned source |
| `RWA_ADAPTER` | Optional existing adapter from that factory; unset creates one |
| `MARKET_LIFECYCLE_MODULE` | Module with the runtime hash below |
| `RWA_APPRAISAL_TICK` | Virtual adapter/USDC tick, aligned to spacing 60, with ±600 range room |
| `RWA_OBSERVED_AT`, `RWA_REPORT_HASH` | Actual dated report provenance |

Manager and quote are fixed to Base Sepolia's PoolManager and USDC. Supplied factories must
match the pinned official runtime for that manager. Adapter owner, checker, underlying,
manager and factory mapping are checked. The issuer must allow native adapter custody and
hold the one-unit verification seed before simulation; use an existing pre-enrolled adapter
or pre-enroll the factory's next CREATE address. A verified adapter can be reused explicitly.

Sequence: create/validate factory and adapter → seed/verify → mine and deploy the exact hook
initcode through the deterministic CREATE2 deployer → pin key → publish dated appraisal →
initialize → deploy engine inactive → bind hook → deploy/configure idle adapters → set guardian
and approve engine wrapper. The installer asserts the inactive binding and logs every address.
It never activates or supplies liquidity. Issuer custody/LP approvals, qualified contributors,
trusted Universal Router approval and the swap switch must be reviewed before activation.

Lifecycle runtime pin in both wrappers, module installer, verifier and fork rehearsal:
`0x9fb68029d316c682a41b625177cc8a7431cd03df38ee5878e3c045edb634bc01`.
The checked-in module creation hex is refreshed from the matching compiled artifact too.
Foundry auto-discovered remappings enter Solidity metadata: initializing the router dependencies
changed the module hash from `0x92db…7e56` without changing executable bytecode. All consumers
must use the same compiled pin. The owned-pool regression suite compares the checked-in creation
hex against the compiled source, and wrapper construction enforces the runtime hash.

Unsigned commands:

```sh
export PATH="$HOME/.foundry/bin:$PATH"
forge script contracts-v4/script/DeployRwaOwnedPool.s.sol:DeployRwaOwnedPool --rpc-url "$BASE_SEPOLIA_RPC_URL"
# Offline harness using the same installer with fixture issuer/quote and real PoolManager code:
forge script contracts-v4/script/RehearseRwaOwnedPool.s.sol:RehearseRwaOwnedPool
```

The offline harness executes PoolManager construction at its fixture address, preserving the
NoDelegateCall immutable. It is not evidence of live Base Sepolia state or issuer onboarding.

## App and archival boundary

`/api/rwa/unit` reads `RWA_OWNED_ENGINE_ADDRESS` on Base Sepolia. With it unset, the response is
`source: undeployed` and the live UI says **Not deployed yet**. An invalid configuration or cold
RPC failure is unavailable; a previously successful read can be returned as explicitly cached.
No archived state substitutes for a live read. Each snapshot and verification is pinned to one block.

Shared ABI/readers live in `lib/web3/artifacts/marketEngine.ts` and `lib/gateway/marketEngine.ts`.
They expose engine NAV (nullable when marks are unavailable), supply, optional account shares,
underlying/idle/wallet balances and position liquidity/range. RWA reads add dated mark, band,
freshness/grace, pause, swap switch and issuer flags. The UI never extrapolates a return.

Registry verification requires an explicitly approved concrete owned-wrapper runtime through
`MARKET_OWNED_ENGINE_CODEHASHES_84532`, configured owner and quote, canonical USDC, the bound hook,
verified adapter→underlying mapping, matching manager/mark and pool id. Underlying token order
must correspond to virtual pool order. Ordinary engine codehash approval cannot admit this model.
The unit reader explicitly permits inactive inspection; registry admission still requires activation.

Old proof JSON, deployment records and its reader live in `config/rwa-archive/`; the proof page
is visibly archived and keeps its original transaction hashes. Old mock contracts, installer,
live-trade writer and background trading/refresh scripts are removed. The retired writer URL
returns 410. Meaningful refusal, governance, band and MW-03 assertions run against owned pools.

## Verification

Validation is local; both pinned router dispatch dependencies are present.

- TypeScript: `pnpm exec tsc --noEmit --incremental false` passes.
- App: `pnpm test` passes, **659 tests across 87 files**.
- Installer: `forge script ...RehearseRwaOwnedPool` passes, engine remains inactive.
- `pnpm context:sync` run; `pnpm context:check` and `git diff --check` pass.
- After `forge clean`, `forge test`: **185 passed, 0 failed, 3 existing fork skips; 188 total
  across 24 suites** (the previous 184 passes plus the installer artifact-consistency regression).
  RPC environment variables were unset. All five MW-03 regressions pass, including the
  sliding-window model fuzz; existing invariant budgets remain 256 runs × 500 calls.
- `forge build --sizes`: **63 reported runtimes, all below EIP-170**. Owned engine **24,169 B**
  (407 B headroom), ordinary engine **23,187 B**, lifecycle module **7,335 B**, hook **16,567 B**.
  Owned-engine initcode is **30,429 B**, below EIP-3860. No engine core/runtime logic was added.
- `FOUNDRY_PROFILE=permissioned_router forge test`: **48 passed, 0 failed, 0 skipped** across
  four suites, also passing after the clean default build. Eight tests exercise Universal Router
  + Permit2; forty repeat imported engine
  behavior tests. These counts are separate from the default suite.

First-party physical source-line diff against `611edbc85457ae2e9a955b13241ccff246b56e72`:
comments/blank lines included; Solidity + TS/TSX; tests, integration proofs and vendored
dependencies excluded. The archived TS reader and installer/rehearsal scripts are included.
Moved proof files are not counted as a source saving. Additional retired MJS scripts are
excluded from these totals.

| Source | Added | Removed | Net |
|---|---:|---:|---:|
| Solidity | 142 | 516 | -374 |
| TypeScript/TSX | 422 | 1,291 | -869 |
| **Total** | **564** | **1,807** | **-1,243** |

Staging was attempted but Git could not create the parent worktree's `index.lock` outside the
writable sandbox. Changes remain uncommitted on the requested branch. No push or broadcast.
