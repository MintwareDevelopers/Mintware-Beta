import Link from 'next/link'
import { CONTRACT_GROUPS } from './deployments'
import { DocHeader, DocTable, H2, Note, Sources } from './DocPrimitives'

export function ContractsDocs() {
  return <>
    <DocHeader title="Current contract addresses" lead="Generated from the committed deployment record, with chain-specific explorer links. No addresses are copied into this page."
      status="Market and RWA records are testnet-only. The listed mainnet attribution ledger is fundless; it is not a mainnet liquidity deployment." />
    <p>This reference selects current engine, RWA, Earn and agent/attribution records from <code>config/deployments.json</code>. It excludes superseded entries and retired liquidity, Treasury, collateral/settlement and staged-router demos, including old families still labeled testnet in the registry.</p>
    <Note title="Recorded deployment is not live health">
      The date below comes from the record’s verification or deployment date. It is not a fresh RPC check. Confirm chain, activation, pause, installed module and permissions before integrating. <Link href="/docs/integrating#public-reads">Public reads</Link> report runtime availability.
    </Note>
    {CONTRACT_GROUPS.map((group) => <section key={`${group.environment}-${group.chain}`}>
      <H2 id={group.chain}>{group.name}</H2>
      <DocTable caption={`${group.contracts.length} current records`} headers={['Contract', 'Address', 'Status / record date']} rows={group.contracts.map((contract) => [
        <code key="n">{contract.name}</code>,
        contract.explorer ? <a key="a" href={`${contract.explorer}/address/${contract.address}`} target="_blank" rel="noreferrer"><code>{contract.address}</code></a> : <code key="a">{contract.address}</code>,
        `${contract.status} · ${contract.recordedAt}`,
      ])} />
    </section>)}
    <p><code>MintwareYieldVault</code> is an asset-generic contract. Its recorded Base Sepolia address is a mock-WETH instance; the separately listed <code>AgentParkVault</code> is the test-USDC parking vault. A contract name alone does not identify its underlying asset. There is no current deployment entry for <code>ChainlinkUsdRatioMarketMark</code> or <code>MintwarePaymentGateway</code> in this record.</p>
    <Sources files={['config/deployments.json', 'lib/rwa/units.ts', 'lib/chains/marketChains.ts']} />
  </>
}
