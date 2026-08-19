// =============================================================================
// POST /api/orgs/accept
//
// Claim a pending email invite once the invitee has a wallet (via Privy login)
// and issue their OrgMembership EAS attestation. The signed-message auth proves
// wallet ownership; the email is taken from the request body as claimed by the
// client (Privy already gated login to that email — we don't re-verify it here,
// same trust boundary the rest of the app uses for Privy-authenticated email).
//
// Body: { authMessage, authSignature, issuedAt, address, org_id, email }
// =============================================================================

import { attestOrgMembership } from '@/lib/rewards/eas'
import { createHandler } from '@/lib/web2/routeHandler'

export const POST = createHandler(async (req, ctx) => {
  const body   = await req.clone().json().catch(() => null) as Record<string, unknown> | null
  const orgId  = body?.org_id
  const email  = body?.email

  if (!orgId || typeof orgId !== 'string') {
    return ctx.json({ error: 'org_id required' }, 400)
  }
  if (!email || typeof email !== 'string') {
    return ctx.json({ error: 'email required' }, 400)
  }

  const wallet = ctx.user!.address.toLowerCase()

  const { data: org, error: orgErr } = await ctx.supabase
    .from('orgs')
    .select('id, treasury_vault_address')
    .eq('id', orgId)
    .maybeSingle()
  if (orgErr || !org) return ctx.json({ error: 'org not found' }, 404)

  const { data: invite, error: inviteErr } = await ctx.supabase
    .from('org_members')
    .select('id, role, status')
    .eq('org_id', orgId)
    .eq('invited_email', email.toLowerCase())
    .eq('status', 'invited')
    .maybeSingle()

  if (inviteErr || !invite) {
    return ctx.json({ error: 'no pending invite for this email at this org' }, 404)
  }

  // Attest first — if this fails we haven't mutated the invite row yet, so it
  // stays retryable rather than getting stuck half-accepted.
  let uid: string
  try {
    uid = await attestOrgMembership({
      // v1: the org's own address doesn't exist until a treasury is deployed
      // (see migration header) — fall back to a stable per-org identifier
      // (owner_wallet-derived would work too; using the org row id keeps this
      // simple and doesn't imply an on-chain org identity that isn't real yet).
      org:    org.treasury_vault_address ?? `0x${'0'.repeat(24)}${orgId.replace(/-/g, '').slice(0, 16)}`,
      member: wallet,
      role:   invite.role,
    })
  } catch (err) {
    ctx.log.error('orgs-accept', 'attestOrgMembership failed', { err: String(err) })
    return ctx.json({ error: 'attestation failed' }, 500)
  }

  const { data: updated, error: updateErr } = await ctx.supabase
    .from('org_members')
    .update({ wallet, status: 'active', eas_uid: uid, accepted_at: new Date().toISOString() })
    .eq('id', invite.id)
    .select('id, org_id, wallet, role, status, eas_uid, accepted_at')
    .single()

  if (updateErr) {
    ctx.log.error('orgs-accept', 'Update failed after successful attestation', { error: updateErr.message, uid })
    // The attestation IS valid and issued; surface it even if the row update
    // failed, so the caller isn't left thinking nothing happened.
    return ctx.json({ member: null, eas_uid: uid, warning: 'attested but membership row update failed — contact support with this UID' }, 500)
  }

  return ctx.json({ member: updated })
}, { auth: 'signed-message', action: 'mintware-org-accept', rateLimit: { max: 10, windowMs: 60_000 } })
