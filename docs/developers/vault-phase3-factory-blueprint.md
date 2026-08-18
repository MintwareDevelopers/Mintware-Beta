# Phase 3 — YPN Multi-Tenant Factory Blueprint

_Branch `feat/ypn-vault-convergence`. Give the converged `MintwareTreasuryVault` a multi-tenant
factory + registry so each team can launch its own YPN vault (own token, own pool, own JIT hook).
Builds on the P2 audited-candidate; both go into ONE external audit pass (more efficient than
audit-P2 → build-P3 → re-audit)._

## The V4 constraint that shapes everything
A YPN vault needs its OWN JIT hook (the hook is bound to one vault + one canonical pool — see the P0
`canonicalPoolId` fix), and a V4 hook MUST live at a CREATE2 address whose low bits encode its
permissions (`0xC0` = beforeSwap|afterSwap). **Mining that salt is only feasible OFF-CHAIN** (`HookMiner`).
Plus the vault↔hook dependency is circular (the vault's pool key needs the hook address; the hook ctor
needs the vault address), broken today by PREDICTING the vault's CREATE address.

**⇒ There is no pure on-chain `createVault()` for a hooked vault** (this is exactly why the deleted 4626
factory was a dead end). The honest pattern: the **caller mines the hook salt off-chain against the
factory's predicted vault address**, then calls the factory, which does the atomic deploy + wire + register
in one tx.

## Components

### 1. `MintwareTreasuryVaultRegistry` (new — YPN-shaped)
The multi-tenant on-chain index. The existing `MintwareVaultRegistry` is DeFi/4626-shaped
(`feeVault`/`vRWA`/`provider`) — a YPN-specific registry is cleaner than bending that record.
- Record per team: `{ vault, hook, gateway, team, teamToken, usdc, createdAt, active }`.
- `register(record)` — only the factory (or owner). `deactivate(id)` — owner/guardian (retire an instance).
- Views: `get(id)`, `count()`, `byTeam(team)`, `isActive(vault)`.

### 2. `MintwareTreasuryVaultFactory`
- `predictNextVault() view returns (address)` — the address the next `createVault` will CREATE the vault at
  (from the factory's own address + nonce). The off-chain miner mines the hook salt against THIS.
- `createVault(CreateParams p, bytes32 hookSalt) returns (address vault, address hook, address gateway)`:
  1. `new MintwareTreasuryVault(pm, hookedKey, usdc, adapter, owner, team)` → lands at `predictNextVault()`.
  2. `new MintwareTreasuryJitHook{salt: hookSalt}(pm, ctorKey, usdc, vault, owner)` (CREATE2; assert the
     mined address + `0xC0` bits).
  3. `pm.initialize(hookedKey, initSqrtPrice)`.
  4. `vault.setJitHook(hook)`; `hook.setJitSkipSender(vault)`; deploy `MintwarePaymentGateway`;
     `vault.setGateway(gateway)`; `vault.setProtocolTreasury(treasury)`; transfer vault/hook ownership to
     the intended owner (see below).
  5. `registry.register(...)`; emit `VaultCreated(id, vault, hook, gateway, team, teamToken)`.
- `CreateParams`: `{ usdc, teamToken, adapter, team, owner, treasury, poolFee, tickSpacing, initSqrtPrice,
  gatewayAdmin }`.
- **Access:** `onlyOwner` (Mintware-curated) for v1 — matches the "whitelisted teams" model and avoids a
  spam/griefing surface; a permissionless variant with guards can come later.

### Ownership subtlety
Steps 4's wiring calls (`setJitHook`, `setGateway`, …) are `onlyOwner` on the vault/hook. So the FACTORY
must be the vault/hook `owner` during construction, do the wiring, THEN transfer ownership to the intended
`owner` (the Mintware ops multisig, NOT the team — the team is the junior tenant via `commitTeam`, per the
P2 M1 binding). Bake this two-phase (factory-owns → wire → transfer) into `createVault`.

## Deploy scripts
- `DeployTreasuryFactory.s.sol` — deploy the registry + factory once per chain; wire the registry to the
  factory (`registry.setFactory(factory)`).
- Generalize `DeployTreasuryV2.s.sol` → `CreateTreasuryVault.s.sol`: read a team's params from env, call
  `factory.predictNextVault()`, mine the hook (`HookMiner`), `factory.createVault(params, salt)`. One team
  per run. (The single-shot `DeployTreasuryV2` stays as the reference/first-vault path.)

## Tests (`MintwareTreasuryVaultFactory.t.sol`)
- `createVault` produces a WORKING vault: full deposit → deployToLP → swap(JIT fires) → sweep → recover →
  gateway-burn lifecycle on the factory-made instance (reuse the RealPool/JitStack harness).
- The hook binds to the right vault + pool (`canonicalPoolId` holds; a swap on another pool no-ops).
- Registry records it; `deactivate` flips `active`; `byTeam` returns it.
- **Two teams → two isolated vaults** (different tokens/pools/hooks); one team's swaps never touch the
  other's vault (the core multi-tenancy property).
- Ownership ends at the intended `owner` (not the factory, not the team); `team` is the constructor-bound
  junior tenant.
- Access control: non-owner `createVault` reverts (v1 permissioned).

## Gate
Same as P2: **external audit before any deploy.** P3 extends the audited-candidate; the full converged stack
(vault + library + factory + registry) audits together in one pass. Until then this is branch-only.
