import { V1Shell } from '@/components/web2/v1/V1Shell'
import { V1Discover } from '@/components/web2/v1/V1Discover'

// The live V1 platform — Discover (curated pools). Reached from the Launch chooser's "V1 · Live" track;
// dark "app mode" shell, distinct from the light marketing site. See components/web2/v1/V1Shell.tsx.
export const metadata = { title: 'Mintware — Discover' }

export default function V1Page() {
  return (
    <V1Shell>
      <V1Discover />
    </V1Shell>
  )
}
