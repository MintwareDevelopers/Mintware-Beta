// POST /api/x402/permit — an x402 agent registers its STANDING DelegatedSpendPermit ONCE, exactly as
// a card holder does at card-activate. The typed-data signature IS the authentication (auth: 'none'):
// it must recover to `payer` under the SHARED card scheme (lib/org/spendPermit.ts — same domain name
// "Mintware Payment Gateway"/"2.0" + same `DelegatedSpendPermit` typehash the Gateway's settleSpend
// verifies). The permit's `user` field must equal `payer`, since settleSpend burns shares from
// `permit.user`. One signature covers many later x402 settlements until `deadline`.
//
// GET /api/x402/permit?payer=&gateway= — does a standing permit exist for this payer? (no permit body).
//
// Fail-closed: bad/short signature, wrong signer, mismatched user, or an unconfigured gateway all
// refuse — we NEVER store a permit the on-chain settleSpend would reject.

import { createHandler } from '@/lib/web2/routeHandler'
import { verifyDelegatedSpendPermit } from '@/lib/org/spendPermit'
import { getStandingPermit, putStandingPermit } from '@/lib/x402/permitStore'
import { x402PermitGateway, x402PermitChainId } from '@/lib/x402/config'

export const dynamic = 'force-dynamic'

const isAddress = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)

export const POST = createHandler(async (req, ctx) => {
  let body: {
    payer?: string
    maxDailySpendUsdc?: string | number
    nonce?: string | number
    deadline?: string | number
    signature?: string
  }
  try {
    body = await req.json()
  } catch {
    return ctx.json({ ok: false, error: 'invalid_json' }, 400)
  }

  const payer = String(body.payer ?? '')
  if (!isAddress(payer)) return ctx.json({ ok: false, error: 'invalid_payer' }, 400)

  const maxDailySpendUSDC = (() => { try { return BigInt(body.maxDailySpendUsdc as never) } catch { return null } })()
  const nonce = (() => { try { return BigInt(body.nonce as never) } catch { return null } })()
  const deadline = (() => { try { return BigInt(body.deadline as never) } catch { return null } })()
  const signature = String(body.signature ?? '')
  if (maxDailySpendUSDC === null || maxDailySpendUSDC <= 0n) return ctx.json({ ok: false, error: 'invalid_maxDailySpendUsdc' }, 400)
  if (nonce === null) return ctx.json({ ok: false, error: 'invalid_nonce' }, 400)
  if (deadline === null || deadline <= BigInt(Math.floor(Date.now() / 1000))) return ctx.json({ ok: false, error: 'deadline_must_be_future' }, 400)
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return ctx.json({ ok: false, error: 'invalid_signature' }, 400)

  // Gateway + chain are resolved SERVER-SIDE (never client-supplied) so the permit is bound to the
  // exact contract the relayer settles on. Unset → fail closed, don't guess.
  const gateway = x402PermitGateway()
  if (!isAddress(gateway)) return ctx.json({ ok: false, error: 'permit_gateway_unconfigured' }, 503)
  const chainId = x402PermitChainId()

  // Verify against the SHARED card scheme. `signer` == `payer` and the signed `user` field == `payer`
  // (settleSpend burns from permit.user), so a signature that recovers to anyone else — or one whose
  // user field points at a different address — is rejected.
  let valid = false
  try {
    valid = await verifyDelegatedSpendPermit({
      signer: payer as `0x${string}`,
      chainId,
      gateway: gateway as `0x${string}`,
      message: { user: payer as `0x${string}`, maxDailySpendUSDC, nonce, deadline },
      signature: signature as `0x${string}`,
    })
  } catch {
    valid = false // a malformed signature that can't be recovered is simply invalid — fail closed.
  }
  if (!valid) return ctx.json({ ok: false, error: 'signature_does_not_recover_to_payer' }, 401)

  const stored = await putStandingPermit(ctx.supabase, {
    payer,
    gateway,
    chainId,
    user: payer,
    maxDailySpendUsdc: maxDailySpendUSDC.toString(),
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    signature,
  })
  if (!stored.ok) {
    ctx.log.error('x402', 'permit store write failed', { error: stored.error })
    return ctx.json({ ok: false, error: 'permit_store_failed' }, 500)
  }

  ctx.log.info('x402', 'standing permit registered', { payer: payer.toLowerCase(), gateway, chainId })
  return ctx.json({ ok: true, payer: payer.toLowerCase(), gateway: gateway.toLowerCase(), chainId })
})

export const GET = createHandler(async (req, ctx) => {
  const url = new URL(req.url)
  const payer = url.searchParams.get('payer') ?? ''
  if (!isAddress(payer)) return ctx.json({ ok: false, error: 'invalid_payer' }, 400)
  const gateway = url.searchParams.get('gateway') ?? x402PermitGateway()
  if (!isAddress(gateway)) return ctx.json({ ok: false, error: 'permit_gateway_unconfigured' }, 503)
  const permit = await getStandingPermit(ctx.supabase, payer, gateway)
  return ctx.json({ ok: true, exists: permit !== null, payer: payer.toLowerCase(), gateway: gateway.toLowerCase() })
})
