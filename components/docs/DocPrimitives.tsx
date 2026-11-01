import type { ReactNode } from 'react'
import styles from '@/app/docs/docs.module.css'

export function DocHeader({ title, lead, status }: { title: string; lead: string; status?: string }) {
  return <header className={styles.docHeader}>
    <h1>{title}</h1>
    <p className={styles.lead}>{lead}</p>
    {status && <p className={styles.status}>{status}</p>}
  </header>
}

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id}><a href={`#${id}`}>{children}<span aria-hidden="true" className={styles.anchor}> #</span></a></h2>
}

export function Note({ title, children }: { title: string; children: ReactNode }) {
  return <aside className={styles.note}><strong>{title}</strong><div>{children}</div></aside>
}

export function Code({ children, label }: { children: string; label: string }) {
  return <figure className={styles.code}><figcaption>{label}</figcaption><pre><code>{children}</code></pre></figure>
}

export function DocTable({ headers, rows, caption }: { headers: string[]; rows: ReactNode[][]; caption: string }) {
  return <table className={styles.table}>
    <caption>{caption}</caption>
    <thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, col) =>
      <td key={col} data-label={headers[col]}>{cell}</td>,
    )}</tr>)}</tbody>
  </table>
}

// Repository-relative evidence avoids assuming a public source repository URL.
export function Sources({ files }: { files: string[] }) {
  return <details className={styles.sources}><summary>Source reference</summary>
    <p>Behavior above follows these files in the Mintware repository. Deployment records describe recorded state, not a fresh chain read.</p>
    <ul>{files.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
  </details>
}
