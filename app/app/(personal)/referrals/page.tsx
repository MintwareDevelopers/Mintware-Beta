import { AppContainer } from '@/components/web2/AppShell'
import { V1Referrals } from '@/components/web2/v1/V1Referrals'

// Referrals — your invite link. Reuses the existing referral system (deterministic code + /ref link +
// referral_stats). Not in the sidebar yet; it folds into Portfolio next.
export const metadata = { title: 'Mintware — Referrals' }

export default function V1ReferralsPage() {
  return (
    <AppContainer>
      <V1Referrals />
    </AppContainer>
  )
}
