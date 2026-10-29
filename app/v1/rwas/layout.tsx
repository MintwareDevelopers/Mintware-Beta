import { V1Shell } from '@/components/web2/v1/V1Shell'

// /v1/rwas/* — the live RWA liquidity demo (Base Sepolia + XRPL EVM testnet) inside the V1 platform shell.
export const metadata = { title: 'Mintware — Real-world assets', robots: { index: false, follow: false } }

export default function RwasLayout({ children }: { children: React.ReactNode }) {
  return <V1Shell>{children}</V1Shell>
}
