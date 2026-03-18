import { createBrowserClient, createServerClient } from '@supabase/ssr'

// Client-side (browser) — anon key, RLS enforced
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Server-side only — service role key, bypasses RLS
// Use in API routes and server utilities. Never call from 'use client' components.
export function createSupabaseServiceClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createSupabaseServiceClient() must only be called server-side')
  }
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}
