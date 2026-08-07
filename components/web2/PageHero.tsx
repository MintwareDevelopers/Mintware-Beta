import type { ReactNode } from 'react'

// =============================================================================
// PageHero — the ONE canonical hero for every Mintware page, so heros never
// drift again. Eyebrow (✴ mono) → oversized accented H1 → subhead, on the
// shared grid background. The nav is rendered by the page (MarketingNav for
// public pages, MwNav for app pages); PageHero is the headline block directly
// beneath it. Page-specific content (wallet search, CTAs, toggles, cards,
// preview widgets) goes in `children`, rendered below the subhead.
//
// Canonical scale (do not fork per-page):
//   eyebrow  font-atx-mono · 11px · tracking .16em · ink/55
//   title    clamp(38px, 6.4vw, 86px) · bold · tracking -.03em · leading .98
//   sub      clamp(15px, 1.9vw, 20px) · leading 1.5 · ink/70
// Accent: pass the highlighted words as <span className="text-atx-blue"> in `title`.
// =============================================================================

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

export function PageHero({
  eyebrow,
  title,
  sub,
  children,
  align = 'left',
}: {
  eyebrow?: string
  title: ReactNode
  sub?: ReactNode
  children?: ReactNode
  align?: 'left' | 'center'
}) {
  const center = align === 'center'
  return (
    <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
      <div className={`mx-auto max-w-[1180px] px-6 py-[54px] max-[800px]:px-4 ${center ? 'text-center' : ''}`}>
        {eyebrow && (
          <div className="font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-ink/55">
            ✴ {eyebrow}
          </div>
        )}
        <h1
          className={`font-atx-display font-bold tracking-[-0.03em] leading-[0.98] text-[clamp(38px,6.4vw,86px)] mt-4 max-w-[16ch] ${center ? 'mx-auto' : ''}`}
        >
          {title}
        </h1>
        {sub && (
          <p
            className={`text-[clamp(15px,1.9vw,20px)] leading-[1.5] text-atx-ink/70 mt-6 max-w-[54ch] ${center ? 'mx-auto' : ''}`}
          >
            {sub}
          </p>
        )}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  )
}
