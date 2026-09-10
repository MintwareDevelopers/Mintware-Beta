import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encodeEventTopics, encodeAbiParameters } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { buildGatewayDepositMessage, buildGatewayWithdrawMessage } from '@/lib/web3/signedActionMessages'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { fakeSupabase, type FakeDb } from '@/lib/gateway/__audit__/fakeSupabase'
import { _resetReplayGuard } from '@/lib/gateway/recordAuth'

// Round-4 audit fix: deposit/withdraw now call one atomic RPC per direction
// (record_gateway_deposit_event / record_gateway_withdraw_event) instead of a two-step insert+upsert —
// see supabase/migrations/20260909000001_gateway_position_atomic_writes.sql for the real SQL. This
// emulates the SAME semantics against fakeSupabase's in-memory tables for these route tests.
function gatewayPositionRpc(fn: string, args: Record<string, unknown>, db: FakeDb) {
  const tx = String(args.p_tx_hash).toLowerCase()
  const address = String(args.p_address).toLowerCase()
  const pool = String(args.p_pool_address).toLowerCase()
  const chainId = args.p_chain_id
  const events = (db.tables.gateway_deposit_events ??= [])
  const positions = (db.tables.gateway_positions ??= [])
  const alreadyRecorded = events.some((e) => String(e.tx_hash).toLowerCase() === tx)

  if (fn === 'record_gateway_deposit_event') {
    if (!alreadyRecorded) events.push({ id: `ev-${events.length + 1}`, tx_hash: tx, address, kind: 'deposit', pool_address: pool, chain_id: chainId, quote_in: String(args.p_quote_in) })
    const quoteIn = BigInt(String(args.p_quote_in))
    const onChainShares = String(args.p_on_chain_shares)
    let pos = positions.find((p) => String(p.user_wallet).toLowerCase() === address && String(p.pool_address).toLowerCase() === pool && p.chain_id === chainId)
    if (!pos) {
      pos = { id: `pos-${positions.length + 1}`, user_wallet: address, pool_address: pool, chain_id: chainId, shares: onChainShares, entry_nav: alreadyRecorded ? '0' : quoteIn.toString() }
      positions.push(pos)
    } else {
      pos.shares = onChainShares
      pos.entry_nav = alreadyRecorded ? String(pos.entry_nav ?? '0') : (BigInt(String(pos.entry_nav ?? '0')) + quoteIn).toString()
    }
    return Promise.resolve({ data: [{ cost_basis_atomic: pos.entry_nav, already_recorded: alreadyRecorded }], error: null })
  }
  if (fn === 'record_gateway_withdraw_event') {
    if (!alreadyRecorded) events.push({ id: `ev-${events.length + 1}`, tx_hash: tx, address, kind: 'withdraw', pool_address: pool, chain_id: chainId, quote_out: String(args.p_quote_out) })
    const pos = positions.find((p) => String(p.user_wallet).toLowerCase() === address && String(p.pool_address).toLowerCase() === pool && p.chain_id === chainId)
    if (!pos) return Promise.resolve({ data: [{ cost_basis_atomic: null, already_recorded: alreadyRecorded, position_found: false }], error: null })
    const onChainShares = BigInt(String(args.p_on_chain_shares))
    const sharesBurned = BigInt(String(args.p_shares_burned))
    pos.shares = onChainShares.toString()
    if (!alreadyRecorded) {
      const priorShares = onChainShares + sharesBurned
      const priorBasis = BigInt(String(pos.entry_nav ?? '0'))
      pos.entry_nav = onChainShares === 0n || priorShares === 0n ? '0' : ((priorBasis * onChainShares) / priorShares).toString()
    }
    return Promise.resolve({ data: [{ cost_basis_atomic: pos.entry_nav, already_recorded: alreadyRecorded, position_found: true }], error: null })
  }
  return Promise.resolve({ data: null, error: { message: `rpc ${fn} not emulated` } })
}

// O-1 + O-10 closeout for the record routes: the exact body the UI now sends (signed message + tx
// hash + poolId) is accepted; the signed txHash/pool are strict-compared to the body; a re-presented
// signature is refused; strict pool resolution (O-2) applies.

