/**
 * harness.ts — **the host side** of the module's ports, for the tests.
 *
 * This file is test support, not module code: nothing in the implementation
 * imports it and `index.ts` does not export it. Everything a host would provide
 * — a clock, a relay, signing — is provided here, which is the point: the module
 * reads no global of its own, opens no socket and holds no timer.
 *
 * **No key, seed or literal identity material lives anywhere in this tree.** The
 * keys below are generated at run time, so every id is a real hash of a real
 * signature and every assertion in the suite is written relationally rather than
 * against a fixture.
 */
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

import type { Event } from './types'

/** The authors the tests sign as, generated at run time. */
export const KEY = generateSecretKey()
export const PUBKEY = getPublicKey(KEY)
export const OTHER_KEY = generateSecretKey()
export const OTHER_PUBKEY = getPublicKey(OTHER_KEY)

/**
 * #8ff9af — NOT_A_RELAY_EDGE: the names that must never appear on the handle.
 *
 * **M5 is structural now, so this is what is left of it** (`#8ff9af`: "No socket, no relay policy" is
 * unchanged and is now structural rather than a promise). The module's options accept **no** relay member
 * and the handle carries **no** relay member: there is no edge to wire a fake into, which is a stronger
 * fact than a fake that was never called. The remaining half of the claim — that nothing in the source
 * names a socket — is checked by `evidence/run.sh`'s greps, not by a fake.
 */
export const NOT_A_RELAY_EDGE = ['relay', 'relayUrls', 'socket', 'WebSocket'] as const

export interface EventFields {
	kind: number
	created_at: number
	content?: string
	tags?: string[][]
}

/** A signed event. */
export function signedEvent(fields: EventFields, sk: Uint8Array = KEY): Event {
	return finalizeEvent({ kind: fields.kind, created_at: fields.created_at, tags: fields.tags ?? [], content: fields.content ?? '' }, sk)
}

/** A replaceable or addressable version: for an addressable kind the `d` tag is the address. */
export function version(fields: { kind: number; created_at: number; content?: string; d?: string }, sk: Uint8Array = KEY): Event {
	const tags: string[][] = fields.d === undefined ? [] : [['d', fields.d]]
	return signedEvent({ kind: fields.kind, created_at: fields.created_at, content: fields.content, tags }, sk)
}

/**
 * A manual clock in **seconds** — the contract's unit, never milliseconds — so
 * that an expiry boundary is a decision a test takes rather than a race with the
 * wall clock.
 */
export function manualClock(seconds = 1_700_000_000): { now(): number; set(value: number): void; advance(by: number): void } {
	let current = seconds
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

/**
 * Up to `n` events from a subscription, and **a rejection if they do not
 * arrive** — so a stream that never emits fails a case instead of hanging it.
 * This is the module tree's only `setTimeout`, and it lives here rather than in
 * the implementation on purpose.
 */
export async function take(stream: AsyncIterable<Event>, n: number, ms = 500): Promise<Event[]> {
	const out: Event[] = []
	const iterator = stream[Symbol.asyncIterator]()
	let timer: ReturnType<typeof setTimeout> | undefined
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`take: only ${out.length} of ${n} event(s) arrived within ${ms} ms`)), ms)
	})
	try {
		const collected = (async (): Promise<Event[]> => {
			while (out.length < n) {
				const { value, done } = await iterator.next()
				if (done) throw new Error(`take: the stream ended after ${out.length} of ${n} event(s)`)
				out.push(value)
			}
			return out
		})()
		return await Promise.race([collected, expired])
	} finally {
		clearTimeout(timer)
	}
}
