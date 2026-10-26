/**
 * harness.ts — **the host side** of the module's ports, for the tests.
 *
 * Test support, not module code: nothing in the implementation imports it and `index.ts` does
 * not export it. Everything a host would provide — signing, a clock, a resolver, the
 * composition's accept context — is provided here, which is the point: the module reads no
 * global of its own, opens no socket and holds no timer beyond the budget the spec allows
 * (`#8e6079`, `#4b58be` (provenance); the bound itself `#e80b77`).
 *
 * **No key, seed or literal identity material lives anywhere in this tree.** The keys below
 * are generated at run time, so every id is a real hash of a real signature and every
 * assertion is written relationally rather than against a fixture.
 */
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

import type { AcceptContext, Event, Resolution, ResolutionAt, ValidationPort } from './types'

/** The authors the tests sign as, generated at run time. */
export const KEY = generateSecretKey()
export const PUBKEY = getPublicKey(KEY)
export const OTHER_KEY = generateSecretKey()
export const OTHER_PUBKEY = getPublicKey(OTHER_KEY)

export interface EventFields {
	kind: number
	created_at: number
	content?: string
	tags?: string[][]
}

/** A signed event — a real id, a real signature, so a comparison over `id` compares real bytes. */
export function signedEvent(fields: EventFields, sk: Uint8Array = KEY): Event {
	return finalizeEvent({ kind: fields.kind, created_at: fields.created_at, tags: fields.tags ?? [], content: fields.content ?? '' }, sk)
}

/**
 * A manual clock in **milliseconds** — the unit every bound the spec states is stated in — so
 * a revisit boundary or a budget is a decision a test takes rather than a race with the wall
 * clock.
 */
export function manualClock(ms = 1_700_000_000_000): { now(): number; set(value: number): void; advance(by: number): void } {
	let current = ms
	return {
		now: () => current,
		set: (value: number) => {
			current = value
		},
		advance: (by: number) => {
			current += by
		},
	}
}

/** The tier the endpoint declares — passed to the resolver. The flow was removed per the
 * maintainer's 2026-10-02 ruling: the rule never learns which boundary it is policing. */
export interface PortCall {
	readonly reference: string
	readonly at: ResolutionAt | undefined
}

/** A port with a scripted answer per reference, recording every call it is handed. */
export interface RecordingPort extends ValidationPort {
	readonly calls: PortCall[]
}

/** A scripted port: `answers` maps a reference to what the host replies; anything else is unanswered. */
export function recordingPort(answers: Record<string, Resolution | undefined> = {}, now: () => number = () => 0): RecordingPort {
	const calls: PortCall[] = []
	return {
		calls,
		now,
		resolve: async (reference: string, at?: ResolutionAt) => {
			calls.push({ reference, at })
			return answers[reference]
		},
	}
}

/** A port that never answers — the reference budget's own case. */
export function neverAnsweringPort(): RecordingPort {
	const calls: PortCall[] = []
	return {
		calls,
		now: () => 0,
		resolve: (reference: string, at?: ResolutionAt) => {
			calls.push({ reference, at })
			return new Promise<Resolution | undefined>(() => {})
		},
	}
}

/** A port that answers after `ms`, so a per-event budget can cut it off. */
export function slowPort(answers: Record<string, Resolution | undefined>, ms: number): RecordingPort {
	const calls: PortCall[] = []
	return {
		calls,
		now: () => 0,
		resolve: (reference: string, at?: ResolutionAt) => {
			calls.push({ reference, at })
			return new Promise<Resolution | undefined>((resolve) => {
				setTimeout(() => resolve(answers[reference]), ms)
			})
		},
	}
}

/**
 * A port that **fails** instead of answering: the host could not answer this reference. The
 * asynchronous form rejects the promise; the synchronous form throws before a promise exists.
 * Both are the same fact in two spellings, and both are the link half's `unresolved` — never a
 * rejection escaping `validate` or `accept`.
 */
export function rejectingPort(when: 'asynchronously' | 'synchronously' = 'asynchronously'): RecordingPort {
	const calls: PortCall[] = []
	return {
		calls,
		now: () => 0,
		resolve: (reference: string, at?: ResolutionAt): Promise<Resolution | undefined> => {
			calls.push({ reference, at })
			if (when === 'synchronously') throw new Error('the reference store is down')
			return Promise.reject(new Error('the reference store is down'))
		},
	}
}

/**
 * The composition's accept context, as `event-access` prints it — the shape `accept` **is**
 * (`#8393ac`, D-O24). `resolve` is the composition's own link resolver.
 */
export function compositionContext(
	resolve: (reference: string) => Promise<Event | undefined>,
	tier: 'local' | 'remote' = 'local',
): AcceptContext {
	return { tier, resolve }
}

/** A held answer, for a scripted port. */
export function held(event: Event): Resolution {
	return { state: 'held', event }
}
