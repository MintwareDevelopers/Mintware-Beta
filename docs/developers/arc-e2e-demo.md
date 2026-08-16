# YPN on Arc — End-to-End Demo Runbook

The full "earn on Base, spend on Arc" loop, on **live Arc testnet** contracts + real Arc USDC. This is the
sequence that produced the on-chain proofs; run it top-to-bottom for the pitch demo.

> **Arc caveat (important):** forge's local EVM mis-simulates Arc's system-contract USDC (`0x3600…0000`) and
> throws a spurious `StackUnderflow` on `forge script --broadcast` pre-sim, though the real Arc node executes
> correctly. **Broadcast state-changing txs with `cast send`** (real-node gas estimation). Deploys work with
> `forge script --broadcast`; deposits/settles use `cast send`.

## Live Arc testnet stack (chain 5042002)

| Contract | Address |
|---|---|
| Vault (`MintwareYieldVault`) | `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421` |
| Gateway (`MintwarePaymentGateway`) | `0x1D075cB38f5c126D9c23f1f91faC0A9C8d135399` |
| Yield adapter (`MintwareERC4626YieldAdapter`) | `0xb9FB965Caa7197932b52631e0121Ea54586e2B88` |
| CCTP router (`MintwareCctpDepositRouter`) | `0xDB9DB7008cfFb09bD1D943C237f57327383DFc03` |
| USDC (real Arc) | `0x3600000000000000000000000000000000000000` |
| CCTP MessageTransmitter (real) | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

RPC `https://rpc.testnet.arc.io` · faucet `https://faucet.circle.com` · explorer `https://testnet.arcscan.app`.

## 0. Fund + deploy (one-time)

```bash
# Fund the deployer with Arc USDC (gas + capital) via faucet.circle.com (USDC / Arc Testnet).
forge script contracts-v4/script/DeployArcSpendStack.s.sol --rpc-url arc --broadcast --slow
# auto-uses the real Arc USDC + CCTP MessageTransmitter; prints the vault/gateway/adapter/router addresses.
```

## 1. Deposit → earn

USDC deposited into the vault idles into the yield source (earning) while staying spendable.

```bash
R=https://rpc.testnet.arc.io; V=0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421; U=0x3600000000000000000000000000000000000000
cast send $U "approve(address,uint256)" $V 5000000 --rpc-url $R --private-key $KEY
cast send $V "deposit(uint256,address)" 5000000 $YOU --rpc-url $R --private-key $KEY
cast call $V "shares(address)(uint256)" $YOU --rpc-url $R          # shares minted
cast call $V "totalAssets()(uint256)" --rpc-url $R                 # earning in the adapter
```

## 2. Deposit cross-chain via CCTP (Base → Arc)

Burn USDC on Base, and it lands as Arc vault shares — driven by `services/relayer::cctp`.

```bash
# (a) Burn on Base Sepolia, mintRecipient = the Arc CCTP router, destinationDomain = 26 (Arc).
TM=0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA; BUSDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e
ROUTER32=0x000000000000000000000000db9db7008cffb09bd1d943c237f57327383dfc03
cast send $BUSDC "approve(address,uint256)" $TM 1000000 --rpc-url base_sepolia --private-key $KEY
cast send $TM "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)" \
  1000000 26 $ROUTER32 $BUSDC $ROUTER32 0 2000 --rpc-url base_sepolia --private-key $KEY   # standard finality
# (b) Poll Circle's attestation (iris) for the burn tx, then (c) on Arc the relayer calls
#     MintwareCctpDepositRouter.receiveAndDeposit(message, attestation, recipient) — see services/relayer::cctp
#     (IrisClient.fetch + submit_receive). Result: recipient gets Arc vault shares from the bridged USDC.
```

Note: if the source RPC's mempool view is stale you may see "replacement transaction underpriced" — retry via
an alternate Base Sepolia RPC (e.g. `https://base-sepolia-rpc.publicnode.com`). Circle attests after source
finality (fast ~1-2 min with `maxFee>0` + threshold 1000; standard ~15 min with `maxFee=0` + threshold 2000).

## 3. Spend — a card charge settles in USDC on Arc

Sub-$250 (permit-only) — see `contracts-v4/script/LiveSettleArc.s.sol` for the EIP-712 permit build; settle
with `cast send`:

```bash
# domainSeparator + DelegatedSpendPermit signed by the user → gateway.settleSpend(...) as RELAYER.
# Result: user's yield-earning shares burned, USDC paid to the card rail (CPN treasury), PaymentSettled.
```

>= $250 (two-signer) — `contracts-v4/script/LiveSettleArcHighValue.s.sol` adds the EDGE_SIGNER
`ShortLivedHoldAuth`. Proven in `MintwareGatewayTreasuryV2.t.sol`; a live >= $250 run needs >= $250 of vault
shares (faucet caps at 20 USDC / 2h).

## What each step proves for the Circle pitch

1. **USDC never idle** — deposits earn in the yield source until the moment of settlement.
2. **CCTP composability** — USDC on any chain becomes productive Arc balance in one relayer tx.
3. **Card settlement on Arc** — a real charge settles in USDC on Circle's chain, gas paid in USDC natively.

## Config to run the SERVICES (not by hand)

Point the running edge-auth + relayer at Arc with `services/edge-auth/.env.arc.example` +
`services/relayer/.env.arc.example` (`EDGE_CHAIN_ID=5042002` makes the edge signer's EIP-712 domain
Arc-correct; the relayer RPC → Arc). Then the service pipeline does authorize→settle and the CCTP
orchestration end-to-end.
