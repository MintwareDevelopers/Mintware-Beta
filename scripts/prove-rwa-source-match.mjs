// V2-RWAs — prove, without an explorer, that every deployed demo contract IS the source in this repo:
//   (1) the deployed bytecode's CBOR metadata hash equals our Forge build's, and
//   (2) every source file recorded in that build's metadata hashes to the file on disk right now.
// Used where explorer verification is unavailable (XRPL EVM testnet's Blockscout has no solc 0.8.26; Sourcify
// lists only XRPL EVM mainnet). Anyone can re-run it. Exit 1 on any mismatch.
// Run:  RWA_NETWORK=xrpl-evm-testnet node scripts/prove-rwa-source-match.mjs
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, keccak256, toHex } from 'viem'
import { resolveNetwork } from './lib/rwaNetworks.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NET = resolveNetwork(ROOT)
const d = JSON.parse(readFileSync(NET.deploymentFile, 'utf8'))
const pub = createPublicClient({ transport: http(NET.rpc) })
const art = (n) => JSON.parse(readFileSync(join(ROOT, 'contracts-v4', 'out', `${n}.sol`, `${n}.json`), 'utf8'))
const meta = (h) => { const n = parseInt(h.slice(-4), 16); return h.slice(h.length - (n + 2) * 2) }

const rows = [
  ...(d.poolManagerDeployedByUs ? [['poolManager', 'PoolManager']] : []),
  ['usd', 'DemoUSD'], ['registry', 'MockRwaIdentityRegistry'], ['property', 'MockPermissionedPropertyToken'],
  ['adapter', 'DemoLendingAdapter'], ['hook', 'MintwareRwaAppraisalHook'], ['positionLib', 'MWTreasuryPositionLib'],
  ['vault', 'MintwareTreasuryVault'], ['router', 'DemoSwapRouter'],
]
let bad = 0
console.log(`${NET.name} (chain ${d.chainId})`)
for (const [k, n] of rows) {
  const a = art(n)
  const code = await pub.getCode({ address: d.contracts[k] })
  const metaOk = !!code && code.length > 2 && meta(code) === meta(a.deployedBytecode.object)
  const stale = Object.entries(a.metadata.sources).filter(([p, { keccak256: want }]) => existsSync(join(ROOT, p)) && keccak256(toHex(readFileSync(join(ROOT, p)))) !== want)
  const ok = metaOk && stale.length === 0
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${n.padEnd(30)} ${d.contracts[k]}  metadata==build:${metaOk}  build==repo:${stale.length === 0}`)
}
process.exit(bad ? 1 : 0)
