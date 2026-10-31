// MintwareMark — the brand mark used across the older surfaces (nav, footers, org pages). Since the Mineral
// redesign it draws the three-disc stack (liquidity, collateral, credit), so every surface shows one logo.
//
// tone:
//   'tile' / 'periwinkle' → the full-colour disc stack (default; light surfaces)
//   'inverse'             → a white silhouette of the stack (dark surfaces)

type Tone = 'tile' | 'periwinkle' | 'inverse'

export function MintwareMark({
  size = 22,
  tone = 'tile',
  className = '',
  title = 'Mintware',
}: {
  size?: number
  tone?: Tone
  className?: string
  title?: string
}) {
  const inverse = tone === 'inverse'
  const c = (color: string, op = 1) => (inverse ? { fill: '#ffffff', fillOpacity: op } : { fill: color })
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={title} className={`shrink-0 ${className}`}>
      <ellipse cx="16" cy="23" rx="13" ry="5" {...c('#E58C66', 0.55)} />
      <ellipse cx="16" cy="21" rx="13" ry="5" {...c('#F2CBC2', 0.9)} />
      <ellipse cx="16" cy="15.5" rx="10.5" ry="4.2" {...c('#8E7FE0', 0.55)} />
      <ellipse cx="16" cy="14" rx="10.5" ry="4.2" {...c('#D6CFF6', 0.9)} />
      <ellipse cx="16" cy="9" rx="8" ry="3.4" {...c('#5B5BE6', 0.55)} />
      <ellipse cx="16" cy="7.6" rx="8" ry="3.4" {...c('#B3B2FB')} />
    </svg>
  )
}
