/**
 * The session: the state machine, the reads, and the refusals.
 *
 * These cases exercise the spec's §1.4 (states and allowed transitions) and
 * §1.2 (the operations) through the contract — nothing here reaches inside the
 * implementation, and a snapshot is read the way a host reads it, through
 * `observeSession()`.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, nip19 } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'

import type {
	EventTemplate,
	ExtensionTransportPort,
	NipEncryptionCapability,
	SessionSnapshot,
	SessionState,
	SignerCapability,
	SignerSession,
	StoragePort,
} from './index'
import {
	CapabilityUnavailableError,
	ClockRequiredError,
	IdentityUnresolvedError,
	InvalidTransitionError,
	LaneUnavailableError,
	NoActiveSessionError,
	PortError,
	SessionAttachedError,
	SessionVaultError,
	createSignerFromKey,
	createSignerSession,
} from './index'
import {
	BUNKER_SECRET,
	CLIENT_PK,
	CLIENT_SK,
	CONNECT_SECRET,
	RELAY,
	REMOTE_PK,
	REMOTE_SK,
	USER_PK,
	USER_SK,
	bunkerTransport,
	bunkerUrl,
	fakeTransport,
	inboundEvent,
	makeNbunksec,
	manualClock,
	memoryStorage,
	userTemplate,
	webCryptoPort,
} from './harness'
import * as vault from './vault'

const ITERATIONS = 1_000

/** Read a session the way a host does: through its own observation operation. */
function observe(session: SignerSession) {
	let last: SessionSnapshot | undefined
	const states: SessionState[] = []
	const unsubscribe = session.observeSession((snapshot) => {
		last = snapshot
		states.push(snapshot.state)
	})
	return {
		states,
		current: (): SessionSnapshot => {
			if (!last) throw new Error('nothing observed yet')
			return last
		},
		unsubscribe,
	}
}

/** An already-built capability, for the attach path (a composer's own signer). */
function capability(overrides: Partial<SignerCapability> = {}): SignerCapability {
	return {
		getPublicKey: async () => USER_PK,
		signEvent: async (template) => finalizeEvent(template as EventTemplate, hexToBytes(USER_SK)),
		...overrides,
	}
}

/** A NIP-07 extension transport, injected. This is what the module is given instead of a browser global. */
function extension(
	exposes: { nip04?: Partial<NipEncryptionCapability>; nip44?: Partial<NipEncryptionCapability> } = {},
): ExtensionTransportPort {
	return {
		getPublicKey: async () => USER_PK,
		signEvent: async (template) => finalizeEvent(template as EventTemplate, hexToBytes(USER_SK)),
		...exposes,
	}
}

