#!/usr/bin/env node
// Operator registration of a MarketEngine we deployed ourselves (the path the schema reserves for
// `verified_by = 'operator:<name>'`). It enforces the SAME on-chain trust root as the curator route
// (/api/gateway/curate → verifyMarketEngine): runtime code hash on the allowlist, activated, owner and quote
// asset equal to the per-chain env, pool tokens consistent, poolId matching. Only then does it write the
// `gateway_instances` row + an append-only `gateway_instance_history` entry, via the service-role REST API.
//
// Dry run by default (verifies and prints the row). `--apply` writes.
//
//   node --env-file=.env.local scripts/ops/register-market-engine.mjs \
//     --chain 84532 --engine 0x… --pool 0x…(32 bytes) --label "WETH / USDC" [--replace] [--apply]
//
// --replace deactivates any other active engine row for the same pool first (status 'inactive' plus a
// 'deactivate' history entry), for redeploys onto the same pool. The old engine stays readable on chain.
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and for the chain:
//   MARKET_ENGINE_CODEHASHES_<chainId>, MARKET_ENGINE_OWNER_<chainId>, MARKET_ENGINE_QUOTE_ASSET_<chainId>
//   (pass them inline if your env file doesn't carry them; they are public values).

import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbi } from 'viem'

const RPC = { 84532: 'https://base-sepolia-rpc.publicnode.com', 46630: 'https://rpc.testnet.chain.robinhood.com' }
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined }
const die = (m) => { console.error(`✗ ${m}`); process.exit(1) }

const chainId = Number(arg('chain'))
const engine = (arg('engine') ?? '').toLowerCase()
const pool = (arg('pool') ?? '').toLowerCase()
const label = (arg('label') ?? '').trim()
const APPLY = process.argv.includes('--apply')
const REPLACE = process.argv.includes('--replace')
if (!RPC[chainId]) die('--chain must be 84532 (Base Sepolia) or 46630 (Robinhood testnet)')
if (!/^0x[0-9a-f]{40}$/.test(engine)) die('--engine must be a 20-byte address')
if (!/^0x[0-9a-f]{64}$/.test(pool)) die('--pool must be a 32-byte v4 pool id')
if (!/^[A-Za-z0-9 ./_-]{1,40}$/.test(label)) die('--label must be short plain text, e.g. "WETH / USDC"')

const allow = (process.env[`MARKET_ENGINE_CODEHASHES_${chainId}`] ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
const owner = (process.env[`MARKET_ENGINE_OWNER_${chainId}`] ?? '').toLowerCase()
const quote = (process.env[`MARKET_ENGINE_QUOTE_ASSET_${chainId}`] ?? '').toLowerCase()
if (!allow.length || !owner || !quote) die(`set MARKET_ENGINE_{CODEHASHES,OWNER,QUOTE_ASSET}_${chainId}`)

// ── on-chain verification (mirrors lib/gateway/marketEngine.ts#verifyMarketEngine) ─────────────────────
const c = createPublicClient({ transport: http(RPC[chainId]) })
if (Number(await c.getChainId()) !== chainId) die('RPC chain id mismatch')
const code = await c.getCode({ address: engine })
if (!code || code === '0x') die('engine has no code')
const codeHash = keccak256(code).toLowerCase()
if (!allow.includes(codeHash)) die(`code hash ${codeHash} not allowlisted`)
const ABI = parseAbi([
  'function owner() view returns (address)', 'function quoteAsset() view returns (address)',
  'function token0() view returns (address)', 'function token1() view returns (address)',
  'function activated() view returns (bool)', 'function poolKey() view returns ((address,address,uint24,int24,address))',
  'function totalNav() view returns (uint256)',
])
const read = (fn) => c.readContract({ address: engine, abi: ABI, functionName: fn })
const [o, q, t0, t1, active, key] = await Promise.all(['owner', 'quoteAsset', 'token0', 'token1', 'activated', 'poolKey'].map(read))
if (!active) die('engine not activated')
if (o.toLowerCase() !== owner) die(`owner ${o} ≠ MARKET_ENGINE_OWNER_${chainId}`)
if (t0.toLowerCase() !== key[0].toLowerCase() || t1.toLowerCase() !== key[1].toLowerCase()) die('engine tokens ≠ pool key')
if (q.toLowerCase() !== quote) die(`quote ${q} ≠ MARKET_ENGINE_QUOTE_ASSET_${chainId}`)
const poolId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], key)).toLowerCase()
if (poolId !== pool) die(`engine pool ${poolId} ≠ --pool`)
await read('totalNav').catch((e) => die(`totalNav() reverts (${e.shortMessage ?? e.message}) — the market cannot be valued`))
console.log(`✓ verified ${engine} on chain ${chainId}: activated, owner ${o}, quote ${q}, pool ${poolId}, codehash ${codeHash}`)

