import { Suspense } from 'react'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { MwNav } from '@/components/MwNav'
import { SwapWidget } from '@/components/swap/SwapWidget'

export const metadata = {
  title: 'Swap · Mintware',
  description: 'Swap tokens across chains and earn attribution rewards.',
}

export default function SwapPage() {
  return (
    <MwAuthGuard>
      <MwNav />
      <main
        style={{
          minHeight: '100vh',
          background: '#F7F6FF',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 40,
          paddingBottom: 80,
          paddingLeft: 16,
          paddingRight: 16,
        }}
      >
        <div style={{ width: '100%', maxWidth: 440 }}>
          <h1
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 26,
              fontWeight: 700,
              color: '#1A1A2E',
              marginBottom: 6,
              letterSpacing: '-0.5px',
            }}
          >
            Swap
          </h1>
          <p
            style={{
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: 14,
              color: '#8A8C9E',
              marginBottom: 24,
            }}
          >
            Trade tokens across chains and earn attribution rewards.
          </p>

          {/* Suspense wrapper required for useSearchParams in useCampaign */}
          <Suspense fallback={<SwapPageSkeleton />}>
            <SwapWidget />
          </Suspense>
        </div>
      </main>
    </MwAuthGuard>
  )
}

function SwapPageSkeleton() {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 16,
        border: '1px solid rgba(26,26,46,0.08)',
        padding: 20,
        height: 460,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#8A8C9E',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        fontSize: 14,
      }}
    >
      Loading swap…
    </div>
  )
}
