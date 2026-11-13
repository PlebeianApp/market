import { SimplePool, verifyEvent } from 'nostr-tools'
import type { Event as NostrEvent } from 'nostr-tools/pure'

const HEX_32 = /^[0-9a-f]{64}$/
export const PROFILE_RELAY = 'wss://relay.powr.build/'
export const PROFILE_READ_TIMEOUT_MS = 6_000
const MAX_PROFILE_CONTENT_BYTES = 16_384
const MAX_NAME_LENGTH = 64
const MAX_ABOUT_LENGTH = 280
const MAX_IMAGE_URL_LENGTH = 512
const UNSAFE_NAME_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu

export type VerifiedNostrProfile = Readonly<{
	actor: string
	eventId: string
	createdAt: number
	displayName: string
	name: string
	about: string
	picture: string
	nip05: string
}>

export type NostrProfileReadOptions = {
	signal?: AbortSignal
	timeoutMs?: number
	/** Test seam. Production always uses the single pinned relay reader below. */
	query?: (actor: string, signal: AbortSignal, timeoutMs: number) => Promise<NostrEvent[]>
}

function boundedText(value: unknown, maximum: number): string {
	if (typeof value !== 'string') return ''
	return [...value.replace(UNSAFE_NAME_CONTROLS, '').trim()].slice(0, maximum).join('')
}

function safeHTTPSImage(value: unknown): string {
	if (typeof value !== 'string') return ''
	const candidate = value.trim()
	if (!candidate || candidate.length > MAX_IMAGE_URL_LENGTH) return ''
	try {
		const parsed = new URL(candidate)
		if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.hash) return ''
		return parsed.href
	} catch { return '' }
}

/**
 * Parses only an exact, signed kind-0 event from the requested account.
 * Names, images and NIP-05 strings remain self-claimed presentation metadata;
 * signature verification proves the event author, not those claims.
 */
export function verifiedNostrProfile(event: unknown, actor: string): VerifiedNostrProfile | null {
	if (!HEX_32.test(actor) || !event || typeof event !== 'object') return null
	const candidate = event as NostrEvent
	if (candidate.kind !== 0 || candidate.pubkey !== actor || !Number.isSafeInteger(candidate.created_at) ||
		candidate.created_at < 0 || typeof candidate.content !== 'string' ||
		new TextEncoder().encode(candidate.content).length > MAX_PROFILE_CONTENT_BYTES || !Array.isArray(candidate.tags)) return null
	// nostr-tools caches successful verification on the object. Verify a fresh,
	// field-only event so a finalized object mutated in place cannot reuse that cache.
	const unsignedCandidate: NostrEvent = {
		id: candidate.id,
		pubkey: candidate.pubkey,
		created_at: candidate.created_at,
		kind: candidate.kind,
		tags: candidate.tags.map(tag => Array.isArray(tag) ? [...tag] : tag),
		content: candidate.content,
		sig: candidate.sig,
	}
	if (!verifyEvent(unsignedCandidate)) return null
	let metadata: unknown
	try { metadata = JSON.parse(unsignedCandidate.content) }
	catch { return null }
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
	const value = metadata as Record<string, unknown>
	return Object.freeze({
		actor,
		eventId: unsignedCandidate.id,
		createdAt: unsignedCandidate.created_at,
		displayName: boundedText(value.display_name, MAX_NAME_LENGTH),
		name: boundedText(value.name, MAX_NAME_LENGTH),
		about: boundedText(value.about, MAX_ABOUT_LENGTH),
		picture: safeHTTPSImage(value.picture),
		nip05: boundedText(value.nip05, MAX_NAME_LENGTH),
	})
}

function abortError(): Error {
	const error = new Error('Nostr profile lookup was cancelled.')
	error.name = 'AbortError'
	return error
}

async function queryPinnedProfileRelay(actor: string, signal: AbortSignal, timeoutMs: number): Promise<NostrEvent[]> {
	if (signal.aborted) throw abortError()
	const pool = new SimplePool({ enableReconnect: false })
	const deadline = new AbortController()
	const cancel = () => deadline.abort()
	signal.addEventListener('abort', cancel, { once: true })
	const timeout = setTimeout(() => deadline.abort(), timeoutMs)
	try {
		return await new Promise<NostrEvent[]>((resolve, reject) => {
			const events: NostrEvent[] = []
			let settled = false
			const finish = (run: () => void) => {
				if (settled) return
				settled = true
				deadline.signal.removeEventListener('abort', cancelled)
				run()
			}
			const cancelled = () => finish(() => signal.aborted ? reject(abortError()) : resolve(events))
			deadline.signal.addEventListener('abort', cancelled, { once: true })
			pool.subscribeMany([PROFILE_RELAY], { kinds: [0], authors: [actor], limit: 8 }, {
				abort: deadline.signal,
				maxWait: timeoutMs,
				onevent: event => { events.push(event) },
				oneose: () => finish(() => resolve(events)),
				onclose: () => finish(() => resolve(events)),
			})
		})
	} finally {
		clearTimeout(timeout)
		signal.removeEventListener('abort', cancel)
		pool.destroy()
	}
}

export async function readVerifiedNostrProfile(actor: string,
	options: NostrProfileReadOptions = {}): Promise<VerifiedNostrProfile | null> {
	if (!HEX_32.test(actor)) throw new Error('Nostr profile actor is invalid.')
	const controller = new AbortController()
	const cancel = () => controller.abort()
	if (options.signal?.aborted) controller.abort()
	else options.signal?.addEventListener('abort', cancel, { once: true })
	const timeoutMs = Math.min(PROFILE_READ_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? PROFILE_READ_TIMEOUT_MS))
	try {
		const events = await (options.query ?? queryPinnedProfileRelay)(actor, controller.signal, timeoutMs)
		if (controller.signal.aborted) throw abortError()
		return events
			.map(event => verifiedNostrProfile(event, actor))
			.filter((profile): profile is VerifiedNostrProfile => profile !== null)
			.sort((left, right) => right.createdAt - left.createdAt || right.eventId.localeCompare(left.eventId))[0] ?? null
	} finally { options.signal?.removeEventListener('abort', cancel) }
}
