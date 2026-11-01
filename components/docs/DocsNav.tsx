'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DOC_GROUPS, docHref } from './navigation'
import styles from '@/app/docs/docs.module.css'

export function DocsNav() {
  const pathname = usePathname()
  return (
    <aside className={styles.sidebar}>
      <nav aria-label="Documentation sections">
        {DOC_GROUPS.map((group) => (
          <div className={styles.navGroup} key={group.title}>
            <p className={styles.navTitle}>{group.title}</p>
            {group.items.map(({ slug, title }) => (
              <Link key={slug} href={docHref(slug)} aria-current={pathname === docHref(slug) ? 'page' : undefined}>
                {title}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}
