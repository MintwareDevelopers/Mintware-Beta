# Arc Settlement Integration — YPN on Circle's Arc

> **Status: foundation SHIPPED (2026-08-16); Arc-native deploy + Circle-rail integrations gated on Arc
> testnet access.** This is the canonical map for putting YPN's spend side on Arc. The earn side (Uniswap-v4
> ETH pools) stays on Base; Arc is the USDC settlement + card layer; CCTP bridges them.

## The topology — one clean separation

```
     BASE / mainnet  (Uniswap v4)                       ARC  (Circle rails)
  ┌───────────────────────────────┐                ┌──────────────────────────────┐
  │ EARN side                     │                │ SPEND side                   │
  │  · ETH-collateral + pair vaults│                │  · MintwareYieldVault (USDC) │
  │  · v4 JIT hook + MEV capture   │── CCTP (USDC) ─▶│  · MintwarePaymentGateway    │
  │  · batchSettleEth (ETH→USDC)   │                │    settleSpend → burnForPayment│
  │  · Aave idle buffer            │                │  · USDC gas (Paymaster)      │
  │  "where USDC earns"            │◀── CCTP ───────│  · card off-ramp → CPN        │
  └───────────────────────────────┘                └──────────────────────────────┘
```

**Why the split:** the earn side needs Uniswap v4 + deep ETH liquidity, which live on Base. The spend side
is USDC-only (no pool) and belongs where USDC is the gas token and settlement is sub-second — Arc. CCTP
(native burn-mint) is the connective tissue, no wrapped-asset risk.

## Per-contract mapping — stays on Base vs. moves to Arc

| Contract | Home | Why |
|---|---|---|
| `MintwareDeFiPairVault`, JIT hook, MEV engine | **Base** | Need a v4 PoolManager + ETH depth |
| `MintwareEthSettlement` (`batchSettleEth`) | **Base** | It IS a v4 swap (ETH→USDC) |
| `AaveV3YieldAdapter` | **Base** | Aave's Base deployment |
| `MintwareYieldVault` (single-asset USDC) | **Arc** ✅ portable | No pool — pure USDC |
| `MintwarePaymentGateway` (`settleSpend`) | **Arc** ✅ portable | No pool — verifies permit + edge sig, pays USDC |
| **`MintwareERC4626YieldAdapter`** (this work) | **Arc** ✅ built | Arc's yield primitive slots in as the 4626 source |
| `services/edge-auth`, `services/relayer` | chain-agnostic | Point `EDGE_CHAIN_ID` / RPC at Arc |

Nothing is rewritten: the contracts are chain-agnostic (EIP-712 domain reads `block.chainid`), and yield is
a pluggable `IYieldAdapter` — Base uses the Aave adapter, Arc uses the 4626 adapter, same interface.

## What's SHIPPED now (this work, testable today)

