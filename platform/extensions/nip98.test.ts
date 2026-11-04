import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { buildHttpAuthTemplate, encodeHttpAuthHeader } from '@sdk/core/nostr/nip98'
import { HttpAuthReplayCache, verifyHttpAuth } from './nip98'
import { ExtensionRateLimiter } from './rateLimiter'

const key = generateSecretKey()
const URL_ = 'https://market.example/api/extensions/ai/actions/suggest'
const NOW = 1_700_000_000
const BODY = '{"title":"Oak table"}'

function header(overrides: { url?: string; method?: string; body?: string; createdAt?: number; kind?: number; tags?: string[][] } = {}) {
	const template = buildHttpAuthTemplate({
		url: overrides.url ?? URL_,
		method: overrides.method ?? 'POST',
		body: overrides.body ?? BODY,
		createdAt: overrides.createdAt ?? NOW,
	})
	return encodeHttpAuthHeader(
		finalizeEvent({ ...template, kind: overrides.kind ?? template.kind, tags: overrides.tags ?? template.tags }, key),
	)
}

const verify = (authorization: string | null, extra: Partial<Parameters<typeof verifyHttpAuth>[0]> = {}) =>
	verifyHttpAuth({
		authorization,
		acceptedUrls: [URL_],
		method: 'POST',
		body: BODY,
		nowSeconds: NOW,
		replayCache: new HttpAuthReplayCache(),
		...extra,
	})

describe('NIP-98 verifier', () => {
	test('accepts a header built by the SDK client helpers', () => {
		expect(verify(header())).toMatchObject({ ok: true, pubkey: getPublicKey(key) })
	})

	test('rejects missing, malformed, tampered, and wrong-kind headers', () => {
		expect(verify(null)).toEqual({ ok: false, reason: 'missing' })
		expect(verify('Bearer abc')).toEqual({ ok: false, reason: 'malformed' })
		expect(verify('Nostr !!!')).toEqual({ ok: false, reason: 'malformed' })
		const event = JSON.parse(atob(header().slice(6)))
		expect(verify(`Nostr ${btoa(JSON.stringify({ ...event, content: 'x' }))}`)).toEqual({ ok: false, reason: 'bad_signature' })
		expect(verify(header({ kind: 1 }))).toEqual({ ok: false, reason: 'wrong_kind' })
	})

	test('enforces ±60s skew, exact url, method, and payload hash', () => {
		expect(verify(header({ createdAt: NOW - 61 }))).toEqual({ ok: false, reason: 'stale' })
		expect(verify(header({ createdAt: NOW + 61 }))).toEqual({ ok: false, reason: 'stale' })
		expect(verify(header({ createdAt: NOW - 60 })).ok).toBe(true)
		expect(verify(header({ url: 'https://evil.example/api/extensions/ai/actions/suggest' }))).toEqual({ ok: false, reason: 'url_mismatch' })
		expect(verify(header({ url: `${URL_}?x=1` }))).toEqual({ ok: false, reason: 'url_mismatch' })
		expect(verify(header({ method: 'GET' }))).toEqual({ ok: false, reason: 'method_mismatch' })
		expect(verify(header(), { body: '{"title":"Other"}' })).toEqual({ ok: false, reason: 'payload_mismatch' })
		expect(
			verify(
				header({
					tags: [
						['u', URL_],
						['method', 'POST'],
					],
				}),
			),
		).toEqual({ ok: false, reason: 'payload_mismatch' })
		expect(
			verify(
				header({
					tags: [
						['u', URL_],
						['u', 'https://evil.example/'],
						['method', 'POST'],
					],
				}),
				{ body: '' },
			),
		).toEqual({ ok: false, reason: 'url_mismatch' })
	})

	test('rejects replays within the window and forgets them afterwards', () => {
		const cache = new HttpAuthReplayCache(10)
		const auth = header()
		expect(verify(auth, { replayCache: cache }).ok).toBe(true)
		expect(verify(auth, { replayCache: cache })).toEqual({ ok: false, reason: 'replayed' })
		expect(cache.claim('other', NOW + 11)).toBe(true)
		expect(cache.size).toBe(1)
	})
})

describe('extension rate limiter', () => {
	const limit = { perPubkey: 2, windowSeconds: 60 }
	const base = { extensionId: 'ai', actionName: 'suggest', limit }

	test('allows up to the limit per pubkey and slides the window', () => {
		const limiter = new ExtensionRateLimiter()
		expect(limiter.consume({ ...base, pubkey: 'a', nowMs: 0 })).toMatchObject({ allowed: true, remaining: 1 })
		expect(limiter.consume({ ...base, pubkey: 'a', nowMs: 1_000 })).toMatchObject({ allowed: true, remaining: 0 })
		expect(limiter.consume({ ...base, pubkey: 'a', nowMs: 2_000 })).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 58 })
		expect(limiter.consume({ ...base, pubkey: 'b', nowMs: 2_000 }).allowed).toBe(true)
		expect(limiter.consume({ ...base, actionName: 'other', pubkey: 'a', nowMs: 2_000 }).allowed).toBe(true)
		expect(limiter.consume({ ...base, pubkey: 'a', nowMs: 60_001 }).allowed).toBe(true)
	})

	test('bounds memory by evicting least-recently-used keys', () => {
		const limiter = new ExtensionRateLimiter(2)
		for (const pubkey of ['a', 'b', 'c']) limiter.consume({ ...base, pubkey, nowMs: 0 })
		expect(limiter.trackedKeys).toBe(2)
	})
})
