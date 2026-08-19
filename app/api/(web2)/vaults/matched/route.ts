// POST /api/vaults/matched — record a community-matched launch vault (MintwareMatchedLiquidityVault).
//
// The team commits its token as one side; the community funds the quote (USDC) up to `targetUsdc`,
// and the team's token pairs PROPORTIONALLY as the fill arrives (the on-chain `activate()` computes
// matchedTokens = teamTokens × matched/target, refunding the remainder). The pool goes live once the
// community fill reaches `thresholdBps` of the target (contract also requires ≥3 backers).
//
// This route only RECORDS intent (a `social_vaults` row, contract_address null) — an operator deploys
// the real Foundry vault and backfills the address, exactly like /api/vaults/create. Auth is generic
// signed-message with an `action` bind so a create signature can't be replayed here.

import { createHandler } from '@/lib/web2/routeHandler'

export const dynamic = 'force-dynamic'

const EVM = /^0x[a-fA-F0-9]{40}$/
const MIN_LOCK_DAYS = 90 // matches the contract's ≥90d team-side cliff

export const POST = createHandler(async (req, ctx) => {
  let body: Record<string, unknown>
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'Invalid JSON' }, 400) }

  const signer = ctx.user!.address.toLowerCase() // guaranteed by auth: 'signed-message'
  const teamWallet = String(body.teamWallet ?? '').toLowerCase()
  const projectToken = String(body.projectToken ?? '').toLowerCase()
  const name = String(body.name ?? '').trim().slice(0, 80)
  const symbol = String(body.symbol ?? '').trim().slice(0, 16)
  const teamTokens = Number(body.teamTokens)          // team-side token amount committed
  const targetUsdc = Number(body.targetUsdc)          // community quote target
  const thresholdBps = Number(body.thresholdBps)      // min fill vs target to go live (bps)
  const lockDays = Number(body.lockDays)
  const chainId = Number(body.chainId)

  // The signer must BE the team wallet — the row is written on their authority.
  if (!EVM.test(teamWallet) || teamWallet !== signer) return ctx.json({ error: 'Signer must be the team wallet' }, 403)
  if (!EVM.test(projectToken)) return ctx.json({ error: 'Invalid token address' }, 400)
  if (!name) return ctx.json({ error: 'Name required' }, 400)
  if (!(teamTokens > 0)) return ctx.json({ error: 'Team token amount must be positive' }, 400)
  if (!(targetUsdc > 0)) return ctx.json({ error: 'Target quote must be positive' }, 400)
  if (!(thresholdBps > 0 && thresholdBps <= 10000)) return ctx.json({ error: 'Threshold must be 1–10000 bps' }, 400)
  if (!(lockDays >= MIN_LOCK_DAYS)) return ctx.json({ error: `Lock must be ≥ ${MIN_LOCK_DAYS} days` }, 400)
  if (!Number.isFinite(chainId) || chainId <= 0) return ctx.json({ error: 'Invalid chainId' }, 400)

  const { data, error } = await ctx.supabase
    .from('social_vaults')
    .insert({
      name,
      team_wallet: teamWallet,
      project_token: projectToken,
      seed_amount: teamTokens,       // team-side commitment (token units)
      pool_key: { symbol, quote: 'USDC' },
      chain_id: chainId,
      contract_address: null,        // operator deploys the Foundry vault + backfills
      status: 'seeding',
      tvl_usdc: 0,
      vault_kind: 'matched',
      match_target_usdc: targetUsdc,
      activation_threshold_bps: thresholdBps,
      lock_days: lockDays,
    })
    .select('id, name, status')
    .single()

  if (error || !data) {
    ctx.log.error('vaults/matched', 'insert failed', { error: error?.message })
    return ctx.json({ error: 'Failed to record vault' }, 500)
  }

  await ctx.supabase
    .from('vault_epochs')
    .insert({ vault_id: data.id, epoch_number: 1, total_pool: 0, bonus_pool: 0, status: 'active' })

  ctx.log.info('vaults/matched', 'recorded matched launch vault', { id: data.id, team: teamWallet })
  return ctx.json({ id: data.id, name: data.name, status: data.status }, 201)
}, { auth: 'signed-message', action: 'mintware-vault-matched' })
