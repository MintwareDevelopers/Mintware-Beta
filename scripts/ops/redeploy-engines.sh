#!/usr/bin/env bash
# Redeploy a testnet MarketEngine with the PR #551 audit fixes (MW-01 exit fairness, MW-02 4626 rounding) and
# move the deployer's position from the old engine into the new one. Same pool, same config, same fixed test
# mark and lifecycle module as the engine it replaces (configs read back from chain on 2026-10-31).
#
#   ./scripts/ops/redeploy-engines.sh base              # dry run: simulate the deploy + the old-engine withdraw
#   ./scripts/ops/redeploy-engines.sh base --broadcast  # deploy, activate, withdraw old, deposit new, verify
#   ./scripts/ops/redeploy-engines.sh robinhood [--broadcast]
#
# Export DEPLOYER_PRIVATE_KEY in your shell at broadcast time (the engine owner, 0x9c64…33AD). This script never
# reads env files and never prints the key. Only the deployer's own shares move; any other holder's shares stay in
# the old engine, which remains exit-available.
set -euo pipefail

NET="${1:-}"; BROADCAST="${2:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
DEPLOYER=0x9c646C48a302f4725450669f1218d3FDb3e933AD

export MARKET_TEST_ONLY=true MARKET_OWNER=$DEPLOYER MARKET_GUARDIAN=$DEPLOYER
export MARKET_CURRENCY0_ERC4626=0x0000000000000000000000000000000000000000   # idle custody, as before
export MARKET_CURRENCY1_ERC4626=0x0000000000000000000000000000000000000000
export MARKET_MAX_MARK_AGE=31536000 MARKET_MAX_SPOT_MARK_DEVIATION_BPS=500 MARKET_MAX_POSITION_BPS=8000
export MARKET_MIN_INITIAL_CONTRIBUTION=1000000

case "$NET" in
  base)
    RPC="${REDEPLOY_RPC_URL:-https://base-sepolia-rpc.publicnode.com}"
    OLD=0x961534db8C0EbB7cEb729E74CaB698A83A9c827e
    export MARKET_POOL_MANAGER=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408
    export MARKET_CURRENCY0=0x036CbD53842c5426634e7929541eC2318f3dCF7e MARKET_CURRENCY1=0x4200000000000000000000000000000000000006
    export MARKET_QUOTE_ASSET=$MARKET_CURRENCY0 MARKET_POOL_FEE=2500 MARKET_TICK_SPACING=50
    export MARKET_NONQUOTE_MARK=0x11fbbDC9954A2Ca6C1eA9E5786d3725d7803dC8D
    export MARKET_LIFECYCLE_MODULE=0x00006A0e0564b5b4300a46a7EB7c936b44653BAD
    export MARKET_TICK_LOWER=197450 MARKET_TICK_UPPER=199850
    export MARKET_RECENTER_EDGE_TICKS=600 MARKET_MAX_RECENTER_TICK_MOVE=1200 MARKET_RECENTER_COOLDOWN=3600
    export MARKET_PRINCIPAL_CAP=100000000000 ;;
  robinhood)
    RPC="${REDEPLOY_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
    OLD=0x38E426D6671FB2c07C07a468e59f954Dcd0eDeb8
    export MARKET_POOL_MANAGER=0x8366a39CC670B4001A1121B8F6A443A643e40951
    export MARKET_CURRENCY0=0x2A8C32E291BC90CEB8aE058B6A684be0312bb848 MARKET_CURRENCY1=0x4494bBcB351a263097978f314057875E5Ec5B9a7
    export MARKET_QUOTE_ASSET=$MARKET_CURRENCY0 MARKET_POOL_FEE=3000 MARKET_TICK_SPACING=60
    export MARKET_NONQUOTE_MARK=0xA7e84b45E59bccC5F1227e706Cc335dc7ab6ed10
    export MARKET_LIFECYCLE_MODULE=0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421
    export MARKET_TICK_LOWER=-600 MARKET_TICK_UPPER=0
    export MARKET_RECENTER_EDGE_TICKS=120 MARKET_MAX_RECENTER_TICK_MOVE=600 MARKET_RECENTER_COOLDOWN=3600
    export MARKET_PRINCIPAL_CAP=10000000000 ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac

