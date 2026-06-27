import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { isWebSocketOriginAllowed, getAllowedOrigins } from '../webSocketOrigin'

/**
 * H1 — WebSocket Origin validation (cross-site WebSocket hijacking).
 *
 * Regression coverage for the origin check added in PR #1074. Without this
 * check a malicious page could open a WebSocket to the app server and act on
 * behalf of the authenticated user (the browser sends credentials on WS
 * upgrades the same way it does for XHR).
 */
describe('H1 — isWebSocketOriginAllowed', () => {
	const PREV_ORIGINS = process.env.ALLOWED_ORIGINS

	beforeEach(() => {
		delete process.env.ALLOWED_ORIGINS
	})

	afterEach(() => {
		if (PREV_ORIGINS === undefined) delete process.env.ALLOWED_ORIGINS
		else process.env.ALLOWED_ORIGINS = PREV_ORIGINS
	})

	const req = (headers: Record<string, string> = {}) => new Request('https://example.invalid/', { headers })

	test('allows requests with no Origin header (non-browser / server-to-server)', () => {
		expect(isWebSocketOriginAllowed(req({ host: 'plebeian.market' }))).toBe(true)
		expect(isWebSocketOriginAllowed(req({}))).toBe(true)
	})

	test('blocks a cross-origin browser request when no allowlist is set (same-origin fallback)', () => {
		// attacker.com opening a WS against plebeian.market must be refused
		expect(isWebSocketOriginAllowed(req({ origin: 'https://attacker.com', host: 'plebeian.market' }))).toBe(false)
	})

	test('allows a same-origin browser request when no allowlist is set', () => {
		expect(isWebSocketOriginAllowed(req({ origin: 'https://plebeian.market', host: 'plebeian.market' }))).toBe(true)
	})

	test('respects an explicit ALLOWED_ORIGINS allowlist (positive + negative)', () => {
		process.env.ALLOWED_ORIGINS = 'https://plebeian.market, https://staging.plebeian.market '
		// listed origin → allowed (even if host header differs, allowlist wins)
		expect(isWebSocketOriginAllowed(req({ origin: 'https://plebeian.market', host: 'cdn.example' }))).toBe(true)
		expect(isWebSocketOriginAllowed(req({ origin: 'https://staging.plebeian.market', host: 'x' }))).toBe(true)
		// unlisted origin → blocked, even if it would otherwise be same-origin
		expect(isWebSocketOriginAllowed(req({ origin: 'https://plebeian.market.evil', host: 'plebeian.market.evil' }))).toBe(false)
	})

	test('rejects a malformed Origin header', () => {
		// not a valid URL → new URL() throws → fail closed
		expect(isWebSocketOriginAllowed(req({ origin: 'not-a-url', host: 'plebeian.market' }))).toBe(false)
	})
})

describe('H1 — getAllowedOrigins parsing', () => {
	const PREV_ORIGINS = process.env.ALLOWED_ORIGINS

	beforeEach(() => {
		delete process.env.ALLOWED_ORIGINS
	})

	afterEach(() => {
		if (PREV_ORIGINS === undefined) delete process.env.ALLOWED_ORIGINS
		else process.env.ALLOWED_ORIGINS = PREV_ORIGINS
	})

	test('returns [] when ALLOWED_ORIGINS is unset / empty / whitespace', () => {
		expect(getAllowedOrigins()).toEqual([])
		process.env.ALLOWED_ORIGINS = ''
		expect(getAllowedOrigins()).toEqual([])
		process.env.ALLOWED_ORIGINS = '   '
		expect(getAllowedOrigins()).toEqual([])
	})

	test('trims and splits entries, dropping blanks', () => {
		process.env.ALLOWED_ORIGINS = ' https://a.com ,https://b.com, ,https://c.com '
		expect(getAllowedOrigins()).toEqual(['https://a.com', 'https://b.com', 'https://c.com'])
	})
})
