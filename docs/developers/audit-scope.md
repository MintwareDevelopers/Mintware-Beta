# Mintware — External Audit Scope (freeze draft)

> **Freeze target:** `main` @ the tag cut AFTER the cards stack (#401/#408) lands or is
> explicitly excluded. Auditors review a tagged SHA, never a branch.
> **Status of everything below: testnet, empty, unaudited.** Only `AIAttribution` v3 (Base
> mainnet) carries a live deployment, and it is fundless. Nothing here holds real value.

## In scope — the converged YPN + vault + hook + settlement stack (`contracts-v4/src`)

### payments/ (YPN treasury → spendable) — HIGHEST PRIORITY (money custody + redemption)
- `MintwareTreasuryVault.sol` — senior/junior tranche, price-free senior NAV, proportional redemption (R6). **The core.**
- `MWTreasuryPositionLib.sol` — delegatecalled V4 position valuation + the R6 `recoverableFloorUSDC` floor.
- `MintwarePaymentGateway.sol` — `settleSpend`/`burnForPayment` card rail **+ the card-buffer + bridge additions from #401/#408 (once landed).**
- `MintwareTreasuryJitHook.sol` — borrow-idle → JIT → settle (am-AMM shelved; returns zero delta).
- `MintwareEthSettlement.sol` — oracle-bounded batch ETH→USDC settlement (windowed caps).
- `MintwareTreasuryFloatSettlement.sol` — go-forward float settlement (Lido/pool refs, env-gated).
- `MintwareCctpDepositRouter.sol` — CCTP receive → yield-earning shares.
- `MintwareTreasuryVaultFactory.sol` · `…Registry.sol` · `MintwareTreasuryDeployers.sol` — multi-tenant CREATE2 deploy/track (factory EIP-170-trimmed).
- `IYieldVault.sol` — interface.

### vaults/ (DeFi LP universe)
- `MintwarePairVault.sol` (abstract base) · `MintwareDeFiPairVault.sol` (canonical) · `MintwareMatchedLiquidityVault.sol` (team-locked/community-matched).
- `MintwareStagedLiquidityRouter.sol` · `Mintwarev3ToV4Migrator.sol` · `MintwareVaultRegistry.sol`.
- Yield adapters: `AaveV3YieldAdapter.sol` · `MintwareERC4626YieldAdapter.sol` (fee-aware) · `MintwareMultiVenueYieldAdapter.sol` (principal-clamp safety-edge fix).
- Libs: `MWJitLib.sol` · `MWIdleLib.sol` · `MWPositionLib.sol` · `MWFeeLib.sol` · `VaultTypes.sol`.
- Interfaces: `IYieldAdapter.sol` · `IAaveV3.sol`.

### hooks/ (V4 hooks + MEV engine)
- `MWHookCoordinator.sol` (canonical hook) · `MWDynamicFee.sol` · `MWOracleGuard.sol` · `MWFeeHook.sol` (routable fee-only).

### lib/ (shared bases — audit these WITH their consumers)
- `SeniorSharesMath.sol` (inflation defense) · `MWGuardianPausable.sol` (kill-switch) · `MWTimelockedOracleSigner.sol` · `MWTimelockedRiskParams.sol` · `HookMiner.sol` (deploy-time CREATE2 helper).

### rewards
- `MintwareWeightedDistributor.sol` — sig-verified epoch close.

## Explicitly OUT of scope (tell the auditor)
- **am-AMM** — `MWAmAuction.sol` / `MWAmAuctionLib.sol`: **shelved / opt-in, inert by default** (removed from the JIT hook). Exclude, or scope as "inert unless enrolled."
- **`MintwareYieldVault.sol`** — v1 flat-senior USDC vault, the legacy Arc-testnet instance. Superseded by `MintwareTreasuryVault`; **Arc is dropped.** Exclude unless still deployed.
- **`AIAttribution.sol`** (`contracts-ai/`) — already live on Base mainnet, separate prior review; fundless attestation ledger, no custody. Note, don't re-scope.
- Shelved surfaces (RWA, Campaigns) and the `EthSeniorDemo_*` demo deploys — already removed from `src` / are deploy artifacts, not source.

## External dependencies the auditor must know
- **Uniswap v4** (v4-core + v4-periphery) — the pool/hook substrate.
- **Aave v3** — idle-capital rehypothecation.
- **OpenZeppelin** — access control, reentrancy, SafeERC20, math.
- **The delegatecall library pattern** — `MWTreasuryPositionLib` / `MWPositionLib` run AS the vault (EIP-170 relief). Storage/`address(this)` resolve as the vault.
- **The truncated in-pool oracle** — no CEX feed; the manipulation-resistance basis for redemption NAV.
- **CCTP** (Circle) — cross-chain USDC.

## Threat model headline
Bunni-class **impaired-tail NAV overstatement** is the primary risk. R6 (this cycle) closed the redemption-order dimension: the senior redeem-NAV now values the LP at its conservative USDC-leg floor, never the mid mark, and `_pullUSDC` realizes each redeemer's own liquidity slice so the liquidation gap is shared. The internal red-team rounds (R2–R6 + safety-edges) and their PoC suites should be handed over as the "already attacked" record.

## Freeze checklist
1. Land or explicitly exclude the cards contracts (#401/#408 → `MintwarePaymentGateway` + `MWTimelockedRiskParams`).
2. Rotate the exposed oracle signer key.
3. Verify the float-settlement mainnet reference addresses (`config/settlement.ts`).
4. `pnpm forge:test` green on the freeze commit; record counts + EIP-170 sizes.
5. Reconcile `docs/developers/audit-readiness-dossier.md` + `pre-audit-findings-ledger.md` to this list + commit.
6. `git tag audit-v1 <sha>`; hand the auditor the tag + dossier + findings ledger + test suite + this scope doc.
