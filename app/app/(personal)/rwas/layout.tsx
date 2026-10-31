import { AppContainer } from '@/components/web2/AppShell'

// /app/rwas/* — the RWA liquidity demo (Base Sepolia), in the Personal workspace.
export const metadata = { title: 'Mintware — Real-world assets', robots: { index: false, follow: false } }

export default function RwasLayout({ children }: { children: React.ReactNode }) {
  return <AppContainer>{children}</AppContainer>
}
