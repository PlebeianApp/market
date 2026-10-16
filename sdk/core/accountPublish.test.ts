import { describe, expect, test } from 'bun:test'
import { buildClientTag, buildHandlerInfoEventData, publishHandlerInfoWorkflow } from './nip89'
import { mergeProfileField, publishProfileWorkflow } from './profile'
import { buildRelayListTags, parseRelayListTags, publishRelayListWorkflow, publishRelayPreferencesWorkflow } from './relays'
import { createTestPublishContext } from './testing/publishContext'

describe('profile publishing', () => {
	test('publishes kind 0 with the profile as JSON content', async () => {
		const { context, published } = createTestPublishContext()
		await publishProfileWorkflow(context, { name: 'Alice', custom: 'kept' })

		expect(published[0]).toMatchObject({ kind: 0, tags: [], created_at: 1_700_000_000 })
		expect(JSON.parse(published[0].content)).toEqual({ name: 'Alice', custom: 'kept' })
	})

	test('merges a single field without dropping the others', () => {
		expect(mergeProfileField({ name: 'Alice', about: 'old' }, 'about', 'new')).toEqual({ name: 'Alice', about: 'new' })
	})
})

describe('relay list publishing', () => {
	const relays = [
		{ url: 'relay.one', read: true, write: true },
		{ url: 'wss://read.only', read: true, write: false },
		{ url: 'ws://write.only', read: false, write: true },
		{ url: 'wss://disabled', read: false, write: false },
	]

	test('builds NIP-65 tags, normalizes URLs, and drops relays with no permission', () => {
		expect(buildRelayListTags(relays)).toEqual([
			['r', 'wss://relay.one'],
			['r', 'wss://read.only', 'read'],
			['r', 'ws://write.only', 'write'],
		])
	})

	test('round-trips through the parser', () => {
		expect(parseRelayListTags(buildRelayListTags(relays))).toEqual([
			{ url: 'wss://relay.one', read: true, write: true },
			{ url: 'wss://read.only', read: true, write: false },
			{ url: 'ws://write.only', read: false, write: true },
		])
	})

	test('publishes kind 10002 and the NIP-78 preferences event', async () => {
		const { context, published } = createTestPublishContext()
		await publishRelayListWorkflow(context, relays)
		await publishRelayPreferencesWorkflow(context, { includeAppDefaults: false })

		expect(published[0].kind).toBe(10002)
		expect(published[1]).toMatchObject({ kind: 30078, tags: [['d', 'plebeian-market-relay-preferences']] })
		expect(JSON.parse(published[1].content)).toEqual({ includeAppDefaults: false })
	})
})

describe('NIP-89 handler info', () => {
	test('includes an r tag only when a relay is given', () => {
		const withoutRelay = buildHandlerInfoEventData({ handlerId: 'h1', siteUrl: 'https://market.test' })
		const withRelay = buildHandlerInfoEventData({ handlerId: 'h1', siteUrl: 'https://market.test', relayUrl: 'wss://relay.test' })

		expect(withoutRelay.tags.some((tag) => tag[0] === 'r')).toBe(false)
		expect(withRelay.tags).toContainEqual(['r', 'wss://relay.test'])
		expect(withRelay.tags).toContainEqual(['web', 'https://market.test/product/<bech32>', 'naddr'])
		expect(withoutRelay.content).toBe('')
	})

	test('client tag carries the frozen software name and the handler coordinate', () => {
		expect(buildClientTag('apppk', 'h1', 'wss://relay.test')).toEqual(['client', 'Plebeian Market', '31990:apppk:h1', 'wss://relay.test'])
	})

	test('publishes kind 31990 with app settings as content', async () => {
		const { context, published } = createTestPublishContext()
		const result = await publishHandlerInfoWorkflow(context, {
			handlerId: 'h1',
			siteUrl: 'https://market.test',
			appSettings: { name: 'M' },
		})

		expect(result.handlerId).toBe('h1')
		expect(published[0]).toMatchObject({ kind: 31990, content: '{"name":"M"}' })
	})
})
