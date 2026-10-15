import { describe, expect, test } from 'bun:test'
import { createLiveChatMessageTemplate } from './liveChatEvents'

describe('createLiveChatMessageTemplate', () => {
	test('roots the message on the live activity coordinate with a relay hint', () => {
		const template = createLiveChatMessageTemplate({
			liveActivityCoord: '30311:host-pubkey:my-stream',
			content: 'hello chat',
			relayHint: 'wss://relay.example.com',
			createdAt: 1700000000,
		})

		expect(template).toEqual({
			kind: 1311,
			created_at: 1700000000,
			content: 'hello chat',
			tags: [['a', '30311:host-pubkey:my-stream', 'wss://relay.example.com', 'root']],
		})
	})

	test('defaults to an empty relay hint when none is given', () => {
		const template = createLiveChatMessageTemplate({
			liveActivityCoord: '30311:host-pubkey:my-stream',
			content: 'hello chat',
			createdAt: 1700000000,
		})

		expect(template.tags).toEqual([['a', '30311:host-pubkey:my-stream', '', 'root']])
	})
})
