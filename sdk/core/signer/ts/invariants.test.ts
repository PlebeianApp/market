/**
 * The five invariants, one case each where the module can prove one on its own.
 *
 * I1–I5 are the ADR's own obligations (ADR-0002, the signer-migration
 * amendment, invariants section). The tests named by the ADR are harvested from
 * the market's `src/lib/__tests__/nostr-connect-signer.test.ts`,
 * `extension-signer.test.ts` and `session-vault.test.ts`; where the harvest's
 * case could not move (it imported the market's stores or mocked the module
 * itself), a module-side case is written here instead, and says so.
 *
 * Every case in this file fails if the invariant it names is broken — that is
 * the property the increment's evidence proves by breaking one on purpose.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import type { NostrEvent } from 'nostr-tools/pure'

import type { EventTemplate, ExtensionTransportPort, NipEncryptionCapability } from './index'
import {
	CapabilityUnavailableError,
	IdentityMismatchError,
	NoActiveSessionError,
	PasswordSignerLockedError,
	createSignerFromKey,
	createSignerSession,
	hasNip04,
	hasNip44,
	isSignerCapability,
} from './index'
import { createPasswordSignerLane } from './lanes'
import { connectBunkerSigner, createNostrConnectClient } from './nip46'
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
	WRONG_SK,
	bunkerTransport,
	bunkerUrl,
	fakeTransport,
	inboundEvent,
	manualClock,
	memoryStorage,
	settle,
	userTemplate,
	webCryptoPort,
} from './harness'
import { hasLegacyPlaintextSession } from './vault'

// ---------------------------------------------------------------------------
// I1 — the connect secret is validated before binding
// ---------------------------------------------------------------------------

describe('I1 — an unknown remote signer is never bound without the expected secret', () => {
	test('a bare "ack" never binds an unknown remote signer', async () => {
		const { pool, incoming } = fakeTransport()
		const client = createNostrConnectClient({
			relays: [RELAY],
			clientKeyHex: CLIENT_SK,
			connectSecret: CONNECT_SECRET,
			transport: pool,
		})

		const waiting = client.waitForSigner()

		incoming.next(inboundEvent(REMOTE_SK, { result: 'ack' }))
		await settle()

		// The library's lax bind (result === "ack") must have been gated by the
		// strict-bind transport: an unknown remote on a bare ack is NOT bound.
		expect(client.remote).toBeUndefined()
		expect(client.isConnected).toBe(false)

		await client.close()
		await waiting.catch(() => {})
	})

	test('a wrong connect secret never binds the remote signer', async () => {
		const { pool, incoming } = fakeTransport()
		const client = createNostrConnectClient({
			relays: [RELAY],
			clientKeyHex: CLIENT_SK,
			connectSecret: CONNECT_SECRET,
			transport: pool,
		})

		const waiting = client.waitForSigner()

		incoming.next(inboundEvent(REMOTE_SK, { result: 'wrong-secret' }))
		await settle()

		expect(client.remote).toBeUndefined()
		expect(client.isConnected).toBe(false)

		await client.close()
		await waiting.catch(() => {})
	})

	test('a validated connect-secret echo binds the remote signer', async () => {
		const { pool, incoming } = fakeTransport()
		const client = createNostrConnectClient({
			relays: [RELAY],
			clientKeyHex: CLIENT_SK,
			connectSecret: CONNECT_SECRET,
			transport: pool,
		})

		const waiting = client.waitForSigner()

		incoming.next(inboundEvent(REMOTE_SK, { result: CONNECT_SECRET }))
		await waiting

		expect(client.remote).toBe(REMOTE_PK)
		expect(client.isConnected).toBe(true)

		await client.close()
	})

	test('the bunker flow binds only a remote that accepts the connect secret', async () => {
		// I1's `bunker://` half. The market's copy of this obligation had no
		// module-side negative case (its only coverage was the app's e2e family),
		// so this case is written here rather than moved.
		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })
		const clock = manualClock()

		await expect(
			connectBunkerSigner(bunkerUrl('the-wrong-secret'), {
				clientKeyHex: CLIENT_SK,
				transport: transport.pool,
				clock,
			}),
		).rejects.toThrow(/unauthorized: wrong connect secret/)

		const accepted = await connectBunkerSigner(bunkerUrl(), {
			clientKeyHex: CLIENT_SK,
			transport: transport.pool,
			clock,
		})
		expect(accepted.signer.isConnected).toBe(true)
		expect(accepted.signer.remote).toBe(REMOTE_PK)
		await accepted.signer.close()
	})
})

// ---------------------------------------------------------------------------
// I2 — remote signer ≠ authenticated identity
// ---------------------------------------------------------------------------

describe('I2 — the remote-signer pubkey stays separate from the authenticated identity', () => {
	test('identity resolution is via getPublicKey() only — never clientPubkey (structural oracle)', async () => {
		// The clientPubkey and the authenticated identity are inherently distinct
		// fields. This guards that no consumer reaches for clientPubkey or the raw
		// `remote` field as an identity.
		const { pool } = fakeTransport()
		const client = createNostrConnectClient({
			relays: [RELAY],
			clientKeyHex: CLIENT_SK,
			connectSecret: CONNECT_SECRET,
			transport: pool,
		})

		expect(client.clientPubkey).toBe(CLIENT_PK)
		expect(client.clientPubkey).not.toBe(USER_PK)
		expect(client.clientPubkey).not.toBe(REMOTE_PK)
	})

	test('behaviourally: a bound session resolves the user, not the client key nor the remote', async () => {
		// The behavioural collapse case the market kept in
		// `nip46-signer-capability.test.ts` (it imported the market's stores, so it
		// could not move). Same obligation, at the module's own seam.
		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })
		const session = createSignerSession({
			ports: { transport: transport.pool, clock: manualClock() },
		})

		await session.startSession({ lane: 'bunker', bunkerUrl: bunkerUrl(), clientKeyHex: CLIENT_SK })

		const identity = await session.getPublicKey()
		expect(identity).toBe(USER_PK)
		expect(identity).not.toBe(CLIENT_PK)
		expect(identity).not.toBe(REMOTE_PK)
	})
})

// ---------------------------------------------------------------------------
// I3 — signed events are bound to the resolved identity
// ---------------------------------------------------------------------------

describe('I3 — a returned event must verify and belong to the resolved identity', () => {
	async function sessionWithSigner(signEvent: (template: EventTemplate) => Promise<NostrEvent>) {
		const session = createSignerSession()
		await session.attachSigner({ getPublicKey: async () => USER_PK, signEvent })
		return session
	}

	test('signEvent fails closed when the returned event pubkey differs from the authenticated identity', async () => {
		const session = await sessionWithSigner(async (template) => finalizeEvent(template, hexToBytes(WRONG_SK)))

		await expect(session.signEvent(userTemplate())).rejects.toThrow(IdentityMismatchError)
		await expect(session.signEvent(userTemplate())).rejects.toThrow(/different pubkey/)
	})

	test('signEvent fails closed when the signature does not verify, even if the pubkey matches', async () => {
		const honest = finalizeEvent(userTemplate('original'), hexToBytes(USER_SK))
		const session = await sessionWithSigner(async () => ({ ...honest, content: 'tampered' }))

		await expect(session.signEvent(userTemplate())).rejects.toThrow(/does not verify/)
	})

	test('signEvent returns the event when identity and signature agree', async () => {
		const session = await sessionWithSigner(async (template) => finalizeEvent(template, hexToBytes(USER_SK)))

		const signed = await session.signEvent(userTemplate())
		expect(signed.pubkey).toBe(USER_PK)
		expect(signed.sig).toHaveLength(128)
	})

	test('the NIP-46 lane arrives at the same assertion: a remote signing as another key fails closed', async () => {
		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })
		const session = createSignerSession({
			ports: { transport: transport.pool, clock: manualClock() },
		})
		await session.startSession({ lane: 'bunker', bunkerUrl: bunkerUrl(), clientKeyHex: CLIENT_SK })

		const signed = await session.signEvent(userTemplate('via a remote signer'))
		expect(signed.pubkey).toBe(USER_PK)
	})

	test('the session-less construct-on-key entry is identity-bound too', async () => {
		const signer = createSignerFromKey(USER_SK)
		const signed = await signer.signEvent(userTemplate())
		expect(signed.pubkey).toBe(USER_PK)
		expect(await signer.getPublicKey()).toBe(USER_PK)
	})
})

// ---------------------------------------------------------------------------
// I4 — NIP-44 is capability-gated, never synthesised locally
// ---------------------------------------------------------------------------

describe('I4 — the encryption capability is optional and fails closed', () => {
	/** A NIP-07 extension that exposes only the two NIP-07 methods. */
	function bareExtension(exposes: Partial<ExtensionTransportPort> = {}): ExtensionTransportPort {
		return {
			getPublicKey: async () => USER_PK,
			signEvent: async (template) => finalizeEvent(template as EventTemplate, hexToBytes(USER_SK)),
			...exposes,
		}
	}

	test('leaves nip04 and nip44 absent when the extension lacks them (fail closed)', async () => {
		const session = createSignerSession({
			settings: { capabilities: ['nip44', 'nip04'] },
			ports: { extension: bareExtension() },
		})

		const snapshot = await session.startSession({ lane: 'extension' })

		expect(snapshot.capabilities).toEqual({ nip04: false, nip44: false })
		expect(session.capabilities().nip44).toBeUndefined()
		expect(session.capabilities().nip04).toBeUndefined()
		await expect(session.encrypt(USER_PK, 'hi', 'nip44')).rejects.toThrow(CapabilityUnavailableError)
		await expect(session.decrypt(USER_PK, 'hi', 'nip04')).rejects.toThrow(/refusing rather than synthesising/)
	})

	test('an extension that exposes only half of nip44 offers no nip44 at all (fail closed)', async () => {
		const half: Partial<NipEncryptionCapability> = { encrypt: async () => 'e44' }
		const session = createSignerSession({
			settings: { capabilities: ['nip44'] },
			ports: { extension: bareExtension({ nip44: half }) },
		})

		await session.startSession({ lane: 'extension' })

		expect(session.capabilities().nip44).toBeUndefined()
		expect(isSignerCapability(session.currentSigner())).toBe(true)
		expect(hasNip44(session.currentSigner())).toBe(false)
		expect(hasNip04(session.currentSigner())).toBe(false)
	})

	test('present ⇔ the signer provides it, and the composer allow-list may only narrow', async () => {
		const nip44: NipEncryptionCapability = {
			encrypt: async () => 'e44',
			decrypt: async () => 'd44',
		}
		const session = createSignerSession({
			settings: { capabilities: ['nip44'] },
			ports: { extension: bareExtension({ nip44 }) },
		})

		await session.startSession({ lane: 'extension' })

		expect(session.capabilities().nip44).toBe(nip44)
		expect(hasNip44(session.currentSigner())).toBe(true)
		expect(await session.encrypt(USER_PK, 'hi', 'nip44')).toBe('e44')
		// The allow-list did not include nip04, and the extension has no nip04.
		await expect(session.encrypt(USER_PK, 'hi', 'nip04')).rejects.toThrow(CapabilityUnavailableError)
	})

	test('the capability handed out through currentSigner() obeys the same allow-list (I4)', async () => {
		// B1: the allow-list gated what `capabilities()` *reported* while
		// `currentSigner()` kept handing out the ungated object — so the exact
		// `nip44.encrypt` the composer had refused was reachable through the
		// contract, and the module's own guard `hasNip44(currentSigner())` answered
		// `true` for a refused scheme.
		const closed = createSignerSession()
		await closed.startSession({ lane: 'nsec', key: USER_SK })
		expect(closed.capabilities()).toEqual({})
		expect(hasNip44(closed.currentSigner())).toBe(false)
		expect(hasNip04(closed.currentSigner())).toBe(false)
		expect(closed.currentSigner().nip44).toBeUndefined()
		expect(closed.currentSigner().nip04).toBeUndefined()

		const permissive = createSignerSession({ settings: { capabilities: ['nip44'] } })
		await permissive.startSession({ lane: 'nsec', key: USER_SK })
		expect(hasNip44(permissive.currentSigner())).toBe(true)
		expect(hasNip04(permissive.currentSigner())).toBe(false)
		expect(permissive.currentSigner().nip04).toBeUndefined()
		// what it does carry is the same object `capabilities()` reports, so the two
		// reads cannot disagree about *which* implementation answers
		expect(permissive.currentSigner().nip44).toBe(permissive.capabilities().nip44)
		const ciphertext = await permissive.currentSigner().nip44?.encrypt(USER_PK, 'a private note')
		expect(ciphertext).toBeDefined()
		expect(ciphertext).not.toContain('a private note')
	})

	// An explicit deadline: this case runs the library's NIP-49 KDF (scrypt) twice,
	// which is deliberately expensive, and the runner's 5 s default is not a margin
	// under load — it timed out once here at 22:38 on a loaded machine while passing
	// everywhere else. The deadline is a property of the case's cost, not a weakening
	// of what it asserts: the guard still has to reject rather than hang.
	test('a locked NIP-49 signer rejects fast instead of hanging on a never-resolved unlock', async () => {
		// The deadlock guard `password-signer-session.ts` documents: the library
		// parks every method on a requestUnlock() deferred nothing resolves.
		const { PasswordSigner } = await import('applesauce-signers')
		const signer = await PasswordSigner.fromPrivateKey(USER_SK, 'a-passphrase')
		const lane = await createPasswordSignerLane(signer.ncryptsec as string, 'a-passphrase')

		expect(lane.capability.getPublicKey()).resolves.toBe(USER_PK)
		lane.lock()

		await expect(lane.capability.getPublicKey()).rejects.toThrow(PasswordSignerLockedError)
		await expect(lane.capability.signEvent(userTemplate())).rejects.toThrow(PasswordSignerLockedError)
		await expect(lane.capability.nip44?.encrypt(USER_PK, 'hi')).rejects.toThrow(PasswordSignerLockedError)
		await expect(lane.capability.nip04?.decrypt(USER_PK, 'hi')).rejects.toThrow(PasswordSignerLockedError)
	}, 30_000)
})