- **`MintwareERC4626YieldAdapter`** (`contracts-v4/src/vaults/`) — the Arc yield seam. Wraps ANY ERC-4626
  source (Arc's native USDC-yield primitive, or a Circle reserve/T-bill product) behind the exact
  `IYieldAdapter` the vault already idles into. Mirrors the Aave adapter's safety: `onlyVault`, one-time
  `setVault`, **best-effort never-reverting withdraw**, per-block drain cap, constructor asset-match guard.
  **9 Forge tests green** (supply/withdraw round-trip · yield accrual · stalled-source best-effort · per-block
  cap · access + wiring guards).
- **`DeployArcSpendStack.s.sol`** — deploys the whole spend stack (USDC → 4626 source → adapter → vault →
  Gateway, fully wired). Parameterized: real Arc `ARC_USDC` / `ARC_YIELD_SOURCE` / `ARC_CPN_TREASURY` if set,
  else mocks. **Dry-runs clean today**; broadcasts to Arc the moment there's an RPC.
- **`MintwareCctpDepositRouter`** (`contracts-v4/src/payments/`) — Arc-side **bridge-and-deposit**: completes
  a Circle CCTP transfer (USDC burned on Base) via `MessageTransmitter.receiveMessage` and, in the same tx,
  deposits the minted USDC into the vault crediting the user. Relayer-gated (safe recipient binding — see the
  contract NatSpec; a permissionless CCTP-v2-hookData variant can follow). Balance-diff accounting. **6 Forge
  tests green** against the REAL spend stack (router → vault → 4626 adapter → yield source).
- **`config/arc.ts`** — the Arc settlement config home: chain id `5042002`, env-driven addresses (incl. CCTP),
  `CCTP_DOMAIN`, `isArcConfigured()` fail-safe gate, and the `EDGE_CHAIN_ID=5042002` wiring note.

## Gas in USDC on Arc — already native (no paymaster code needed)

On Arc, **USDC is the gas token**, so the relayer's existing EIP-1559 submit path pays gas in USDC *natively*
— no Circle Paymaster integration is required for settlement on Arc. The only thing to confirm with Circle is
Arc's **fee model**: if Arc is EIP-1559-compatible, `services/relayer/src/submit.rs` works unchanged; if Arc
uses a non-1559 fee mechanism, the relayer needs a tx-type tweak. (Circle Paymaster / ERC-4337 is a separate,
user-facing *gasless-UX-on-non-Arc-chains* concern — not on the Arc settlement critical path.)

## Arc-native pieces still to build (each needs Circle input)

| Piece | What it does | Needs from Circle |
|---|---|---|
| **Broadcast the spend stack to Arc** | Run `DeployArcSpendStack` + deploy the CCTP router on Arc | Arc testnet RPC + faucet |
| **Wire the real yield source** | Set `ARC_YIELD_SOURCE` to Arc's 4626 | Which primitive (or a Circle reserve product) |
| **CCTP wiring** | Set `ARC_CCTP_MESSAGE_TRANSMITTER` + `ARC_CCTP_DOMAIN`; the router is built | CCTP addresses + Arc domain id |
| **Confirm the relayer fee model** | Verify EIP-1559 on Arc (else a small tx-type tweak) | Arc fee-model docs |
| **CPN card off-ramp** | `cpnTreasury` settles into the Visa/MC rails | CPN access + issuing relationship |

## Deploy sequence (when Arc testnet is up)

1. Set `ARC_RPC_URL`, `ARC_USDC`, `ARC_YIELD_SOURCE`, `ARC_CPN_TREASURY`.
2. `forge script DeployArcSpendStack.s.sol --rpc-url arc --broadcast --slow` → gateway + vault addresses.
3. Grant `RELAYER_ROLE` + `EDGE_SIGNER_ROLE` on the Gateway to the operational keys.
4. Point the edge at Arc: `EDGE_CHAIN_ID=5042002`, `EDGE_GATEWAY_ADDRESS`, `EDGE_VAULT_ADDRESS`; relayer RPC → Arc.
5. Add the CCTP deposit adapter + (optionally) Paymaster sponsorship.
6. Smoke: deposit USDC → confirm yield accrues → authorize via edge → `settleSpend` via relayer → USDC to CPN.

## Open questions for Circle

- [ ] Arc's native USDC-yield primitive — is it a 4626, or do we wrap a Circle reserve/T-bill product?
- [ ] CCTP contract addresses + finality on Arc for the deposit path.
- [ ] Paymaster: sponsored (relayer pays) vs. user-pays-in-USDC — and the Arc Paymaster interface.
- [ ] CPN: settlement interface for the card off-ramp + the issuing relationship (Rain vs. a Circle-blessed issuer).
- [ ] Is Uniswap v4 (or equivalent depth) on Arc? If yes, some USDC-pair earn could also run on Arc; ETH depth still favors Base.

## Related
`config/arc.ts` · `contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol` ·
`contracts-v4/script/DeployArcSpendStack.s.sol` · `docs/developers/eth-settlement-swap-spec.md` (the Base
earn-side settlement swap that feeds USDC into this) · `docs/developers/ypn-v1-foundation-spec.md` (the
chain-agnostic settlement foundation) · `docs/product/framing-and-messaging.md` (the settlement stack).
