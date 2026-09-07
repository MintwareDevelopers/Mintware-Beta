import { V1Shell } from '@/components/web2/v1/V1Shell'
import { V1Leaderboard } from '@/components/web2/v1/V1Leaderboard'

// V1 Leaderboard — Season 0. Ranks observable activity (capital at work · referrals). Testnet, illustrative.
export const metadata = { title: 'Mintware — Leaderboard' }

export default function V1LeaderboardPage() {
  return (
    <V1Shell>
      <V1Leaderboard />
    </V1Shell>
  )
}