describe('the session state machine', () => {
	test('a fresh session is idle: no identity, no capabilities, no record', () => {
		const session = createSignerSession()
		const observed = observe(session)

		expect(observed.current()).toEqual({
			state: 'idle',
			capabilities: { nip04: false, nip44: false },
			record: 'none',
		})
	})

	test('the nsec lane reaches active and exposes the resolved identity', async () => {
		const session = createSignerSession()
		const observed = observe(session)

		const snapshot = await session.startSession({ lane: 'nsec', key: USER_SK })

		expect(snapshot.state).toBe('active')
		expect(snapshot.pubkey).toBe(USER_PK)
		expect(snapshot.lane).toBe('nsec')
		expect(snapshot.record).toBe('none')
		expect(await session.getPublicKey()).toBe(USER_PK)
		expect(observed.states).toEqual(['idle', 'connecting', 'active'])
	})

	test('endSession returns to idle and clears the identity', async () => {
		const session = createSignerSession()
		const observed = observe(session)

		await session.startSession({ lane: 'nsec', key: USER_SK })
		await session.endSession()

		expect(observed.current().state).toBe('idle')
		expect(observed.current().pubkey).toBeUndefined()
		expect(observed.states).toEqual(['idle', 'connecting', 'active', 'closing', 'idle'])
		expect(() => session.currentSigner()).toThrow(NoActiveSessionError)
	})

	test('a failing lane lands in failed with a typed reason, never half-attached', async () => {
		const session = createSignerSession()
		const observed = observe(session)

		await expect(session.startSession({ lane: 'extension' })).rejects.toThrow(LaneUnavailableError)

		expect(observed.current().state).toBe('failed')
		expect(observed.current().reason).toMatch(/no NIP-07 extension/i)
		expect(observed.current().pubkey).toBeUndefined()
		expect(() => session.currentSigner()).toThrow(NoActiveSessionError)
	})

	test('a second session is refused while one is attached, and the first is untouched', async () => {
		const session = createSignerSession()
		await session.startSession({ lane: 'nsec', key: USER_SK })

		await expect(session.attachSigner(capability())).rejects.toThrow(SessionAttachedError)
		expect(await session.getPublicKey()).toBe(USER_PK)
	})

	test('a session never becomes active without a resolved identity', async () => {
		const session = createSignerSession()
		const observed = observe(session)

		const unresolvable = {
			getPublicKey: async () => {
				throw new Error('no key here')
			},
			signEvent: async () => finalizeEvent(userTemplate(), hexToBytes(USER_SK)),
		}

		await expect(session.attachSigner(unresolvable)).rejects.toThrow(IdentityUnresolvedError)
		expect(observed.current().state).toBe('idle')
		expect(observed.current().pubkey).toBeUndefined()
	})

	test('attach and detach signal the composer, and detach runs the teardown once', async () => {
		const session = createSignerSession()
		const observed = observe(session)

		await session.attachSigner(capability())
		await session.detachSigner()
		await session.detachSigner()

		expect(observed.states).toEqual(['idle', 'active', 'closing', 'idle'])
		expect(() => session.currentSigner()).toThrow(NoActiveSessionError)
	})

	test('observeSession stops emitting after unsubscribe', async () => {
		const session = createSignerSession()
		const observed = observe(session)
		observed.unsubscribe()

		await session.startSession({ lane: 'nsec', key: USER_SK })

		expect(observed.states).toEqual(['idle'])
	})

	test('ending a session while a lane is in flight keeps it ended', async () => {
		// Not reported by the red team: `endSession()` during `connecting` tore the
		// transport down, but the lane was still running — and when it resolved it
		// activated the session the caller had just ended, subscription and all.
		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })
		const session = createSignerSession({ ports: { transport: transport.pool, clock: manualClock() } })
		const observed = observe(session)

		const started = session.startSession({ lane: 'bunker', bunkerUrl: bunkerUrl(), clientKeyHex: CLIENT_SK })
		await session.endSession()

		await expect(started).rejects.toThrow(InvalidTransitionError)
		expect(observed.current().state).toBe('idle')
		expect(observed.current().pubkey).toBeUndefined()
		// the abandoned lane released what it opened, even though the session it was
		// for had already ended
		expect(transport.active()).toBe(0)
	})
})

