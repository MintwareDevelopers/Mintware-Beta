// AirbrushSplash — a soft, grainy pastel gradient "splash" for depth behind light
// hero/section grounds. Absolutely positioned; drop into a `relative overflow-hidden`
// parent and keep the real content above it (e.g. wrap content in `relative`).
// The signature airbrush texture (mesh gradient + fractal-noise grain), light-only.

const MESH: Record<string, string> = {
  peri:
    'radial-gradient(42% 60% at 86% 12%, rgba(169,182,252,0.38), transparent 70%), radial-gradient(38% 56% at 10% 30%, rgba(199,184,251,0.28), transparent 72%)',
  coral:
    'radial-gradient(44% 62% at 88% 10%, rgba(248,198,172,0.36), transparent 70%), radial-gradient(36% 54% at 6% 28%, rgba(199,169,242,0.26), transparent 72%)',
  mix:
    'radial-gradient(40% 58% at 88% 8%, rgba(186,210,250,0.36), transparent 70%), radial-gradient(36% 56% at 4% 26%, rgba(248,198,172,0.26), transparent 72%)',
}

export type SplashTone = keyof typeof MESH

export function AirbrushSplash({ tone = 'peri', opacity = 1 }: { tone?: SplashTone; opacity?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ opacity }}>
      <div className="absolute inset-0" style={{ background: MESH[tone] }} />
      <div className="grain absolute inset-0 opacity-[0.55]" />
    </div>
  )
}
