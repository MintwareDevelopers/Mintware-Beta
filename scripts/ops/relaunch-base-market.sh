#!/usr/bin/env bash
# Relaunch the Base Sepolia USDC/WETH MarketEngine so it can be listed as a Live market.
#
# Why: the current engine (0x18c2…c384) reverts `StaleMark()` — its FreshTestMark's timestamp is frozen at
# deploy and the engine's max mark age is short; both are immutable, so it can never be valued again. The fix
# is a new engine on the SAME, already-seeded pool (fee 2500 / spacing 50, poolId 0x033f9c6a…2937) with a new
# fixed test mark at that pool's own price and a one-year max mark age — the same shape as the Robinhood
# testnet engine that has stayed live. A live Chainlink mark is deliberately NOT used: nobody arbitrages a
# testnet pool, so spot would drift from a moving mark and the engine would refuse deposits.
#
# Steps (run in order; each prints the address the next one needs):
#   1. mark      deploy FreshTestMark at the pool's price                 -> export MARKET_NONQUOTE_MARK=<addr>
#   2. engine    deploy MintwareMarketEngine + idle adapters (inactive)   -> export MARKET_ENGINE=<addr>
#   3. activate  owner activates the engine (checks spot ≈ mark, adapters readable)
#   4. verify    read back the deployment against this config (no transaction)
#   all          1–4 in one go (owner = the deployer unless MARKET_OWNER is set)
# Then, outside this script:
#   5. Vercel env (Production + Preview), then redeploy:
#        MARKET_ENGINE_CODEHASHES_84532 = <printed by step 4>
#        MARKET_ENGINE_OWNER_84532      = <MARKET_OWNER>
#        MARKET_ENGINE_QUOTE_ASSET_84532= 0x036CbD53842c5426634e7929541eC2318f3dCF7e
#   6. /curate → "Register a market directly": Base Sepolia, label "WETH / USDC",
#        pool 0x033f9c6a29740ff07044ab5e63e2dff909793801a0b1e51496d9963765052937, engine <MARKET_ENGINE>.
#   7. Record the new engine + mark in config/deployments.json (base-sepolia) and mark the old engine superseded.
#
# Dry run by default (forge simulates against live Base Sepolia). Add --broadcast to send.
# Export DEPLOYER_PRIVATE_KEY in your shell at broadcast time only; this script never reads env files.
#
#   MARKET_OWNER=0x… ./scripts/ops/relaunch-base-market.sh mark
#   MARKET_OWNER=0x… ./scripts/ops/relaunch-base-market.sh mark --broadcast
set -euo pipefail

STEP="${1:-}"; BROADCAST="${2:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Own RPC var: a sourced app env file often sets BASE_SEPOLIA_RPC_URL to sepolia.base.org, which rejects forge.
RPC="${RELAUNCH_RPC_URL:-https://base-sepolia-rpc.publicnode.com}"
export PATH="$HOME/.foundry/bin:$PATH"

# ── fixed market config (the existing seeded pool) ─────────────────────────────────────────────────────
export MARKET_TEST_ONLY=true
export MARKET_POOL_MANAGER=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408
export MARKET_CURRENCY0=0x036CbD53842c5426634e7929541eC2318f3dCF7e   # USDC (quote)
export MARKET_CURRENCY1=0x4200000000000000000000000000000000000006   # WETH
export MARKET_QUOTE_ASSET=$MARKET_CURRENCY0
export MARKET_NONQUOTE_ASSET=$MARKET_CURRENCY1
export MARKET_POOL_FEE=2500 MARKET_TICK_SPACING=50
export MARKET_TEST_PRICE_WAD=2359038039004747396922                    # = the pool's current price (old mark)
export MARKET_LIFECYCLE_MODULE=0x00006A0e0564b5b4300a46a7EB7c936b44653BAD
export MARKET_CURRENCY0_ERC4626=0x0000000000000000000000000000000000000000   # idle custody (no yield source)
export MARKET_CURRENCY1_ERC4626=0x0000000000000000000000000000000000000000
export MARKET_TICK_LOWER=197450 MARKET_TICK_UPPER=199850                # same band as the current engine
export MARKET_MAX_MARK_AGE=31536000                                     # one year, as on Robinhood testnet
export MARKET_MAX_SPOT_MARK_DEVIATION_BPS=500
export MARKET_MAX_POSITION_BPS=8000
export MARKET_RECENTER_EDGE_TICKS=600 MARKET_MAX_RECENTER_TICK_MOVE=1200 MARKET_RECENTER_COOLDOWN=3600
export MARKET_PRINCIPAL_CAP="${MARKET_PRINCIPAL_CAP:-100000000000}"     # 100,000 USDC (testnet)
export MARKET_MIN_INITIAL_CONTRIBUTION="${MARKET_MIN_INITIAL_CONTRIBUTION:-1000000}"  # 1 USDC
export MARKET_GUARDIAN="${MARKET_GUARDIAN:-${MARKET_OWNER:-}}"

