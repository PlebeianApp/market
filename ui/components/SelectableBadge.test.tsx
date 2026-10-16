import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SelectableBadge } from './SelectableBadge'

describe('SelectableBadge', () => {
	test('renders its selected state and caller props', () => {
		const markup = renderToStaticMarkup(
			createElement(SelectableBadge, { isSelected: true, className: 'cursor-pointer', 'aria-label': 'All categories' }, 'All'),
		)

		expect(markup).toContain('data-selected="true"')
		expect(markup).toContain('aria-label="All categories"')
		expect(markup).toContain('cursor-pointer')
		expect(markup).toContain('All')
	})

	test('defaults to unselected and preserves badge props', () => {
		const markup = renderToStaticMarkup(createElement(SelectableBadge, { title: 'Filter by category' }, 'Books'))

		expect(markup).toContain('data-selected="false"')
		expect(markup).toContain('title="Filter by category"')
		expect(markup).toContain('Books')
	})
})
