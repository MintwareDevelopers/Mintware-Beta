# Decision: fate of the single-sided vault + `MintwareVaultFactory`

_Drafted 2026-08-11. Status: **proposal — needs a call.** Follows the `FeeLib`/`LockLib`/`DeployPhase3`
deletion (PR #132), which deliberately left this cluster alone because it's a design decision, not cleanup._

## The cluster

Three contracts move together — they're one architecture:

| Contract | What it is | State |
|---|---|---|
| `MintwareDeFiVault4626` | single-sided (USDC-only) ERC-4626 vault | **deprecated** — known NAV/solvency flaw (par shares over a 2-token LP → late-redeemer loss); superseded by `MintwareDeFiPairVault` |
| `MintwareBaseVault4626` | abstract base for the above | only the single-sided vault extends it (pair vault extends `MintwarePairVault`) |
| `MintwareVaultFactory` | on-chain `createVault` — multi-tenant self-serve | built + tested, **never deployed / never wired** |

## Why this isn't a param change

`MintwareVaultFactory` is **hard-coupled to the single-sided + FeeVault model** (`MintwareVaultFactory.sol`):
- deploys a `FeeVault` per vault (line 74) and calls `vault.setFeeVault(...)` (89) — the **pair vault has no FeeVault** (rent routes vault-internal to LPs);
- verifies `vault.asset()` (83) — the pair vault has `token0()/token1()`, not a single `asset()`;
- its `IMintwareVaultInit` interface assumes `asset()` + `setFeeVault()`.

The pair vault's wiring is entirely different: `setWeightedDistributor` + `setRentFunder` + (optional) am-AMM deploy/cross-wire, and it needs a **pre-mined 0xAC8 hook** (salt-mined off-chain — a factory can't mine it on-chain economically). So making the factory deploy pair vaults means **rewriting steps 1/3/4** and adding hook/am-AMM handling — a new contract, not an edit.

## What actually deploys vaults today

The **`deploy-pair-full-testnet` admin route** (Privy-signed): mines the hook, deploys the pair vault + hook + am-AMM + wires the weighted distributor, all verified on-chain. It's re-runnable (random salt → fresh stack per call). The factory provides **zero value today** — it's undeployed and only knows how to build the flawed single-sided vault.

## Options

**A — Rewrite the factory for pair vaults.** New `MintwarePairVaultFactory`: takes pre-mined hook + pair-vault initcode, wires weighted distributor + rent funder, registers. Keeps the on-chain multi-tenant / self-serve vision (see `ProjectSDK.md`). **Cost:** real feature work; am-AMM enablement is multi-step (likely a separate `enableAmAmm` call, not one tx); still `onlyOwner` unless a permissionless design is added.

**B — Retire the single-sided stack; canonicalize the deploy route.** Delete `MintwareDeFiVault4626` + `MintwareBaseVault4626` + `MintwareVaultFactory` (+ their `.t.sol`), migrate the am-AMM skim tests (`MWHookCoordinatorAmAmm.t` / `…Invariant.t`) off the single-sided vault onto the pair vault or a minimal LP mock. The `deploy-pair-full-testnet` route + `MintwareVaultRegistry` remain the launch + record path. **Cost:** medium — mostly test migration.

**C — Do nothing.** Rejected: leaves a "factory" that deploys a solvency-flawed vault sitting in `src/` — the exact contributor trap this whole audit is removing.

## Recommendation — **B now, A later as a real feature**

- The factory as-built is single-sided-coupled, unwired, and undeployed; it isn't earning its keep, and it actively misleads (a factory for the *deprecated* vault).
- The live product already launches vaults via the route; the registry already records multiple vaults.
- A proper permissionless **pair-vault** factory is a genuine feature for the self-serve / SDK phase — build it deliberately then, not by contorting the single-sided one now.

### Test-migration note (the only real work in B)
`MWHookCoordinatorAmAmm.t.sol` uses the single-sided vault purely as a convenient LP to seed liquidity for the skim assertions. `MWPairVaultAmAmmFork.t.sol` **already proves the same skim → rent → LP loop on the pair vault** (against the real PoolManager). So Option B's migration is: repoint the two non-fork am-AMM tests to the pair vault (or a tiny mock LP so they stay fork-free for CI), then delete the single-sided cluster. Coverage is preserved, not lost.

## If B is chosen — deletion set (after test migration, `forge` green gate)
`MintwareDeFiVault4626.sol`, `MintwareBaseVault4626.sol`, `MintwareVaultFactory.sol`,
`MintwareDeFiVault4626.t.sol`, `MintwareVaultFactory.t.sol`; repoint `MWHookCoordinatorAmAmm.t.sol` +
`MWHookCoordinatorAmAmmInvariant.t.sol`. Also drop the now-dead `ORACLE_PRIVATE_KEY` `range`/`agent`
fallback in `oracleKeys.ts` and rotate that exposed key on-chain (operator).
