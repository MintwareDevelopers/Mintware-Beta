import { redirect } from 'next/navigation'

// Profile is now MESHED into /app/account (account-led, stats-forward, Attribution
// sprinkled). Keep this route as a redirect so old links + the nav still resolve.
// The public profile lives at /[address]; the identity/score/invite views live in
// the tabs on /app/account.
export default function ProfilePage() {
  redirect('/app/account')
}
