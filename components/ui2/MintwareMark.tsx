// MintwareMark — the Mintware brand mark: a dome rising over a wide base (an
// abstract "m" / horizon), set in the periwinkle tile the platform already uses.
// One reusable component so the nav, footer, and favicon all read identically.
//
// tone:
//   'tile'    → periwinkle-gradient rounded square, white two-tone mark (default; nav/footer)
//   'periwinkle' → transparent bg, periwinkle mark (on light surfaces)
//   'inverse' → transparent bg, white mark (on dark surfaces / dark "pop" pills)

type Tone = 'tile' | 'periwinkle' | 'inverse'

// Shared glyph geometry — dome + wider base ellipse. Base is faintly translucent so
// the dome reads as foreground (adds a little depth to the flat original).
function Glyph({ fill }: { fill: string }) {
  return (
    <>
      <ellipse cx="50" cy="62" rx="33" ry="9" fill={fill} fillOpacity="0.55" />
      <path d="M35 62C35 43 42 30 50 30C58 30 65 43 65 62Z" fill={fill} />
    </>
  )
}

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
  if (tone === 'tile') {
    return (
      <span
        role="img"
        aria-label={title}
        className={`inline-grid place-items-center shrink-0 ${className}`}
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.32),
          background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri))',
          boxShadow: '0 3px 10px rgba(108,108,240,0.35)',
        }}
      >
        <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
          <Glyph fill="#ffffff" />
        </svg>
      </span>
    )
  }

  const fill = tone === 'inverse' ? '#ffffff' : 'var(--color-peri)'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title}
      className={`shrink-0 ${className}`}
    >
      <Glyph fill={fill} />
    </svg>
  )
}
