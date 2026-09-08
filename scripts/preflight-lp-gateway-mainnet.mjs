#!/usr/bin/env node
// READ-ONLY mainnet preflight for the LP Gateway V1 on Robinhood Chain (4663). Sends NO transactions —
// every check is an eth_call / eth_getCode / eth_getStorageAt / eth_getBalance. Exits non-zero on any FAIL.
//
// The deploy script (`scripts/deploy-lp-gateway-mainnet.mjs`) imports `runPreflight` and refuses to deploy
// unless every row PASSes, so this is the single gate a real deploy has to clear. Run it standalone first.
//
// What it verifies (audit refs in brackets — docs/developers/audits/2026-09-08-consolidated.md §4,
// docs/developers/lp-gateway-v1-realfunds-audit-findings.md §8 M-07):
//   chain      · RPC chain id == 4663; canonical V4 PoolManager / PositionManager / Permit2 have code,
//                PositionManager.poolManager() == PoolManager.
//   USDG       · address == the Paxos-documented RH-mainnet USDG; symbol USDG; decimals 6; EIP-1967 proxy
//                (impl non-zero — Paxos UUPS, M-07); paused()==false; signer + harvest recipient not frozen.
//   source     · LP_GATEWAY_YIELD_SOURCE (a Morpho / ERC-4626 vault) has code; asset()==USDG; totalAssets()>0;
//                maxDeposit(signer)>0; previewRedeem works; prints name / symbol / total assets.
//   pool       · the target v4 pool key resolves (LP_GATEWAY_POOL_ID via PositionManager.poolKeys, or the
//                explicit LP_GATEWAY_POOL_CURRENCY0/1 + FEE + TICK_SPACING + HOOKS) and is initialized on the
//                canonical PoolManager; hooks == 0x0 [A-6]; USDG is one currency; paired != 0x0 [A-8];
//                in-range liquidity ≥ LP_GATEWAY_MIN_POOL_LIQUIDITY (absolute L, REQUIRED — no silent 0);
//                USDG-side depth estimate ≥ LP_GATEWAY_MIN_POOL_USDG (default 250,000 USDG);
//                the deploy tick range (LP_TICK_LOWER/UPPER, default symmetric ±22980 aligned to tickSpacing)
//                is ordered, aligned, and contains the current tick.
//   paired     · code exists; prints name / symbol / decimals / totalSupply; ADMIN-CONTROL heuristics
//                (EIP-1967 impl slot → proxy; owner() answers; paused() answers; bytecode contains the
//                selectors for pause / blacklist / freeze / wipe / upgrade / mint; eth_call probes for
//                isBlacklisted / isFrozen) — ANY flag = FAIL unless LP_GATEWAY_ALLOW_ADMIN_TOKEN=true, which
//                the runbook says never to set [C-2 / C-10 / RT-6 residuals].
//   signer     · GATEWAY_ORACLE_PRIVY_ADDRESS has gas.
//
// Usage (from repo root; never paste secrets on the command line — use an env file):
//   node --env-file=.env.lp-gateway-mainnet scripts/preflight-lp-gateway-mainnet.mjs
//   pnpm preflight:lp-gateway:mainnet

import { fileURLToPath } from 'node:url'
import {
  createPublicClient, http, formatEther, formatUnits, keccak256, encodeAbiParameters, toFunctionSelector,
  getAddress, isAddress, hexToBigInt, pad, toHex, encodeFunctionData,
} from 'viem'

