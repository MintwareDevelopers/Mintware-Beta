import { V1Shell } from '@/components/web2/v1/V1Shell'
import { V1Referrals } from '@/components/web2/v1/V1Referrals'

// V1 Referrals — invite & earn. Reuses the existing referral system (deterministic code + /ref link +
// referral_stats). Dark app-mode shell. Testnet — rewards illustrative, live with the mainnet gateway.
export const metadata = { title: 'Mintware — Referrals' }

export default function V1ReferralsPage() {
  return (
    <V1Shell>
      <V1Referrals />
    </V1Shell>
  )
}
