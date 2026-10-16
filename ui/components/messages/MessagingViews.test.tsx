import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMessageBubbleView, ChatOrderItemView } from './ChatMessageBubbleView'
import { ConversationViewLayout, MessageInputView } from './MessagingViews'

const noop = () => {}

describe('ChatMessageBubbleView', () => {
	test('renders direct message content', () => {
		const markup = renderToStaticMarkup(
			createElement(ChatMessageBubbleView, {
				event: { kind: 14, content: 'hello there', tags: [], pubkey: 'a', created_at: 1 },
				isCurrentUser: true,
				renderOrderItem: () => null,
			}),
		)
		expect(markup).toContain('hello there')
	})

	test('renders order creation with host-rendered items', () => {
		const markup = renderToStaticMarkup(
			createElement(ChatMessageBubbleView, {
				event: {
					kind: 16,
					content: '',
					pubkey: 'b',
					tags: [
						['type', '1'],
						['order', 'ord-1'],
						['amount', '2100'],
						['item', '30402:seller:mug', '2'],
					],
				},
				isCurrentUser: false,
				renderOrderItem: (item, index) => createElement(ChatOrderItemView, { key: index, title: 'Mug', quantity: item[2], price: null }),
			}),
		)
		expect(markup).toContain('Order Placed')
		expect(markup).toContain('ord-1')
		expect(markup).toContain('Qty: 2')
	})
})

describe('messaging layout views', () => {
	test('message input is disabled for signed-out viewers', () => {
		const markup = renderToStaticMarkup(
			createElement(MessageInputView, { onSendMessage: async () => {}, isSending: false, isLoggedIn: false }),
		)
		expect(markup).toContain('Log in to send messages')
	})

	test('conversation layout shows the empty state', () => {
		const markup = renderToStaticMarkup(
			createElement(ConversationViewLayout, {
				isLoading: false,
				errorMessage: null,
				onRetry: noop,
				isEmpty: true,
				messages: null,
				endRef: noop,
				input: null,
			}),
		)
		expect(markup).toContain('No messages yet')
	})
})
