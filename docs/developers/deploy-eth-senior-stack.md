# Deploy runbook — ETH senior tranche stack (Base Sepolia, testnet)

> **Status: testnet only, unaudited, empty.** This runbook broadcasts the audit-hardened "ETH senior
> tranche" stack to **Base Sepolia (84532)**. Nothing here touches mainnet or real value. Broadcasting
> is a **deliberate operator action** — the deploy scripts default to a dry-run and only send with
> `--broadcast`. Branch: `fix/audit-remediation`. External audit is the gate before any real value.

## What gets deployed

| Script | Deploys | Wires |
|---|---|---|
| `contracts-v4/script/DeployTreasuryV2.s.sol` | `MintwareTreasuryVault` (senior USDC / junior team-token) · `MintwareTreasuryJitHook` · `MintwarePaymentGateway` | mines the JIT hook against the predicted vault address · opens the hooked V4 pool · `vault.setJitHook` / `hook.setJitSkipSender` / `hook.setBaseFeePips` · `vault.setGateway` / `vault.setProtocolTreasury` · optional `EDGE_SIGNER_ROLE` / `RELAYER_ROLE` grants |
| `contracts-v4/script/DeployEthSettlement.s.sol` | `MintwareEthSettlement` (oracle-bounded batch ETH→USDC) + a mock USDC + a `{WETH,USDC}` V4 pool | **`setSettlementRail(...)` (AUDIT H4 — REQUIRED, without it every `batchSettleEth` reverts `RailNotSet`)** · optional `setMaxSettlePerCall(...)` |

## Order of operations

Deploy the **treasury stack first**, then the **settlement contract**. Run the two `forge script`
invocations from the repo root with `export PATH="$HOME/.foundry/bin:$PATH"`.

### 0. Environment (all shells below)

```bash
export PATH="$HOME/.foundry/bin:$PATH"

# Required for BOTH scripts
export DEPLOYER_PRIVATE_KEY=0x<64-hex>          # MUST be 0x-prefixed (foundry vm.envUint)
export BASE_SEPOLIA_RPC_URL="https://base-sepolia-rpc.publicnode.com"
                                                # base_sepolia alias in foundry.toml → this var.
                                                # NOTE: sepolia.base.org is dead; use publicnode.
```

> `DEPLOYER_PRIVATE_KEY` is the deployer = owner = initial relayer for both contracts. Fund it with
> Base Sepolia ETH first. Treasury deploy ≈ 0.00014 ETH, settlement deploy ≈ 0.000035 ETH at 0.011 gwei
> (dry-run estimates).

### 1. Treasury stack (vault + JIT hook + gateway)

```bash
# Required
export V4_POOL_MANAGER=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408   # live Base Sepolia V4 PoolManager
                                                                    # (matches config/treasury.ts)
export USDC_ADDRESS=<usdc-erc20>                 # Base Sepolia USDC (6dp), e.g. 0x036CbD53842c5426634e7929541eC2318f3dCF7e
export TEAM_TOKEN_ADDRESS=<team-token-erc20>     # the junior (team) token; MUST differ from USDC
export ADAPTER_ADDRESS=<IYieldAdapter-over-USDC> # a REAL deployed adapter (AaveV3YieldAdapter or
                                                 # MintwareERC4626YieldAdapter) — deploy it separately first
export CIRCLE_TREASURY=<card-rail-treasury>      # settlement/protocol treasury the gateway pays

# Optional
export GATEWAY_ADMIN=<admin>                     # default: deployer
export EDGE_SIGNER=<edge-auth-signer>            # granted EDGE_SIGNER_ROLE on the gateway if set
export RELAYER=<oracle/relayer submitting settleSpend>  # granted RELAYER_ROLE on the gateway if set
export POOL_FEE=3000                             # hook BASE (floor) fee; default 3000
export TICK_SPACING=60                           # default 60
export INIT_SQRT_PRICE=<sqrtPriceX96>            # default 1:1 @ tick 0 — WRONG for a 6dp/18dp pair;
                                                 # pass the decimal-adjusted price for real tokens

forge script contracts-v4/script/DeployTreasuryV2.s.sol \
  --rpc-url base_sepolia --broadcast -vvvv
```

Record the printed `TreasuryVault`, `JitHook`, `Gateway` addresses.

### 2. ETH settlement contract

