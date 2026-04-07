// GET /api/vault?id=<uuid>          — single vault + active epoch
// GET /api/vault?address=<wallet>   — all deposits for a wallet
// Auth: none

import { createHandler } from '@/lib/web2/routeHandler'

export const GET = createHandler(async (req, ctx) => {
  const id      = req.nextUrl.searchParams.get('id')
  const address = req.nextUrl.searchParams.get('address')

  if (id) {
    const { data: vault, error } = await ctx.supabase
      .from('social_vaults')
      .select(`*, current_epoch:vault_epochs(id, epoch_number, total_pool, bonus_pool, total_claimed, status, opened_at, closed_at, deadline, merkle_root)`)
      .eq('id', id).single()
    if (error || !vault) return ctx.json({ error: 'Vault not found' }, 404)
    return ctx.json(vault)
  }

  if (address) {
    const wallet = address.toLowerCase()
    const [depositsRes, queueRes] = await Promise.all([
      ctx.supabase.from('lp_deposits').select('*, vault:social_vaults(id,name,project_token,status,tvl_usdc)').eq('wallet', wallet).neq('status', 'withdrawn').order('deposited_at', { ascending: false }),
      ctx.supabase.from('withdrawal_queue').select('*').eq('wallet', wallet).eq('status', 'pending').order('notice_given_at', { ascending: false }),
    ])
    return ctx.json({ deposits: depositsRes.data ?? [], withdrawal_queue: queueRes.data ?? [] })
  }

  return ctx.json({ error: 'Missing id or address param' }, 400)
})