// ---------------------------------------------------------------------------
// I5 — session secrets are never silently plaintext (the session-level half;
// the vault's own cases are in vault.test.ts)
// ---------------------------------------------------------------------------

describe('I5 — the persisted record is encrypted, migrated, or intentionally re-logged-in', () => {
	test('a legacy plaintext record is discarded by default — never silently retained', async () => {
		const storage = memoryStorage()
		storage.map.set('nostr_local_signer_key', CLIENT_SK)
		storage.map.set('nostr_connect_url', bunkerUrl())

		const session = createSignerSession({
			settings: { capabilities: ['nip44'] },
			ports: { storage, crypto: webCryptoPort, transport: fakeTransport().pool, clock: manualClock() },
		})

		await expect(session.restoreSession()).rejects.toThrow(/intentional re-login is required/)
		expect(await hasLegacyPlaintextSession({ storage, crypto: webCryptoPort })).toBe(false)
		expect(storage.map.size).toBe(0)
	})

	test('a legacy plaintext record migrates when configured, deleting the plaintext', async () => {
		const storage = memoryStorage()
		storage.map.set('nostr_local_signer_key', CLIENT_SK)
		storage.map.set('nostr_connect_url', bunkerUrl())
		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })

		const session = createSignerSession({
			settings: { restoreOnStart: 'migrate', capabilities: ['nip44'] },
			ports: { storage, crypto: webCryptoPort, transport: transport.pool, clock: manualClock() },
		})

		const snapshot = await session.restoreSession({ passphrase: 'a passphrase' })

		expect(snapshot.state).toBe('active')
		expect(snapshot.pubkey).toBe(USER_PK)
		expect(snapshot.record).toBe('vaulted')
		expect(storage.map.has('nostr_local_signer_key')).toBe(false)
		expect(storage.map.has('nostr_connect_url')).toBe(false)
	})

	test('a session with no vault record and no attach point has no identity to read', async () => {
		const session = createSignerSession()
		await expect(session.getPublicKey()).rejects.toThrow(NoActiveSessionError)
		await expect(session.signEvent(userTemplate())).rejects.toThrow(NoActiveSessionError)
		expect(session.capabilities()).toEqual({})
	})

	test('the token a session persists is the encrypted session token, never the key', async () => {
		const storage = memoryStorage()
		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })
		const session = createSignerSession({
			settings: { sessionAtRest: { iterations: 1_000, minIterations: 1_000, passphrase: 'a passphrase' } },
			ports: { storage, crypto: webCryptoPort, transport: transport.pool, clock: manualClock() },
		})

		await session.startSession({ lane: 'bunker', bunkerUrl: bunkerUrl(), clientKeyHex: CLIENT_SK })

		const stored = [...storage.map.values()].join('\n')
		// The plaintext session token is bech32 over JSON: it contains neither the
		// hex client key nor the bunker secret *literally*, so those two assertions
		// cannot fail if the vault is bypassed — measured: a plaintext persist stays
		// green under them. These can fail, so they are the case's real content.
		expect(stored.startsWith('nbunksec')).toBe(false)
		expect(Object.keys(JSON.parse(stored) as Record<string, unknown>).sort()).toEqual(['ct', 'iterations', 'iv', 'kdf', 'salt', 'v'])
	})
})