```bash
# Optional (defaults shown). SETTLEMENT_RAIL SHOULD point at the real settlement destination —
# the gateway / CPN settlement address — for anything beyond a local soak. If unset it FALLS BACK
# to the deployer's own EOA (safe testnet default; settlement pays back to the operator).
export SETTLEMENT_RAIL=<gateway-or-CPN-settlement-address>   # default: deployer
export SETTLE_MAX_PER_CALL=0                                 # per-call totalUsdc ceiling; 0 = off (default)

forge script contracts-v4/script/DeployEthSettlement.s.sol \
  --rpc-url base_sepolia --broadcast --slow -vvv
```

The script constructs `MintwareEthSettlement` **and** calls `setSettlementRail(SETTLEMENT_RAIL)`
(and `setMaxSettlePerCall` when the cap is non-zero) in the same broadcast, so the contract is
usable — not `RailNotSet` — the moment it lands. Record the printed `Settlement` and mock `USDC`
addresses.

## REQUIRED post-deploy wiring

Standing the contracts up is not enough. These steps are mandatory; several fail **silently on-chain**
(tx mines with status 0 / later reverts) if skipped.

1. **Grant `RELAYER_ROLE` to the ORACLE signer on the gateway** (treasury stack). `settleSpend` is
   submitted by `getOracleSigner('root')`, NOT the deployer. `DeployTreasuryV2.s.sol` grants it only
   when its `RELAYER` env was set to that signer. If it wasn't (or via the factory path), grant it:

   ```bash
   cast send <Gateway> "grantRole(bytes32,address)" \
     $(cast keccak "RELAYER_ROLE") <oracleSigner> \
     --rpc-url base_sepolia --private-key $DEPLOYER_PRIVATE_KEY
   ```

   `requiredGatewayRoleGrants()` (`lib/web3/vault/treasuryProvisioning.ts`) returns the exact grants.
   Without it, settle reverts `AccessControlUnauthorizedAccount`.

2. **Confirm / (re)point the settlement rail** (settlement contract). The deploy already pinned it.
   To migrate the destination later (owner-only):

   ```bash
   cast send <Settlement> "setSettlementRail(address)" <newRail> \
     --rpc-url base_sepolia --private-key $DEPLOYER_PRIVATE_KEY
   ```

   `batchSettleEth(totalUsdc, minUsdcOut, rail)` requires `rail == settlementRail` or it reverts
   `RailMismatch`. Real settlements also require the oracle band to be ready (`requireReadyOracle`
   stays TRUE by default) — wire `setOracleSource(...)` before a live settle, else `OracleNotReady`.

3. **Point edge-auth at THIS vault.** edge-auth authorizes off a SINGLE env-configured vault; the
   `/authorize` request carries no vault address. Set on the edge-auth host:

   ```
   EDGE_VAULT_ADDRESS=<TreasuryVault>
   EDGE_VAULT_KIND=<treasury>
   ```

   One edge-auth instance = one treasury (per-vault NAV is a tracked follow-up).

4. **Adapter binding.** If the yield adapter gates on the vault, call `adapter.setVault(<TreasuryVault>)`.

## Optional hardening / tuning (owner-only)

- **Coverage floor** (`MintwareTreasuryVault`): `setMinCoverage(uint16 bps)` — require the junior
  buffer to stay ≥ `bps` of at-risk senior before risk-increasing ops (deploy/JIT). 0 = off (default).
  Tune per pool tier (thinner junior → higher floor). e.g. `cast send <Vault> "setMinCoverage(uint16)" 2000 ...`
- **Auto-heal pause window** (inherited `MWGuardianPausable`): `setMaxPauseDuration(uint256 seconds_)`
  — default 30 days; 0 disables permissionless auto-heal.
- **Settlement per-call cap** (`MintwareEthSettlement`): `setMaxSettlePerCall(uint256 cap)` — bounds
  how much one settlement can move even to the pinned rail. Also settable at deploy via `SETTLE_MAX_PER_CALL`.
- **Team commit** is not a deployer action: the team calls `vault.commitTeam(...)` to activate the junior side.

## Validation before you broadcast (no funds moved)

Drop `--broadcast` to simulate against the live PoolManager fork — this exercises the full assembly and
the new `setSettlementRail` wiring without sending anything:

```bash
forge script contracts-v4/script/DeployTreasuryV2.s.sol   --rpc-url base_sepolia -vvv    # dry-run
forge script contracts-v4/script/DeployEthSettlement.s.sol --rpc-url base_sepolia -vvv    # dry-run
```

Both must print "Script ran successfully" and "SIMULATION COMPLETE". The settlement dry-run tx list
must include a `setSettlementRail(address)` CALL after the `MintwareEthSettlement` CREATE.
