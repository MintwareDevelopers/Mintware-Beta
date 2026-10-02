// Diagram specs for /how-it-works. Kept apart from the page so /deck and /dataroom can reuse the
// same pictures. Status pills are honesty labels — keep them in sync with .claude/STATE.md:
//   testnet = running on a testnet with mock tokens · built = tested code, not live · roadmap = planned.
// Copy rules apply here too: no deposit / savings / guaranteed / fixed-APY framing; IL is the LP's.

import type { DiagramSpec } from './ModelDiagram'

export const MODEL: DiagramSpec = {
  id: 'model',
  title: 'The Mintware model',
  description:
    'You send USDG to Mintware contracts, which hold the position and issue you shares redeemable anytime. ' +
    'The LP product deploys it into a curated third-party Uniswap v4 pool that earns trading fees and carries impermanent loss; ' +
    'the Earn product supplies it to a lending market that earns interest with no pairing. Fees and interest flow back into your share value.',
  wide: { w: 960, h: 290 },
  tall: { w: 360, h: 450 },
  nodes: [
    {
      id: 'you', title: 'You', tone: 'you', lines: ['USDG in your wallet'],
      wide: { x: 20, y: 110, w: 170, h: 70 },
      tall: { x: 20, y: 16, w: 320, h: 60 },
    },
    {
      id: 'mw', title: 'Mintware contracts', tone: 'mintware',
      wide: { x: 330, y: 20, w: 200, h: 250, lines: ['Hold the position,', 'issue your shares,', 'redeemable anytime'] },
      tall: { x: 20, y: 150, w: 320, h: 76, lines: ['Hold the position, issue your', 'shares — redeemable anytime'] },
    },
    {
      id: 'lp', title: 'LP', tone: 'external', status: 'testnet',
      wide: { x: 680, y: 20, w: 260, h: 80, lines: ['Curated Uniswap v4 pool · earns', 'trading fees, carries IL'] },
      tall: { x: 20, y: 330, w: 150, h: 100, lines: ['Curated Uniswap v4', 'pool · trading fees', '· carries IL'] },
    },
    {
      id: 'earn', title: 'Earn', tone: 'external', status: 'built',
      wide: { x: 680, y: 190, w: 260, h: 80, lines: ['Lending market · earns interest,', 'no pairing, no IL'] },
      tall: { x: 190, y: 330, w: 150, h: 100, lines: ['Lending market ·', 'interest · no pairing', '· no IL'] },
    },
  ],
  edges: [
    { from: 'you', to: 'mw', label: 'USDG', offset: -12 },
    { from: 'mw', to: 'you', label: 'withdraw', back: true, offset: 12 },
    { from: 'mw', to: 'lp', label: 'deploy', offset: -12 },
    { from: 'lp', to: 'mw', label: 'fees', back: true, offset: 12 },
    { from: 'mw', to: 'earn', label: 'supply', offset: -12 },
    { from: 'earn', to: 'mw', label: 'interest', back: true, offset: 12 },
  ],
}

