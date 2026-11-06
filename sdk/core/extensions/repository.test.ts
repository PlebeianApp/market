import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import {
	buildRepositorySnapshot,
	CONTEXTVM_SERVER_ANNOUNCEMENT_KIND,
	CONTEXTVM_TOOLS_LIST_KIND,
	EXTENSION_REGISTRY_D_TAG,
	hashInputSchema,
	parseRegistryList,
	parseRepositorySnapshot,
	parseToolsList,
} from './repository'

const curatorKey = generateSecretKey()
const curator = getPublicKey(curatorKey)
const serverKey = generateSecretKey()
const server = getPublicKey(serverKey)
const silentServer = getPublicKey(generateSecretKey())

const sign = (key: Uint8Array, kind: number, tags: string[][], content: unknown, createdAt = 1_700_000_000) =>
	finalizeEvent({ kind, created_at: createdAt, tags, content: typeof content === 'string' ? content : JSON.stringify(content) }, key)

const registry = (servers: string[], createdAt?: number) =>
	sign(curatorKey, 30000, [['d', EXTENSION_REGISTRY_D_TAG], ...servers.map((pubkey) => ['p', pubkey])], '', createdAt)

const announcement = sign(
	serverKey,
	CONTEXTVM_SERVER_ANNOUNCEMENT_KIND,
	[
		['name', 'Shipping rates'],
		['about', 'Live carrier rates for your listings'],
		['website', 'https://rates.example'],
		['picture', 'http://insecure.example/logo.png'],
		['support_encryption'],
	],
	{ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'rates', version: '2.1.0' } },
)

const toolList = sign(serverKey, CONTEXTVM_TOOLS_LIST_KIND, [['cap', 'tool:quote', '10', 'sats']], {
	tools: [
		{
			name: 'quote',
			title: 'Get a quote',
			description: 'Rates for a parcel',
			inputSchema: { type: 'object', properties: { weight: {}, country: {} } },
		},
		{ name: 'track', inputSchema: { type: 'object' } },
		{ name: 'quote' },
	],
})

describe('extension repository', () => {
	test('reads servers from the curator’s registry list only', () => {
		expect(parseRegistryList(registry([server, server, 'not-hex']), curator)).toEqual([server])
		expect(parseRegistryList(registry([server]), server)).toBeUndefined()
		const wrongD = sign(
			curatorKey,
			30000,
			[
				['d', 'admins'],
				['p', server],
			],
			'',
		)
		expect(parseRegistryList(wrongD, curator)).toBeUndefined()
		const tampered = {
			...registry([server]),
			tags: [
				['d', EXTENSION_REGISTRY_D_TAG],
				['p', silentServer],
			],
		}
		expect(parseRegistryList(tampered, curator)).toBeUndefined()
	})

	test('parses tools, deduplicates names, and attaches CEP-8 prices', () => {
		const parsed = parseToolsList(toolList)
		expect('tools' in parsed && parsed.tools).toEqual([
			{
				name: 'quote',
				title: 'Get a quote',
				description: 'Rates for a parcel',
				inputFields: ['weight', 'country'],
				inputSchemaHash: hashInputSchema({ type: 'object', properties: { weight: {}, country: {} } }),
				price: { amount: '10', unit: 'sats' },
			},
			{ name: 'track', inputFields: [], inputSchemaHash: hashInputSchema({ type: 'object' }) },
		])
	})

	test('builds entries from the newest registry list and the servers’ own announcements', () => {
		const forged = sign(generateSecretKey(), CONTEXTVM_SERVER_ANNOUNCEMENT_KIND, [['name', 'Impostor']], {})
		const snapshot = buildRepositorySnapshot({
			curators: [curator, silentServer],
			relays: ['wss://relay.example'],
			registryEvents: [registry([server], 1), registry([server, silentServer], 2)],
			announcementEvents: [announcement, toolList, { ...forged, pubkey: server }],
			nowMs: 5,
		})
		expect(snapshot.missingRegistries).toEqual([silentServer])
		expect(snapshot.entries.map((entry) => [entry.name, entry.state])).toEqual([
			['Shipping rates', 'listed'],
			[`${silentServer.slice(0, 8)}…`, 'unavailable'],
		])
		const [listed, unavailable] = snapshot.entries
		expect(listed).toMatchObject({
			serverPubkey: server,
			listedBy: [curator],
			about: 'Live carrier rates for your listings',
			website: 'https://rates.example/',
			version: '2.1.0',
			paid: true,
			encrypted: true,
		})
		expect(listed.picture).toBeUndefined()
		expect(unavailable.problem).toBe('No server announcement found on the configured relays')
	})

	test('sideloaded servers appear without a registry and are marked; registry-listed ones keep their curators', () => {
		const snapshot = buildRepositorySnapshot({
			curators: [curator],
			relays: [],
			registryEvents: [registry([server])],
			announcementEvents: [announcement],
			sideloaded: [server, silentServer, 'not-hex'],
			nowMs: 0,
		})
		expect(snapshot.sideloaded).toEqual([server, silentServer])
		expect(snapshot.entries.map((entry) => [entry.serverPubkey, entry.sideloaded, entry.listedBy, entry.state])).toEqual([
			[server, true, [curator], 'listed'],
			[silentServer, true, [], 'unavailable'],
		])
		const wire = parseRepositorySnapshot(JSON.parse(JSON.stringify(snapshot)))
		expect(wire?.entries.map((entry) => entry.sideloaded)).toEqual([true, true])
		expect(wire?.sideloaded).toEqual([server, silentServer])
	})

	test('servers that no registry lists are ignored', () => {
		const snapshot = buildRepositorySnapshot({
			curators: [curator],
			relays: [],
			registryEvents: [registry([])],
			announcementEvents: [announcement],
			nowMs: 0,
		})
		expect(snapshot.entries).toEqual([])
	})

	test('snapshot round-trips through the untrusted parser and drops bad entries', () => {
		const snapshot = buildRepositorySnapshot({
			curators: [curator],
			relays: ['wss://relay.example'],
			registryEvents: [registry([server])],
			announcementEvents: [announcement, toolList],
			nowMs: 9,
		})
		const wire = JSON.parse(
			JSON.stringify({
				...snapshot,
				entries: [
					...snapshot.entries,
					{ serverPubkey: 'x', state: 'listed', name: 'bad' },
					{ ...snapshot.entries[0], website: 'javascript:alert(1)', serverPubkey: silentServer },
				],
			}),
		)
		const parsed = parseRepositorySnapshot(wire)
		expect(parsed?.entries.map((entry) => [entry.serverPubkey, entry.website])).toEqual([
			[server, 'https://rates.example/'],
			[silentServer, undefined],
		])
		expect(parseRepositorySnapshot({ entries: 'nope' })).toBeUndefined()
	})
})