// ── constants (Robinhood Chain mainnet; V4 verified byte-identical to canonical) ──
export const RH_MAINNET_CHAIN_ID = 4663
export const RH_MAINNET_RPC = 'https://rpc.mainnet.chain.robinhood.com'
export const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951'
export const POSITION_MANAGER = '0x58daec3116aae6D93017bAAea7749052E8a04fA7'
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
// Paxos-documented USDG on "Robinhood Mainnet" (docs.paxos.com/guides/stablecoin/usdg/mainnet) — verified
// Paxos-NATIVE UUPS issuance in the real-funds re-audit (M-07). Any other address is a FAIL.
export const PAXOS_USDG_RH_MAINNET = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
export const ZERO = '0x0000000000000000000000000000000000000000'
const EIP1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const EIP1967_ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103'
const POOLS_SLOT = 6n // v4-core StateLibrary.POOLS_SLOT
const LIQUIDITY_OFFSET = 3n // v4-core StateLibrary.LIQUIDITY_OFFSET
const Q96 = 2n ** 96n
const DEFAULT_HALF_RANGE_TICKS = 22980 // ~10x-up / −90%-down; the testnet default (see runbook "IL control")
const DEFAULT_MIN_POOL_USDG = 250_000n // whole USDG

// ── minimal ABIs ──
const ERC20_ABI = [
  { type: 'function', stateMutability: 'view', name: 'name', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', stateMutability: 'view', name: 'symbol', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', stateMutability: 'view', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', stateMutability: 'view', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'balanceOf', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'paused', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', stateMutability: 'view', name: 'owner', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', stateMutability: 'view', name: 'isFrozen', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', stateMutability: 'view', name: 'isBlacklisted', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
]
const ERC4626_ABI = [
  ...ERC20_ABI,
  { type: 'function', stateMutability: 'view', name: 'asset', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', stateMutability: 'view', name: 'totalAssets', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'maxDeposit', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'convertToShares', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'previewRedeem', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
]
const POOL_KEY_COMPONENTS = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
]
const POSM_ABI = [
  { type: 'function', stateMutability: 'view', name: 'poolManager', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function', stateMutability: 'view', name: 'poolKeys', inputs: [{ name: 'poolId', type: 'bytes25' }],
    outputs: POOL_KEY_COMPONENTS,
  },
]
const PM_EXTSLOAD_ABI = [
  { type: 'function', stateMutability: 'view', name: 'extsload', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
]

// Selectors whose PRESENCE in a paired token's bytecode flags an admin control. Computed, not hand-typed.
const ADMIN_SIGS = [
  'pause()', 'unpause()',
  'blacklist(address)', 'unBlacklist(address)', 'addBlackList(address)', 'removeBlackList(address)',
  'setBlacklisted(address,bool)', 'isBlacklisted(address)', 'getBlackListStatus(address)', 'blacklisted(address)',
  'freeze(address)', 'unfreeze(address)', 'isFrozen(address)', 'frozen(address)', 'wipeFrozenAddress(address)',
  'destroyBlackFunds(address)',
  'upgradeTo(address)', 'upgradeToAndCall(address,bytes)',
  'mint(address,uint256)',
]

// ── tiny helpers ──
export function poolIdOf(key) {
  return keccak256(encodeAbiParameters(POOL_KEY_COMPONENTS, [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]))
}
function stateSlot(poolId) {
  return hexToBigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [poolId, POOLS_SLOT])))
}
export function alignTick(t, spacing) {
  const s = Number(spacing)
  return Math.trunc(t / s) * s
}
function fmtUsdg(atomic) {
  return Number(formatUnits(atomic, 6)).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
const sqrtPriceToTick = (sqrtP) => Math.floor(Math.log((Number(sqrtP) / 2 ** 96) ** 2) / Math.log(1.0001))
function tickToSqrtPrice(tick) {
  return BigInt(Math.floor(Math.sqrt(1.0001 ** tick) * 2 ** 96))
}

/** Resolve the run configuration from env. Pure — no network. Throws on malformed input. */
export function resolveConfig(env = process.env) {
  const chainId = Number(env.LP_GATEWAY_CHAIN_ID ?? RH_MAINNET_CHAIN_ID)
  const rpc = env.LP_GATEWAY_RPC_URL ?? RH_MAINNET_RPC
  const usdg = env.LP_GATEWAY_USDG ?? PAXOS_USDG_RH_MAINNET
  const yieldSource = env.LP_GATEWAY_YIELD_SOURCE ?? ''
  const signer = env.GATEWAY_ORACLE_PRIVY_ADDRESS ?? ''
  const harvestRecipient = env.LP_GATEWAY_HARVEST_RECIPIENT ?? signer
  const poolId = env.LP_GATEWAY_POOL_ID ?? ''
  const explicitKey = env.LP_GATEWAY_POOL_CURRENCY0 && env.LP_GATEWAY_POOL_CURRENCY1
    ? {
        currency0: getAddress(env.LP_GATEWAY_POOL_CURRENCY0),
        currency1: getAddress(env.LP_GATEWAY_POOL_CURRENCY1),
        fee: Number(env.LP_GATEWAY_POOL_FEE ?? 3000),
        tickSpacing: Number(env.LP_GATEWAY_POOL_TICK_SPACING ?? 60),
        hooks: getAddress(env.LP_GATEWAY_POOL_HOOKS ?? ZERO),
      }
    : null
  const minPoolLiquidity = env.LP_GATEWAY_MIN_POOL_LIQUIDITY ? BigInt(env.LP_GATEWAY_MIN_POOL_LIQUIDITY) : null
  const minPoolUsdg = BigInt(env.LP_GATEWAY_MIN_POOL_USDG ?? DEFAULT_MIN_POOL_USDG) * 10n ** 6n
  const allowAdminToken = (env.LP_GATEWAY_ALLOW_ADMIN_TOKEN ?? '').toLowerCase() === 'true'
  const tickLower = env.LP_TICK_LOWER != null ? Number(env.LP_TICK_LOWER) : null
  const tickUpper = env.LP_TICK_UPPER != null ? Number(env.LP_TICK_UPPER) : null
  const maxDeviationBps = Number(env.LP_MAX_DEVIATION_BPS ?? 500)
  return {
    chainId, rpc, usdg, yieldSource, signer, harvestRecipient, poolId, explicitKey, minPoolLiquidity, minPoolUsdg,
    allowAdminToken, tickLower, tickUpper, maxDeviationBps,
  }
}

/**
 * Run every read-only check. Returns `{ ok, rows, resolved }` — `resolved` carries the on-chain-derived facts
 * the deploy script needs (pool key, quote-is-currency0, aligned ticks, current tick, decimals).
 */
export async function runPreflight(env = process.env, { log = console.log } = {}) {
  const cfg = resolveConfig(env)
  const rows = []
  const resolved = { poolKey: null, poolId: null, tickLower: null, tickUpper: null, currentTick: null, paired: null, adminFlags: [] }
  const pass = (group, check, detail = '') => rows.push({ group, check, status: 'PASS', detail })
  const fail = (group, check, detail = '') => rows.push({ group, check, status: 'FAIL', detail })
  const info = (group, check, detail = '') => rows.push({ group, check, status: 'INFO', detail })
  const expect = (cond, group, check, detail) => (cond ? pass(group, check, detail) : fail(group, check, detail))

  const pub = createPublicClient({ transport: http(cfg.rpc, { timeout: 30_000 }) })
  const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args })
  const tryRead = async (address, abi, functionName, args = []) => {
    try { return { ok: true, value: await read(address, abi, functionName, args) } } catch (e) { return { ok: false, error: e } }
  }
  const codeLen = async (a) => { const c = await pub.getBytecode({ address: a }); return c && c !== '0x' ? (c.length - 2) / 2 : 0 }

  // ── 1. chain + canonical V4 stack ──
  let cid = null
  try { cid = await pub.getChainId() } catch (e) { fail('chain', 'rpc reachable', String(e?.shortMessage ?? e)) }
  if (cid != null) expect(cid === cfg.chainId, 'chain', `chain id == ${cfg.chainId}`, `rpc reports ${cid}`)
  if (cfg.chainId !== RH_MAINNET_CHAIN_ID) info('chain', 'NOT Robinhood mainnet', `configured ${cfg.chainId} — this preflight is written for 4663`)
  for (const [label, addr] of [['PoolManager', POOL_MANAGER], ['PositionManager', POSITION_MANAGER], ['Permit2', PERMIT2]]) {
    const n = cid == null ? 0 : await codeLen(addr)
    expect(n > 0, 'chain', `${label} has code`, `${addr} · ${n} bytes`)
  }
  if (cid != null) {
    const pm = await tryRead(POSITION_MANAGER, POSM_ABI, 'poolManager')
    expect(pm.ok && pm.value.toLowerCase() === POOL_MANAGER.toLowerCase(), 'chain', 'PositionManager.poolManager() == PoolManager', pm.ok ? pm.value : 'call failed')
  }
  if (cid == null || cid !== cfg.chainId) return finish(rows, resolved, log)

  // ── 2. USDG (quote asset) ──
  expect(isAddress(cfg.usdg) && cfg.usdg.toLowerCase() === PAXOS_USDG_RH_MAINNET.toLowerCase(), 'usdg', 'address == Paxos-documented RH-mainnet USDG', cfg.usdg)
  const usdgCode = await codeLen(cfg.usdg)
  expect(usdgCode > 0, 'usdg', 'has code', `${usdgCode} bytes`)
  if (usdgCode > 0) {
    const sym = await tryRead(cfg.usdg, ERC20_ABI, 'symbol')
    expect(sym.ok && sym.value === 'USDG', 'usdg', 'symbol() == USDG', sym.ok ? sym.value : 'call failed')
    const dec = await tryRead(cfg.usdg, ERC20_ABI, 'decimals')
    expect(dec.ok && Number(dec.value) === 6, 'usdg', 'decimals() == 6', dec.ok ? String(dec.value) : 'call failed')
    const impl = await pub.getStorageAt({ address: cfg.usdg, slot: EIP1967_IMPL_SLOT })
    const implAddr = impl ? getAddress('0x' + impl.slice(-40)) : ZERO
    expect(implAddr !== ZERO, 'usdg', 'EIP-1967 proxy (impl non-zero — Paxos UUPS, M-07)', `impl ${implAddr}`)
    const admin = await pub.getStorageAt({ address: cfg.usdg, slot: EIP1967_ADMIN_SLOT })
    info('usdg', 'EIP-1967 admin slot', admin && hexToBigInt(admin) !== 0n ? getAddress('0x' + admin.slice(-40)) : 'zero (UUPS — upgrade authority lives in the implementation)')
    const paused = await tryRead(cfg.usdg, ERC20_ABI, 'paused')
    expect(paused.ok && paused.value === false, 'usdg', 'paused() == false', paused.ok ? String(paused.value) : 'call failed')
    const supply = await tryRead(cfg.usdg, ERC20_ABI, 'totalSupply')
    if (supply.ok) info('usdg', 'totalSupply', `${fmtUsdg(supply.value)} USDG`)
    for (const [label, addr] of [['gateway signer', cfg.signer], ['harvest recipient', cfg.harvestRecipient]]) {
      if (!isAddress(addr ?? '')) continue
      const fz = await tryRead(cfg.usdg, ERC20_ABI, 'isFrozen', [addr])
      expect(fz.ok && fz.value === false, 'usdg', `${label} not frozen by issuer`, fz.ok ? `isFrozen(${addr}) = ${fz.value}` : 'isFrozen call failed')
    }
  }

  // ── 3. yield source (Morpho / ERC-4626 over USDG) ──
  if (!isAddress(cfg.yieldSource)) {
    fail('source', 'LP_GATEWAY_YIELD_SOURCE set', 'unset / not an address — the curated Morpho USDG vault (see runbook)')
  } else {
    const n = await codeLen(cfg.yieldSource)
    expect(n > 0, 'source', 'has code', `${cfg.yieldSource} · ${n} bytes`)
    if (n > 0) {
      const asset = await tryRead(cfg.yieldSource, ERC4626_ABI, 'asset')
      expect(asset.ok && asset.value.toLowerCase() === cfg.usdg.toLowerCase(), 'source', 'asset() == USDG', asset.ok ? asset.value : 'call failed')
      const name = await tryRead(cfg.yieldSource, ERC4626_ABI, 'name')
      const sym = await tryRead(cfg.yieldSource, ERC4626_ABI, 'symbol')
      info('source', 'name / symbol', `${name.ok ? name.value : '?'} / ${sym.ok ? sym.value : '?'}`)
      const ta = await tryRead(cfg.yieldSource, ERC4626_ABI, 'totalAssets')
      expect(ta.ok && ta.value > 0n, 'source', 'totalAssets() > 0', ta.ok ? `${fmtUsdg(ta.value)} USDG` : 'call failed')
      const md = await tryRead(cfg.yieldSource, ERC4626_ABI, 'maxDeposit', [isAddress(cfg.signer ?? '') ? cfg.signer : ZERO])
      expect(md.ok && md.value > 0n, 'source', 'maxDeposit(signer) > 0 (supply cap open)', md.ok ? (md.value > 10n ** 30n ? 'uncapped' : `${fmtUsdg(md.value)} USDG`) : 'call failed')
      const sh = await tryRead(cfg.yieldSource, ERC4626_ABI, 'convertToShares', [1_000_000n])
      const pr = sh.ok ? await tryRead(cfg.yieldSource, ERC4626_ABI, 'previewRedeem', [sh.value]) : { ok: false }
      expect(pr.ok && pr.value > 0n, 'source', 'previewRedeem(convertToShares(1 USDG)) works [C-10]', pr.ok ? `${formatUnits(pr.value, 6)} USDG` : 'reverted — the adapter NAV read would brick')
    }
  }

  // ── 4. target pool ──
  let key = null
  if (cfg.poolId) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(cfg.poolId)) {
      fail('pool', 'LP_GATEWAY_POOL_ID is a 32-byte v4 poolId', cfg.poolId)
    } else {
      const k = await tryRead(POSITION_MANAGER, POSM_ABI, 'poolKeys', [cfg.poolId.slice(0, 52)])
      if (k.ok && Number(k.value[3]) !== 0) {
        key = { currency0: getAddress(k.value[0]), currency1: getAddress(k.value[1]), fee: Number(k.value[2]), tickSpacing: Number(k.value[3]), hooks: getAddress(k.value[4]) }
        pass('pool', 'pool key resolved via PositionManager.poolKeys(poolId)', `${key.currency0} / ${key.currency1} · fee ${key.fee} · spacing ${key.tickSpacing} · hooks ${key.hooks}`)
        if (cfg.explicitKey && poolIdOf(cfg.explicitKey).toLowerCase() !== cfg.poolId.toLowerCase()) {
          fail('pool', 'explicit LP_GATEWAY_POOL_* key matches LP_GATEWAY_POOL_ID', `explicit key hashes to ${poolIdOf(cfg.explicitKey)}`)
        }
      } else if (cfg.explicitKey) {
        key = cfg.explicitKey
        info('pool', 'poolKeys(poolId) unknown to the PositionManager (no official-periphery mint yet) — using the explicit key', '')
        expect(poolIdOf(key).toLowerCase() === cfg.poolId.toLowerCase(), 'pool', 'explicit key hashes to LP_GATEWAY_POOL_ID', poolIdOf(key))
      } else {
        fail('pool', 'pool key resolvable', 'PositionManager.poolKeys() has no entry for this id — pass LP_GATEWAY_POOL_CURRENCY0/1 + FEE + TICK_SPACING explicitly')
      }
    }
  } else if (cfg.explicitKey) {
    key = cfg.explicitKey
  } else {
    fail('pool', 'pool configured', 'set LP_GATEWAY_POOL_ID (32-byte v4 poolId) or LP_GATEWAY_POOL_CURRENCY0/1 (+ FEE, TICK_SPACING)')
  }

  if (key) {
    if (key.currency0.toLowerCase() >= key.currency1.toLowerCase()) fail('pool', 'currencies sorted (currency0 < currency1)', `${key.currency0} !< ${key.currency1}`)
    const id = poolIdOf(key)
    resolved.poolKey = key
    resolved.poolId = id
    const slot = stateSlot(id)
    const slot0 = await tryRead(POOL_MANAGER, PM_EXTSLOAD_ABI, 'extsload', [pad(toHex(slot), { size: 32 })])
    const liqRaw = await tryRead(POOL_MANAGER, PM_EXTSLOAD_ABI, 'extsload', [pad(toHex(slot + LIQUIDITY_OFFSET), { size: 32 })])
    const sqrtP = slot0.ok ? hexToBigInt(slot0.value) & ((1n << 160n) - 1n) : 0n
    expect(sqrtP > 0n, 'pool', 'pool initialized on canonical PoolManager', `poolId ${id}`)
    expect(key.hooks === ZERO, 'pool', 'hooks == 0x0 [A-6]', key.hooks)
    const q0 = key.currency0.toLowerCase() === cfg.usdg.toLowerCase()
    const q1 = key.currency1.toLowerCase() === cfg.usdg.toLowerCase()
    expect(q0 || q1, 'pool', 'USDG is one of the currencies', q0 ? 'USDG = currency0' : q1 ? 'USDG = currency1' : 'neither')
    const paired = q0 ? key.currency1 : key.currency0
    resolved.paired = paired
    resolved.quoteIsCurrency0 = q0
    expect(paired !== ZERO, 'pool', 'paired token != 0x0 (no native-ETH pools) [A-8]', paired)

    if (sqrtP > 0n) {
      const tick = sqrtPriceToTick(sqrtP)
      resolved.currentTick = tick
      const liq = liqRaw.ok ? hexToBigInt(liqRaw.value) & ((1n << 128n) - 1n) : 0n
      info('pool', 'spot', `sqrtPriceX96 ${sqrtP} · tick ${tick} · in-range L ${liq}`)
      if (cfg.minPoolLiquidity == null) {
        fail('pool', 'LP_GATEWAY_MIN_POOL_LIQUIDITY set (absolute L, fail-closed like the cron)', `unset — current in-range L is ${liq}; set a floor ≤ ~50% of it`)
      } else {
        expect(cfg.minPoolLiquidity > 0n && liq >= cfg.minPoolLiquidity, 'pool', 'in-range liquidity ≥ LP_GATEWAY_MIN_POOL_LIQUIDITY', `L ${liq} vs floor ${cfg.minPoolLiquidity}`)
      }
      // USDG-side depth estimate from active liquidity (a v3-style "virtual reserve"): currency1 amount = L·√P/Q96,
      // currency0 amount = L·Q96/√P. Concentrated liquidity makes this an UPPER-bound-ish estimate of what sits in
      // the pool on the USDG side; the ±2% figure is the practical "how much USDG moves price 2%" depth.
      const virtualUsdg = q1 ? (liq * sqrtP) / Q96 : (liq * Q96) / sqrtP
      const sqrtUp2 = (sqrtP * 100995n) / 100000n // √1.02 ≈ 1.00995
      const sqrtDn2 = (sqrtP * 98995n) / 100000n // √0.98 ≈ 0.98995
      const depth2 = q1
        ? (liq * (sqrtUp2 - sqrtP)) / Q96 // USDG in to push price up 2%
        : (liq * Q96 * (sqrtP - sqrtDn2)) / (sqrtP * sqrtDn2) // USDG in to push price down 2%
      info('pool', 'USDG depth (est.)', `virtual USDG reserve ≈ ${fmtUsdg(virtualUsdg)} · ±2% move ≈ ${fmtUsdg(depth2)} USDG`)
      expect(virtualUsdg >= cfg.minPoolUsdg, 'pool', 'USDG-side depth est. ≥ LP_GATEWAY_MIN_POOL_USDG', `${fmtUsdg(virtualUsdg)} vs floor ${fmtUsdg(cfg.minPoolUsdg)} USDG`)

      // deploy tick range: env, or the default — symmetric ±22980 ticks AROUND SPOT (≈ −90% / +10x), each bound
      // aligned to tickSpacing. NOT around tick 0: a 6dp/18dp pair trades hundreds of thousands of ticks from 0.
      // Must be ordered, aligned, and hold the current tick, or the first deploy is out-of-range at birth.
      const half = alignTick(DEFAULT_HALF_RANGE_TICKS, key.tickSpacing)
      const center = alignTick(tick, key.tickSpacing)
      const tl = cfg.tickLower ?? center - half
      const tu = cfg.tickUpper ?? center + half
      resolved.tickLower = tl
      resolved.tickUpper = tu
      const rangeSrc = cfg.tickLower == null && cfg.tickUpper == null ? 'default: spot-centered ±' + half : 'env LP_TICK_LOWER/UPPER'
      expect(tl < tu && tl % key.tickSpacing === 0 && tu % key.tickSpacing === 0, 'pool', 'deploy ticks ordered + aligned to tickSpacing [A-8]', `[${tl}, ${tu}] · spacing ${key.tickSpacing} · ${rangeSrc}`)
      expect(tick > tl && tick < tu, 'pool', 'current tick inside the deploy range (not out-of-range at birth)', `tick ${tick} ∈ (${tl}, ${tu})`)
      const downPct = (1 - 1.0001 ** (tl - tick)) * 100
      const upX = 1.0001 ** (tu - tick)
      info('pool', 'range coverage (est.)', `stays in range from −${downPct.toFixed(1)}% to ${upX.toFixed(2)}× of spot`)
    }
    expect(cfg.maxDeviationBps > 0 && cfg.maxDeviationBps <= 5000, 'pool', 'LP_MAX_DEVIATION_BPS in (0, 5000]', String(cfg.maxDeviationBps))

    // ── 5. paired token — admin-control heuristics ──
    if (paired !== ZERO) {
      const n = await codeLen(paired)
      expect(n > 0, 'paired', 'has code', `${paired} · ${n} bytes`)
      if (n > 0) {
        const [name, sym, dec, ts] = await Promise.all(['name', 'symbol', 'decimals', 'totalSupply'].map((f) => tryRead(paired, ERC20_ABI, f)))
        resolved.pairedDecimals = dec.ok ? Number(dec.value) : null
        info('paired', 'name / symbol / decimals', `${name.ok ? name.value : '?'} / ${sym.ok ? sym.value : '?'} / ${dec.ok ? dec.value : '?'}`)
        info('paired', 'totalSupply', ts.ok && dec.ok ? `${Number(formatUnits(ts.value, Number(dec.value))).toLocaleString('en-US', { maximumFractionDigits: 0 })} ${sym.ok ? sym.value : ''}` : '?')
        const flags = []
        const impl = await pub.getStorageAt({ address: paired, slot: EIP1967_IMPL_SLOT })
        const implAddr = impl && hexToBigInt(impl) !== 0n ? getAddress('0x' + impl.slice(-40)) : null
        if (implAddr) flags.push(`EIP-1967 proxy (impl ${implAddr})`)
        const owner = await tryRead(paired, ERC20_ABI, 'owner')
        if (owner.ok && owner.value !== ZERO) flags.push(`owner() = ${owner.value}`)
        const paused = await tryRead(paired, ERC20_ABI, 'paused')
        if (paused.ok) flags.push(`paused() answers (${paused.value})`)
        const probeAddr = isAddress(cfg.signer ?? '') ? cfg.signer : ZERO
        const bl = await tryRead(paired, ERC20_ABI, 'isBlacklisted', [probeAddr])
        if (bl.ok) flags.push(`isBlacklisted() answers (${bl.value})`)
        const fz = await tryRead(paired, ERC20_ABI, 'isFrozen', [probeAddr])
        if (fz.ok) flags.push(`isFrozen() answers (${fz.value})`)
        // bytecode selector scan — token code AND (if proxied) the implementation code
        const codes = [await pub.getBytecode({ address: paired })]
        if (implAddr) codes.push(await pub.getBytecode({ address: implAddr }))
        const hexCode = codes.filter(Boolean).map((c) => c.slice(2).toLowerCase()).join('|')
        const hits = ADMIN_SIGS.filter((sig) => hexCode.includes(toFunctionSelector(sig).slice(2).toLowerCase()))
        if (hits.length) flags.push(`selectors in bytecode: ${hits.join(', ')}`)
        resolved.adminFlags = flags
        if (flags.length === 0) {
          pass('paired', 'no admin controls detected (proxy / owner / pause / blacklist / freeze / upgrade / mint)', 'heuristic — the curation policy still requires a human review')
        } else if (cfg.allowAdminToken) {
          rows.push({ group: 'paired', check: 'ADMIN CONTROLS detected — OVERRIDDEN by LP_GATEWAY_ALLOW_ADMIN_TOKEN=true', status: 'WARN', detail: flags.join(' · ') })
        } else {
          fail('paired', 'ADMIN CONTROLS detected — refused [C-2 / C-10 / RT-6 residuals; curation policy]', flags.join(' · '))
        }
      }
    }
  }

  // ── 6. signer ──
  if (!isAddress(cfg.signer ?? '')) {
    fail('signer', 'GATEWAY_ORACLE_PRIVY_ADDRESS set', 'unset — the dedicated `gateway` Privy seat (never the shared root)')
  } else {
    const bal = await pub.getBalance({ address: cfg.signer })
    expect(bal > 0n, 'signer', 'gateway signer has gas', `${cfg.signer} · ${formatEther(bal)} ETH`)
    const scode = await codeLen(cfg.signer)
    expect(scode === 0, 'signer', 'gateway signer is an EOA (Privy wallet)', scode === 0 ? 'no code' : `${scode} bytes of code`)
  }
  if (isAddress(cfg.harvestRecipient ?? '')) {
    info('signer', 'harvest recipient', cfg.harvestRecipient.toLowerCase() === (cfg.signer ?? '').toLowerCase() ? `${cfg.harvestRecipient} (= gateway signer; restake-compatible)` : `${cfg.harvestRecipient} (separate address — LP_GATEWAY_HARVEST_DESTINATION=restake needs the SIGNER to hold the fees; see runbook)`)
  } else {
    fail('signer', 'LP_GATEWAY_HARVEST_RECIPIENT is an address', cfg.harvestRecipient || 'unset')
  }

  return finish(rows, resolved, log)
}

