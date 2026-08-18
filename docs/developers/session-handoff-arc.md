# Session Handoff — Multi-Collateral + YPN LIVE on Arc

> **Read this first if you're resuming.** Branch: `feat/ypn-vault-convergence`. This session took YPN from
> "spec + Base testnet" to a **full USDC card-payment loop running live on Circle's Arc**, plus the
> multi-collateral ETH settlement path, a v3→v4 migration router, a hard-gate foundation, and a pre-audit
> security pass. Everything is committed + pushed. Nothing here is on `main` yet.

## TL;DR — what landed

1. **Multi-collateral ETH settlement** — complete + live on Base Sepolia (ETH vault + `MintwareEthSettlement`
   swap + relayer batch path + edge idle-buffer wire).
2. **v3→v4 migration router** — one-tx migrate a dormant Uniswap-v3 LP into the v4 pair vault (+ additive
   `depositFor`).
3. **User/Team Phase-2 hard-gate foundation** — RBAC + gate logic + middleware + server verify, flag-gated.
4. **Pre-audit security pass** — 2 MEDIUMs found + fixed (lock-griefing, unbounded settlement swap).
5. **⭐ YPN spend stack LIVE on Arc testnet** — deploy → deposit→earn → **CCTP Base→Arc** → **card settle in
   USDC**, all proven on-chain; edge-auth **service** authorizing off the live Arc NAV in ~10ms; `/app/arc`
   surface; real yield primitive identified (XyloVault).

## Live deployments

### Base Sepolia (chain 84532) — the "earn / collateral" side
| Contract | Address |
|---|---|
| ETH-collateral vault | `0x09Cda8519737a60FD16D263f94fb56237CDb7E42` |
| MintwareEthSettlement | `0x20140811123db9C00CA1dF1023BA4fE758B98c5F` |
| Chainlink ETH/USD feed | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` |
| USDC Gateway (settleSpend) | `0x26ce3baff473b24e8afe932dfb6d68adca8048b0` |

### Arc testnet (chain 5042002) — the "spend / settlement" side
| Contract | Address |
|---|---|
| Vault (`MintwareYieldVault`) | `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421` |
| Payment Gateway | `0x1D075cB38f5c126D9c23f1f91faC0A9C8d135399` |
| Yield adapter (ERC-4626) | `0xb9FB965Caa7197932b52631e0121Ea54586e2B88` |
| CCTP deposit router | `0xDB9DB7008cfFb09bD1D943C237f57327383DFc03` |
| Yield source (mock 4626, placeholder) | `0x4Deb74E9D50Ebbf9bD883E0A2dcD0a1b4b9Db9BE` |
| USDC (real Arc) | `0x3600000000000000000000000000000000000000` |
| CCTP MessageTransmitter (real) | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

Deployer/relayer/edge-signer (demo): `0x9c646C48a302f4725450669f1218d3FDb3e933AD`.
RPC `https://rpc.testnet.arc.io` · faucet `https://faucet.circle.com` · explorer `https://testnet.arcscan.app`.

## On-chain proofs (Arc)

- **Deploy** — full spend stack via `DeployArcSpendStack.s.sol` (auto-uses real Arc USDC + CCTP).
- **Deposit→earn** — 5 USDC deposited, idled into the adapter; shares minted.
- **CCTP Base→Arc** — burned 1 USDC on Base → Circle attested → relayer `receiveAndDeposit` on Arc
  (tx `0x3e7734cf…da853`) → vault shares 2→3 USDC. The bridged dollar arrived as yield-earning shares.
- **Card settle in USDC** — EIP-712 permit → `settleSpend` (tx `0x41e12fce…1a64c8de`) → shares burned,
  merchant paid 2 USDC, `PaymentSettled`.
- **Live service** — edge-auth authorized `$2` in **~10ms** off the live Arc NAV, declined `$300`
  (`insufficient_equity`).

## Where the code lives (this session)

