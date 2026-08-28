#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// deployments-sync — pull REAL contract addresses from the local Foundry broadcast
// records into config/deployments.json (the one committed deploy record). Broadcast
// files are gitignored, so they only exist on the machine that ran the deploy — this
// is how a deployer promotes that ground truth into the committed ledger.
//
//   pnpm deployments:sync            → merge ./broadcast/**/run-latest.json into the ledger
//   pnpm deployments:sync --check    → exit 1 if the ledger is missing / disagrees with a broadcast
//
// After a sync, run `pnpm context:sync` to regenerate the STATE.md build-status table.
// Entries the broadcasts don't cover (e.g. contracts deployed by hand, or an older run
// that was overwritten) are LEFT UNTOUCHED — including `address:null` GAPs, which stay
// honest gaps rather than being erased.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const CHECK = process.argv.includes('--check')
const LEDGER = 'config/deployments.json'

// chainId → [env, chain-label] in the ledger.
const CHAINS = {
  '8453': ['mainnet', 'base'],
  '84532': ['testnet', 'base-sepolia'],
  '42161': ['testnet', 'arbitrum'],
  '56': ['testnet', 'bnb'],
}
// Test/scaffolding contracts are not product deployments — never record them.
const skip = (name) => name.startsWith('Mock') || name.startsWith('Test') || name.endsWith('Test') || name === 'PoolModifyLiquidityTest'

// ── gather real CREATE deployments from every broadcast run-latest.json ──
function collectBroadcasts() {
  const found = {} // `${chainId}|${name}` → { chainId, name, addr, script }
  if (!existsSync(join(ROOT, 'broadcast'))) return found
  const files = []
  ;(function walk(d) {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (e.name === 'run-latest.json') files.push(rel)
    }
  })('broadcast')
  for (const f of files) {
    let j
    try { j = JSON.parse(readFileSync(join(ROOT, f), 'utf8')) } catch { continue }
    const chainId = String(j.chain ?? (f.match(/\/(\d+)\//) || [])[1] ?? '')
    for (const tx of j.transactions || []) {
      if (tx.transactionType !== 'CREATE' || !tx.contractName || !tx.contractAddress) continue
      if (skip(tx.contractName)) continue
      const k = `${chainId}|${tx.contractName}`
      if (!found[k]) found[k] = { chainId, name: tx.contractName, addr: tx.contractAddress, script: f.split('/')[1] }
    }
  }
  return found
}

const today = new Date().toISOString().slice(0, 10)
const ledger = JSON.parse(readFileSync(join(ROOT, LEDGER), 'utf8'))
const broadcasts = collectBroadcasts()

let changed = 0
const drift = []
for (const { chainId, name, addr, script } of Object.values(broadcasts)) {
  const loc = CHAINS[chainId]
  if (!loc) continue
  const [env, chain] = loc
  ledger[env] ??= {}
  ledger[env][chain] ??= {}
  const cur = ledger[env][chain][name]
  const addrLc = addr.toLowerCase()
  if (cur && (cur.address || '').toLowerCase() === addrLc) continue // already current
  if (CHECK) { drift.push(`${env}/${chain}/${name} → ${addrLc} (ledger: ${cur?.address ?? 'missing'})`); continue }
  ledger[env][chain][name] = {
    address: addrLc,
    chainId: Number(chainId),
    status: cur?.status ?? 'testnet',
    note: cur?.note && !/^GAP:/.test(cur.note) ? cur.note : `from broadcast ${script}`,
    verified: today,
    source: 'broadcast',
  }
  changed++
}

if (CHECK) {
  if (drift.length) { console.error(`✗ ${drift.length} deployment(s) in broadcasts not reflected in the ledger:\n  ` + drift.join('\n  ') + `\n\nrun: pnpm deployments:sync`); process.exit(1) }
  console.log('✓ deploy ledger matches the broadcast records'); process.exit(0)
}

if (changed) {
  writeFileSync(join(ROOT, LEDGER), JSON.stringify(ledger, null, 2) + '\n')
  console.log(`✓ synced ${changed} address(es) from broadcasts into ${LEDGER}. Now run: pnpm context:sync`)
} else {
  console.log('All broadcast addresses already recorded in the ledger.')
}
