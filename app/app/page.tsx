import { redirect } from 'next/navigation'

// App-tier home. There is no standalone dashboard yet, so the app door lands on
// the flagship vault browse (/vaults — public, list stays on the marketing side);
// gated actions live under /app/vault/*. Revisit when an aggregated positions
// dashboard exists (IA §05 open decision).
export default function AppHome() {
  redirect('/vaults')
}
