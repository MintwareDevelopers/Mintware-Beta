# Payments — YPN, Settlement & the Off-chain Services

> **Status (2026-08-18):** the YPN loop is **proven live on Circle's Arc testnet** on branch
> `feat/ypn-vault-convergence` — **testnet + unaudited, NOT on `main`**. Never present as production.
> External audit + a real card issuer (CPN) gate real value. Canonical state: [`../STATE.md`](../STATE.md).

## What YPN is

The **Yield Payment Network** — a vault balance that stays **spendable as USDC** (cards, x402, Arc
settlement) *while it keeps earning*. Spend never un-parks capital: it's a hold against the earning
position → settle (burn shares → USDC to the payee). The "never idle, never locked, always yours" pillar.

- **Tranches:** community capital is **senior** (par, USDC-spendable); team capital is **junior**
  (first-loss). Fuses the matched-liquidity × ULV lineage (see [`vaults.md`](vaults.md)) with a payment
  gateway + a USDC yield adapter.
- Marketing surface: `/yield-payment-network` (zero-opportunity-cost cash narrative).

## On-chain stack (Forge — details in [`smart-contracts.md`](smart-contracts.md))

- `MintwareTreasuryVault` + `MintwareV4LiquidityModule` + standalone `MintwareTreasuryJitHook`
  (borrow-idle → JIT → settle atomically; junior backstops; senior NAV untouched).
- Payment gateway: `settleSpend` / `burnForPayment`.
- `MintwareERC4626YieldAdapter` — **fee-aware** (values NAV via `previewRedeem`, exits via `redeem`) so a
  fee-charging yield source (Arc's XyloVault, 10 bps exit) can't overstate the NAV backing par-spendable USDC.

## Off-chain services (Rust — `services/`)

| Service | Role | Surface |
|---|---|---|
| **edge-auth** (axum) | Sub-150 ms authorization: decide → reserve a hold off cached **NAV** with a VaR haircut → sign. Fail-closed bearer. Two Pre-audit #6 spend-safety gates in the decision core (`portfolio::PortfolioGuard`, both OFF by default): an always-liquid **hot-buffer reserve floor** (`reserve_floor_breached`) + a system-wide **circuit-breaker** (`circuit_breaker_open`), set via `MemStore::set_liquidity_reserve`/`set_breaker`. | `POST /authorize` · `GET /holds/:id` · `GET /available/:user` (read-only live spendable = NAV − holds − cap − liquidity − hot-buffer reserve; 0 while the breaker is open) · `POST /webhooks/rain` |
| **relayer** | Builds + submits `settleSpend` and the CCTP bridge orchestration. **A signing/submission library — no HTTP server yet** (a live `settle` endpoint = a separate server + funded key, deploy-gated). | `settle.rs` · `cctp.rs` · `batch.rs` · `submit.rs` |

Tests: `cd services/edge-auth && cargo test` (86) · `cd services/relayer && cargo test` (23); both
`cargo clippy -D warnings` clean.

## The Arc loop (proven on testnet, on-chain)

`deploy → deposit → earn → CCTP Base→Arc → card settle in USDC → edge authorizes ~10 ms off live Arc NAV.`
Topology: v4-ETH **earn** on Base ↔ **CCTP** ↔ USDC **spend** on Arc (Circle's USDC-native L1, chain
`5042002`, USDC is the gas token). Contracts are chain-agnostic (EIP-712 reads `block.chainid`).
Runbook: [`../../docs/developers/session-handoff-arc.md`](../../docs/developers/session-handoff-arc.md) ·
integration: [`../../docs/developers/arc-settlement-integration.md`](../../docs/developers/arc-settlement-integration.md).

## Where it connects

- **Agent-facing x402** (park/pay actions, facilitator, discovery) → [`agents.md`](agents.md).
- **Env + testnet deploys** (edge/relayer/Arc/x402 vars) → [`deployments.md`](deployments.md).
- **Vaults / ULV / pool tiering** → [`vaults.md`](vaults.md).

## Deploy-gated remainder (not code)

Relayer settle HTTP server + funded key · CPN card issuer (the genuine Circle-relationship piece) ·
Arc mainnet (Sept 16, 2026) · external audit of the converged stack.
