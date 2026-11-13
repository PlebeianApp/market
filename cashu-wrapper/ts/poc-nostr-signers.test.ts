import { afterEach, describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44, verifyEvent } from 'nostr-tools'
import { BunkerSigner } from 'nostr-tools/nip46'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure'
import {
	createClaveNip46Signer,
	createDevNsecSigner,
	type ClavePairingOptions,
} from './poc-nostr-signers'

const template: EventTemplate = { kind: 1, created_at: 1_800_000_000, tags: [['t', 'test']], content: 'hello' }
const transportSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const accountSecret = Uint8Array.from({ length: 32 }, (_, index) => 32 - index)
const pointer = {
	pubkey: getPublicKey(transportSecret),
	relays: ['wss://relay.powr.build/'],
	secret: 'single-use-secret',
}

function remoteFixture(overrides: Record<string, unknown> = {}) {
	const clientSecret = generateSecretKey()
	const calls = { connect: 0, close: 0, signs: 0, metadata: null as unknown }
	const transport = {
		async connect(metadata?: unknown) { calls.connect += 1; calls.metadata = metadata },
		async getPublicKey() { return getPublicKey(accountSecret) },
		async signEvent(event: EventTemplate) { calls.signs += 1; return finalizeEvent(event, accountSecret) },
		async close() { calls.close += 1 },
		...overrides,
	}
	const dependencies: NonNullable<ClavePairingOptions['dependencies']> = {
		parseInput: async () => pointer,
		generateClientSecret: () => clientSecret,
		createTransport(secret, parsed) {
			expect(secret).toBe(clientSecret)
			expect(parsed).toEqual(pointer)
			return transport
		},
	}
	return { calls, clientSecret, dependencies, transport }
}

