import type { Metadata } from 'next'
import { V2Nav } from '@/components/ui2/V2Nav'
import { DocsNav } from '@/components/docs/DocsNav'
import styles from './docs.module.css'

export const metadata: Metadata = {
  title: 'Docs — Mintware',
  description: 'How Mintware works: MarketEngine shares, liquidity, valuation, withdrawals, owned RWA pools, integration and current contracts.',
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`font-geist ${styles.root}`}>
      <a className={styles.skip} href="#docs-content">Skip to content</a>
      <V2Nav active="docs" />
      <div className={styles.layout}>
        <DocsNav />
        <main id="docs-content" tabIndex={-1} className={styles.article}>{children}</main>
      </div>
    </div>
  )
}
