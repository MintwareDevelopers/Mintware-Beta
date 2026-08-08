// =============================================================================
// Block-explorer URL helper — single source of truth.
// (Replaces the duplicated maps in ClaimCard.tsx + lib/swap/lifi.ts.)
// Keyed by chainId so callers don't juggle chain slugs.
// =============================================================================

const EXPLORER_BASE: Record<number, string> = {
  1:     'https://etherscan.io',
  8453:  'https://basescan.org',
  84532: 'https://sepolia.basescan.org', // Base Sepolia — the vault chain
  42161: 'https://arbiscan.io',
  56:    'https://bscscan.com',
}

/** Explorer origin for a chain, or undefined if unknown. */
export function explorerBase(chainId: number): string | undefined {
  return EXPLORER_BASE[chainId]
}

/** `https://…/tx/<hash>` or undefined if the chain isn't known. */
export function explorerTxUrl(chainId: number, txHash: string): string | undefined {
  const base = EXPLORER_BASE[chainId]
  return base ? `${base}/tx/${txHash}` : undefined
}

/** `https://…/address/<addr>` or undefined if the chain isn't known. */
export function explorerAddressUrl(chainId: number, address: string): string | undefined {
  const base = EXPLORER_BASE[chainId]
  return base ? `${base}/address/${address}` : undefined
}