describe('Clave NIP-46 signer', () => {
	test('uses the real NIP-46 encrypted connect protocol with subscription established before publish', async () => {
		const clientSecret = generateSecretKey()
		const requests: Array<{ id: string; method: string; params: string[] }> = []
		let subscription: { onevent(event: unknown): void } | null = null
		let subscribed = false, closed = false
		const pool = {
			subscribe(relays: string[], filter: Record<string, unknown>, callbacks: { onevent(event: unknown): void }) {
				expect(relays).toEqual(pointer.relays)
				expect(filter).toMatchObject({ kinds: [24133], authors: [pointer.pubkey], '#p': [getPublicKey(clientSecret)], limit: 0 })
				subscribed = true; subscription = callbacks
				return { close() { closed = true } }
			},
			publish(relays: string[], event: VerifiedEvent) {
				expect(subscribed).toBe(true)
				expect(relays).toEqual(pointer.relays)
				expect(verifyEvent(event)).toBe(true)
				const conversationKey = nip44.v2.utils.getConversationKey(transportSecret, event.pubkey)
				const request = JSON.parse(nip44.v2.decrypt(event.content, conversationKey)) as { id: string; method: string; params: string[] }
				requests.push(request)
				const result = request.method === 'connect' ? 'ack' : request.method === 'get_public_key'
					? getPublicKey(accountSecret) : 'unsupported'
				const response = finalizeEvent({ kind: 24133, created_at: event.created_at,
					tags: [['p', event.pubkey]], content: nip44.v2.encrypt(JSON.stringify({ id: request.id, result }), conversationKey) }, transportSecret)
				queueMicrotask(() => subscription?.onevent(response))
				return [Promise.resolve('accepted')]
			},
		}
		const dependencies: NonNullable<ClavePairingOptions['dependencies']> = {
			parseInput: async () => pointer,
			generateClientSecret: () => clientSecret,
			createTransport(secret, parsed, onAuth) {
				return BunkerSigner.fromBunker(secret, parsed, { pool: pool as never, timeout: 1_000, authTimeout: 1_000, onauth: onAuth })
			},
		}
		const signer = await createClaveNip46Signer('bunker://redacted', { dependencies })
		expect(await signer.getPublicKey()).toBe(getPublicKey(accountSecret))
		expect(requests.map(request => request.method)).toEqual(['connect', 'get_public_key'])
		expect(requests[0]?.params).toEqual([pointer.pubkey, pointer.secret, '', JSON.stringify({ name: 'Plebeian Auctions', url: 'https://auctions.invalid' })])
		await signer.close()
		expect(closed).toBe(true)
		expect(clientSecret.every(byte => byte === 0)).toBe(true)
	})

	test('uses the exact URI relay and distinguishes transport from account pubkeys', async () => {
		const held = remoteFixture()
		const phases: string[] = []
		const signer = await createClaveNip46Signer('bunker://private-code', {
			dependencies: held.dependencies, onStatus: phase => phases.push(phase),
		})
		expect(await signer.getPublicKey()).toBe(getPublicKey(accountSecret))
		expect(await signer.getPublicKey()).not.toBe(pointer.pubkey)
		const signed = await signer.signEvent(template)
		expect(verifyEvent({ ...signed, tags: signed.tags.map(tag => [...tag]) })).toBe(true)
		expect(phases).toEqual(['connecting', 'waiting_for_approval', 'connected'])
		expect(held.calls.connect).toBe(1)
		expect(held.calls.metadata).toEqual({ name: 'Plebeian Auctions', url: 'https://auctions.invalid' })
		await signer.close()
		expect(held.clientSecret.every(byte => byte === 0)).toBe(true)
		expect(held.calls.close).toBe(1)
		await expect(signer.signEvent(template)).rejects.toThrow('disconnected')
	})

	test('rejects malformed, non-bunker, secretless, and non-Clave relay inputs', async () => {
		await expect(createClaveNip46Signer('nsec1not-a-bunker')).rejects.toThrow('bunker://')
		for (const changed of [null, { ...pointer, secret: null }, { ...pointer, relays: ['wss://other.example/'] },
			{ ...pointer, relays: ['wss://relay.powr.build/', 'wss://other.example/'] }]) {
			const held = remoteFixture()
			held.dependencies.parseInput = async () => changed as never
			await expect(createClaveNip46Signer('bunker://redacted', { dependencies: held.dependencies }))
				.rejects.toThrow('current Clave bunker code')
			expect(held.calls.connect).toBe(0)
		}
	})

	test('fails closed on a wrong account, changed event, or invalid signature', async () => {
		const wrongActor = remoteFixture({ async getPublicKey() { return 'zz' } })
		await expect(createClaveNip46Signer('bunker://redacted', { dependencies: wrongActor.dependencies }))
			.rejects.toThrow('invalid account')
		for (const [label, signed] of Object.entries({
			'changed event': finalizeEvent({ ...template, content: 'changed' }, accountSecret),
			'invalid signature': { ...finalizeEvent(template, accountSecret), sig: '00'.repeat(64) },
			'wrong account': finalizeEvent({ ...template, tags: template.tags.map(tag => [...tag]) }, generateSecretKey()),
			'malformed tags': { ...finalizeEvent({ ...template, tags: template.tags.map(tag => [...tag]) }, accountSecret), tags: null },
		})) {
			const held = remoteFixture({ async signEvent() { return signed as VerifiedEvent } })
			const signer = await createClaveNip46Signer('bunker://redacted', { dependencies: held.dependencies })
			let rejection = ''
			try { await signer.signEvent(template) } catch (error) { rejection = (error as Error).message }
			if (!rejection.includes('different or invalid')) throw new Error(`${label} was not rejected: ${rejection || 'resolved'}`)
			await signer.close()
		}
	})

	test('cancellation closes transport, clears the client key, and ignores a late response', async () => {
		let release = () => undefined
		const pending = new Promise<void>(resolve => { release = resolve })
		const held = remoteFixture({ connect: () => pending })
		const abort = new AbortController()
		const pairing = createClaveNip46Signer('bunker://redacted', { dependencies: held.dependencies, signal: abort.signal })
		abort.abort()
		await expect(pairing).rejects.toThrow('cancelled')
		expect(held.calls.close).toBe(1)
		expect(held.clientSecret.every(byte => byte === 0)).toBe(true)
		release()
		await Promise.resolve()
		expect(held.calls.close).toBe(1)
	})

	test('transport denial is sanitized and never echoes the connection secret', async () => {
		const held = remoteFixture({ async connect() { throw new Error('denied single-use-secret') } })
		let error: Error | null = null
		try { await createClaveNip46Signer('bunker://redacted', { dependencies: held.dependencies }) }
		catch (caught) { error = caught as Error }
		expect(error?.message).toContain('did not complete')
		expect(error?.message).not.toContain('single-use-secret')
		expect(held.clientSecret.every(byte => byte === 0)).toBe(true)
	})

	test('relay and CSP failures are not mislabeled as missing Clave approval', async () => {
		const relay = remoteFixture({ async connect() { throw new Error('nostr-tools/nip46: failed to send "connect" to any relay') } })
		await expect(createClaveNip46Signer('bunker://redacted', { dependencies: relay.dependencies }))
			.rejects.toThrow("lost access to Clave's required relay")

		const listeners = new Set<(event: Event) => void>()
		const fakeDocument = {
			addEventListener(type: string, listener: (event: Event) => void) { if (type === 'securitypolicyviolation') listeners.add(listener) },
			removeEventListener(type: string, listener: (event: Event) => void) { if (type === 'securitypolicyviolation') listeners.delete(listener) },
		}
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
		Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
		try {
			const blocked = remoteFixture({ async connect() {
				const event = Object.assign(new Event('securitypolicyviolation'), {
					blockedURI: 'wss://relay.powr.build/', violatedDirective: 'connect-src',
				})
				for (const listener of listeners) listener(event)
				throw new Error('opaque browser failure')
			} })
			await expect(createClaveNip46Signer('bunker://redacted', { dependencies: blocked.dependencies }))
				.rejects.toThrow("browser security policy blocked Clave's required relay")
			expect(listeners.size).toBe(0)
		} finally {
			if (previous) Object.defineProperty(globalThis, 'document', previous)
			else delete (globalThis as { document?: unknown }).document
		}
	})

	test('the bounded pairing timeout closes transport and does not imply a payment attempt', async () => {
		const held = remoteFixture({ connect: () => new Promise<void>(() => undefined) })
		await expect(createClaveNip46Signer('bunker://redacted', { dependencies: held.dependencies, timeoutMs: 5 }))
			.rejects.toThrow('timed out after two minutes')
		expect(held.calls.close).toBe(1)
		expect(held.clientSecret.every(byte => byte === 0)).toBe(true)
	})
})