need() { for v in "$@"; do [ -n "${!v:-}" ] || { echo "✗ set $v first" >&2; exit 1; }; done; }
fs() {  # forge script <file> <contract>, simulated unless --broadcast
  local args=(script "$ROOT/contracts-v4/script/$1" --tc "$2" --rpc-url "$RPC")
  [ "$BROADCAST" = "--broadcast" ] && args+=(--broadcast)
  (cd "$ROOT" && forge "${args[@]}")
}
key() {
  if [ -z "${DEPLOYER_PRIVATE_KEY:-}" ]; then
    [ "$BROADCAST" = "--broadcast" ] && { echo "✗ export DEPLOYER_PRIVATE_KEY to broadcast" >&2; exit 1; }
    # Simulation only: Anvil's published test key stands in for the sender (never funded, never broadcast).
    export DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
    echo "· simulating with a stand-in sender (no key exported)"
  fi
}

case "$STEP" in
  mark)
    key; fs DeployMarketTestMark.s.sol DeployMarketTestMark ;;
  engine)
    need MARKET_OWNER MARKET_NONQUOTE_MARK; key; fs DeployMarketEngine.s.sol DeployMarketEngine ;;
  activate)
    need MARKET_ENGINE
    if [ "$BROADCAST" = "--broadcast" ]; then
      need DEPLOYER_PRIVATE_KEY
      cast send "$MARKET_ENGINE" "activate()" --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY"
    else
      echo "· dry run: simulating activate() as the engine owner"
      cast call "$MARKET_ENGINE" "activate()" --rpc-url "$RPC" --from "$(cast call "$MARKET_ENGINE" "owner()(address)" --rpc-url "$RPC")" && echo "✓ activate() would succeed"
    fi ;;
  verify)
    need MARKET_ENGINE MARKET_NONQUOTE_MARK
    echo "codehash  $(cast keccak "$(cast code "$MARKET_ENGINE" --rpc-url "$RPC")")"
    echo "owner     $(cast call "$MARKET_ENGINE" "owner()(address)" --rpc-url "$RPC")"
    echo "activated $(cast call "$MARKET_ENGINE" "activated()(bool)" --rpc-url "$RPC")"
    echo "quote     $(cast call "$MARKET_ENGINE" "quoteAsset()(address)" --rpc-url "$RPC")"
    echo "totalNav  $(cast call "$MARKET_ENGINE" "totalNav()(uint256)" --rpc-url "$RPC")"
    echo "poolId    0x033f9c6a29740ff07044ab5e63e2dff909793801a0b1e51496d9963765052937" ;;
  all)
    # One shot: mark → engine → activate → verify. Owner defaults to the deployer so it can activate.
    [ "$BROADCAST" = "--broadcast" ] && need DEPLOYER_PRIVATE_KEY
    key
    export MARKET_OWNER="${MARKET_OWNER:-$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")}"
    export MARKET_GUARDIAN="${MARKET_GUARDIAN:-$MARKET_OWNER}"
    echo "· owner/guardian $MARKET_OWNER"
    out=$(fs DeployMarketTestMark.s.sol DeployMarketTestMark 2>&1) || { echo "$out"; exit 1; }
    export MARKET_NONQUOTE_MARK=$(echo "$out" | awk '/FreshTestMark 0x/ {print $2}')
    echo "1/4 mark    $MARKET_NONQUOTE_MARK"
    [ "$BROADCAST" = "--broadcast" ] || { echo "· dry run stops here: the engine step needs the mark on-chain. Re-run with --broadcast."; exit 0; }
    out=$(fs DeployMarketEngine.s.sol DeployMarketEngine 2>&1) || { echo "$out"; exit 1; }
    export MARKET_ENGINE=$(echo "$out" | awk '/MintwareMarketEngine 0x/ {print $2}')
    echo "2/4 engine  $MARKET_ENGINE"
    "$0" activate --broadcast >/dev/null && echo "3/4 activated"
    echo "4/4 verify"; "$0" verify ;;
  *)
    sed -n '2,30p' "$0"; exit 1 ;;
esac