describe('the reads a surface decides with', () => {
	test('availableLanes reports exactly what the host injected', () => {
		const bare = createSignerSession()
		expect(bare.availableLanes()).toEqual({
			extension: false,
			nsec: true,
			ncryptsec: true,
			bunker: false,
			nostrconnect: false,
		})

		const injected = createSignerSession({
			ports: { extension: extension(), transport: fakeTransport().pool, clock: manualClock() },
		})
		expect(injected.availableLanes()).toEqual({
			extension: true,
			nsec: true,
			ncryptsec: true,
			bunker: true,
			nostrconnect: true,
		})
	})

	test('a lane the host cannot offer refuses instead of degrading', async () => {
		const session = createSignerSession()
		await expect(session.startSession({ lane: 'extension' })).rejects.toThrow(/no NIP-07 extension/i)
	})

	test('signerKind pins the lane: another lane is refused, not quietly started', async () => {
		// M3: the setting was declared contract and read by no code path, so a
		// session pinned to `nsec` started the bunker lane happily. A declared
		// setting nothing reads is a trap for the second implementer.
		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })
		const session = createSignerSession({
			settings: { signerKind: 'nsec' },
			ports: { transport: transport.pool, clock: manualClock() },
		})

		await expect(session.startSession({ lane: 'bunker', bunkerUrl: bunkerUrl(), clientKeyHex: CLIENT_SK })).rejects.toThrow(
			/pins sessions to the nsec lane/,
		)
		expect(transport.active()).toBe(0)

		const snapshot = await session.startSession({ lane: 'nsec', key: USER_SK })
		expect(snapshot.state).toBe('active')
		expect(snapshot.lane).toBe('nsec')
	})

	test('the client-initiated lane refuses without a sink for the connect URI', async () => {
		const session = createSignerSession({
			ports: { transport: fakeTransport().pool, clock: manualClock() },
		})
		await expect(session.startSession({ lane: 'nostrconnect', relays: [RELAY] })).rejects.toThrow(/needs a sink for the connect URI/)
	})

	test('currentSigner is the attached capability, and refuses when there is none', async () => {
		const session = createSignerSession()
		expect(() => session.currentSigner()).toThrow(NoActiveSessionError)

		await session.attachSigner(capability())
		expect(await session.currentSigner().getPublicKey()).toBe(USER_PK)
	})

	test('the client-initiated lane refuses before the URI reaches the sink when the clock is missing', async () => {
		// M2: the connect URI carries the connect secret, and it used to be handed
		// to the caller's sink before the clock was checked — a secret disclosed to
		// a host for a session that could never bind.
		const seen: string[] = []
		const session = createSignerSession({ ports: { transport: fakeTransport().pool } })

		await expect(
			session.startSession({
				lane: 'nostrconnect',
				relays: [RELAY],
				clientKeyHex: CLIENT_SK,
				onAuthUrl: async (url) => {
					seen.push(url)
				},
			}),
		).rejects.toThrow(ClockRequiredError)

		expect(seen).toEqual([])
	})

	test('a port that fails is a typed refusal on both of its paths — never the host’s own error', async () => {
		// M7: a store that threw rejected `restoreSession()` with the host's raw
		// Error and landed inside `startSession` as a raw rethrow, so a caller could
		// not catch "the store is gone" without catching everything.
		const message = 'QuotaExceededError: the host store is unavailable'
		const throwing = (on: 'getItem' | 'setItem'): StoragePort => ({
			getItem: () => {
				if (on === 'getItem') throw new Error(message)
				return null
			},
			setItem: () => {
				if (on === 'setItem') throw new Error(message)
			},
			removeItem: () => {},
		})

		const restoring = createSignerSession({ ports: { storage: throwing('getItem'), crypto: webCryptoPort } })
		await expect(restoring.restoreSession()).rejects.toThrow(PortError)
		await expect(restoring.restoreSession()).rejects.toThrow(/store is unavailable/)

		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })
		const persisting = createSignerSession({
			settings: {
				sessionAtRest: { iterations: ITERATIONS, minIterations: ITERATIONS, passphrase: 'correct horse' },
			},
			ports: {
				storage: throwing('setItem'),
				crypto: webCryptoPort,
				transport: transport.pool,
				clock: manualClock(),
			},
		})
		await expect(persisting.startSession({ lane: 'bunker', bunkerUrl: bunkerUrl(), clientKeyHex: CLIENT_SK })).rejects.toThrow(PortError)
	})

	test('the composer allow-list gates the capability set — absent means refuse, never synthesise', async () => {
		const closed = createSignerSession()
		await closed.startSession({ lane: 'nsec', key: USER_SK })
		expect(closed.capabilities()).toEqual({})
		await expect(closed.encrypt(USER_PK, 'hi', 'nip44')).rejects.toThrow(CapabilityUnavailableError)
		await expect(closed.decrypt(USER_PK, 'hi', 'nip04')).rejects.toThrow(/refusing rather than synthesising/)

		const open = createSignerSession({ settings: { capabilities: ['nip44'] } })
		await open.startSession({ lane: 'nsec', key: USER_SK })
		expect(open.capabilities().nip44).toBeDefined()
		expect(open.capabilities().nip04).toBeUndefined()
		// A local (key-holding) signer implements NIP-44 itself, so the round trip works.
		const ciphertext = await open.encrypt(USER_PK, 'a private note', 'nip44')
		expect(ciphertext).not.toContain('a private note')
		expect(await open.decrypt(USER_PK, ciphertext, 'nip44')).toBe('a private note')
	})
})

