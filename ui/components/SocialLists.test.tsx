import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReactionsListView, ZapsListView } from './SocialLists'
import { parseZapAmount } from './ZapDialogView'

describe('ZapsListView', () => {
	test('renders sats amounts and truncates long messages', () => {
		const markup = renderToStaticMarkup(
			createElement(ZapsListView, {
				zaps: [{ id: 'z1', senderPubkey: 'alice', amountMillisats: 21_000_000, message: 'x'.repeat(50) }],
				renderAvatar: (pubkey) => createElement('span', null, `avatar:${pubkey}`),
			}),
		)
		expect(markup).toContain('21,000')
		expect(markup).toContain('avatar:alice')
		expect(markup).toContain(`${'x'.repeat(40)}...`)
		expect(markup).toContain('data-testid="zaps-list"')
	})

	test('renders nothing without zaps', () => {
		expect(renderToStaticMarkup(createElement(ZapsListView, { zaps: [], renderAvatar: () => null }))).toBe('')
	})
})

describe('ReactionsListView', () => {
	test('highlights the viewer reactions with counts', () => {
		const markup = renderToStaticMarkup(
			createElement(ReactionsListView, {
				groups: [
					{ emoji: '🔥', count: 3, isOwn: true },
					{ emoji: '👀', count: 1, isOwn: false },
				],
				onToggle: () => {},
			}),
		)
		expect(markup).toContain('🔥')
		expect(markup).toContain('bg-neo-purple')
		expect(markup).toContain('bg-purple-50')
	})
})

describe('parseZapAmount', () => {
	test('accepts positive integers only', () => {
		expect(parseZapAmount('21')).toBe(21)
		expect(parseZapAmount('')).toBeNull()
		expect(parseZapAmount('0')).toBeNull()
	})
})
