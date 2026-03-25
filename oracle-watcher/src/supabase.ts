// =============================================================================
// oracle-watcher — thin Supabase REST client
// Cannot use @supabase/ssr in a Cloudflare Worker (uses Node http/stream).
// Uses raw fetch against PostgREST endpoint instead.
// =============================================================================

import type { Env } from './types.js'

function headers(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'apikey':        env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type':  'application/json',
    ...extra,
  }
}

export async function supabaseSelect<T>(
  env:   Env,
  table: string,
  query: string,
): Promise<T[]> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${table}?${query}`,
    { headers: headers(env) },
  )
  if (!res.ok) {
    console.error(`[supabase] SELECT ${table} failed:`, await res.text())
    return []
  }
  return res.json() as Promise<T[]>
}

export async function supabaseInsert(
  env:   Env,
  table: string,
  row:   Record<string, unknown>,
): Promise<void> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${table}`,
    {
      method:  'POST',
      headers: headers(env, { 'Prefer': 'resolution=ignore-duplicates' }),
      body:    JSON.stringify(row),
    },
  )
  if (!res.ok && res.status !== 409) {
    console.error(`[supabase] INSERT ${table} failed:`, await res.text())
  }
}

export async function supabaseUpsert(
  env:   Env,
  table: string,
  row:   Record<string, unknown>,
  onConflict: string,
): Promise<void> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${table}`,
    {
      method:  'POST',
      headers: headers(env, { 'Prefer': `resolution=merge-duplicates,return=minimal` }),
      body:    JSON.stringify(row),
    },
  )
  if (!res.ok) {
    console.error(`[supabase] UPSERT ${table} failed (${res.status}):`, await res.text())
  }
}
