import { V1Shell } from '@/components/web2/v1/V1Shell'
import { V1Issuers } from '@/components/web2/v1/V1Issuers'

export const metadata = { title: 'Mintware — Issuers' }

export default function V1IssuersPage() {
  return (
    <V1Shell>
      <V1Issuers />
    </V1Shell>
  )
}
