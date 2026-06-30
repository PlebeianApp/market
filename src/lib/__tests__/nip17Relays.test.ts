import { describe, expect, test } from 'bun:test'
import {
	NIP17_DM_RELAY_LIST_KIND,
	buildNip17DmRelayListFilter,
	parseNip17DmRelays,
	resolveNip17DmRelayListFromEvents,
	resolveNip17RelayTargetsFromEvents,
} from '../nostr/nip17Relays'

const SENDER_PUBKEY = 'a'.repeat(64)
const RECIPIENT_PUBKEY = 'b'.repeat(64)

function relayListEvent(
	pubkey: string,
	createdAt: number,
	tags: string[][],
	id = `${pubkey}-${createdAt}`,
): {
	id: string
	kind: number
	pubkey: string
	created_at: number
	tags: string[][]
	content: string
} {
	return {
		id,
		kind: NIP17_DM_RELAY_LIST_KIND,
		pubkey,
		created_at: createdAt,
		tags,
		content: '',
	}
}

describe('NIP-17 DM relay resolution', () => {
	test('builds a strict kind 10050 relay-list filter', () => {
		expect(buildNip17DmRelayListFilter(RECIPIENT_PUBKEY)).toEqual({
			kinds: [NIP17_DM_RELAY_LIST_KIND],
			authors: [RECIPIENT_PUBKEY],
			limit: 1,
		})
	})

	test('parses, normalizes, and dedupes relay tags from a kind 10050 event', () => {
		const event = relayListEvent(RECIPIENT_PUBKEY, 100, [
			['relay', ' wss://Relay.Example.com/ '],
			['relay', 'wss://relay.example.com'],
			['relay', 'ws://localhost:7777/'],
			['relay', 'wss://relay.example.com/nostr/'],
			['relay', 'https://not-a-relay.example'],
			['relay', ''],
			['relay'],
			['r', 'wss://wrong-tag.example'],
			['relay', 'not a url'],
		])

		expect(parseNip17DmRelays(event)).toEqual(['wss://relay.example.com', 'ws://localhost:7777', 'wss://relay.example.com/nostr/'])
	})

	test('selects the latest kind 10050 event for the requested pubkey', () => {
		const older = relayListEvent(RECIPIENT_PUBKEY, 100, [['relay', 'wss://older.example']])
		const newer = relayListEvent(RECIPIENT_PUBKEY, 200, [['relay', 'wss://newer.example']])
		const wrongAuthor = relayListEvent(SENDER_PUBKEY, 300, [['relay', 'wss://sender.example']])
		const wrongKind = {
			...relayListEvent(RECIPIENT_PUBKEY, 400, [['relay', 'wss://kind-10002.example']]),
			kind: 10002,
		}

		const result = resolveNip17DmRelayListFromEvents([older, wrongAuthor, newer, wrongKind], RECIPIENT_PUBKEY)

		expect(result.status).toBe('ready')
		expect(result.pubkey).toBe(RECIPIENT_PUBKEY)
		expect(result.event).toBe(newer)
		expect(result.relays).toEqual(['wss://newer.example'])
	})

	test('fails closed when the user has no usable kind 10050 relay list', () => {
		expect(resolveNip17DmRelayListFromEvents([], RECIPIENT_PUBKEY)).toEqual({
			status: 'missing',
			pubkey: RECIPIENT_PUBKEY,
			relays: [],
		})

		const emptyList = relayListEvent(RECIPIENT_PUBKEY, 100, [
			['relay', 'https://not-a-relay.example'],
			['r', 'wss://not-a-dm-relay-tag.example'],
		])

		const result = resolveNip17DmRelayListFromEvents([emptyList], RECIPIENT_PUBKEY)

		expect(result.status).toBe('empty')
		expect(result.pubkey).toBe(RECIPIENT_PUBKEY)
		expect(result.event).toBe(emptyList)
		expect(result.relays).toEqual([])
	})

	test('resolves recipient and sender relay targets without fallback relays', () => {
		const recipientList = relayListEvent(RECIPIENT_PUBKEY, 100, [['relay', 'wss://recipient.example']])
		const senderList = relayListEvent(SENDER_PUBKEY, 100, [['relay', 'wss://sender.example']])

		const readyTargets = resolveNip17RelayTargetsFromEvents({
			recipientPubkey: RECIPIENT_PUBKEY,
			senderPubkey: SENDER_PUBKEY,
			recipientEvents: [recipientList],
			senderEvents: [senderList],
		})

		expect(readyTargets.ready).toBe(true)
		expect(readyTargets.recipient.relays).toEqual(['wss://recipient.example'])
		expect(readyTargets.sender.relays).toEqual(['wss://sender.example'])

		const missingSenderTargets = resolveNip17RelayTargetsFromEvents({
			recipientPubkey: RECIPIENT_PUBKEY,
			senderPubkey: SENDER_PUBKEY,
			recipientEvents: [recipientList],
			senderEvents: [],
		})

		expect(missingSenderTargets.ready).toBe(false)
		expect(missingSenderTargets.recipient.status).toBe('ready')
		expect(missingSenderTargets.sender.status).toBe('missing')
	})
})