const state = vi.hoisted(() => ({
  supabase: null as unknown,
  cfg: null as unknown,
  receipt: null as unknown,
  sharesOf: 0n,
  // V1-04 fix test hook: sharesOf AS OF a specific historical block, keyed by block number (string) —
  // lets a test simulate "current" shares (state.sharesOf) differing from what the withdrawal's OWN
  // block would have shown, to prove the RPC is fed the historically-correct value.
  sharesOfAtBlock: null as Map<string, bigint> | null,
}))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => state.supabase }))
vi.mock('@/lib/gateway/chain', () => ({
  gatewayConfig: () => state.cfg,
  gatewayPublicClient: () => ({
    getTransactionReceipt: async () => { if (!state.receipt) throw new Error('not found'); return state.receipt },
    readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
      if (functionName !== 'sharesOf') throw new Error(functionName)
      if (blockNumber != null && state.sharesOfAtBlock?.has(blockNumber.toString())) {
        return state.sharesOfAtBlock.get(blockNumber.toString())
      }
      return state.sharesOf
    },
  }),
}))

// throwaway test key (hardhat #0 — public, worthless)
const wallet = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const USER = wallet.address.toLowerCase()
const REG_PM = '0x00000000000000000000000000000000000000aa'
const POOL_ID = '0x' + 'ab'.repeat(32)
const TX = ('0x' + 'aa'.repeat(32)) as `0x${string}`
const cfg = { chainId: 46630, rpcUrl: 'http://rpc.test', positionManager: null, staging: null, poolAddress: null }
const registryRow = { pool_address: POOL_ID, chain_id: 46630, position_manager: REG_PM, staging: '0x' + '11'.repeat(20), quote_asset: '0x' + '22'.repeat(20), status: 'active' }

function depositedLog(user: string, quoteIn: bigint, shares: bigint) {
  return {
    address: REG_PM,
    topics: encodeEventTopics({ abi: LP_GATEWAY_ABI, eventName: 'Deposited', args: { user: user as `0x${string}` } }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [quoteIn, shares]),
  }
}
function withdrawnLog(user: string, burned: bigint, quoteOut: bigint, pairedOut: bigint, pm: string = REG_PM) {
  return {
    address: pm,
    topics: encodeEventTopics({ abi: LP_GATEWAY_ABI, eventName: 'Withdrawn', args: { user: user as `0x${string}` } }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [burned, quoteOut, pairedOut]),
  }
}

