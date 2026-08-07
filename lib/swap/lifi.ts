// =============================================================================
// lib/swap/lifi.ts — LI.FI SDK configuration for Mintware custom swap UI
//
// ARCHITECTURE NOTE: Shared between Web2 (quote proxy) and Web3 (execute).
// Do NOT move this file into a grouping subfolder.
//
// Exports:
//   lifiEvmProvider  — EVM wallet provider (call setOptions() with wagmi client)
//   createLifiConfig — Initialises the SDK (browser-only, called once on mount)
//   LIFI_FEE         — 0.5% integrator fee
//   LIFI_INTEGRATOR  — integrator identifier string
//   LIFI_TREASURY    — fee recipient address
//   MINTWARE_CHAIN_IDS — supported chains
//   CHAIN_NAMES / CHAIN_EXPLORER — display helpers
// =============================================================================

import { EVM, createConfig } from '@lifi/sdk'
import type { EVMProvider } from '@lifi/sdk'

// ---------------------------------------------------------------------------
// Module-level EVM provider — created once, wallet injected via setOptions()
// ---------------------------------------------------------------------------
export const lifiEvmProvider: EVMProvider = EVM()

// ---------------------------------------------------------------------------
// SDK initialisation — must run client-side only (uses fetch, globals)
// ---------------------------------------------------------------------------
export function createLifiConfig() {
  createConfig({
    integrator: process.env.NEXT_PUBLIC_LIFI_INTEGRATOR ?? 'mintware',
    apiKey:     process.env.NEXT_PUBLIC_LIFI_API_KEY,
    providers:  [lifiEvmProvider],
  })
}

// ---------------------------------------------------------------------------
// Fee / attribution constants
// ---------------------------------------------------------------------------
export const LIFI_FEE        = 0.005
export const LIFI_INTEGRATOR = process.env.NEXT_PUBLIC_LIFI_INTEGRATOR ?? 'mintware'
export const LIFI_TREASURY   = process.env.NEXT_PUBLIC_MINTWARE_TREASURY

// ---------------------------------------------------------------------------
// Chain constants
// ---------------------------------------------------------------------------
export const MINTWARE_CHAIN_IDS = [8453] as const

export const CHAIN_NAMES: Record<number, string> = {
  8453: 'Base',
}

export const CHAIN_EXPLORER: Record<number, string> = {
  8453: 'https://basescan.org/tx/',
}

// Native / zero address — used for gas tokens
export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'

// Default tokens per chain (ETH on Base)
export const DEFAULT_FROM_TOKENS: Record<number, string> = {
  8453: NATIVE_TOKEN_ADDRESS, // ETH on Base
}

export const DEFAULT_TO_TOKENS: Record<number, string> = {
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
}
