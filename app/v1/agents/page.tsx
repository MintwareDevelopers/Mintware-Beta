import { V1Shell } from '@/components/web2/v1/V1Shell'
import { V1Agents } from '@/components/web2/v1/V1Agents'

export const metadata = { title: 'Mintware — Agents' }

export default function V1AgentsPage() {
  return (
    <V1Shell>
      <V1Agents />
    </V1Shell>
  )
}
