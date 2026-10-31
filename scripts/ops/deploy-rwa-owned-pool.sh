#!/usr/bin/env bash
# Install the testnet RWA unit on Base Sepolia: owned hooked pool on Uniswap Permissioned Pools + owned MarketEngine.
#
#   RPC=http://127.0.0.1:8547 ./scripts/ops/deploy-rwa-owned-pool.sh   # rehearsal against an anvil fork
#   RPC=https://base-sepolia-rpc.publicnode.com ./scripts/ops/deploy-rwa-owned-pool.sh --broadcast
#
# Steps: lifecycle module → issuer fixtures (testnet property token + allowlist) → official PermissionsAdapterFactory →
# issuer grants → canonical installer (DeployRwaOwnedPool) → custody/LP grants → activate → seed → deploy liquidity.
# Swaps stay disabled (adapter swap switch off, no router allowed). Fixtures are TEST-ONLY: their setters are open.
# Export DEPLOYER_PRIVATE_KEY (0x9c64…33AD); this script never prints it.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.foundry/bin:$PATH"
RPC="${RPC:?set RPC}"; MODE="${1:-}"
D=0x9c646C48a302f4725450669f1218d3FDb3e933AD
PM=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408
USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e
: "${DEPLOYER_PRIVATE_KEY:?export DEPLOYER_PRIVATE_KEY}"
[ "$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")" = "$D" ] || { echo "✗ key is not $D" >&2; exit 1; }
[ "$(cast chain-id --rpc-url "$RPC")" = 84532 ] || { echo "✗ not Base Sepolia" >&2; exit 1; }
case "$RPC" in http://127.0.0.1*|http://localhost*) ;; *) [ "$MODE" = "--broadcast" ] || { echo "✗ remote RPC needs --broadcast"; exit 1; } ;; esac

c() { cast call "$@" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}'; }
send() { cast send "$@" --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --json 2>/dev/null | python3 -c 'import json,sys;r=json.load(sys.stdin);print(r["status"],r["transactionHash"])'; }
# forge's --constructor-args is variadic, so it must come last.
create() { local what=$1; shift; forge create "$what" --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --json ${1:+--constructor-args "$@"} 2>/dev/null | python3 -c 'import json,sys;s=sys.stdin.read();r=json.loads(s[s.index("{"):s.rindex("}")+1]);print(r["deployedTo"],r["transactionHash"])'; }

echo "1/9 lifecycle module"
out=$(MARKET_POOL_MANAGER=$PM MARKET_TEST_ONLY=true forge script contracts-v4/script/DeployMarketLifecycleModule.s.sol \
  --tc DeployMarketLifecycleModule --rpc-url "$RPC" --broadcast 2>&1) || { echo "$out" | tail -15; exit 1; }
MODULE=$(echo "$out" | awk '/MintwareMarketLifecycleModule 0x/{print $2}'); echo "    $MODULE"

echo "2/9 issuer fixtures (testnet only)"
read -r PROPERTY TX <<<"$(create contracts-v4/test/rwa/OwnedPoolFixtures.sol:OwnedIssuerToken 18 true)"; echo "    property $PROPERTY $TX"
read -r CHECKER TX <<<"$(create contracts-v4/test/rwa/OwnedPoolFixtures.sol:IssuerAllowlist)"; echo "    allowlist $CHECKER $TX"

echo "3/9 official PermissionsAdapterFactory"
read -r FACTORY TX <<<"$(create contracts-v4/lib/v4-periphery-permissioned/src/hooks/permissionedPools/PermissionsAdapterFactory.sol:PermissionsAdapterFactory $PM)"; echo "    $FACTORY $TX"
ADAPTER=$(cast compute-address "$FACTORY" --nonce 1 | awk '{print $NF}')
# ~$100 per property token (18 dp) in USDC (6 dp); tick sign follows PoolKey order (adapter vs USDC).
TICK=$(python3 -c "print(-230280 if int('$ADAPTER',16) < int('$USDC',16) else 230280)")
echo "    predicted adapter $ADAPTER · appraisal tick $TICK"

