// =============================================================================
// Shared transaction-lifecycle toasts — one consistent pending → confirming →
// success (+ explorer link) → error experience across every write flow (deposit,
// withdraw, swap, claim). Drives the globally-mounted sonner Toaster.
//
// Usage:
//   const t = createTxToast({ chainId, label: 'Deposit' })
//   t.submitted(hash)   // wallet signed, tx broadcast → "confirming…"
//   t.success(hash)     // receipt confirmed → success + "View ↗"
//   t.error(message)    // rejected / reverted
// All calls target the SAME toast id, so the one toast transitions in place.
// =============================================================================

import { toast } from 'sonner'
import { explorerTxUrl } from './explorer'

function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash
}

export interface TxToast {
  submitted: (txHash: string) => void
  success: (txHash?: string) => void
  error: (message?: string) => void
  dismiss: () => void
}

export function createTxToast(opts: { chainId: number; label: string }): TxToast {
  const { chainId, label } = opts
  const id = toast.loading(`${label} — confirm in your wallet…`)

  return {
    submitted(txHash: string) {
      toast.loading(`${label} — confirming on-chain…`, { id, description: shortHash(txHash) })
    },
    success(txHash?: string) {
      const url = txHash ? explorerTxUrl(chainId, txHash) : undefined
      toast.success(`${label} confirmed`, {
        id,
        description: txHash ? shortHash(txHash) : undefined,
        action: url ? { label: 'View ↗', onClick: () => window.open(url, '_blank', 'noopener') } : undefined,
      })
    },
    error(message?: string) {
      toast.error(`${label} failed`, { id, description: message })
    },
    dismiss() {
      toast.dismiss(id)
    },
  }
}