describe('the lanes', () => {
	test('the extension lane is enabled by an injected extension, and nip04/nip44 follow it', async () => {
		const session = createSignerSession({
			settings: { capabilities: ['nip44', 'nip04'] },
			ports: {
				extension: extension({
					nip44: { encrypt: async () => 'e44', decrypt: async () => 'd44' },
					nip04: { encrypt: async () => 'e4', decrypt: async () => 'd4' },
				}),
			},
		})

		const snapshot = await session.startSession({ lane: 'extension' })

		expect(snapshot.lane).toBe('extension')
		expect(snapshot.capabilities).toEqual({ nip04: true, nip44: true })
		expect(await session.encrypt(USER_PK, 'hi', 'nip44')).toBe('e44')
		expect(await session.signEvent(userTemplate())).toMatchObject({ pubkey: USER_PK, kind: 1 })
	})

	test('the nostrconnect lane: connecting → awaiting_user (the URI reaches the sink) → active', async () => {
		const transport = bunkerTransport()
		const session = createSignerSession({
			settings: { capabilities: ['nip44'] },
			ports: { transport: transport.pool, clock: manualClock() },
		})
		const observed = observe(session)
		const seen: string[] = []

		// A real remote signer echoes the connect secret. The transport replays, so
		// the echo is already waiting when the client subscribes.
		transport.incoming.next(inboundEvent(REMOTE_SK, { result: CONNECT_SECRET }))

		const started = session.startSession({
			lane: 'nostrconnect',
			relays: [RELAY],
			clientKeyHex: CLIENT_SK,
			connectSecret: CONNECT_SECRET,
			onAuthUrl: async (url) => {
				seen.push(url)
			},
		})

		// The URI is emitted synchronously, before the wait for approval.
		expect(seen[0]?.startsWith('nostrconnect://')).toBe(true)
		expect(seen[0]).toContain('secret=' + CONNECT_SECRET)
		expect(seen[0]).not.toContain('token=')

		await started

		expect(observed.states).toEqual(['idle', 'connecting', 'awaiting_user', 'active'])
		expect(observed.current().pubkey).toBe(USER_PK)
		expect(observed.current().lane).toBe('nostrconnect')
		expect(observed.current().pubkey).not.toBe(CLIENT_PK)
		expect(observed.current().pubkey).not.toBe(REMOTE_PK)
	})

	test('the bunker lane reaches active against a remote signer that answers', async () => {
		const transport = bunkerTransport({ expectSecret: 'bunkersecret' })
		const session = createSignerSession({
			ports: { transport: transport.pool, clock: manualClock() },
		})

		const snapshot = await session.startSession({
			lane: 'bunker',
			bunkerUrl: bunkerUrl(),
			clientKeyHex: CLIENT_SK,
		})

		expect(snapshot.state).toBe('active')
		expect(snapshot.lane).toBe('bunker')
		expect(snapshot.pubkey).toBe(USER_PK)
	})
})

