// Phase 2 — Social Vault DB queries (server-side, service role)
// All reads use the Supabase client — no direct SQL from browser.

import { createSupabaseBrowserClient } from '@/lib/web2/supabase'
import type { SocialVault, LpDeposit, WithdrawalQueueEntry } from './types'

/** Public: list all vaults (optionally filtered by status) */
export async function fetchVaults(status?: string): Promise<SocialVault[]> {
  const supabase = createSupabaseBrowserClient()
  let q = supabase
    .from('social_vaults')
    .select('*, current_epoch:vault_epochs(id,epoch_number,total_pool,bonus_pool,status,opened_at,closed_at,deadline)')
    .order('created_at', { ascending: false })

  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as SocialVault[]
}

/** Public: single vault by id */
export async function fetchVault(id: string): Promise<SocialVault | null> {
  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('social_vaults')
    .select('*, current_epoch:vault_epochs(id,epoch_number,total_pool,bonus_pool,status,opened_at,closed_at,deadline)')
    .eq('id', id)
    .single()

  if (error) return null
  return data as SocialVault
}

/** Wallet-scoped: deposits for a wallet across all vaults (or one vault) */
export async function fetchDeposits(wallet: string, vaultId?: string): Promise<LpDeposit[]> {
  const supabase = createSupabaseBrowserClient()
  let q = supabase
    .from('lp_deposits')
    .select('*')
    .eq('wallet', wallet.toLowerCase())
    .neq('status', 'withdrawn')
    .order('deposited_at', { ascending: false })

  if (vaultId) q = q.eq('vault_id', vaultId)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as LpDeposit[]
}

/** Wallet-scoped: pending withdrawal queue entries */
export async function fetchWithdrawalQueue(wallet: string): Promise<WithdrawalQueueEntry[]> {
  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('withdrawal_queue')
    .select('*')
    .eq('wallet', wallet.toLowerCase())
    .eq('status', 'pending')
    .order('notice_given_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as WithdrawalQueueEntry[]
}
