import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DOC_SECTIONS } from '@/components/docs/navigation'
import { EngineDocs } from '@/components/docs/EngineDocs'
import { ValuationDocs } from '@/components/docs/ValuationDocs'
import { ArchitectureDocs } from '@/components/docs/ArchitectureDocs'
import { RwaDocs } from '@/components/docs/RwaDocs'
import { IntegrationDocs } from '@/components/docs/IntegrationDocs'
import { ContractsDocs } from '@/components/docs/ContractsDocs'
import { GlossaryDocs } from '@/components/docs/GlossaryDocs'
import { SwapDocs, EarnDocs, CardDocs, AgentsDocs } from '@/components/docs/ProductDocs'
import { RisksDocs, SecurityDocs } from '@/components/docs/TrustDocs'

const CONTENT = {
  markets: EngineDocs,
  valuation: ValuationDocs,
  architecture: ArchitectureDocs,
  rwa: RwaDocs,
  integrating: IntegrationDocs,
  contracts: ContractsDocs,
  glossary: GlossaryDocs,
  swap: SwapDocs,
  earn: EarnDocs,
  card: CardDocs,
  agents: AgentsDocs,
  risks: RisksDocs,
  security: SecurityDocs,
} as const

type Props = { params: Promise<{ section: string }> }

export function generateStaticParams() {
  return Object.keys(CONTENT).map((section) => ({ section }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params
  const entry = DOC_SECTIONS.find((item) => item.slug === section)
  return { title: entry ? `${entry.title} — Mintware Docs` : 'Docs — Mintware' }
}

export default async function DocsSectionPage({ params }: Props) {
  const { section } = await params
  if (!Object.hasOwn(CONTENT, section)) notFound()
  const Content = CONTENT[section as keyof typeof CONTENT]
  return <Content />
}