c() { cast call "$@" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}'; }
send() { cast send "$@" --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" 2>&1 | awk '/^(status|transactionHash)/ {printf "%s ", $2} END {print ""}'; }
T0=$MARKET_CURRENCY0; T1=$MARKET_CURRENCY1

if [ -z "${DEPLOYER_PRIVATE_KEY:-}" ]; then
  [ "$BROADCAST" = "--broadcast" ] && { echo "✗ export DEPLOYER_PRIVATE_KEY to broadcast" >&2; exit 1; }
  export DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # Anvil stand-in, simulation only
fi
if [ "$BROADCAST" = "--broadcast" ] && [ "$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")" != "$DEPLOYER" ]; then
  echo "✗ DEPLOYER_PRIVATE_KEY is not the engine owner $DEPLOYER" >&2; exit 1
fi

SHARES=$(c $OLD 'balanceOf(address)(uint256)' $DEPLOYER)
SUPPLY=$(c $OLD 'totalSupply()(uint256)')
echo "· $NET: old engine $OLD — deployer holds $SHARES of $SUPPLY shares"
[ "$SHARES" = "$SUPPLY" ] || echo "! other wallets hold $(python3 -c "print($SUPPLY-$SHARES)") shares; they stay in the old engine"
QUOTE=$(cast call $OLD 'withdraw(uint256,address,uint256,uint256)(uint256,uint256,uint256)' "$SHARES" $DEPLOYER 0 0 --from $DEPLOYER --rpc-url "$RPC" 2>/dev/null | awk '{print $1}' | tr '\n' ' ')
read -r _ OUT0 OUT1 <<<"$QUOTE"
echo "· withdraw would return token0 $OUT0 · token1 $OUT1"

args=(script "$ROOT/contracts-v4/script/DeployMarketEngine.s.sol" --tc DeployMarketEngine --rpc-url "$RPC")
[ "$BROADCAST" = "--broadcast" ] && args+=(--broadcast)
out=$(cd "$ROOT" && forge "${args[@]}" 2>&1) || { echo "$out" | tail -20; exit 1; }
NEW=$(echo "$out" | awk '/MintwareMarketEngine 0x/ {print $2}')
echo "1/5 engine   $NEW  (adapters $(echo "$out" | awk '/adapter0 0x/ {print $2}') $(echo "$out" | awk '/adapter1 0x/ {print $2}'))"
[ "$BROADCAST" = "--broadcast" ] || { echo "· dry run stops here. Re-run with --broadcast."; exit 0; }

echo "2/5 activate $(send $NEW 'activate()')"
B0=$(c $T0 'balanceOf(address)(uint256)' $DEPLOYER); B1=$(c $T1 'balanceOf(address)(uint256)' $DEPLOYER)
MIN0=$(python3 -c "print($OUT0*99//100)"); MIN1=$(python3 -c "print($OUT1*99//100)")
echo "3/5 withdraw $(send $OLD 'withdraw(uint256,address,uint256,uint256)' "$SHARES" $DEPLOYER "$MIN0" "$MIN1")"
A0=$(python3 -c "print($(c $T0 'balanceOf(address)(uint256)' $DEPLOYER)-$B0)"); A1=$(python3 -c "print($(c $T1 'balanceOf(address)(uint256)' $DEPLOYER)-$B1)")
echo "    received token0 $A0 · token1 $A1"
[ "$A0" != 0 ] && echo "    approve0 $(send $T0 'approve(address,uint256)' $NEW "$A0")"
[ "$A1" != 0 ] && echo "    approve1 $(send $T1 'approve(address,uint256)' $NEW "$A1")"
echo "4/5 deposit  $(send $NEW 'deposit(uint256,uint256,uint256)' "$A0" "$A1" 1)"
echo "5/5 verify   codehash $(cast keccak "$(cast code $NEW --rpc-url "$RPC" 2>/dev/null)")"
echo "             owner $(c $NEW 'owner()(address)') activated $(c $NEW 'activated()(bool)') quote $(c $NEW 'quoteAsset()(address)')"
echo "             new totalNav $(c $NEW 'totalNav()(uint256)') · old totalNav $(c $OLD 'totalNav()(uint256)') · old supply $(c $OLD 'totalSupply()(uint256)')"