function finish(rows, resolved, log) {
  const ok = rows.every((r) => r.status !== 'FAIL')
  const w = Math.max(...rows.map((r) => r.check.length), 10)
  log('')
  log(`LP Gateway V1 — MAINNET PREFLIGHT (read-only) · ${new Date().toISOString()}`)
  log('─'.repeat(w + 26))
  let lastGroup = ''
  for (const r of rows) {
    if (r.group !== lastGroup) { log(`[${r.group}]`); lastGroup = r.group }
    const mark = r.status === 'PASS' ? '✓ PASS' : r.status === 'FAIL' ? '✗ FAIL' : r.status === 'WARN' ? '! WARN' : '· info'
    log(`  ${mark}  ${r.check.padEnd(w)}  ${r.detail}`)
  }
  log('─'.repeat(w + 26))
  const nFail = rows.filter((r) => r.status === 'FAIL').length
  log(ok ? `RESULT: PASS (${rows.filter((r) => r.status === 'PASS').length} checks, 0 failures)` : `RESULT: FAIL (${nFail} failure${nFail === 1 ? '' : 's'}) — do NOT deploy`)
  log('')
  return { ok, rows, resolved }
}

// `encodeFunctionData` is re-exported for the deploy script's dry-run printout.
export { encodeFunctionData }

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const { ok } = await runPreflight(process.env)
  process.exit(ok ? 0 : 1)
}
