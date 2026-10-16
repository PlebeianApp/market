import { describe, expect, test } from 'bun:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup as renderBare } from 'react-dom/server'
import { TooltipProvider } from '../primitives/tooltip'
import { PriceDisplayView } from './PriceDisplayView'
import { CommentButtonView, ReactionButtonView, ShareButtonView, ZapButtonView } from './SocialButtons'
import { TimelineEventCard } from './TimelineEventCard'
import { getUserCardTitle, UserCardView } from './UserCardView'

const noop = () => {}
const renderToStaticMarkup = (element: ReactElement) => renderBare(createElement(TooltipProvider, null, element))

describe('PriceDisplayView', () => {
	test('renders sats and the converted fiat price', () => {
		const markup = renderToStaticMarkup(
			createElement(PriceDisplayView, {
				priceValue: 50_000,
				originalCurrency: 'SATS',
				selectedCurrency: 'USD',
				price: { isBitcoinCurrency: true, satsValue: 50_000, fiatValue: { value: 50, currency: 'USD' } },
				isLoading: false,
			}),
		)
		expect(markup).toContain('50,000 sats')
		expect(markup).toContain('50.00 USD')
	})

	test('renders a skeleton while loading', () => {
		const markup = renderToStaticMarkup(
			createElement(PriceDisplayView, {
				priceValue: 1,
				originalCurrency: 'EUR',
				selectedCurrency: 'USD',
				price: { isBitcoinCurrency: false, satsValue: null, fiatValue: null },
				isLoading: true,
			}),
		)
		expect(markup).toContain('animate-pulse')
		expect(markup).not.toContain('EUR')
	})
})

describe('TimelineEventCard', () => {
	test('shows receipt amount and preimage proof', () => {
		const markup = renderToStaticMarkup(
			createElement(TimelineEventCard, {
				event: {
					id: 'r1',
					created_at: 1,
					content: '',
					tags: [
						['amount', '2100'],
						['payment', 'lightning', 'lnbc', 'pre-image'],
					],
				},
				title: 'Payment Receipt',
				icon: null,
				type: 'payment',
				timelineIndex: 2,
				onCopyPreimage: noop,
			}),
		)
		expect(markup).toContain('Paid: 2,100 sats')
		expect(markup).toContain('pre-image')
	})

	test('shows shipping status, tracking and carrier', () => {
		const markup = renderToStaticMarkup(
			createElement(TimelineEventCard, {
				event: {
					id: 's1',
					content: 'On its way',
					tags: [
						['status', 'shipped'],
						['tracking', 'TRK1'],
						['carrier', 'DHL'],
					],
				},
				title: 'Shipping Update',
				icon: null,
				type: 'shipping',
				timelineIndex: 1,
				onCopyPreimage: noop,
			}),
		)
		expect(markup).toContain('Order Shipped')
		expect(markup).toContain('TRK1')
		expect(markup).toContain('DHL')
	})
})

describe('UserCardView', () => {
	const base = {
		renderAvatar: (className: string) => createElement('span', { className, 'data-avatar': true }),
		isLoading: false,
		nip05: null,
		npub: 'npub1abcdefghijklmnopqrstuvwxyz',
	}

	test('falls back to a shortened npub title and links to the profile', () => {
		const markup = renderToStaticMarkup(createElement(UserCardView, { ...base, displayName: null, profileHref: '/profile/abc' }))
		expect(markup).toContain('npub1abcd..uvwxyz')
		expect(markup).toContain('href="/profile/abc"')
		expect(markup).toContain('h-12 w-12')
	})

	test('shows NIP-05 as subtitle and renders the host badge', () => {
		const markup = renderToStaticMarkup(
			createElement(UserCardView, {
				...base,
				displayName: 'Alice',
				nip05: 'alice@example.com',
				renderNip05Badge: () => createElement('span', null, 'badge'),
			}),
		)
		expect(markup).toContain('Alice')
		expect(markup).toContain('alice@example.com')
		expect(markup).toContain('badge')
		expect(markup).not.toContain('href=')
	})

	test('title helper prefers loading, then name, then npub', () => {
		expect(getUserCardTitle({ isProfileLoading: true, profileDisplayName: 'A', textDisplayNpub: 'n' })).toBe('Loading...')
		expect(getUserCardTitle({ isProfileLoading: false, profileDisplayName: null, textDisplayNpub: 'n' })).toBe('n')
	})
})

describe('social buttons', () => {
	test('reaction button reflects the viewer reaction', () => {
		const heart = renderToStaticMarkup(
			createElement(ReactionButtonView, { latestEmoji: '❤️', canPickEmoji: true, onPress: noop, onSelectEmoji: noop }),
		)
		const fire = renderToStaticMarkup(
			createElement(ReactionButtonView, { latestEmoji: '🔥', canPickEmoji: true, onPress: noop, onSelectEmoji: noop }),
		)
		const none = renderToStaticMarkup(
			createElement(ReactionButtonView, { latestEmoji: null, canPickEmoji: false, onPress: noop, onSelectEmoji: noop }),
		)
		expect(heart).toContain('i-heart-fill')
		expect(fire).toContain('🔥')
		expect(none).toContain('i-heart"')
	})

	test('zap button is disabled while checking or when the recipient cannot receive zaps', () => {
		const checking = renderToStaticMarkup(
			createElement(ZapButtonView, { isCheckingCapability: true, canReceiveZaps: false, isZapping: false, onPress: noop }),
		)
		const ready = renderToStaticMarkup(
			createElement(ZapButtonView, { isCheckingCapability: false, canReceiveZaps: true, isZapping: false, onPress: noop }),
		)
		expect(checking).toContain('disabled')
		expect(ready).not.toContain('disabled=""')
		expect(ready).toContain('i-lightning')
	})

	test('share and comment buttons expose their test ids', () => {
		expect(renderToStaticMarkup(createElement(ShareButtonView, { onPress: noop }))).toContain('data-testid="share-button"')
		expect(renderToStaticMarkup(createElement(CommentButtonView, { onPress: noop }))).toContain('data-testid="comment-button"')
	})
})
