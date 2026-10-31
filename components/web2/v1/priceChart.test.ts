import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PriceChart } from './V1PoolDetail'

it('draws the 24h line and change when the pool has price history', () => {
  const html = renderToStaticMarkup(createElement(PriceChart, { series: [100, 98, 103, 110] }))
  expect(html).toContain('+10.00%')
  expect(html).toContain('24h price up')
  expect(html).toMatch(/<path d="M0\.0,/)
})

it('shows a falling day in red', () => {
  const html = renderToStaticMarkup(createElement(PriceChart, { series: [100, 101, 95, 90] }))
  expect(html).toContain('-10.00%')
  expect(html).toContain('24h price down')
})

it('says there is no history instead of drawing a line', () => {
  const html = renderToStaticMarkup(createElement(PriceChart, { series: undefined }))
  expect(html).toContain('No price history to chart')
  expect(html).not.toContain('<svg')
})
