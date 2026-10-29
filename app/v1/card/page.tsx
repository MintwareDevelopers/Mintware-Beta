import { V1Shell } from '@/components/web2/v1/V1Shell'
import { V1Card } from '@/components/web2/v1/V1Card'

export const metadata = { title: 'Mintware — Card' }

export default function V1CardPage() {
  return (
    <V1Shell>
      <V1Card />
    </V1Shell>
  )
}
