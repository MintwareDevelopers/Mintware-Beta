// V2-RWAs — source-verify every contract of the deployed demo unit on the chain's explorer.
// Chain-agnostic via RWA_NETWORK (scripts/lib/rwaNetworks.mjs):
//   base-sepolia      → Etherscan V2 API; needs BASESCAN_API_KEY (an Etherscan V2 key works for every chain).
//   xrpl-evm-testnet  → the explorer's Blockscout API (https://explorer.testnet.xrplevm.org/api/); no key needed.
// Reads the network's deployment file (config/rwaDemo.deployment.json / config/rwaDemo.xrpl.deployment.json).
// When the deployment carries our own PoolManager (no canonical Uniswap v4 on that chain), it is verified too.
// Run:  node --env-file=.env.local scripts/verify-rwa-demo.mjs
//       RWA_NETWORK=xrpl-evm-testnet node scripts/verify-rwa-demo.mjs
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeAbiParameters } from 'viem'
import { resolveNetwork } from './lib/rwaNetworks.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NET = resolveNetwork(ROOT)
const d = JSON.parse(readFileSync(NET.deploymentFile, 'utf8'))
if (d.chainId !== NET.chainId) { console.error(`✗ ${NET.deploymentFile} is chain ${d.chainId}, RWA_NETWORK=${NET.id} is ${NET.chainId}`); process.exit(1) }
if (d.rehearsal) { console.error('✗ that deployment file is a local-fork rehearsal — nothing to verify'); process.exit(1) }
const verifierUrl = process.env.RWA_VERIFIER_URL ?? NET.verifier.url
let verifierArgs
if (NET.verifier.kind === 'etherscan') {
  const key = process.env.BASESCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY
  if (!key) { console.error('✗ BASESCAN_API_KEY not set'); process.exit(1) }
  verifierArgs = ['--verifier', 'etherscan', '--verifier-url', verifierUrl, '--etherscan-api-key', key]
} else {
  verifierArgs = ['--verifier', 'blockscout', '--verifier-url', verifierUrl]
}

const c = d.contracts, me = d.signer
const A = (t) => ({ type: t })
const KEY_T = { type: 'tuple', components: [
  { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }
const CFG_T = { type: 'tuple', components: [
  { name: 'coreBandTicks', type: 'uint24' }, { name: 'specBandTicks', type: 'uint24' }, { name: 'maxStepTicks', type: 'uint24' },
  { name: 'minUpdateInterval', type: 'uint32' }, { name: 'maxAppraisalAge', type: 'uint32' },
  { name: 'coreFeePips', type: 'uint24' }, { name: 'specFeePips', type: 'uint24' },
  { name: 'maxDriftTicksPerDay', type: 'uint24' }, { name: 'oracleGraceSecs', type: 'uint32' }] }

const LIB = 'contracts-v4/src/payments/lib/MWTreasuryPositionLib.sol:MWTreasuryPositionLib'
const jobs = [
  ...(d.poolManagerDeployedByUs
    ? [[c.poolManager, 'contracts-v4/lib/v4-core/src/PoolManager.sol:PoolManager', encodeAbiParameters([A('address')], [me])]]
    : []),
  [c.usd, 'contracts-v4/src/rwa/testnet/DemoUSD.sol:DemoUSD', encodeAbiParameters([A('address')], [me])],
  [c.registry, 'contracts-v4/src/rwa/testnet/MockRwaIdentityRegistry.sol:MockRwaIdentityRegistry', encodeAbiParameters([A('address')], [me])],
  [c.property, 'contracts-v4/src/rwa/testnet/MockPermissionedPropertyToken.sol:MockPermissionedPropertyToken',
    encodeAbiParameters([A('string'), A('string'), A('uint8'), A('address'), A('address')], [d.property.name, d.property.symbol, 18, c.registry, me])],
  [c.adapter, 'contracts-v4/src/rwa/testnet/DemoLendingAdapter.sol:DemoLendingAdapter',
    encodeAbiParameters([A('address'), A('uint256'), A('address')], [c.usd, BigInt(process.env.LEND_APR_BPS ?? 450), me])],
  [c.hook, 'contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:MintwareRwaAppraisalHook',
    encodeAbiParameters([A('address'), A('address'), A('address'), A('address'), CFG_T], [c.poolManager, me, me, me, d.hookConfig])],
  [c.positionLib, LIB, '0x'],
  [c.vault, 'contracts-v4/src/payments/MintwareTreasuryVault.sol:MintwareTreasuryVault',
    encodeAbiParameters([A('address'), KEY_T, A('address'), A('address'), A('address'), A('address')], [c.poolManager, d.poolKey, c.usd, c.adapter, me, me]),
    ['--libraries', `${LIB}:${c.positionLib}`]],
  [c.router, 'contracts-v4/src/rwa/testnet/DemoSwapRouter.sol:DemoSwapRouter', encodeAbiParameters([A('address')], [c.poolManager])],
]

const forge = join(process.env.HOME, '.foundry', 'bin', 'forge')
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const only = process.env.RWA_VERIFY_ONLY?.split(',').map((s) => s.trim().toLowerCase())
let failed = 0
for (const [addr, id, args, extra = []] of jobs) {
  if (only && !only.includes(id.split(':')[1].toLowerCase())) continue
  const argv = ['verify-contract', addr, id, '--chain-id', String(d.chainId), '--watch', ...verifierArgs,
    '--retries', '10', '--delay', '6', ...(args !== '0x' ? ['--constructor-args', args] : []), ...extra]
  let out = '', ok = false
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    const r = spawnSync(forge, argv, { cwd: ROOT, encoding: 'utf8' })
    out = `${r.stdout}\n${r.stderr}`
    ok = /Pass - Verified|already verified|Contract successfully verified|successfully verified/i.test(out)
    if (!ok) sleepSync(8000) // free-tier explorers: space out submissions + status polls
  }
  sleepSync(4000)
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${id.split(':')[1].padEnd(32)} ${addr}${ok ? '' : `\n${out.split('\n').filter((l) => /error|fail|reason|response/i.test(l)).slice(0, 4).join('\n')}`}`)
}
process.exit(failed ? 1 : 0)