describe('the persisted record (I5, through the session)', () => {
	function persistedSession(storage = memoryStorage()) {
		const transport = bunkerTransport({ expectSecret: 'bunkersecret' })
		const session = createSignerSession({
			settings: {
				capabilities: ['nip44'],
				sessionAtRest: { iterations: ITERATIONS, minIterations: ITERATIONS, passphrase: 'correct horse' },
			},
			ports: { storage, crypto: webCryptoPort, transport: transport.pool, clock: manualClock() },
		})
		return { session, storage, transport }
	}

	test('a bunker session is written encrypted, and endSession clears it', async () => {
		const { session, storage } = persistedSession()

		const snapshot = await session.startSession({
			lane: 'bunker',
			bunkerUrl: bunkerUrl(),
			clientKeyHex: CLIENT_SK,
		})
		expect(snapshot.record).toBe('vaulted')
		expect(storage.map.has(vault.VAULT_STORAGE_KEY)).toBe(true)
		expect(storage.map.get(vault.VAULT_STORAGE_KEY)).not.toContain('nbunksec')

		await session.endSession()
		expect(storage.map.has(vault.VAULT_STORAGE_KEY)).toBe(false)
	})

	test('without a passphrase source nothing is persisted — there is no plaintext fallback', async () => {
		const storage = memoryStorage()
		const transport = bunkerTransport({ expectSecret: 'bunkersecret' })
		const session = createSignerSession({
			ports: { storage, crypto: webCryptoPort, transport: transport.pool, clock: manualClock() },
		})

		const snapshot = await session.startSession({
			lane: 'bunker',
			bunkerUrl: bunkerUrl(),
			clientKeyHex: CLIENT_SK,
		})

		expect(snapshot.state).toBe('active')
		expect(snapshot.record).toBe('none')
		expect(storage.map.size).toBe(0)
	})

	test('a vaulted record parks in locked without a passphrase, and the machine refuses a new lane there', async () => {
		const storage = memoryStorage()
		const { session } = persistedSession(storage)
		await vault.saveVaultedSession(
			makeNbunksec(),
			'correct horse',
			{ iterations: ITERATIONS },
			{
				storage,
				crypto: webCryptoPort,
			},
		)

		const observed = observe(session)
		const locked = await session.restoreSession()

		expect(locked.state).toBe('locked')
		expect(locked.record).toBe('vaulted')
		await expect(session.startSession({ lane: 'nsec', key: USER_SK })).rejects.toThrow(InvalidTransitionError)
		await expect(session.getPublicKey()).rejects.toThrow(NoActiveSessionError)
		expect(observed.states).toEqual(['idle', 'locked'])
	})

	test('a locked session unlocks with the passphrase and is active against the real remote', async () => {
		const storage = memoryStorage()
		const { session } = persistedSession(storage)
		await vault.saveVaultedSession(
			makeNbunksec(),
			'correct horse',
			{ iterations: ITERATIONS },
			{
				storage,
				crypto: webCryptoPort,
			},
		)

		await session.restoreSession()
		const restored = await session.restoreSession({ passphrase: 'correct horse' })

		expect(restored.state).toBe('active')
		expect(restored.pubkey).toBe(USER_PK)
		expect(restored.lane).toBe('bunker')
	})

	test('restoring with nothing stored fails closed', async () => {
		const { session } = persistedSession()
		await expect(session.restoreSession()).rejects.toThrow(/No persisted session/)
	})

	test('restoring without storage or crypto refuses rather than guessing', async () => {
		const session = createSignerSession()
		await expect(session.restoreSession()).rejects.toThrow(/needs an injected storage port/)
	})

	test('a lane that fails while resolving its identity writes no persisted record', async () => {
		// M1: the record was written before the identity was resolved, so a login
		// that never happened left a vaulted bearer session behind. B2: the same
		// failure used to leave the lane's relay subscription open forever.
		const storage = memoryStorage()
		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })
		let published = 0

		const session = createSignerSession({
			settings: {
				sessionAtRest: { iterations: ITERATIONS, minIterations: ITERATIONS, passphrase: 'correct horse' },
			},
			ports: {
				storage,
				crypto: webCryptoPort,
				clock: manualClock(),
				// The remote answers the connect RPC and then goes away, so the lane
				// fails exactly where the first pass measured it: resolving identity.
				transport: {
					subscription: transport.pool.subscription,
					publish: async (relays, event) => {
						published++
						if (published > 1) throw new Error('the remote went away')
						return transport.pool.publish(relays, event)
					},
				},
			},
		})

		await expect(session.startSession({ lane: 'bunker', bunkerUrl: bunkerUrl(), clientKeyHex: CLIENT_SK })).rejects.toThrow(
			IdentityUnresolvedError,
		)

		expect(storage.map.size).toBe(0)
		expect(storage.map.has(vault.VAULT_STORAGE_KEY)).toBe(false)
		expect(transport.active()).toBe(0)
	})

	test('endSession clears the persisted record from `locked`, and from `failed`', async () => {
		// B2: `locked → closing` was refused and `endSession()` returned from
		// `failed` before its teardown ran, so a record a failed attempt had written
		// could not be cleared by any operation in the contract.
		const storage = memoryStorage()
		const { session } = persistedSession(storage)
		await vault.saveVaultedSession(
			makeNbunksec(),
			'correct horse',
			{ iterations: ITERATIONS },
			{
				storage,
				crypto: webCryptoPort,
			},
		)

		const locked = await session.restoreSession()
		expect(locked.state).toBe('locked')
		expect(storage.map.has(vault.VAULT_STORAGE_KEY)).toBe(true)

		await session.endSession()
		expect(storage.map.has(vault.VAULT_STORAGE_KEY)).toBe(false)
		expect(storage.map.size).toBe(0)

		const second = memoryStorage()
		await vault.saveVaultedSession(
			makeNbunksec(),
			'correct horse',
			{ iterations: ITERATIONS },
			{
				storage: second,
				crypto: webCryptoPort,
			},
		)
		const failing = persistedSession(second).session
		await expect(failing.restoreSession({ passphrase: 'the wrong passphrase' })).rejects.toThrow(SessionVaultError)
		expect(second.map.has(vault.VAULT_STORAGE_KEY)).toBe(true)

		await failing.endSession()
		expect(second.map.has(vault.VAULT_STORAGE_KEY)).toBe(false)
	})

	test('a locked session is not moved by detachSigner — endSession is the way out', async () => {
		// M6: `locked → idle` was implemented and reachable, but absent from the
		// spec's allowed list (which refuses everything it does not list). The
		// decision: detaching is about an *attached* capability and a locked session
		// has none, so it is a no-op — ending is `endSession()`, which clears the
		// record instead of abandoning it.
		const storage = memoryStorage()
		const { session } = persistedSession(storage)
		await vault.saveVaultedSession(
			makeNbunksec(),
			'correct horse',
			{ iterations: ITERATIONS },
			{
				storage,
				crypto: webCryptoPort,
			},
		)
		const observed = observe(session)
		await session.restoreSession()

		await session.detachSigner()

		expect(observed.states).toEqual(['idle', 'locked'])
		expect(observed.current().state).toBe('locked')
		expect(storage.map.has(vault.VAULT_STORAGE_KEY)).toBe(true)

		await session.endSession()
		expect(observed.current().state).toBe('idle')
	})

	test('the two vault failures a login surface must distinguish arrive as different codes', async () => {
		// M8: "wrong passphrase, let them retry" and "the plaintext session was
		// discarded, send them to login" used to arrive as one type with one code.
		const storage = memoryStorage()
		const { session } = persistedSession(storage)
		await vault.saveVaultedSession(
			makeNbunksec(),
			'correct horse',
			{ iterations: ITERATIONS },
			{
				storage,
				crypto: webCryptoPort,
			},
		)
		await session.restoreSession()

		const wrongPassphrase = await session
			.restoreSession({ passphrase: 'not the passphrase' })
			.catch((error: unknown) => error as { code?: string })
		expect(wrongPassphrase).toMatchObject({ code: 'wrong_passphrase' })

		const legacy = memoryStorage()
		legacy.map.set('nostr_local_signer_key', CLIENT_SK)
		legacy.map.set('nostr_connect_url', bunkerUrl())
		const second = createSignerSession({
			ports: { storage: legacy, crypto: webCryptoPort, transport: fakeTransport().pool, clock: manualClock() },
		})

		const reLogin = await second.restoreSession().catch((error: unknown) => error as { code?: string })
		expect(reLogin).toMatchObject({ code: 'legacy_discarded' })
	})
})

describe('createSignerFromKey — the session-less entry', () => {
	test('builds a usable, identity-bound signer with no session, storage or UI', async () => {
		const signer = createSignerFromKey(USER_SK)

		expect(await signer.getPublicKey()).toBe(USER_PK)
		const signed = await signer.signEvent(userTemplate('from a CLI'))
		expect(signed.pubkey).toBe(USER_PK)
		expect(signed.sig).toHaveLength(128)
	})

	test('also accepts an nsec1… key', async () => {
		const signer = createSignerFromKey(nip19.nsecEncode(hexToBytes(USER_SK)))
		expect(await signer.getPublicKey()).toBe(USER_PK)
	})
})
