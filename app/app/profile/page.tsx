import { redirect } from 'next/navigation'

// Profile is now MESHED into /app/account (account-led, stats-forward, Attribution
// sprinkled). Keep this route as a redirect so old links + the nav still resolve.
// The identity/score/invite views live in the tabs on /app/account. The public
// /[address] wallet-lookup page was retired 2026-08-28 with the rest of the
// human-facing Attribution surface — see attribution_review_2026_08_28 memory.
export default function ProfilePage() {
  redirect('/app/account')
}
