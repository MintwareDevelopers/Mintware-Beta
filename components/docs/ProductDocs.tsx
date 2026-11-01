import Link from 'next/link'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { DocHeader, H2, Note, Sources } from './DocPrimitives'

export function SwapDocs() {
  return <>
    <DocHeader title="Swap" lead="Exchange tokens on a supported network from your connected wallet."
      status="Swap can move real tokens on mainnet. This is separate from the testnet MarketEngine demonstrations." />
    <p>The <Link href="/app/swap">Swap app</Link> finds exchange routes on the selected network. The current quote route sets the source and destination chain to the same chain: this flow does not bridge. Review the network, tokens, route, platform fee and network cost before approving or signing. Keep the network’s native token for transaction fees.</p>
    <p>A swap does not issue MarketEngine shares or add your assets to an engine. A routed trade uses external liquidity and carries execution risk. Review the quote and transaction limits before signing.</p>
    <Sources files={['components/rewards/swap/SwapWidget.tsx', 'lib/web2/providers/lifi.ts', 'app/api/(web2)/swap/quote/route.ts']} />
  </>
}

export function EarnDocs() {
  return <>
    <DocHeader title="Treasury yield (Earn)" lead="A single-asset vault holds a claim on one adapter. This is a different share model from a two-asset market."
      status="Testnet-only and unaudited. The Team workspace is a private preview; source support does not establish a live production yield source." />
    <p><code>MintwareYieldVault</code> is an ERC-4626 vault with <code>mwEARN</code> shares. It accepts its configured underlying asset, such as test USDC, and uses one <code>IYieldAdapter</code>. Read <code>asset()</code> for the specific instance: not every deployed instance holds USDC.</p>
    <p>Any return depends on the adapter’s underlying source and costs. A custody-only adapter earns zero. Pausing blocks deposits and mints; withdrawals and redemptions remain callable subject to liquidity and accounting checks.</p>
    <H2 id="exits">Redemption and withdrawal differ</H2>
    <p><code>redeem(shares, receiver, owner)</code> can pay the obtainable assets and leave unburned shares with the holder. The burn reflects the source assets consumed, so the exiting holder bears source exit costs. <code>withdraw(assets, receiver, owner)</code> instead requires delivery of the requested asset amount and reverts if it cannot obtain it. Neither path promises immediate liquidity.</p>
    <p>Team treasury reads use the organization’s configured Earn vault. Card refill is a separate, restricted redemption path described under <Link href="/docs/card">Card</Link>.</p>
    <Sources files={['contracts-v4/src/payments/MintwareYieldVault.sol', 'lib/org/treasuryReader.ts', '.claude/rules/payments-ypn.md', 'config/deployments.json']} />
  </>
}

export function CardDocs() {
  return <>
    <DocHeader title="Card" lead="The proposed card spends from a buffer wallet. Earn shares can refill that buffer through a restricted gateway."
      status="In development, with a simulated preview. This is not a live card offer or a production spend rail." />
    <p><code>MintwarePaymentGateway</code> implements refill, not merchant settlement. An authorized relayer calls <code>refill(bytes32 refillId, address member, uint256 shares)</code> to redeem a member’s Earn shares to that member’s registered buffer wallet.</p>
    <ul>
      <li>The member proposes a destination, waits 48 hours, then accepts it. The member can revoke the registered destination at any time.</li>
      <li>Per-member and global UTC-day caps limit delivered refill amounts. Increases are timelocked; lower caps can apply immediately.</li>
      <li>A refill identifier cannot be reused. Gateway pause blocks refills.</li>
      <li>Purchases are not settled directly from engine NAV or Earn shares. There is no spend-from-NAV entry point in this gateway.</li>
    </ul>
    <p>The current deployment record contains no entry for this refill gateway. Explore the <Link href="/app/previews/card">simulated card preview</Link>; <Link href="/docs/earn">Earn</Link> explains the separate vault.</p>
    <Sources files={['contracts-v4/src/payments/MintwarePaymentGateway.sol', 'contracts-v4/src/payments/MintwareYieldVault.sol', '.claude/rules/payments-ypn.md', 'config/deployments.json']} />
  </>
}

export function AgentsDocs() {
  return <>
    <DocHeader title="Agent payments" lead="Pay per request with a signed USDC transfer. Attribution is a separate reputation signal."
      status="Direct x402 is runtime-configured, with testnet as the default network. The parking vault is testnet and earns no yield; the mainnet attribution ledger is fundless." />
    <FlowDiagram steps={[
      { label: 'Request a resource', sub: 'An enabled seller responds with HTTP 402 and payment requirements.' },
      { label: 'Sign & retry', sub: 'The agent signs an EIP-3009 authorization and retries with PAYMENT-SIGNATURE.' },
      { label: 'Verify & transfer', sub: 'The direct facilitator verifies it; settlement sends USDC from payer to seller.' },
    ]} />
    <p>The active facilitator in <code>lib/x402/config.ts</code> is selected with <code>X402_SETTLE_PROVIDER=direct</code>. Supported networks and the seller destination are configured at runtime. When unconfigured, the score seller returns HTTP 503. Do not infer a live mainnet payment service merely from the source supporting that network.</p>
    <p><code>/api/x402/score?address=&lt;wallet&gt;</code> is the paywalled score endpoint. Its current handler verifies the authorization before serving the resource and initiates settlement asynchronously; a successful resource response is not itself proof that the payment transaction confirmed.</p>
    <Note title="No spend from parked shares">
      Direct x402 pays from the agent’s wallet, not from an earning vault balance. The recorded <code>AgentParkVault</code> holds test USDC through an idle adapter with no yield. An earning balance that pays in place is not enabled in the current implementation.
    </Note>
    <p>The separate <code>AIAttribution</code> ledger and ERC-8004 identity support agent reputation. Start at <Link href="/agents">agent integrations</Link>; recorded contracts are in <Link href="/docs/contracts">Contracts</Link>.</p>
    <Sources files={['lib/x402/config.ts', 'lib/x402/directFacilitator.ts', 'lib/x402/directSettler.ts', 'app/api/x402/score/route.ts', 'config/deployments.json', '.claude/rules/agents.md']} />
  </>
}
