export const DOC_GROUPS = [
  { title: 'Understand the engine', items: [
    { slug: '', title: 'The model' },
    { slug: 'markets', title: 'Engine lifecycle' },
    { slug: 'valuation', title: 'NAV, shares & price marks' },
    { slug: 'architecture', title: 'Contract architecture' },
    { slug: 'rwa', title: 'RWAs & owned pools' },
  ] },
  { title: 'Build with Mintware', items: [
    { slug: 'integrating', title: 'Integration guide' },
    { slug: 'contracts', title: 'Contract addresses' },
    { slug: 'glossary', title: 'Glossary' },
  ] },
  { title: 'Other products', items: [
    { slug: 'swap', title: 'Swap' },
    { slug: 'earn', title: 'Treasury yield (Earn)' },
    { slug: 'card', title: 'Card' },
    { slug: 'agents', title: 'Agent payments' },
  ] },
  { title: 'Understand the risks', items: [
    { slug: 'risks', title: 'Risks' },
    { slug: 'security', title: 'Security & authority' },
  ] },
] as const

export const DOC_SECTIONS = DOC_GROUPS.flatMap((group) => [...group.items])
export const docHref = (slug: string) => slug ? `/docs/${slug}` : '/docs'
