import { finalizeEvent, generateSecretKey, getPublicKey, nip19, verifyEvent } from 'nostr-tools'
import { BunkerSigner, parseBunkerInput, type BunkerPointer } from 'nostr-tools/nip46'
import type { Event as NostrEvent, EventTemplate, VerifiedEvent } from 'nostr-tools/pure'

const HEX_32 = /^[0-9a-f]{64}$/
const CLAVE_RELAY = 'wss://relay.powr.build/'
export const CLAVE_PAIRING_TIMEOUT_MS = 120_000

export type DisposableNostrSigner = {
	getPublicKey(): Promise<string>
	signEvent(event: EventTemplate): Promise<VerifiedEvent>
	close(): Promise<void>
}

type RemoteSignerTransport = {
	connect(metadata?: { name?: string; url?: string }): Promise<void>
	getPublicKey(): Promise<string>
	signEvent(event: EventTemplate): Promise<VerifiedEvent>
	close(): Promise<void>
}

type ClaveSignerDependencies = {
	parseInput(input: string): Promise<BunkerPointer | null>
	generateClientSecret(): Uint8Array
	createTransport(secret: Uint8Array, pointer: BunkerPointer, onAuth: (url: string) => void): RemoteSignerTransport
}

export type ClavePairingOptions = {
	signal?: AbortSignal
	onStatus?: (phase: 'connecting' | 'waiting_for_approval' | 'connected') => void
	/** May shorten, but never extend, the two-minute production pairing window. */
	timeoutMs?: number
	/** Test seam. Browser callers always use the pinned nostr-tools implementation below. */
	dependencies?: ClaveSignerDependencies
}

function cleanEvent(event: NostrEvent): NostrEvent {
	return {
		id: event.id,
		pubkey: event.pubkey,
		sig: event.sig,
		kind: event.kind,
		created_at: event.created_at,
		tags: event.tags.map(tag => [...tag]),
		content: event.content,
	}
}

function exactSignedEvent(template: EventTemplate, actor: string, signed: NostrEvent): VerifiedEvent {
	let exact: NostrEvent | null = null
	try { exact = signed && typeof signed === 'object' ? cleanEvent(signed) : null }
	catch { exact = null }
	if (!exact || !HEX_32.test(actor) || exact.pubkey !== actor || exact.kind !== template.kind ||
		exact.created_at !== template.created_at || exact.content !== template.content ||
		JSON.stringify(exact.tags) !== JSON.stringify(template.tags) || !verifyEvent(exact)) {
		throw new Error('The signer returned a different or invalid Nostr event.')
	}
	return exact
}

function validClavePointer(pointer: BunkerPointer | null): pointer is BunkerPointer {
	if (!pointer || !HEX_32.test(pointer.pubkey) || typeof pointer.secret !== 'string' || pointer.secret.length < 8 ||
		pointer.secret.length > 512 || pointer.relays.length !== 1) return false
	try { return new URL(pointer.relays[0]).href === CLAVE_RELAY }
	catch { return false }
}

function defaultClaveDependencies(): ClaveSignerDependencies {
	return {
		parseInput: parseBunkerInput,
		generateClientSecret: generateSecretKey,
		createTransport(secret, pointer, onAuth) {
			return BunkerSigner.fromBunker(secret, pointer, {
				timeout: CLAVE_PAIRING_TIMEOUT_MS,
				authTimeout: CLAVE_PAIRING_TIMEOUT_MS,
				onauth: onAuth,
			})
		},
	}
}

function abortError(): Error {
	const error = new Error('Clave pairing was cancelled.')
	error.name = 'AbortError'
	return error
}

type PairingStage = 'connect' | 'account'

function isClaveRelayPolicyViolation(event: Event): boolean {
	const violation = event as Event & { blockedURI?: unknown; violatedDirective?: unknown }
	if (typeof violation.violatedDirective !== 'string' || !violation.violatedDirective.startsWith('connect-src') ||
		typeof violation.blockedURI !== 'string') return false
	try { return new URL(violation.blockedURI).origin === new URL(CLAVE_RELAY).origin }
	catch { return false }
}

function isRelayTransportFailure(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	return /nostr-tools\/nip46: (?:failed to send|subscription to the remote signer was closed)|websocket|network|relay/i.test(error.message)
}

function pairingFailure(error: unknown, stage: PairingStage, relayPolicyBlocked: boolean): Error {
	if (relayPolicyBlocked) {
		return new Error("This site's browser security policy blocked Clave's required relay. Pairing was not sent. No payment action was started.")
	}
	if (isRelayTransportFailure(error)) {
		return new Error("The browser lost access to Clave's required relay. Pairing was not completed; check this site's connection policy or network and try again. No payment action was started.")
	}
	if (stage === 'account') {
		return new Error('Clave connected, but its account identity could not be confirmed. Disconnect and pair with a fresh code. No payment action was started.')
	}
	return new Error('Clave did not complete the pairing request. Keep Auctions open in the foreground, check Clave notifications, and try a fresh code if needed. No payment action was started.')
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal | undefined,
	onAbort: () => void | Promise<void>): Promise<T> {
	if (!signal) return operation
	if (signal.aborted) {
		await onAbort()
		throw abortError()
	}
	return new Promise<T>((resolve, reject) => {
		let settled = false
		const finish = (run: () => void) => {
			if (settled) return
			settled = true
			signal.removeEventListener('abort', cancelled)
			run()
		}
		const cancelled = () => {
			Promise.resolve(onAbort()).catch(() => undefined).finally(() => finish(() => reject(abortError())))
		}
		signal.addEventListener('abort', cancelled, { once: true })
		operation.then(value => finish(() => resolve(value)), error => finish(() => reject(error)))
	})
}

