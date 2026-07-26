import { createBrowserClient, createServerClient } from '@supabase/ssr'

// ---------------------------------------------------------------------------
// Client-side (browser) — anon key, RLS enforced
// ---------------------------------------------------------------------------

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// ---------------------------------------------------------------------------
// Server-side — service role key, bypasses RLS
//
// getServiceClient() — preferred. Returns a module-level singleton.
//   Reused across requests within the same serverless instance.
//   Never call from 'use client' components.
//
// createSupabaseServiceClient() — kept for backward compatibility.
//   Now delegates to getServiceClient(). Do not use in new code.
// ---------------------------------------------------------------------------

type ServiceClient = ReturnType<typeof createServerClient>
let _serviceClient: ServiceClient | null = null

export function getServiceClient(): ServiceClient {
  if (typeof window !== 'undefined') {
    throw new Error('getServiceClient() must only be called server-side')
  }
  if (!_serviceClient) {
    _serviceClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } }
    )
  }
  return _serviceClient
}

/** @deprecated Use getServiceClient() instead */
export function createSupabaseServiceClient(): ServiceClient {
  return getServiceClient()
}