describe('development-only local nsec signer', () => {
	const saved = { fetch: globalThis.fetch, log: console.log }
	afterEach(() => { globalThis.fetch = saved.fetch; console.log = saved.log })

	test('validates, signs locally, and best-effort destroys its in-memory key on close', async () => {
		let networkCalls = 0, logCalls = 0
		globalThis.fetch = (() => { networkCalls += 1; throw new Error('network forbidden') }) as typeof fetch
		console.log = () => { logCalls += 1 }
		const secret = generateSecretKey(), encoded = nip19.nsecEncode(secret)
		const signer = createDevNsecSigner(encoded)
		expect(await signer.getPublicKey()).toBe(getPublicKey(secret))
		const signed = await signer.signEvent(template)
		expect(signed.pubkey).toBe(getPublicKey(secret))
		expect(verifyEvent({ ...signed, tags: signed.tags.map(tag => [...tag]) })).toBe(true)
		expect(networkCalls).toBe(0)
		expect(logCalls).toBe(0)
		await signer.close()
		await expect(signer.getPublicKey()).rejects.toThrow('disconnected')
		await expect(signer.signEvent(template)).rejects.toThrow('disconnected')
	})

	test('rejects invalid checksum and non-nsec identifiers', () => {
		const encoded = nip19.nsecEncode(generateSecretKey())
		expect(() => createDevNsecSigner(`${encoded.slice(0, -1)}${encoded.endsWith('q') ? 'p' : 'q'}`)).toThrow('checksum')
		expect(() => createDevNsecSigner(nip19.npubEncode(getPublicKey(generateSecretKey())))).toThrow('nsec key')
		expect(() => createDevNsecSigner(nip19.nsecEncode(new Uint8Array(32)))).toThrow('valid Nostr private key')
	})
})
