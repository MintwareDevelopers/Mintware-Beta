// ROUND-3 EXPLOIT REPLAY (off-chain, 2026-09-08) — signature handling.
// Incident classes replayed: Wormhole 2022 (verification-path bypass), EIP-2 low-s malleability
// (Bitcoin tx-id malleability / early Ethereum), Nomad 2022 (a "distinct" message accepted as valid).
//
// Target: the O-10 fix in lib/gateway/recordAuth.ts — a re-presented signature inside the 15-min
// freshness window must be refused (409 auth_replayed). The replay set is keyed on
// keccak256(lowercase(authSignature)). ECDSA has TWO valid encodings of the same signature over the same
// message: (r, s, v) and (r, n−s, v^1); viem's recoverMessageAddress also accepts v ∈ {0,1} as well as
// {27,28}. Every twin recovers the SAME signer but hashes to a DIFFERENT replay key.
import { describe, it, expect, beforeEach } from 'vitest'
import { recoverMessageAddress, hexToBigInt, numberToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { bindSignedRecord, _resetReplayGuard } from '@/lib/gateway/recordAuth'
import { createHandler } from '@/lib/web2/routeHandler'
import { buildGatewayDepositMessage, buildGatewayWithdrawMessage } from '@/lib/web3/signedActionMessages'
import { buildGatewayCurateMessage } from '@/lib/gateway/curateAuth'
import { buildProfileAvatarMessage } from '@/lib/profile/avatarUpload'
import { parseCuratorAllowlist, isAllowlistedCurator } from '@/lib/gateway/curateAuth'

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
// throwaway hardhat #0 key — public, worthless
const wallet = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const TX = '0x' + 'aa'.repeat(32)

/** (r, s, v) → (r, n−s, v^1): the EIP-2 "high-s" twin. Same signer, different bytes. */
function highSTwin(sig: `0x${string}`): `0x${string}` {
  const r = sig.slice(0, 66)
  const s = hexToBigInt(`0x${sig.slice(66, 130)}`)
  const v = parseInt(sig.slice(130, 132), 16)
  const vFlip = v === 27 ? 28 : v === 28 ? 27 : v ^ 1
  return `${r}${numberToHex(SECP256K1_N - s, { size: 32 }).slice(2)}${vFlip.toString(16).padStart(2, '0')}` as `0x${string}`
}
/** v 27/28 → 0/1 re-encoding (accepted by viem). */
function vYParityTwin(sig: `0x${string}`): `0x${string}` {
  const v = parseInt(sig.slice(130, 132), 16)
  return `${sig.slice(0, 130)}${(v >= 27 ? v - 27 : v).toString(16).padStart(2, '0')}` as `0x${string}`
}

function post(body: Record<string, unknown>) {
  return new Request('https://x.test/api/gateway/deposit', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as unknown as Parameters<ReturnType<typeof createHandler>>[0]
}

// FIXED (round-3 F-2): the replay set is now keyed on the signed `authMessage`, not the signature encoding, so every
// twin of one authorization collapses onto one key. The PoCs below are kept as regression evidence with the
// expectations flipped to the fixed behaviour.
describe('FIXED (was Low): EIP-2 malleability + v re-encoding no longer bypass the O-10 per-process replay set', () => {
  beforeEach(() => _resetReplayGuard())

  it('viem recovers the SAME signer from the canonical sig, its high-s twin and its v=0/1 twin', async () => {
    const msg = buildGatewayDepositMessage({ address: wallet.address, txHash: TX, pool: null, issuedAt: 1 })
    const sig = await wallet.signMessage({ message: msg })
    for (const twin of [sig, highSTwin(sig), vYParityTwin(sig)]) {
      expect((await recoverMessageAddress({ message: msg, signature: twin })).toLowerCase()).toBe(wallet.address.toLowerCase())
    }
    expect(highSTwin(sig)).not.toBe(sig)
    expect(vYParityTwin(sig)).not.toBe(sig)
  })

  it('bindSignedRecord: canonical → ok, canonical again → auth_replayed, high-s twin → auth_replayed, v-twin → auth_replayed', async () => {
    const issuedAt = Date.now()
    const authMessage = buildGatewayDepositMessage({ address: wallet.address, txHash: TX, pool: null, issuedAt })
    const sig = await wallet.signMessage({ message: authMessage })
    const body = (authSignature: string) => ({ address: wallet.address, authMessage, authSignature, issuedAt, txHash: TX })

    expect(bindSignedRecord(body(sig)).ok).toBe(true)
    expect(bindSignedRecord(body(sig))).toEqual({ ok: false, error: 'auth_replayed' })
    // the same authorization, re-encoded, is the SAME key (message-keyed replay set):
    expect(bindSignedRecord(body(highSTwin(sig)))).toEqual({ ok: false, error: 'auth_replayed' })
    expect(bindSignedRecord(body(vYParityTwin(sig)))).toEqual({ ok: false, error: 'auth_replayed' })
    expect(bindSignedRecord(body(sig.toUpperCase().replace('0X', '0x')))).toEqual({ ok: false, error: 'auth_replayed' })
  })

  it('a DIFFERENT authorization (fresh issuedAt) from the same wallet is still accepted — the key is the message, not the wallet', async () => {
    const a = buildGatewayDepositMessage({ address: wallet.address, txHash: TX, pool: null, issuedAt: Date.now() })
    const b = buildGatewayDepositMessage({ address: wallet.address, txHash: TX, pool: null, issuedAt: Date.now() + 1 })
    const sa = await wallet.signMessage({ message: a }); const sb = await wallet.signMessage({ message: b })
    expect(bindSignedRecord({ address: wallet.address, authMessage: a, authSignature: sa, issuedAt: JSON.parse(a).issuedAt, txHash: TX }).ok).toBe(true)
    expect(bindSignedRecord({ address: wallet.address, authMessage: b, authSignature: sb, issuedAt: JSON.parse(b).issuedAt, txHash: TX }).ok).toBe(true)
  })

  it('end-to-end through createHandler: the twin passes signed-message auth but the route-level replay guard refuses it', async () => {
    const issuedAt = Date.now()
    const authMessage = buildGatewayDepositMessage({ address: wallet.address, txHash: TX, pool: null, issuedAt })
    const sig = await wallet.signMessage({ message: authMessage })
    const handler = createHandler(async (req, ctx) => {
      const b = (await req.clone().json()) as Record<string, unknown>
      const bound = bindSignedRecord(b)
      return ctx.json({ bound })
    }, { auth: 'signed-message', action: 'mintware-gateway-deposit' })
    const first = await handler(post({ address: wallet.address, authMessage, authSignature: sig, issuedAt, txHash: TX }))
    expect(((await first.json()) as { bound: { ok: boolean } }).bound.ok).toBe(true)
    const replay = await handler(post({ address: wallet.address, authMessage, authSignature: sig, issuedAt, txHash: TX }))
    expect(((await replay.json()) as { bound: { error: string } }).bound.error).toBe('auth_replayed')
    const twin = await handler(post({ address: wallet.address, authMessage, authSignature: highSTwin(sig), issuedAt, txHash: TX }))
    expect(twin.status).toBe(200) // signed-message auth itself is fine with the twin (it recovers the same signer)…
    expect(((await twin.json()) as { bound: { error: string } }).bound.error).toBe('auth_replayed') // …the replay guard is not
  })

  it('impact bound (why this is Low): the route acts on the SIGNED txHash, and gateway_deposit_events.tx_hash UNIQUE makes the replay idempotent', () => {
    // The twin only lets an attacker who ALREADY holds a valid signature re-run "record tx X for wallet W".
    // Body drift is still refused, so the replay cannot target another tx/pool:
    const issuedAt = Date.now()
    const authMessage = buildGatewayDepositMessage({ address: wallet.address, txHash: TX, pool: null, issuedAt })
    expect(bindSignedRecord({ address: wallet.address, authMessage, authSignature: '0x' + '11'.repeat(65), issuedAt, txHash: '0x' + 'bb'.repeat(32) })).toEqual({ ok: false, error: 'auth_payload_mismatch' })
  })
})

describe('MITIGATED: cross-route / cross-action replay (Nomad-class "any valid message is valid here")', () => {
  it('a deposit-action signature is refused by a withdraw-action handler (and vice versa) at the factory', async () => {
    const issuedAt = Date.now()
    const dep = buildGatewayDepositMessage({ address: wallet.address, txHash: TX, pool: null, issuedAt })
    const depSig = await wallet.signMessage({ message: dep })
    const withdrawHandler = createHandler(async (_r, ctx) => ctx.json({ ok: true }), { auth: 'signed-message', action: 'mintware-gateway-withdraw' })
    const res = await withdrawHandler(post({ address: wallet.address, authMessage: dep, authSignature: depSig, issuedAt, txHash: TX }))
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe('AUTH_MISMATCH')
    // the message builders disagree on `action`, so a withdraw message can never satisfy the deposit route either
    expect(JSON.parse(buildGatewayWithdrawMessage({ address: wallet.address, txHash: TX, issuedAt })).action).toBe('mintware-gateway-withdraw')
  })

  it('a curate signature cannot be presented to the avatar route (different action + different canonical shape) and vice versa', async () => {
    const issuedAt = Date.now()
    const curate = buildGatewayCurateMessage({ address: wallet.address, issuedAt, curateAction: 'approve' })
    const avatar = buildProfileAvatarMessage({ wallet: wallet.address, issuedAt, sha256: 'ab'.repeat(32), size: 12 })
    expect(JSON.parse(curate).action).toBe('mintware-gateway-curate')
    expect(JSON.parse(avatar).action).toBe('mintware-profile-avatar')
    // the avatar route strict-rebuilds `buildProfileAvatarMessage(wallet, issuedAt, sha256(bytes), size)` and compares
    // for byte-equality — a curate message can never equal it; the curate route strict-rebuilds its own message.
    expect(curate).not.toBe(avatar)
  })

  it('cross-chain: the deposit/withdraw messages carry NO chainId — bound instead by the single-env gateway chain (informational)', () => {
    const m = JSON.parse(buildGatewayDepositMessage({ address: wallet.address, txHash: TX, pool: null, issuedAt: 1 }))
    expect('chainId' in m).toBe(false) // the route resolves chain from LP_GATEWAY_CHAIN_ID; one chain per deployment today
  })

  it('recovered-address casing: curator allowlist + comparisons are lower-cased on both sides (checksummed env entry still matches)', () => {
    const checksummed = wallet.address // EIP-55 mixed case
    const allow = parseCuratorAllowlist(` ${checksummed} , 0x${'0'.repeat(40)}`)
    expect(allow).toContain(checksummed.toLowerCase())
    expect(isAllowlistedCurator(checksummed.toLowerCase(), allow)).toBe(true)
    expect(isAllowlistedCurator(checksummed.toUpperCase().replace('0X', '0x'), allow)).toBe(true)
    // an entry that is not a 20-byte hex is dropped, never "matches anything"
    expect(parseCuratorAllowlist('*,0x123')).toEqual([])
  })

  it('Wormhole-class: an empty / garbage signature is rejected, never treated as "verified"', async () => {
    const issuedAt = Date.now()
    const authMessage = buildGatewayDepositMessage({ address: wallet.address, txHash: TX, pool: null, issuedAt })
    const handler = createHandler(async (_r, ctx) => ctx.json({ ok: true }), { auth: 'signed-message', action: 'mintware-gateway-deposit' })
    for (const bad of ['0x', '0x00', '0x' + '00'.repeat(65), 'not-hex']) {
      const res = await handler(post({ address: wallet.address, authMessage, authSignature: bad, issuedAt, txHash: TX }))
      expect(res.status).toBe(401)
    }
  })
})