export const V1_LP: DiagramSpec = {
  id: 'v1-lp',
  title: 'V1 LP Gateway flow',
  description:
    'Deposit USDG; the Position Manager mints your shares at a conservative mark. Deploy swaps part of it into the paired token ' +
    'in one transaction and adds the full amount to a curated third-party Uniswap v4 pool. Harvest collects trading fees — never ' +
    'principal — and compounds them into the position value. Withdraw anytime for your pro-rata share of both legs.',
  wide: { w: 960, h: 300 },
  tall: { w: 360, h: 624 },
  nodes: [
    {
      id: 'dep', title: 'Deposit USDG', tone: 'you', lines: ['Approve and deposit', 'from your wallet'],
      wide: { x: 20, y: 40, w: 170, h: 80 }, tall: { x: 30, y: 16, w: 300, h: 70 },
    },
    {
      id: 'pm', title: 'Position Manager', tone: 'mintware', status: 'testnet', lines: ['Mints your shares at', 'a conservative mark'],
      wide: { x: 270, y: 40, w: 170, h: 80 }, tall: { x: 30, y: 120, w: 300, h: 70 },
    },
    {
      id: 'deploy', title: 'Deploy', tone: 'mintware', status: 'testnet', lines: ['Swaps part into the', 'paired token in one tx'],
      wide: { x: 520, y: 40, w: 170, h: 80 }, tall: { x: 30, y: 224, w: 300, h: 70 },
    },
    {
      id: 'pool', title: 'Curated v4 pool', tone: 'external', status: 'testnet', lines: ['Third-party pool —', 'earns swap fees'],
      wide: { x: 770, y: 40, w: 170, h: 80 }, tall: { x: 30, y: 328, w: 300, h: 70 },
    },
    {
      id: 'harvest', title: 'Harvest', tone: 'mintware', status: 'testnet', lines: ['Collects fees,', 'never principal'],
      wide: { x: 770, y: 200, w: 170, h: 80 }, tall: { x: 30, y: 432, w: 300, h: 70 },
    },
    {
      id: 'wd', title: 'Withdraw anytime', tone: 'you', lines: ['Pro-rata share of', 'both legs'],
      wide: { x: 20, y: 200, w: 170, h: 80 }, tall: { x: 30, y: 536, w: 300, h: 70 },
    },
  ],
  edges: [
    { from: 'dep', to: 'pm', label: 'USDG' },
    { from: 'pm', to: 'deploy', label: 'staged' },
    { from: 'deploy', to: 'pool', label: 'full amount' },
    { from: 'pool', to: 'harvest', label: 'fees accrue' },
    {
      from: 'harvest', to: 'pm', label: 'compounded into position value', back: true,
      wide: { from: 'l', to: 'b', offset: 20 },
      tall: { from: 'r', to: 'r', via: 348, label: null },
    },
    {
      from: 'pm', to: 'wd', label: 'redeem', back: true,
      wide: { from: 'b', to: 'r', offset: -20 },
      tall: { from: 'l', to: 'l', via: 12, label: null },
    },
  ],
}

export const V1_EARN: DiagramSpec = {
  id: 'v1-earn',
  title: 'V1 Earn flow',
  description:
    'Supply USDG to the Earn adapter, which mints your shares and supplies the USDG to an ERC-4626 lending market. Interest accrues ' +
    'to your share value; there is no pairing and no impermanent loss. Withdraw returns USDG.',
  wide: { w: 960, h: 130 },
  tall: { w: 360, h: 330 },
  nodes: [
    {
      id: 'you', title: 'Supply USDG', tone: 'you', lines: ['Single asset in,', 'single asset out'],
      wide: { x: 20, y: 25, w: 220, h: 80 }, tall: { x: 20, y: 16, w: 320, h: 70 },
    },
    {
      id: 'ad', title: 'Earn adapter', tone: 'mintware', status: 'built', lines: ['Mints your shares;', 'value tracks interest'],
      wide: { x: 370, y: 25, w: 220, h: 80 }, tall: { x: 20, y: 130, w: 320, h: 70 },
    },
    {
      id: 'mk', title: 'Lending market', tone: 'external', status: 'built', lines: ['ERC-4626 vault ·', 'no pairing, no IL'],
      wide: { x: 720, y: 25, w: 220, h: 80 }, tall: { x: 20, y: 244, w: 320, h: 70 },
    },
  ],
  edges: [
    { from: 'you', to: 'ad', label: 'USDG', offset: -12 },
    { from: 'ad', to: 'you', label: 'withdraw', back: true, offset: 12 },
    { from: 'ad', to: 'mk', label: 'supply', offset: -12 },
    { from: 'mk', to: 'ad', label: 'interest', back: true, offset: 12 },
  ],
}

