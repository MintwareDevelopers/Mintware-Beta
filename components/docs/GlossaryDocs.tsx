import { DocHeader } from './DocPrimitives'
import styles from '@/app/docs/docs.module.css'

const TERMS = [
  ['adapter', 'Adapter', 'A contract between an engine and a per-token custody or yield source. It reports assets and capacity and accepts deposits/recalls. This is distinct from the PermissionsAdapter.'],
  ['band', 'Band / range', 'A pair of price boundaries. The engine’s liquidity band defines where its LP position is active. The RWA hook’s appraisal band independently controls acceptable trading outcomes.'],
  ['basis-point', 'Basis point (bps)', 'One hundredth of a percent. 10,000 basis points equal 100%. Uniswap fee pips use a different scale: 1,000,000 pips equal 100%.'],
  ['engine', 'Engine', 'One market’s capital manager and share ledger, bound to one pool. It values assets, issues shares, manages liquidity and processes exits.'],
  ['harvest', 'Harvest', 'Collect accrued LP fees into the engine’s token balances. It does not automatically pay holders or redeploy the fees.'],
  ['hook', 'Hook', 'A contract attached to a pool key, called by Uniswap’s PoolManager at selected operations. Mintware’s owned RWA hook checks permissions, appraisals and trading bands.'],
  ['in-kind', 'In-kind withdrawal', 'Delivery in the portfolio’s actual underlying tokens, rather than selling everything for one payout asset.'],
  ['liquidity', 'Liquidity / LP', 'Tokens committed to support trades. A liquidity provider (LP) owns a claim on those tokens and applicable trading fees.'],
  ['mark', 'Mark', 'A reference price used to value an asset in the quote token, with an observation timestamp. It is distinct from the pool’s current spot price.'],
  ['nav', 'NAV', 'Net asset value: the marked value of the engine’s directly held tokens, adapter claims and LP token amounts. Uncollected LP fees are excluded until collection.'],
  ['permissions-adapter', 'PermissionsAdapter', 'Uniswap’s wrapper that holds a permissioned underlying asset while PoolManager holds its virtual representation. Taking virtual units releases underlying.'],
  ['pool-key', 'Pool key', 'The currencies, fee, tick spacing and hook identifying a Uniswap v4 pool. The same currency pair can have different pools.'],
  ['principal', 'Principal', 'Context matters: contributed capital in ordinary usage; a represented actor in permission checks. The engine setting named principalCap actually gates marked NAV at particular operations.'],
  ['quote', 'Quote asset', 'The token used as the unit of account for market NAV. A quote-denominated value is not necessarily a dollar value.'],
  ['raw-units', 'Raw units / WAD', 'Raw units are token integers before applying decimals. WAD means a number scaled by 10^18; the mark is whole quote tokens per whole asset token at that scale.'],
  ['recenter', 'Recenter', 'Atomically move existing LP liquidity into a same-width band near spot, within edge, cooldown and maximum-move limits.'],
  ['shares', 'Shares', 'An 18-decimal proportional claim on one market portfolio. Owned RWA engine shares cannot be transferred between holders.'],
  ['tick', 'Tick', 'An integer index on Uniswap’s price grid; one tick changes the currency1/currency0 raw-unit price ratio by a factor of 1.0001. Tick spacing restricts usable LP boundaries.'],
] as const

export function GlossaryDocs() {
  return <>
    <DocHeader title="A short glossary" lead="The words used throughout the engine reference, in plain language." />
    <dl className={styles.glossary}>{TERMS.map(([id, term, definition]) => <div key={id}>
      <dt id={id}><a href={`#${id}`}>{term}</a></dt><dd>{definition}</dd>
    </div>)}</dl>
  </>
}
