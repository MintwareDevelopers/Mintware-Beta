import { V1AppHome } from '@/components/web2/V1AppHome'

// The live V1 platform (LP Gateway), reachable from the Launch chooser's "V1 · Live" track. This is a
// dedicated door so V1 is always reachable regardless of the site-wide V2 default — the marketing pages
// and the V2 app surfaces are untouched. See components/web2/LaunchModal.tsx (the track chooser).
export const metadata = { title: 'Mintware — LP Gateway' }

export default function V1Platform() {
  return <V1AppHome />
}