/**
 * Connects to Clave through the relay contained in its signer-initiated bunker URI.
 * Neither the URI secret nor the ephemeral client key leaves this closure except as
 * required by the pinned nostr-tools NIP-46 transport.
 */
export async function createClaveNip46Signer(connectionCode: string,
	options: ClavePairingOptions = {}): Promise<DisposableNostrSigner> {
	if (typeof connectionCode !== 'string' || !connectionCode.trim().toLowerCase().startsWith('bunker://')) {
		throw new Error('Paste the bunker:// connection code copied from Clave.')
	}
	const dependencies = options.dependencies ?? defaultClaveDependencies()
	let pointer: BunkerPointer | null
	try { pointer = await dependencies.parseInput(connectionCode.trim()) }
	catch { throw new Error('The Clave connection code is invalid.') }
	if (!validClavePointer(pointer)) {
		throw new Error('Use a current Clave bunker code with its wss://relay.powr.build relay and pairing secret.')
	}
	const clientSecret = dependencies.generateClientSecret()
	if (!(clientSecret instanceof Uint8Array) || clientSecret.length !== 32) {
		clientSecret?.fill?.(0)
		throw new Error('Secure local pairing key generation failed.')
	}
	let transport: RemoteSignerTransport | null = null
	let closed = false
	let stage: PairingStage = 'connect', relayPolicyBlocked = false
	const policyTarget = typeof document === 'object' && typeof document.addEventListener === 'function' ? document : null
	const policyListener = (event: Event) => { if (isClaveRelayPolicyViolation(event)) relayPolicyBlocked = true }
	policyTarget?.addEventListener('securitypolicyviolation', policyListener)
	let callerCancelled = false, timedOut = false
	const deadline = new AbortController()
	const externalAbort = () => { callerCancelled = true; deadline.abort() }
	if (options.signal?.aborted) externalAbort()
	else options.signal?.addEventListener('abort', externalAbort, { once: true })
	const timeoutMs = Math.min(CLAVE_PAIRING_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? CLAVE_PAIRING_TIMEOUT_MS))
	const timeout = setTimeout(() => { timedOut = true; deadline.abort() }, timeoutMs)
	const close = async () => {
		if (closed) return
		closed = true
		try { await transport?.close() } finally { clientSecret.fill(0); transport = null }
	}
	try {
		options.onStatus?.('connecting')
		transport = dependencies.createTransport(clientSecret, pointer, () => options.onStatus?.('waiting_for_approval'))
		options.onStatus?.('waiting_for_approval')
		const applicationURL = typeof location === 'object' && typeof location.origin === 'string'
			? location.origin : 'https://auctions.invalid'
		await abortable(transport.connect({ name: 'Plebeian Auctions', url: applicationURL }), deadline.signal, close)
		stage = 'account'
		const actor = await abortable(transport.getPublicKey(), deadline.signal, close)
		if (!HEX_32.test(actor)) throw new Error('Clave returned an invalid account public key.')
		options.onStatus?.('connected')
		return Object.freeze({
			getPublicKey: async () => {
				if (closed) throw new Error('The Clave signer is disconnected.')
				return actor
			},
			signEvent: async (event: EventTemplate) => {
				if (closed || !transport) throw new Error('The Clave signer is disconnected.')
				return exactSignedEvent(event, actor, await transport.signEvent(event))
			},
			close,
		})
	} catch (error) {
		await close().catch(() => undefined)
		if (timedOut) throw new Error('Clave pairing timed out after two minutes. Check notifications and keep Auctions in the foreground when trying again. No payment action was started.')
		if (callerCancelled) throw abortError()
		if (error instanceof Error && error.message.startsWith('Clave returned')) throw error
		throw pairingFailure(error, stage, relayPolicyBlocked)
	} finally {
		clearTimeout(timeout)
		policyTarget?.removeEventListener('securitypolicyviolation', policyListener)
		options.signal?.removeEventListener('abort', externalAbort)
	}
}

/**
 * DEV/TEST ONLY. The decoded key is copied into one in-memory Uint8Array and is
 * best-effort overwritten on close. JavaScript runtimes may retain temporary or
 * garbage-collected copies, so this is not a hardware-grade zeroization claim.
 */
export function createDevNsecSigner(nsec: string): DisposableNostrSigner {
	let decoded: ReturnType<typeof nip19.decode>
	try { decoded = nip19.decode(nsec.trim()) }
	catch { throw new Error('The development nsec is invalid or has a bad checksum.') }
	if (decoded.type !== 'nsec' || !(decoded.data instanceof Uint8Array) || decoded.data.length !== 32) {
		if (decoded.type === 'nsec') decoded.data.fill(0)
		throw new Error('Enter an nsec key, not an npub or another Nostr identifier.')
	}
	let secret: Uint8Array | null = Uint8Array.from(decoded.data)
	decoded.data.fill(0)
	let actor: string
	try { actor = getPublicKey(secret) }
	catch {
		secret.fill(0); secret = null
		throw new Error('The development nsec does not contain a valid Nostr private key.')
	}
	let closed = false
	const close = async () => {
		if (closed) return
		closed = true
		secret?.fill(0)
		secret = null
	}
	return Object.freeze({
		getPublicKey: async () => {
			if (closed) throw new Error('The development signer is disconnected.')
			return actor
		},
		signEvent: async (event: EventTemplate) => {
			if (closed || !secret) throw new Error('The development signer is disconnected.')
			return exactSignedEvent(event, actor, finalizeEvent({
				kind: event.kind, created_at: event.created_at, tags: event.tags.map(tag => [...tag]), content: event.content,
			}, secret))
		},
		close,
	})
}
