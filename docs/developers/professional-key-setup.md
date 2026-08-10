# Professional key setup — roles, Privy oracle signer, hardware-key ownership

Goal: stop using one hot EOA (whose key leaked) for everything. Separate signing into
**role-scoped wallets**, move the automated oracle signer into **Privy server wallets** (no raw key in
env), and make a **hardware-key EOA** the contract owner for now (migrate to a Safe multisig later).

The code already supports this — flip env vars, no redeploy of the app logic. The on-chain rotation
uses the existing 48-hour timelock, so nothing is instant or irreversible-by-accident.

---

## 1. Role map

| Role | Signs / controls | Wallet | Automated? |
|---|---|---|---|
| **Owner / admin** | Every contract's `owner` — `setOracleSigner`, `pause`/`unpause`, `deactivateVault`, `configurePool`, param changes | **Hardware-key EOA now** (Ledger/Trezor) → Gnosis Safe later | No (human) |
| **Guardian** | Fast-pause only (kill-switch) | Small EOA / monitoring bot | Semi |
| **Deployer** | Runs the deploy scripts, then hands `owner` to the hardware key | Hardware key or a throwaway funded key | Per-deploy |
| **Oracle signer** (root/weight/range/agent) | EIP-712 epoch roots, snapshots, rebalance proposals, agent attestations | **Privy server wallet** (key in Privy's enclave) | **Yes — via Privy API** |
| **Treasury** | Receives fees | Separate Safe/EOA — **never** the oracle key | No |

The four oracle sub-roles (`root`, `weight`, `range`, `agent`) are already separated in
`lib/web3/oracleKeys.ts` (audit C2). Give each its **own** Privy wallet so one compromise can't forge
across families.

---

## 2. Oracle signer → Privy server wallets (retires the exposed key)

The app signs through `getOracleSigner(role)` (`lib/web3/oracleSigner.ts`). It returns a viem
`LocalAccount` from one of two providers, chosen by `ORACLE_SIGNER_PROVIDER`:

- `env-key` (default) — raw key from env (current behavior; the leaked key).
- `privy` — a **Privy server wallet**; Privy holds the key and signs via API. No raw key in env.

### 2.1 Provision the Privy server wallets
In the Privy dashboard (or via `@privy-io/server-auth` — already added as a dependency), create **one
server wallet per role** and note each wallet's **id** and **address**. (Server wallets require your
`PRIVY_APP_SECRET`; the client SDKs you already run — `@privy-io/react-auth`/`wagmi` — are unrelated.)

### 2.2 Set the env (Vercel, Server-only / All Envs)
```
ORACLE_SIGNER_PROVIDER=privy
PRIVY_APP_ID=<your app id>
PRIVY_APP_SECRET=<your app secret>          # server-only, never NEXT_PUBLIC_

# one wallet per role:
ROOT_ORACLE_PRIVY_WALLET_ID=<id>     ROOT_ORACLE_PRIVY_ADDRESS=0x...
WEIGHT_ORACLE_PRIVY_WALLET_ID=<id>   WEIGHT_ORACLE_PRIVY_ADDRESS=0x...
RANGE_ORACLE_PRIVY_WALLET_ID=<id>    RANGE_ORACLE_PRIVY_ADDRESS=0x...
AGENT_ORACLE_PRIVY_WALLET_ID=<id>    AGENT_ORACLE_PRIVY_ADDRESS=0x...
```
Leaving `ORACLE_SIGNER_PROVIDER` unset (or `env-key`) keeps the old behavior — this is safe to stage.

### 2.3 Rotate the ON-CHAIN signer to the Privy address (48h timelock)
The contracts recover the signer from the signature, so the on-chain `oracleSigner` must equal the
Privy wallet's address. Rotate it (do NOT just swap the env):
1. As **owner**: `proposeOracleSigner(<ROOT_ORACLE_PRIVY_ADDRESS>)` on `MintwareWeightedDistributor`
   (and `MintwareDistributor` v2, `MintwareAttributionToken` as applicable).
2. Wait **48 hours** (`ORACLE_ROTATION_DELAY`).
3. As **owner**: `confirmOracleSigner()`.
4. Flip `ORACLE_SIGNER_PROVIDER=privy` and redeploy the app. Verify a test epoch close signs + verifies.
5. **Rotate/burn the old `DISTRIBUTOR_PRIVATE_KEY` / `ORACLE_PRIVATE_KEY`** — assume they're compromised.

> Test the whole flow on **Base Sepolia** first (a throwaway Privy wallet + the testnet distributor).

---

## 3. Ownership → hardware-key EOA now (Safe later)

Interim: a Ledger/Trezor EOA is the `owner` of every contract. Two ways to get there:

- **Deploy from the hardware key** — broadcast the deploy scripts signed by the Ledger; the scripts pass
  the broadcaster as `initialOwner`, so it ends up owning everything. Simplest.
- **Deploy from a funded deployer, then `transferOwnership(<hardwareKey>)`** at the end — needed if the
  deployer must do owner-only wiring first (`setVault`, `setExpectedHook`, `setWeightedDistributor`,
  registry `registerVault`). Add a final `transferOwnership` per Ownable contract in the deploy run.

Keep the hardware key **off** any server. It signs owner actions manually (via Frame/rabby/etherscan
write-as-owner). Admin actions are rare and high-value — that's the point.

**Migrate to a Gnosis Safe later:** create a 2-of-3 / 3-of-5 Safe, then `transferOwnership(<Safe>)` on
each contract. No code change — Ownable doesn't care whether the owner is an EOA or a Safe.

---

## 4. What Claude can / can't do here

- ✅ Wired the code: `getOracleSigner` (env-key + Privy), migrated all four signing sites, added the SDK.
  Can also add the `transferOwnership` step to the deploy scripts and drive the **Base Sepolia** dry-run.
- ❌ Won't hold keys, create the Privy wallets/app-secret, run **mainnet** deploys/rotations, or move
  value. Those stay with your secret manager + hardware key + owner approval — which is exactly the
  security property this setup buys you.

---

## Checklist
- [ ] Create per-role Privy server wallets; record ids + addresses.
- [ ] Set `ORACLE_SIGNER_PROVIDER=privy` + `PRIVY_APP_ID/SECRET` + per-role wallet env (server-only).
- [ ] `proposeOracleSigner(privyAddr)` → wait 48h → `confirmOracleSigner()` per distributor.
- [ ] Verify a testnet epoch close signs + verifies under Privy.
- [ ] Rotate/burn the old `DISTRIBUTOR_PRIVATE_KEY` / `ORACLE_PRIVATE_KEY`.
- [ ] Set the hardware-key EOA as `owner` (deploy-from or `transferOwnership`).
- [ ] Later: stand up a Safe and `transferOwnership` to it.
