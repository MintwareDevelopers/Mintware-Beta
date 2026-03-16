/**
 * Explorer — served as the existing static explorer.html
 * The explorer is a complex D3-powered page; serve the existing public file directly.
 */
import { redirect } from 'next/navigation'

export default function ExplorerPage() {
  redirect('/explorer.html')
}