async function signedDeposit(over: { txHash?: string; pool?: string | null; bodyTx?: string; bodyPool?: string | null } = {}) {
  const issuedAt = Date.now()
  const authMessage = buildGatewayDepositMessage({ address: wallet.address, txHash: over.txHash ?? TX, pool: over.pool === undefined ? POOL_ID : over.pool, issuedAt })
  const authSignature = await wallet.signMessage({ message: authMessage })
  return { address: wallet.address, txHash: over.bodyTx ?? over.txHash ?? TX, pool: over.bodyPool === undefined ? (over.pool === undefined ? POOL_ID : over.pool) : over.bodyPool, authMessage, authSignature, issuedAt }
}
function post(path: string, body: unknown) {
  return new Request(`https://mw.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never
}

beforeEach(() => {
  _resetReplayGuard()
  state.cfg = cfg
  state.sharesOf = 1_000_000n
  state.receipt = { status: 'success', to: REG_PM, blockNumber: 500n, logs: [depositedLog(USER, 1_000_000n, 1_000_000n)] }
  state.supabase = fakeSupabase({ tables: { gateway_instances: [registryRow] }, uniques: { gateway_deposit_events: [['tx_hash']] }, rpc: gatewayPositionRpc }).client
})

describe('POST /api/gateway/deposit — the UI body is now accepted and recorded (O-1)', () => {
  it('signed { address, txHash, pool=poolId, authMessage, authSignature, issuedAt } → 200, gateway_positions written', async () => {
    const { POST } = await import('./route')
    const res = await POST(post('/api/gateway/deposit', await signedDeposit()))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.shares).toBe('1000000')
    expect(json.costBasisAtomic).toBe('1000000')
    expect(json.idempotentReplay).toBe(false)
  })
  it('the OLD unsigned UI body is still refused (401) — nothing regressed', async () => {
    const { POST } = await import('./route')
    const res = await POST(post('/api/gateway/deposit', { address: wallet.address, txHash: TX, pool: POOL_ID }))
    expect(res.status).toBe(401)
  })
  // Round-4 pass-2 event-order fix (independent Codex audit, 2026-09-09): the RPC's replay-based
  // recompute (migration 20260909000004) is only order-independent because it sorts by the STORED
  // block_number — which is only correct if the route actually sends it. Proves the wire-up, not just
  // the pure basisMath.ts math (that's covered separately in basisMath.test.ts).
  it('sends the receipt\'s own blockNumber as p_block_number (the replay sort key)', async () => {
    const { db, client } = fakeSupabase({ tables: { gateway_instances: [registryRow] }, uniques: { gateway_deposit_events: [['tx_hash']] }, rpc: gatewayPositionRpc })
    state.supabase = client
    const { POST } = await import('./route')
    await POST(post('/api/gateway/deposit', await signedDeposit()))
    const call = db.calls.find((c) => c.table === 'rpc:record_gateway_deposit_event')
    expect((call?.payload as Record<string, unknown> | undefined)?.p_block_number).toBe('500')
  })
})

describe('O-10 — signed txHash/pool bound to the body; single-use signature', () => {
  it('body txHash ≠ signed txHash → 401 auth_payload_mismatch', async () => {
    const { POST } = await import('./route')
    const res = await POST(post('/api/gateway/deposit', await signedDeposit({ bodyTx: '0x' + 'bb'.repeat(32) })))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('auth_payload_mismatch')
  })
  it('body pool ≠ signed pool → 401 auth_payload_mismatch', async () => {
    const { POST } = await import('./route')
    const res = await POST(post('/api/gateway/deposit', await signedDeposit({ bodyPool: '0x' + 'cd'.repeat(32) })))
    expect(res.status).toBe(401)
  })
  it('case differences are normalised (checksummed body vs lowercased signature is fine)', async () => {
    const { POST } = await import('./route')
    const b = await signedDeposit()
    const res = await POST(post('/api/gateway/deposit', { ...b, txHash: TX.toUpperCase().replace('0X', '0x'), pool: POOL_ID.toUpperCase().replace('0X', '0x') }))
    expect(res.status).toBe(200)
  })
  it('the same signature presented twice → second is 409 auth_replayed (and the tx ledger stays single-row)', async () => {
    const { POST } = await import('./route')
    const b = await signedDeposit()
    expect((await POST(post('/api/gateway/deposit', b))).status).toBe(200)
    const res = await POST(post('/api/gateway/deposit', b))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('auth_replayed')
  })
  it('a FRESH signature for an already-recorded tx is an idempotent replay (basis not inflated)', async () => {
    const { POST } = await import('./route')
    expect((await POST(post('/api/gateway/deposit', await signedDeposit()))).status).toBe(200)
    const res = await POST(post('/api/gateway/deposit', await signedDeposit()))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.idempotentReplay).toBe(true)
    expect(json.costBasisAtomic).toBe('1000000') // not 2,000,000
  })
})

describe('O-2 — strict pool resolution on the record path', () => {
  it('a label slug that misses the registry → 404 pool_not_live (never recorded against the env rig)', async () => {
    const { POST } = await import('./route')
    const res = await POST(post('/api/gateway/deposit', await signedDeposit({ pool: 'pons-usdg' })))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('pool_not_live')
  })
  it('receipt.to ≠ the resolved PM → wrong_contract', async () => {
    state.receipt = { status: 'success', to: '0x' + '77'.repeat(20), blockNumber: 500n, logs: [] }
    const { POST } = await import('./route')
    const res = await POST(post('/api/gateway/deposit', await signedDeposit()))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('wrong_contract')
  })
})

describe('POST /api/gateway/withdraw — same binding, records the exit', () => {
  it('signed withdraw body → 200 and the basis is reduced proportionally', async () => {
    state.supabase = fakeSupabase({
      tables: {
        gateway_instances: [registryRow],
        gateway_positions: [{ id: 'p1', user_wallet: USER, pool_address: POOL_ID, chain_id: 46630, shares: '1000000', entry_nav: '1000000' }],
      },
      uniques: { gateway_deposit_events: [['tx_hash']] },
      rpc: gatewayPositionRpc,
    }).client
    state.sharesOf = 500_000n
    state.receipt = { status: 'success', to: REG_PM, blockNumber: 500n, logs: [withdrawnLog(USER, 500_000n, 480_000n, 10n)] }
    const issuedAt = Date.now()
    const authMessage = buildGatewayWithdrawMessage({ address: wallet.address, txHash: TX, pool: POOL_ID, issuedAt })
    const authSignature = await wallet.signMessage({ message: authMessage })
    const { POST } = await import('../withdraw/route')
    const res = await POST(post('/api/gateway/withdraw', { address: wallet.address, txHash: TX, pool: POOL_ID, authMessage, authSignature, issuedAt }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.sharesBurned).toBe('500000')
    expect(json.costBasisAtomic).toBe('500000')
  })
  // Round-4 pass-2 event-order fix (independent Codex audit, 2026-09-09) — the withdraw-route half of
  // the same wire-up check the deposit route got above.
  it('sends the receipt\'s own blockNumber as p_block_number (the replay sort key)', async () => {
    const { db, client } = fakeSupabase({
      tables: {
        gateway_instances: [registryRow],
        gateway_positions: [{ id: 'p1', user_wallet: USER, pool_address: POOL_ID, chain_id: 46630, shares: '1000000', entry_nav: '1000000' }],
      },
      uniques: { gateway_deposit_events: [['tx_hash']] },
      rpc: gatewayPositionRpc,
    })
    state.supabase = client
    state.sharesOf = 500_000n
    state.receipt = { status: 'success', to: REG_PM, blockNumber: 501n, logs: [withdrawnLog(USER, 500_000n, 480_000n, 10n)] }
    const issuedAt = Date.now()
    const authMessage = buildGatewayWithdrawMessage({ address: wallet.address, txHash: TX, pool: POOL_ID, issuedAt })
    const authSignature = await wallet.signMessage({ message: authMessage })
    const { POST } = await import('../withdraw/route')
    await POST(post('/api/gateway/withdraw', { address: wallet.address, txHash: TX, pool: POOL_ID, authMessage, authSignature, issuedAt }))
    const call = db.calls.find((c) => c.table === 'rpc:record_gateway_withdraw_event')
    expect((call?.payload as Record<string, unknown> | undefined)?.p_block_number).toBe('501')
  })
  // V1-04 — FIXED 2026-09-09 (independent Codex audit). Reproduces Codex's own arithmetic trace: a
  // withdrawal burns half of an original 1,000,000-share position (basis 1,000,000), but ANOTHER
  // 1,000,000-share deposit lands on-chain (block 501) before this withdrawal (block 500) gets
  // recorded — "current" shares by the time recording happens are 1,500,000, not the 500,000 that
  // existed right after the withdrawal itself. Reading sharesOf live (the bug) would size the
  // proportional reduction against the WRONG, inflated denominator (500k*1.5M/2M = a wrong 750,000
  // basis — an artifact of the interleaved deposit, not of this withdrawal). Reading at the
  // withdrawal's OWN block (the fix) gets the correct 500,000/500,000 = 500,000, independent of
  // when the interleaved deposit happens to be recorded relative to this call.
  it('FIXED: an interleaved deposit before recording no longer corrupts the withdrawal basis', async () => {
    state.supabase = fakeSupabase({
      tables: {
        gateway_instances: [registryRow],
        gateway_positions: [{ id: 'p1', user_wallet: USER, pool_address: POOL_ID, chain_id: 46630, shares: '1000000', entry_nav: '1000000' }],
      },
      uniques: { gateway_deposit_events: [['tx_hash']] },
      rpc: gatewayPositionRpc,
    }).client
    state.sharesOf = 1_500_000n // "current" (live) shares — includes the LATER interleaved deposit
    state.sharesOfAtBlock = new Map([['500', 500_000n]]) // shares AS OF the withdrawal's own block
    state.receipt = { status: 'success', to: REG_PM, blockNumber: 500n, logs: [withdrawnLog(USER, 500_000n, 480_000n, 10n)] }
    const issuedAt = Date.now()
    const authMessage = buildGatewayWithdrawMessage({ address: wallet.address, txHash: TX, pool: POOL_ID, issuedAt })
    const authSignature = await wallet.signMessage({ message: authMessage })
    const { POST } = await import('../withdraw/route')
    const res = await POST(post('/api/gateway/withdraw', { address: wallet.address, txHash: TX, pool: POOL_ID, authMessage, authSignature, issuedAt }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.costBasisAtomic).toBe('500000') // correct — NOT 750000, which the live-read bug produced
  })
  // V1-01 pass-2 residual — FIXED 2026-09-09 (independent Codex audit). This pool has been through a
  // full PM migration: an OLD (retired) instance and a NEW (active, different address) one both
  // registered for the SAME pool id. Codex's own suggested regression: prove a withdrawal against
  // EITHER generation resolves to its own contract, rather than the pool-only lookup always handing
  // both callers the CURRENT active PM (which would reject the old PM's real withdrawal as
  // wrong_contract, since the tx it actually sent went to a different address than what got resolved).
  it('FIXED: withdrawing from the OLD (retired) PM resolves to it, not the pool\'s current active PM', async () => {
    const OLD_PM = '0x' + '55'.repeat(20)
    const NEW_PM = REG_PM
    state.supabase = fakeSupabase({
      tables: {
        gateway_instances: [
          { ...registryRow, position_manager: OLD_PM, status: 'inactive' },
          { ...registryRow, position_manager: NEW_PM, status: 'active' },
        ],
        gateway_positions: [{ id: 'p1', user_wallet: USER, pool_address: POOL_ID, chain_id: 46630, shares: '1000000', entry_nav: '1000000' }],
      },
      uniques: { gateway_deposit_events: [['tx_hash']] },
      rpc: gatewayPositionRpc,
    }).client
    state.sharesOf = 500_000n
    // The tx this user actually sent went to the OLD PM — receipt.to says so.
    state.receipt = { status: 'success', to: OLD_PM, blockNumber: 500n, logs: [withdrawnLog(USER, 500_000n, 480_000n, 10n, OLD_PM)] }
    const issuedAt = Date.now()
    const authMessage = buildGatewayWithdrawMessage({ address: wallet.address, txHash: TX, pool: POOL_ID, issuedAt })
    const authSignature = await wallet.signMessage({ message: authMessage })
    const { POST } = await import('../withdraw/route')
    const res = await POST(post('/api/gateway/withdraw', { address: wallet.address, txHash: TX, pool: POOL_ID, authMessage, authSignature, issuedAt }))
    const json = await res.json()
    // Must NOT be wrong_contract — the old PM is a real, still-registered (if retired) instance, and
    // this withdrawal genuinely happened against it.
    expect(res.status).toBe(200)
    expect(json.sharesBurned).toBe('500000')
  })
  it('FIXED: withdrawing from the NEW (active, replacement) PM for the same pool also resolves correctly', async () => {
    const OLD_PM = '0x' + '55'.repeat(20)
    const NEW_PM = REG_PM
    state.supabase = fakeSupabase({
      tables: {
        gateway_instances: [
          { ...registryRow, position_manager: OLD_PM, status: 'inactive' },
          { ...registryRow, position_manager: NEW_PM, status: 'active' },
        ],
        gateway_positions: [{ id: 'p1', user_wallet: USER, pool_address: POOL_ID, chain_id: 46630, shares: '1000000', entry_nav: '1000000' }],
      },
      uniques: { gateway_deposit_events: [['tx_hash']] },
      rpc: gatewayPositionRpc,
    }).client
    state.sharesOf = 500_000n
    state.receipt = { status: 'success', to: NEW_PM, blockNumber: 500n, logs: [withdrawnLog(USER, 500_000n, 480_000n, 10n, NEW_PM)] }
    const issuedAt = Date.now()
    const authMessage = buildGatewayWithdrawMessage({ address: wallet.address, txHash: TX, pool: POOL_ID, issuedAt })
    const authSignature = await wallet.signMessage({ message: authMessage })
    const { POST } = await import('../withdraw/route')
    const res = await POST(post('/api/gateway/withdraw', { address: wallet.address, txHash: TX, pool: POOL_ID, authMessage, authSignature, issuedAt }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.sharesBurned).toBe('500000')
  })
  it('a deposit-action signature cannot be replayed on the withdraw route (action binding held)', async () => {
    const { POST } = await import('../withdraw/route')
    const res = await POST(post('/api/gateway/withdraw', await signedDeposit()))
    expect(res.status).toBe(401)
  })
  it('signed pool ≠ body pool → 401 on withdraw too', async () => {
    const issuedAt = Date.now()
    const authMessage = buildGatewayWithdrawMessage({ address: wallet.address, txHash: TX, pool: POOL_ID, issuedAt })
    const authSignature = await wallet.signMessage({ message: authMessage })
    const { POST } = await import('../withdraw/route')
    const res = await POST(post('/api/gateway/withdraw', { address: wallet.address, txHash: TX, pool: 'pons-usdg', authMessage, authSignature, issuedAt }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('auth_payload_mismatch')
  })
})