const now = new Date().toISOString()
const paired = t0.toLowerCase() === quote ? t1.toLowerCase() : t0.toLowerCase()
const by = 'operator:register-market-engine'
const row = {
  pool_address: pool, chain_id: chainId, pair_label: label, position_manager: engine, staging: null,
  quote_asset: quote, paired_asset: paired, market_engine_address: engine, market_engine_code_hash: codeHash,
  market_engine_owner: o.toLowerCase(), market_engine_token0: t0.toLowerCase(), market_engine_token1: t1.toLowerCase(),
  engine_verified_at: now, verification: 'codehash', verified_by: by, verification_meta: { codeHash, owner: o.toLowerCase() },
  status: 'active', created_by: by, updated_at: now,
}

// ── registry write (service role) ──────────────────────────────────────────────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key2 = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key2) die('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
const H = { apikey: key2, Authorization: `Bearer ${key2}`, 'Content-Type': 'application/json' }
const rest = (path, init = {}) => fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } })

const existing = await (await rest(`gateway_instances?select=id,status,market_engine_address&pool_address=eq.${pool}&chain_id=eq.${chainId}`)).json()
if (!Array.isArray(existing)) die(`registry read failed: ${JSON.stringify(existing).slice(0, 200)}`)
const others = existing.filter((r) => r.status === 'active' && r.market_engine_address?.toLowerCase() !== engine)
if (others.length && !REPLACE) die('another active engine is registered for this pool — pass --replace to deactivate it')
if (others.length) console.log(`  will deactivate ${others.map((r) => `${r.id} (${r.market_engine_address})`).join(', ')}`)
const exact = existing.find((r) => r.market_engine_address?.toLowerCase() === engine)
console.log(`  registry: ${existing.length} row(s) for this pool; ${exact ? `updating ${exact.id}` : 'inserting a new row'}`)

if (!APPLY) { console.log('\nDry run only. Re-run with --apply to register.'); process.exit(0) }

for (const r of others) {
  const d = await rest(`gateway_instances?id=eq.${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'inactive', updated_at: now }) })
  if (!d.ok) die(`deactivate ${r.id} failed (${d.status}): ${(await d.text()).slice(0, 200)}`)
  const h = await rest('gateway_instance_history', { method: 'POST', body: JSON.stringify({ pool_address: pool, chain_id: chainId, action: 'deactivate', position_manager: r.market_engine_address, staging: null, verification: 'codehash', actor: by, meta: { replacedBy: engine } }) })
  if (!h.ok) console.warn(`! history append for ${r.id} failed (${h.status})`)
  console.log(`✓ deactivated ${r.id} (${r.market_engine_address})`)
}

const res = exact
  ? await rest(`gateway_instances?id=eq.${exact.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) })
  : await rest('gateway_instances', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) })
const written = await res.json()
if (!res.ok) die(`registry write failed (${res.status}): ${JSON.stringify(written).slice(0, 300)}`)
const hist = await rest('gateway_instance_history', { method: 'POST', body: JSON.stringify({ pool_address: pool, chain_id: chainId, action: 'register', position_manager: engine, staging: null, verification: 'codehash', actor: by, meta: { marketEngine: engine, codeHash, owner: o.toLowerCase() } }) })
if (!hist.ok) console.warn(`! history append failed (${hist.status}) — the instance row is written`)
console.log(`✓ registered ${label} on chain ${chainId} (row ${written[0]?.id ?? exact?.id})`)
