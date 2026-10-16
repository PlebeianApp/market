import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TestLabelButtonView } from './TestLabelViews'

const noop = () => {}

describe('TestLabelButtonView', () => {
	test('offers unmark for labeled items and mark otherwise', () => {
		const labeled = renderToStaticMarkup(
			createElement(TestLabelButtonView, { isLabeled: true, itemLabel: 'Auction', kindSlug: 'auction', onPress: noop }),
		)
		const unlabeled = renderToStaticMarkup(
			createElement(TestLabelButtonView, { isLabeled: false, itemLabel: 'Product', kindSlug: 'product', onPress: noop }),
		)
		expect(labeled).toContain('data-testid="unmark-test-label-auction-button"')
		expect(labeled).toContain('Unmark as Test Auction')
		expect(unlabeled).toContain('data-testid="mark-test-label-product-button"')
	})
})
