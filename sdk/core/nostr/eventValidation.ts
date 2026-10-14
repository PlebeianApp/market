import { verifyEvent } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import { failure, success, type Result } from '../result'
import { ValidationError } from '../errors'

const EVENT_ID_RE = /^[0-9a-f]{64}$/i
const EVENT_SIG_RE = /^[0-9a-f]{128}$/i

export type ValidatedNostrEvent = Event

/** Validate the complete NIP-01 event shape without asserting signature validity. */
export function parseNostrEventShape(input: unknown): Result<ValidatedNostrEvent, ValidationError> {
	if (!isRecord(input)) return failure(new ValidationError('Event must be an object'))
	if (typeof input.id !== 'string' || !EVENT_ID_RE.test(input.id))
		return failure(new ValidationError('Event id must be 32-byte hex', ['id']))
	if (typeof input.pubkey !== 'string' || !EVENT_ID_RE.test(input.pubkey)) {
		return failure(new ValidationError('Event pubkey must be 32-byte hex', ['pubkey']))
	}
	if (!Number.isSafeInteger(input.created_at) || (input.created_at as number) < 0) {
		return failure(new ValidationError('Event created_at must be a non-negative integer', ['created_at']))
	}
	if (!Number.isSafeInteger(input.kind) || (input.kind as number) < 0) {
		return failure(new ValidationError('Event kind must be a non-negative integer', ['kind']))
	}
	if (typeof input.content !== 'string') return failure(new ValidationError('Event content must be a string', ['content']))
	if (!Array.isArray(input.tags) || !input.tags.every(isStringTag)) {
		return failure(new ValidationError('Event tags must be arrays of strings', ['tags']))
	}
	if (typeof input.sig !== 'string' || !EVENT_SIG_RE.test(input.sig)) {
		return failure(new ValidationError('Event signature must be 64-byte hex', ['sig']))
	}
	return success({
		id: input.id,
		pubkey: input.pubkey,
		created_at: input.created_at as number,
		kind: input.kind as number,
		content: input.content,
		tags: input.tags.map((tag) => [...tag]),
		sig: input.sig,
	})
}

/** Validate the event shape, event hash, and Schnorr signature. */
export function verifyNostrEvent(input: unknown): Result<ValidatedNostrEvent, ValidationError> {
	const parsed = parseNostrEventShape(input)
	if (!parsed.ok) return parsed
	if (!verifyEvent(parsed.value)) return failure(new ValidationError('Event id or signature verification failed', ['sig']))
	return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringTag(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((part) => typeof part === 'string')
}
