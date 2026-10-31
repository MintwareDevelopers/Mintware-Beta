#!/usr/bin/env node
// Re-post the demo RWA unit's appraisal so the hook stays fresh (Base Sepolia `wcp7`).
//
// The appraisal hook halts trading once `appraisedAt + maxAppraisalAge` passes (30 days on the demo unit), then
// opens the LP exit window. This script posts a new appraisal from the hook's KEEPER — the dedicated `rwa` Privy
// server-wallet seat (scripts/lib/rwaSigner.mjs; no raw key). By default it re-posts the CURRENT appraisal tick
// (a pure freshness refresh, no price change); `--tick <n>` posts a bounded move instead.
//
// Dry run by default: reads state, checks every on-chain rule the hook enforces, simulates the call. Nothing is
// sent unless you pass `--send`.
//
//   node --env-file=<your env file> scripts/rwa-refresh-appraisal.mjs            # dry run
//   node --env-file=<your env file> scripts/rwa-refresh-appraisal.mjs --send     # broadcast
//
// Signer env (the rwa seat): PRIVY_APP_ID, PRIVY_APP_SECRET, RWA_ORACLE_PRIVY_WALLET_ID, RWA_ORACLE_PRIVY_ADDRESS
// (+ RWA_ORACLE_PRIVY_AUTH_KEY if the wallet has an authorization key). Optional RWA_RPC_URL.
// TESTNET ONLY: the property is fictional and every token is valueless.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { baseSepolia } from 'viem/chains'
import { resolveRwaSigner } from './lib/rwaSigner.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const demo = JSON.parse(readFileSync(join(ROOT, 'config', 'rwaDemo.json'), 'utf8'))
const HOOK = demo.contracts.hook
const args = process.argv.slice(2)
const SEND = args.includes('--send')
const tickArg = args.includes('--tick') ? Number(args[args.indexOf('--tick') + 1]) : null

const ABI = parseAbi([
  'function keeper() view returns (address)',
  'function appraisalTick() view returns (int24)',
  'function appraisedAt() view returns (uint64)',
  'function isFresh() view returns (bool)',
  'function postAppraisal(int24 tick)',
])

const die = (m) => { console.error(`✗ ${m}`); process.exit(1) }
const fmtAge = (s) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 172800 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`)

if (demo.chainId !== 84532) die(`config/rwaDemo.json is chain ${demo.chainId}, expected Base Sepolia (84532)`)
const rpc = process.env.RWA_RPC_URL ?? 'https://base-sepolia-rpc.publicnode.com'
const pub = createPublicClient({ chain: baseSepolia, transport: http(rpc) })

const [keeper, tick, at, fresh, block] = await Promise.all([
  pub.readContract({ address: HOOK, abi: ABI, functionName: 'keeper' }),
  pub.readContract({ address: HOOK, abi: ABI, functionName: 'appraisalTick' }),
  pub.readContract({ address: HOOK, abi: ABI, functionName: 'appraisedAt' }),
  pub.readContract({ address: HOOK, abi: ABI, functionName: 'isFresh' }),
  pub.getBlock(),
])
// The hook's limits as recorded at deploy (config/rwaDemo.json); the simulation below is the on-chain check.
const cfg = demo.hookConfig
const now = Number(block.timestamp)
const age = now - Number(at)
const left = Number(at) + cfg.maxAppraisalAge - now

console.log(`${demo.property.name} · hook ${HOOK} · Base Sepolia block ${block.number}`)
console.log(`  keeper          ${keeper}`)
console.log(`  appraisal tick  ${tick}  (posted ${fmtAge(age)} ago, ${fresh ? `fresh for ${fmtAge(Math.max(0, left))} more` : 'STALE — trading halted'})`)

const target = tickArg ?? Number(tick)
if (!Number.isInteger(target)) die('--tick must be an integer')
if (Math.abs(target - Number(tick)) > cfg.maxStepTicks) die(`step ${Math.abs(target - Number(tick))} > maxStepTicks ${cfg.maxStepTicks}`)
if (age < cfg.minUpdateInterval) die(`last update was ${fmtAge(age)} ago; the hook rate-limits updates to one per ${fmtAge(cfg.minUpdateInterval)}`)
console.log(`  new tick        ${target}${target === Number(tick) ? ' (unchanged — freshness refresh)' : ''}`)

const { account, kind } = await resolveRwaSigner().catch((e) => die(e.message))
console.log(`  signer          ${account.address} (${kind})`)
if (account.address.toLowerCase() !== String(keeper).toLowerCase()) die('signer is not the hook keeper — refusing to send')

const { request } = await pub.simulateContract({ account, address: HOOK, abi: ABI, functionName: 'postAppraisal', args: [target] })
  .catch((e) => die(`simulation reverted: ${e.shortMessage ?? e.message}`))
console.log('✓ simulation passed')

if (!SEND) { console.log('\nDry run only. Re-run with --send to post the appraisal.'); process.exit(0) }

const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) })
const hash = await wallet.writeContract(request)
console.log(`  sent ${hash}`)
const receipt = await pub.waitForTransactionReceipt({ hash })
if (receipt.status !== 'success') die(`transaction reverted in block ${receipt.blockNumber}`)
console.log(`✓ appraisal posted in block ${receipt.blockNumber} — fresh for ${fmtAge(cfg.maxAppraisalAge)}`)
console.log(`  ${'https://sepolia.basescan.org'}/tx/${hash}`)
