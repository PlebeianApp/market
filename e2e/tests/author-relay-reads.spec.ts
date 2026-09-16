/**
 * ADR-0002 Wave 1 read topology (F3, proposed: PR #1333) — bounded author-relay read path, end to end.
 *
 * Two black-box cases, both with every relay mocked locally:
 *
 *  - flag ON: an author whose kind-0 profile exists ONLY on a relay they declare
 *    in their own kind-10002 list resolves through the bounded path, so the
 *    profile renders instead of the degraded pubkey-prefix fallback.
 *  - flag OFF: the same read stays pinned-only — the degraded fallback renders
 *    and the author's relay sees ZERO connections. That second assertion is the
 *    point of the test: "OFF" must mean no egress, not "egress that failed".
 *
 * Test isolation (ADR-0005): the app relay is the local `nak serve` relay from
 * `playwright.config.ts`; the author's declared relay is intercepted with
 * `page.routeWebSocket`, so no request leaves the machine. The `/api/config`
 * decision is the single server boolean F3 defines, rewritten per test through
 * `page.route` — the production default (OFF) is never flipped for a run.
 */
import { test, expect, type Page, type WebSocketRoute } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import type { Event } from 'nostr-tools/pure'
import WebSocket from 'ws'
import { RELAY_URL } from '../test-config'

useWebSocketImplementation(WebSocket)

/** A relay only the author declares — unroutable, and always intercepted. */
const AUTHOR_RELAY_URL = 'wss://author-relay.e2e.invalid'
const PROFILE_NAME = 'OffRelay Author Profile'

interface AuthorFixture {
	secretKey: Uint8Array
	pubkey: string
	/** kind 0 — published ONLY to the mocked author relay, never to the app relay. */
	profile: Event
	/** kind 10002 — declares AUTHOR_RELAY_URL for reads; published to the app relay. */
	relayList: Event
	/** kind 1 — the post under test; published to the app relay. */
	post: Event
}

function createAuthorFixture(): AuthorFixture {
	const secretKey = generateSecretKey()
	const pubkey = getPublicKey(secretKey)
	const createdAt = Math.floor(Date.now() / 1000)

	return {
		secretKey,
		pubkey,
		profile: finalizeEvent(
			{
				kind: 0,
				created_at: createdAt,
				tags: [],
				content: JSON.stringify({ name: PROFILE_NAME, about: 'declared-relay-only author' }),
			},
			secretKey,
		),
		// No marker on the `r` tag means read+write, per `parseRelayTags`.
		relayList: finalizeEvent({ kind: 10002, created_at: createdAt, tags: [['r', AUTHOR_RELAY_URL]], content: '' }, secretKey),
		post: finalizeEvent({ kind: 1, created_at: createdAt, tags: [], content: 'bounded author-relay read fixture' }, secretKey),
	}
}

async function publishToAppRelay(events: Event[]): Promise<void> {
	const relay = await Relay.connect(RELAY_URL)
	try {
		for (const event of events) await relay.publish(event)
	} finally {
		relay.close()
	}
}

/** Rewrite the single server decision the browser consumes. */
async function setExternalAuthorReadsEnabled(page: Page, enabled: boolean): Promise<void> {
	await page.route('**/api/config', async (route) => {
		const response = await route.fetch()
		const body = await response.json()
		await route.fulfill({ response, json: { ...body, externalAuthorReadsEnabled: enabled } })
	})
}

interface MockedAuthorRelay {
	/** Number of WebSocket connections the author's relay accepted. */
	connections: number
	/** Parsed REQ messages, in arrival order. */
	requests: unknown[][]
	/** Filters the relay was asked for. */
	filters: Array<Record<string, unknown>>
}

/**
 * Stand up a mock relay at AUTHOR_RELAY_URL that serves `events` and records
 * every REQ. `connectToServer()` is deliberately never called, so the
 * connection is served in-process and cannot reach the network.
 *
 * Async on purpose: `page.routeWebSocket()` only takes effect once its promise
 * resolves (the install adds a context init script that patches `WebSocket`),
 * so a non-awaited registration silently lets the real connection out — the
 * exact egress ADR-0005 forbids.
 */
async function mockAuthorRelay(page: Page, events: Event[]): Promise<MockedAuthorRelay> {
	const state: MockedAuthorRelay = { connections: 0, requests: [], filters: [] }

	await page.routeWebSocket(/author-relay\.e2e\.invalid/, (ws: WebSocketRoute) => {
		state.connections += 1

		ws.onMessage((message) => {
			let parsed: unknown
			try {
				parsed = JSON.parse(typeof message === 'string' ? message : message.toString())
			} catch {
				return
			}
			if (!Array.isArray(parsed) || parsed[0] !== 'REQ') return

			state.requests.push(parsed as unknown[][])
			const subscriptionId = String(parsed[1])
			for (const filter of (parsed.slice(2) as Array<Record<string, unknown>>) ?? []) {
				state.filters.push(filter)
			}
			for (const event of events) ws.send(JSON.stringify(['EVENT', subscriptionId, event]))
			ws.send(JSON.stringify(['EOSE', subscriptionId]))
		})
	})

	return state
}

test.describe('bounded author-relay reads (F3)', () => {
	test('flag ON: a profile that exists only on the author-declared relay resolves', async ({ page }) => {
		const author = createAuthorFixture()
		await publishToAppRelay([author.relayList, author.post])

		await setExternalAuthorReadsEnabled(page, true)
		const authorRelay = await mockAuthorRelay(page, [author.profile])

		await page.goto(`/posts/${author.post.id}`)

		// The bounded path reached the author's declared relay and the profile is
		// rendered, instead of the degraded `pubkey.slice(0, 8) + '...'` label.
		await expect(page.getByText(PROFILE_NAME)).toBeVisible({ timeout: 20_000 })
		await expect(page.getByText(`${author.pubkey.slice(0, 8)}...`)).toHaveCount(0)

		expect(authorRelay.connections).toBeGreaterThan(0)
		// The disclosure the ADR records: the author's relay learns a filter
		// naming that author. Inside the bound, that is the accepted tradeoff.
		expect(authorRelay.filters).toContainEqual({ kinds: [0], authors: [author.pubkey] })
	})

	test('flag OFF: the read stays degraded and the author relay is never contacted', async ({ page }) => {
		const author = createAuthorFixture()
		await publishToAppRelay([author.relayList, author.post])

		await setExternalAuthorReadsEnabled(page, false)
		const authorRelay = await mockAuthorRelay(page, [author.profile])

		await page.goto(`/posts/${author.post.id}`)

		await expect(page.getByText(`${author.pubkey.slice(0, 8)}...`)).toBeVisible({ timeout: 20_000 })
		await expect(page.getByText(PROFILE_NAME)).toHaveCount(0)

		// Zero egress: not a failed connection, no connection at all.
		expect(authorRelay.connections).toBe(0)
		expect(authorRelay.requests).toHaveLength(0)
	})
})
