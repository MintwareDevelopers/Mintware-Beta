#!/usr/bin/env bash
# cctp-bridge-smoke.sh — smoke the CCTP Base->Arc "bridge-and-deposit" DESTINATION leg.
#
# CCTP is async + cross-chain, so it can't be one atomic script. This covers the half Mintware owns:
# given a Base-Sepolia USDC burn tx (mintRecipient = the Arc CCTP router), it (1) polls Circle's iris
# attestation service until the message is attested, then (2) submits
# MintwareCctpDepositRouter.receiveAndDeposit(message, attestation, recipient) on Arc via `cast send`
# (forge sim breaks on Arc's system-contract USDC), and (3) asserts the recipient's vault shares rose.
#
# The SOURCE burn (Base `TokenMessenger.depositForBurn`, mintRecipient = the Arc router) is Circle's
# standard CCTP tooling — use your existing burn flow / Circle's TokenMessenger per the CCTP docs; this
# script deliberately does NOT hardcode a burn address. Domains: Base Sepolia = 6, Arc = 26.
#
# Usage:
#   BURN_TX=0x<base burn tx> RECIPIENT=0x<who gets the shares> \
#     ARC_RPC_URL=https://rpc.testnet.arc.io \
#     ARC_CCTP_ROUTER=0xDB9DB7008cfFb09bD1D943C237f57327383DFc03 \
#     ARC_VAULT=0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421 \
#     DEPLOYER_PRIVATE_KEY=0x... \
#     ./scripts/cctp-bridge-smoke.sh
set -euo pipefail

: "${BURN_TX:?set BURN_TX to the Base-Sepolia burn tx hash}"
: "${RECIPIENT:?set RECIPIENT (address to credit the bridged shares)}"
: "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY (the relayer key — receiveAndDeposit is onlyRelayer)}"
ARC_RPC_URL="${ARC_RPC_URL:-https://rpc.testnet.arc.io}"
ARC_CCTP_ROUTER="${ARC_CCTP_ROUTER:-0xDB9DB7008cfFb09bD1D943C237f57327383DFc03}"
ARC_VAULT="${ARC_VAULT:-0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421}"
IRIS_BASE="${IRIS_BASE:-https://iris-api-sandbox.circle.com}"   # production: https://iris-api.circle.com
SRC_DOMAIN="${SRC_DOMAIN:-6}"                                    # Base Sepolia CCTP domain
command -v cast >/dev/null || { echo "cast (foundry) not found on PATH"; exit 1; }

echo "== 1. poll iris for the attestation (burn tx $BURN_TX, domain $SRC_DOMAIN) =="
MSG=""; ATT=""
POLL_MAX="${POLL_MAX:-60}"   # attempts × 15s. Base-Sepolia STANDARD finality (threshold 2000) can exceed 15 min.
for i in $(seq 1 "$POLL_MAX"); do
  RESP="$(curl -fsS "$IRIS_BASE/v2/messages/$SRC_DOMAIN?transactionHash=$BURN_TX" || true)"
  STATUS="$(echo "$RESP" | jq -r '.messages[0].status // "pending"' 2>/dev/null || echo pending)"
  if [ "$STATUS" = "complete" ]; then
    MSG="$(echo "$RESP" | jq -r '.messages[0].message')"
    ATT="$(echo "$RESP" | jq -r '.messages[0].attestation')"
    echo "   attested."
    break
  fi
  echo "   status=$STATUS (attempt $i/$POLL_MAX) — waiting 15s"; sleep 15
done
[ -n "$MSG" ] && [ "$MSG" != "null" ] || { echo "attestation not ready after the poll window — re-run later"; exit 2; }

echo "== 2. record recipient vault shares BEFORE =="
# The YPN yield vault tracks shares via `shares(address)` (not ERC20 balanceOf). Strip cast's `[1e6]` note.
BEFORE="$(cast call "$ARC_VAULT" "shares(address)(uint256)" "$RECIPIENT" --rpc-url "$ARC_RPC_URL" | awk '{print $1}')"
echo "   before: $BEFORE"

echo "== 3. submit receiveAndDeposit on Arc (onlyRelayer) =="
cast send "$ARC_CCTP_ROUTER" "receiveAndDeposit(bytes,bytes,address)" "$MSG" "$ATT" "$RECIPIENT" \
  --rpc-url "$ARC_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"

echo "== 4. assert recipient vault shares INCREASED (bridged dollar landed as yield-earning shares) =="
AFTER="$(cast call "$ARC_VAULT" "shares(address)(uint256)" "$RECIPIENT" --rpc-url "$ARC_RPC_URL" | awk '{print $1}')"
echo "   after: $AFTER"
if [ "$AFTER" -gt "$BEFORE" ] 2>/dev/null; then
  echo "PASS: CCTP bridge-and-deposit credited the recipient ($BEFORE -> $AFTER)."
else
  echo "FAIL: recipient shares did not increase (before=$BEFORE after=$AFTER)."; exit 3
fi
