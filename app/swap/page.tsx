import { MwAuthGuard } from '@/components/MwAuthGuard'
import { MwNav } from '@/components/MwNav'
import { MintwareSwap } from '@/components/swap/MintwareSwap'

export const metadata = {
  title: 'Swap · Mintware',
  description: 'Swap tokens across chains and earn attribution rewards.',
}

export default function SwapPage() {
  return (
    <MwAuthGuard>
      <MwNav />
      <main className="min-h-screen bg-mw-surface flex flex-col items-center px-4 pt-[52px] pb-20 relative overflow-hidden">
        <div className="mw-hero-radial" />
        <div className="mw-light-grid" />

        <div className="w-full max-w-[440px] relative">
          {/* Eyebrow pill */}
          <div className="inline-flex items-center gap-1.5 bg-white border border-mw-border-strong rounded-full px-3.5 py-1 text-[11px] font-bold text-mw-ink-2 tracking-[0.5px] mb-[18px] shadow-sm animate-fade-up">
            <span className="w-1.5 h-1.5 rounded-full bg-mw-green animate-pulse-slow" />
            Multi-chain · Attribution rewards
          </div>

          {/* Heading */}
          <h1 className="font-[Georgia,serif] text-[32px] font-bold text-mw-ink tracking-[-1px] leading-[1.1] mb-2 [animation:fadeUp_0.4s_0.06s_ease_both]">
            Swap &amp; <em className="not-italic text-mw-brand">earn.</em>
          </h1>

          {/* Subheading */}
          <p className="text-sm text-mw-ink-3 mb-7 leading-relaxed [animation:fadeUp_0.4s_0.12s_ease_both]">
            Trade tokens across chains. Every swap builds your Attribution score and unlocks campaign rewards.
          </p>

          {/* Widget — MintwareSwap handles its own loading skeleton via dynamic import */}
          <div className="[animation:fadeUp_0.5s_0.16s_ease_both]">
            <MintwareSwap />
          </div>
        </div>
      </main>
    </MwAuthGuard>
  )
}