echo "4/9 issuer grants"
echo "    $(send $PROPERTY 'setEligible(address,bool)' $D true)"
echo "    $(send $PROPERTY 'setEligible(address,bool)' $ADAPTER true)"
echo "    $(send $PROPERTY 'mint(address,uint256)' $D 1000000000000000000000000)"
echo "    $(send $CHECKER 'set(address,address,bytes2)' $D $PROPERTY 0xffff)"

echo "5/9 canonical installer"
NOW=$(cast block latest --field timestamp --rpc-url "$RPC")
out=$(RWA_APPRAISAL_TICK=$TICK RWA_OBSERVED_AT=$((NOW-60)) RWA_OWNER=$D RWA_KEEPER=$D RWA_GUARDIAN=$D \
  RWA_PROPERTY=$PROPERTY RWA_CHECKER=$CHECKER RWA_FACTORY=$FACTORY MARKET_LIFECYCLE_MODULE=$MODULE \
  RWA_REPORT_HASH=$(cast keccak "testnet fictional appraisal 2026-10-31") \
  forge script contracts-v4/script/DeployRwaOwnedPool.s.sol --tc DeployRwaOwnedPool --rpc-url "$RPC" \
  --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast 2>&1) || { echo "$out" | tail -20; exit 1; }
ENGINE=$(echo "$out" | awk '/engine \(inactive\) 0x/{print $3}'); HOOK=$(echo "$out" | awk '/^ *hook 0x/{print $2}')
IDLE0=$(echo "$out" | awk '/idle0 0x/{print $2}'); IDLE1=$(echo "$out" | awk '/idle1 0x/{print $2}')
[ "$(c $FACTORY 'verifiedPermissionsAdapterOf(address)(address)' $ADAPTER)" = "$PROPERTY" ] || { echo "✗ adapter mapping"; exit 1; }
echo "    engine $ENGINE · hook $HOOK · idle $IDLE0 $IDLE1"

echo "6/9 custody + LP grants"
for a in $ENGINE $IDLE0 $IDLE1; do echo "    $(send $PROPERTY 'setEligible(address,bool)' $a true)"; done
echo "    $(send $CHECKER 'set(address,address,bytes2)' $ENGINE $PROPERTY 0x0002)"

echo "7/9 activate"
echo "    $(send $ENGINE 'activate()')"

echo "8/9 seed (50 property tokens + 0.5 USDC)"
T0=$(c $ENGINE 'token0()(address)')
if [ "$(echo $T0 | tr A-F a-f)" = "$(echo $PROPERTY | tr A-F a-f)" ]; then A0=50000000000000000000; A1=500000; else A0=500000; A1=50000000000000000000; fi
echo "    $(send $PROPERTY 'approve(address,uint256)' $ENGINE 50000000000000000000)"
echo "    $(send $USDC 'approve(address,uint256)' $ENGINE 500000)"
echo "    $(send $ENGINE 'deposit(uint256,uint256,uint256)' $A0 $A1 1)"

echo "9/9 deploy liquidity"
I0=$(c $IDLE0 'totalAssets()(uint256)'); I1=$(c $IDLE1 'totalAssets()(uint256)')
echo "    $(send $ENGINE 'deployLiquidity(uint256,uint256,bool,uint256,uint256,uint160,uint128)' $I0 $I1 false 0 0 0 1)"

echo "verify: codehash $(cast keccak "$(cast code $ENGINE --rpc-url "$RPC")")"
echo "        activated $(c $ENGINE 'activated()(bool)') · totalNav $(c $ENGINE 'totalNav()(uint256)') · liquidity $(c $ENGINE 'positionLiquidity()(uint128)')"
echo "        mark $(cast call $HOOK 'latestMark()(uint256,uint64)' --rpc-url "$RPC" | tr '\n' ' ') · swaps enabled $(c $ADAPTER 'swappingEnabled()(bool)')"
printf 'ENGINE=%s\nHOOK=%s\nADAPTER=%s\nFACTORY=%s\nPROPERTY=%s\nCHECKER=%s\nMODULE=%s\nIDLE0=%s\nIDLE1=%s\nTICK=%s\n' \
  $ENGINE $HOOK $ADAPTER $FACTORY $PROPERTY $CHECKER $MODULE $IDLE0 $IDLE1 $TICK
