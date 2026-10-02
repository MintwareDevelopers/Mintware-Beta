// V2-RWAs — wait until the rwa seat is funded on RWA_NETWORK's testnet, then run deploy → lifecycle → verify.
// For chains whose faucet you have to visit by hand (e.g. XRPL EVM testnet): arm this, fund the seat, walk away.
// Run:  RWA_NETWORK=xrpl-evm-testnet node --env-file=.env.robinhood.local scripts/rwa-demo-when-funded.mjs
// Env:  RWA_WAIT_HOURS (default 2), RWA_MIN_RUN_WEI (default: the preset's pre-flight floor)
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, formatEther } from 'viem'
import { resolveNetwork } from './lib/rwaNetworks.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NET = resolveNetwork(ROOT)
const SEAT = process.env.RWA_ORACLE_PRIVY_ADDRESS
if (!SEAT) { console.error('✗ RWA_ORACLE_PRIVY_ADDRESS not set (load the env file with --env-file)'); process.exit(1) }
const need = NET.minRunWei > 0n ? NET.minRunWei : 1n
const pub = createPublicClient({ transport: http(NET.rpc) })
const deadline = Date.now() + Number(process.env.RWA_WAIT_HOURS ?? 2) * 3600_000

console.log(`waiting for ${SEAT} to hold ≥ ${formatEther(need)} ${NET.nativeCurrency.symbol} on ${NET.name}${NET.faucet ? ` (faucet: ${NET.faucet})` : ''}`)
for (;;) {
  const b = await pub.getBalance({ address: SEAT }).catch(() => 0n)
  if (b >= need) { console.log(`FUNDED: ${formatEther(b)} ${NET.nativeCurrency.symbol}`); break }
  if (Date.now() > deadline) { console.log('TIMEOUT: still unfunded'); process.exit(2) }
  await new Promise((r) => setTimeout(r, 30_000))
}

const envFileArg = process.execArgv.find((a) => a.startsWith('--env-file'))
function step(name, script) {
  const r = spawnSync(process.execPath, [...(envFileArg ? [envFileArg] : []), join(ROOT, 'scripts', script)], { cwd: ROOT, env: process.env, stdio: 'inherit' })
  console.log(`── ${name}: exit ${r.status}`)
  return r.status === 0
}
if (!step('DEPLOY', 'deploy-rwa-demo.mjs')) process.exit(3)
if (!step('LIFECYCLE', 'rwa-demo-lifecycle.mjs')) process.exit(4)
step('VERIFY', 'verify-rwa-demo.mjs')