| Area | Files |
|---|---|
| ETH settlement swap | `contracts-v4/src/payments/MintwareEthSettlement.sol` (+ `.t.sol`) |
| Migration router | `contracts-v4/src/vaults/Mintwarev3ToV4Migrator.sol`, `MintwareDeFiPairVault.depositFor` |
| Arc yield adapter | `contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol` (+ `.t.sol`) |
| CCTP router (on-chain) | `contracts-v4/src/payments/MintwareCctpDepositRouter.sol` (+ `.t.sol`) |
| Arc deploy | `contracts-v4/script/DeployArcSpendStack.s.sol`, `DeployEthCollateralVault.s.sol`, `DeployEthSettlement.s.sol` |
| Arc settle scripts | `contracts-v4/script/LiveSettleArc.s.sol`, `LiveSettleArcHighValue.s.sol` |
| Relayer (Rust) | `services/relayer/src/{batch,cctp,settle,submit}.rs` |
| Edge-auth (Rust) | `services/edge-auth/src/{nav,ledger,portfolio,haircut,chain,...}.rs` |
| Hard gate | `lib/auth/{rbac,gate,session,cookies}.ts`, `middleware.ts`, `app/api/team/session/route.ts` |
| Arc surface | `app/app/arc/page.tsx` |
| Config | `config/arc.ts`, `services/*/.env.arc.example`, `foundry.toml` (`arc` endpoint) |
| Docs | `docs/developers/arc-settlement-integration.md`, `arc-e2e-demo.md`, `eth-settlement-swap-spec.md`, `v3-to-v4-migration-spec.md` |
| Artifacts | Status page + [YPN × Circle Arc pitch brief](https://claude.ai/code/artifact/ca86ffd2-3bf4-4cab-91bf-1bbc6bd98e1f) |

## Test state (last known green)

- **Forge** — full suite 443 passed / 0 failed / 4 skipped (gated live tests self-skip). New: settlement 9,
  migrator 7, adapter 9, CCTP router 6.
- **edge-auth (Rust)** — 80 passed, clippy `-D warnings` clean.
- **relayer (Rust)** — 23 passed (incl. cctp), clippy clean.
- **Vitest** — auth suite 20 passed; hard-gate typecheck clean.

## Gotchas learned (don't re-learn these)

- **Arc: USDC IS the gas token** — native gas balance == the ERC-20 USDC at `0x3600…0000` (unified).
- **Arc: forge sim breaks on the system-contract USDC** — `forge script --broadcast` throws a spurious
  `StackUnderflow` in the local EVM; the real node is fine. **Settle/state-changes via `cast send`.** Deploys
  are fine with forge.
- **CCTP v2: unified addresses across chains** (Base TokenMessenger == Arc's); the public TokenMessenger is
  **shared** — find your burn by tx hash, not by scanning logs. Standard finality (`maxFee=0`, threshold
  2000) attests in ~15 min; fast (threshold 1000) needs `maxFee>0` and has a per-window allowance.
- **Base Sepolia RPC** (`sepolia.base.org`) had a **stale mempool view** → "replacement underpriced";
  use `https://base-sepolia-rpc.publicnode.com`.
- **RTK proxy** compresses `curl` JSON output into schemas — capture raw with `curl -o file` + the Read tool.

## What's left (business / audit track only)

1. **Wire XyloVault** for real Arc yield — address **confirmed** `0x240Eb85458CD41361bd8C3773253a1D78054f747`
   (XyloNet XyloVault, `asset()`=Arc USDC, `symbol()`=`xyUSDC`, `totalAssets()`≈8.27M USDC, funded). **⚠ The
   live smoke test (2026-08-18, deposit→redeem round-trip on-chain) found it is NOT a clean drop-in** — it's a
   non-standard 4626:
   - `withdrawFee()` = **10 bps** (0.10% on exit) + `performanceFee()` = **10%** (on yield).
   - `convertToAssets()` and `maxWithdraw()` **do not net the withdraw fee → they over-report** realizable NAV;
     `previewRedeem()`/`previewWithdraw()` do net it. Because `maxWithdraw` over-reports, **`withdraw(assets)`
     reverts (`INSUFFICIENT_BALANCE`)** near full balance — `redeem(shares)` is the only working exit.
   - Proof: deposited 1 USDC → 999998 shares; `withdraw(999999)` (=`maxWithdraw`) reverted; `redeem(999998)`
     returned ~999000 USDC (the 10 bps haircut). Position fully recovered.

   **So the redeploy is gated on a fee-aware adapter change** in `MintwareERC4626YieldAdapter`: (1) value
   `totalAssets()` via `previewRedeem(balanceOf)` (fee-net, conservative — and identical to `convertToAssets`
   for fee-free vaults, so it's a safe general improvement); (2) exit via `redeem(shares)` instead of
   `withdraw(assets)`. An overstated NAV backing *par-spendable* settlement USDC is a solvency risk, so this is
   a real gate, not cosmetic. Once the adapter is fee-aware, it IS a one-line redeploy (deploy script already
   reads the env, falling back to the mock):
   ```bash
   ARC_YIELD_SOURCE=0x240Eb85458CD41361bd8C3773253a1D78054f747 \
     forge script contracts-v4/script/DeployArcSpendStack.s.sol --rpc-url arc --broadcast --slow
   ```
   Then repoint `config/arc.ts` (`ARC_TESTNET_DEPLOYMENT`) + the `NEXT_PUBLIC_ARC_*` envs. Until the adapter
   lands, keep the mock 4626. (Decimals were never the issue — the adapter is asset-denominated; the fee is.)
2. **CPN card off-ramp + issuer** — the one genuine Circle-relationship piece.
3. **External audit** — the gate before real value (converged vault + settlement + MEV stack).
4. **Arc mainnet** — public launch **Sept 16, 2026**.
5. **Hard gate Phase-2 finish** — org UI, `[orgSlug]` routing, Privy dashboard org setup.

## How to resume

```bash
git checkout feat/ypn-vault-convergence
export PATH="$HOME/.foundry/bin:$PATH"
forge test                                   # contracts
(cd services/edge-auth && cargo test)        # edge
(cd services/relayer && cargo test)          # relayer
```
Run the Arc demo end-to-end: `docs/developers/arc-e2e-demo.md`. Point the services at Arc:
`services/{edge-auth,relayer}/.env.arc.example`. The pitch is ready to send.