export const V2_TREASURY: DiagramSpec = {
  id: 'v2-treasury',
  title: 'V2 treasury vault',
  description:
    'Community capital enters as the senior tranche, paid first; team capital enters as the junior tranche, which absorbs losses first. ' +
    'The treasury vault keeps one earning balance with the tranches accounted separately. Idle capital goes to best-rate lending; a ' +
    'Uniswap v4 hook provides just-in-time liquidity when swaps need depth. Interest and fees flow back to the vault.',
  wide: { w: 960, h: 290 },
  tall: { w: 360, h: 470 },
  nodes: [
    {
      id: 'com', title: 'Community capital', tone: 'you', lines: ['Senior tranche —', 'paid first'],
      wide: { x: 20, y: 20, w: 250, h: 80 },
      tall: { x: 20, y: 16, w: 150, h: 90, title: 'Community', lines: ['Senior —', 'paid first'] },
    },
    {
      id: 'team', title: 'Team capital', tone: 'you', lines: ['Junior tranche —', 'absorbs losses first'],
      wide: { x: 20, y: 190, w: 250, h: 80 },
      tall: { x: 190, y: 16, w: 150, h: 90, title: 'Team', lines: ['Junior —', 'absorbs losses', 'first'] },
    },
    {
      id: 'vault', title: 'Treasury vault', tone: 'mintware', status: 'testnet',
      wide: { x: 380, y: 20, w: 200, h: 250, lines: ['One earning balance,', 'senior + junior', 'accounted separately'] },
      tall: { x: 20, y: 190, w: 320, h: 76, lines: ['One earning balance, senior +', 'junior accounted separately'] },
    },
    {
      id: 'lend', title: 'Best-rate lending', tone: 'external', status: 'testnet', lines: ['Idle capital earns', 'base yield'],
      wide: { x: 690, y: 20, w: 250, h: 80 },
      tall: { x: 20, y: 350, w: 150, h: 100, title: 'Lending', lines: ['Best-rate venue ·', 'idle capital earns', 'base yield'] },
    },
    {
      id: 'jit', title: 'JIT liquidity', tone: 'external', status: 'testnet', lines: ['A Uniswap v4 hook adds', 'depth exactly when swaps need it'],
      wide: { x: 690, y: 190, w: 250, h: 80 },
      tall: { x: 190, y: 350, w: 150, h: 100, lines: ['v4 hook adds depth', 'when swaps need it'] },
    },
  ],
  edges: [
    { from: 'com', to: 'vault', label: 'USDC' },
    { from: 'team', to: 'vault', label: 'capital' },
    { from: 'vault', to: 'lend', label: 'idle', offset: -12 },
    { from: 'lend', to: 'vault', label: 'interest', back: true, offset: 12 },
    { from: 'vault', to: 'jit', label: 'on swap', offset: -12 },
    { from: 'jit', to: 'vault', label: 'fees', back: true, offset: 12 },
  ],
}

export const V2_SPEND: DiagramSpec = {
  id: 'v2-spend',
  title: 'V2 spend path',
  description:
    'A card swipe or x402 API call goes to the edge authorizer, which places a hold against your live earning balance in milliseconds. ' +
    'At settlement just enough shares are burned to cover the amount and the merchant or API is paid in USDC. Everything not spent keeps earning.',
  wide: { w: 960, h: 300 },
  tall: { w: 360, h: 520 },
  nodes: [
    {
      id: 'pay', title: 'Card or x402 call', tone: 'you', lines: ['A swipe or a', 'paid API request'],
      wide: { x: 20, y: 30, w: 170, h: 80 }, tall: { x: 30, y: 16, w: 300, h: 70 },
    },
    {
      id: 'edge', title: 'Edge authorizer', tone: 'mintware', status: 'testnet', lines: ['Holds the amount off', 'live balance, in ms'],
      wide: { x: 270, y: 30, w: 170, h: 80 }, tall: { x: 30, y: 120, w: 300, h: 70 },
    },
    {
      id: 'vault', title: 'Your earning balance', tone: 'mintware', status: 'testnet',
      lines: ['Everything not spent keeps earning —', 'spend the yield, not the position'],
      wide: { x: 270, y: 200, w: 420, h: 80 }, tall: { x: 30, y: 224, w: 300, h: 70 },
    },
    {
      id: 'settle', title: 'Settle', tone: 'mintware', status: 'testnet', lines: ['Burns just enough', 'shares to cover it'],
      wide: { x: 520, y: 30, w: 170, h: 80 }, tall: { x: 30, y: 328, w: 300, h: 70 },
    },
    {
      id: 'mer', title: 'Merchant or API', tone: 'external', lines: ['Paid in USDC'],
      wide: { x: 770, y: 30, w: 170, h: 80 }, tall: { x: 30, y: 432, w: 300, h: 70 },
    },
  ],
  edges: [
    { from: 'pay', to: 'edge', label: 'authorize' },
    { from: 'edge', to: 'settle', label: 'capture', wide: {}, tall: { from: 'r', to: 'r', via: 348, label: null } },
    { from: 'edge', to: 'vault', label: 'hold' },
    { from: 'settle', to: 'vault', label: 'burn shares' },
    { from: 'settle', to: 'mer', label: 'USDC' },
  ],
}
