// Shared "is this caller an active member (or the owner) of this org" check — used by every card
// route that needs it (issue, list, simulate-swipe, settle). Pulled out once these routes started
// duplicating it rather than let the copies drift.

import { policyForRole, type RolePolicy } from '@/lib/org/rolePresets'
import type { getServiceClient } from '@/lib/web2/supabase'

type SupabaseClient = ReturnType<typeof getServiceClient>

export type OrgRow = {
  id: string
  owner_wallet: string
  treasury_vault_address: string | null
  treasury_chain_id: number | null
}

export type ActiveCallerResult =
  | { org: OrgRow; caller: string; isOwner: boolean; policy: RolePolicy }
  | { error: string; status: 403 | 404 }

export async function requireActiveCaller(
  supabase: SupabaseClient,
  callerAddress: string,
  orgId: string,
): Promise<ActiveCallerResult> {
  const caller = callerAddress.toLowerCase()
  const { data: org } = await supabase
    .from('orgs')
    .select('id, owner_wallet, treasury_vault_address, treasury_chain_id')
    .eq('id', orgId)
    .single()
  if (!org) return { error: 'org not found', status: 404 }
  const isOwner = (org.owner_wallet as string).toLowerCase() === caller
  if (isOwner) return { org: org as OrgRow, caller, isOwner, policy: policyForRole('owner') }
  const { data: mem } = await supabase
    .from('org_members').select('role, status').eq('org_id', orgId).eq('wallet', caller).maybeSingle()
  if (!mem || mem.status !== 'active') return { error: 'not an active member of this org', status: 403 }
  return { org: org as OrgRow, caller, isOwner, policy: policyForRole(mem.role) }
}
