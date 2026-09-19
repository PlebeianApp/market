/**
 * Login gate for PR #1363 / PR #1371 — "can a user log in to the nostr client
 * and actually use the app?"
 *
 * Three things are asserted, in increasing order of strength:
 *
 *  1. RELAY DERIVATION (the assertion the reviewer said existed nowhere):
 *     the Nostr Connect QR lane's DEFAULT advertised relay must equal the
 *     server's `/api/config.nip46Relay`. The config read is stubbed with a
 *     sentinel value, so a regression back to the hardcoded
 *     `DEFAULT_NIP46_RELAYS[0]` (the bug PR #1363 fixed — see
 *     `src/lib/nostr/nip46-relays.ts`) fails loudly instead of silently
 *     passing.
 *
 *  2. THE ADVERTISED RELAY IS THE ONE LOGIN USES: the test no longer clicks
 *     "Custom relay..." (which the Playwright config's `NIP46_RELAY_URL:
 *     RELAY_URL` made redundant — `playwright.config.ts`) and no longer types a
 *     relay by hand. `Nip46Mock.respondToConnect()` dials `parsed.relays[0]`
 *     from the emitted `nostrconnect://` URI, so the NIP-46 handshake can only
 *     complete if the app both advertised that relay AND wrote its kind-24133
 *     response to it. Interacting with the picker would prove nothing.
 *
 *  3. THE APP IS USABLE AFTER LOGIN, WITH NO CONSOLE ERRORS: the shell is past
 *     `/setup`, a relay-backed read on `/` resolved to a terminal state
 *     (`src/routes/index.tsx` -> `InfiniteProductList` -> `product-card`, see
 *     `src/components/ProductCard.tsx`), and at least one relay WebSocket frame
 *     was physically received.
 *
 * SELECTORS USED (verified in source, see the marked lines):
 *   - `[data-slot="select-trigger"] [data-slot="select-value"]`
 *     `src/components/ui/select.tsx` — readable while the Radix Select is
 *     CLOSED (`aria-selected` is not usable on the closed trigger).
 *   - `input[readonly]` — the emitted nostrconnect:// URI.
 *   - `[data-testid="product-card"]` — `src/components/ProductCard.tsx:98`.
 *
 * SCOPE / WHAT THIS DOES NOT PROVE: the NIP-46 counterparty is a local mock, so
 * this proves the client-side flow and relay wiring, NOT that any particular
 * PUBLIC relay accepts kind-24133 writes. See the accompanying report.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect } from '../fixtures/recorded-context'
import { Nip46Mock } from '../utils/nip46-mock'
import { RELAY_URL, TARGETS_EXTERNAL_APP, BASE_URL } from '../test-config'
import { ensureScenario } from '../scenarios'
import { devUser2 } from '../../src/lib/fixtures'

/** The closed Radix Select trigger's rendered value. */
const SELECT_VALUE = '[data-slot="select-trigger"] [data-slot="select-value"]'
/** Known-bogus NIP-46 relay: `.invalid` is reserved and never resolves (RFC 2606). */
const SENTINEL_NIP46_RELAY = 'wss://nip46-sentinel.invalid'

// ─── Helpers ────────────────────────────────────────────────

/** Collect every console error / uncaught page error for the lifetime of the page. */
function collectConsoleErrors(page: Page): string[] {
	const errors: string[] = []
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
	})
	page.on('pageerror', (err) => errors.push(`pageerror: ${err.message ?? String(err)}`))
	return errors
}

/** Count relay WebSocket traffic (skips the dev server's HMR socket). */
function trackRelayFrames(page: Page) {
	const relayUrls = new Set<string>()
	let received = 0
	let sent = 0
	page.on('websocket', (ws) => {
		const url = ws.url()
		if (url.includes('_bun/hmr') || url.includes('__vite')) return
		relayUrls.add(url)
		ws.on('framereceived', () => {
			received++
		})
		ws.on('framesent', () => {
			sent++
		})
	})
	return () => ({ relayUrls: Array.from(relayUrls), received, sent })
}

/**
 * Test isolation: the app also fans out to public community relays. They are
 * flaky from test hosts (observed verbatim on the preview run: `relay.nostr.net`
 * HTTP 500/525, `relay.damus.io` 503) and a third-party outage is not "the app
 * failed to log in". Replace every relay socket that is neither the app's own
 * origin nor the suite's relay with a minimal EOSE-only stub, so the run is
 * hermetic — no public network, no third-party console noise.
 *
 * Passes through only the app origin (dev-server HMR) and the suite relay.
 */
async function stubThirdPartyRelays(context: BrowserContext) {
	const appHost = new URL(BASE_URL).host
	const relayHost = new URL(RELAY_URL).host
	const stubbed = new Set<string>()
	await context.routeWebSocket(/^wss?:\/\//, (ws) => {
		const url = ws.url()
		let host = ''
		try {
			host = new URL(url).host
		} catch {
			host = ''
		}
		// Keep the app's own origin (dev-server HMR + the app relay) and the
		// suite's relay on the real network.
		if (host === appHost || host === relayHost) {
			ws.connectToServer()
			return
		}
		stubbed.add(url.replace(/\/+$/, ''))
		ws.onMessage((message) => {
			const data = typeof message === 'string' ? message : message.toString()
			try {
				const msg = JSON.parse(data)
				if (msg[0] === 'REQ') ws.send(JSON.stringify(['EOSE', msg[1]]))
				if (msg[0] === 'EVENT') ws.send(JSON.stringify(['OK', msg[1].id, true, '']))
				if (msg[0] === 'CLOSE') return
			} catch {
				/* non-JSON frame — ignore */
			}
		})
	})
	return () => Array.from(stubbed)
}

/** Fresh, unauthenticated context state (terms pre-accepted, as the other auth specs do). */
async function seedFreshContext(context: BrowserContext) {
	await context.addInitScript(() => {
		localStorage.setItem('plebeian_terms_accepted', 'true')
	})
}

/**
 * Test isolation: product images point at a remote CDN that is not reachable
 * from the test host. Serve the local placeholder instead so a broken CDN does
 * not masquerade as "console errors during login".
 */
async function stubExternalImages(context: BrowserContext) {
	await context.route('**/*', async (route) => {
		const request = route.request()
		const url = request.url()
		const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)
		if (request.resourceType() === 'image' && !isLocal) {
			await route.fulfill({
				path: 'public/images/Plebeian_Logo_OpenGraph.png',
				contentType: 'image/png',
			})
			return
		}
		await route.continue()
	})
}

/** Open the login dialog from the header (same dance as e2e/tests/auth.spec.ts). */
async function openLoginDialog(page: Page) {
	await expect(page.locator('header')).toBeVisible({ timeout: 15_000 })

	const overlay = page.locator('[data-slot="dialog-overlay"]')
	if ((await overlay.count()) > 0) {
		await overlay.first().click({ position: { x: 10, y: 10 } })
	}
	await expect(overlay).toHaveCount(0, { timeout: 15_000 })

	const loginButton = page.locator('[data-testid="login-button"]').first()
	await expect(loginButton).toBeVisible({ timeout: 10_000 })
	await loginButton.click()
	await expect(page.locator('[data-testid="login-dialog"]')).toBeVisible({ timeout: 15_000 })
}

/** Navigate the open login dialog to N-Connect → QR Code. */
async function openQrLane(page: Page) {
	await page.locator('[data-testid="connect-tab"]').click()
	await page.locator('[data-testid="qr-tab"]').click()
}

/** The `relay` query param of an emitted `nostrconnect://` URI. */
function relayParamOf(nostrconnectUri: string): string | null {
	const asHttp = nostrconnectUri.replace(/^nostrconnect:\/\//, 'http://')
	return new URL(asHttp).searchParams.get('relay')
}

/** `wss://host/path` -> `host/path` — exactly what the Select renders as the option label. */
function relayLabel(relayUrl: string): string {
	return relayUrl.replace(/^wss?:\/\//, '').replace(/\/+$/, '')
}

/**
 * Matcher for the Select trigger's rendered value.
 *
 * The trigger CSS uppercases its text (`RELAY.PLEBEIAN.MARKET`), and `innerText`
 * vs `textContent` differ, so match case-insensitively on the scheme-stripped
 * label — that is what `nip46RelayOptions()` produces as `label`.
 */
function relayMatcher(relayUrl: string): RegExp {
	const escaped = relayLabel(relayUrl).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	return new RegExp(`^\\s*${escaped}\\s*$`, 'i')
}

// ─── Tests ──────────────────────────────────────────────────

test.describe('Authentication', () => {
	test.describe('NIP-46 Nostr Connect login (PR #1363 / #1371)', () => {
		test('QR lane defaults to the server-advertised /api/config.nip46Relay', async ({ recorded }) => {
			test.setTimeout(120_000)
			const { context, page } = recorded

			await seedFreshContext(context)
			// The sentinel relay is deliberately unresolvable; stub every
			// socket except the app's own relay so the DNS failure does not
			// masquerade as app breakage.
			await stubThirdPartyRelays(context)

			// Stub the config read with a sentinel. This is the ONLY input the QR
			// lane has for its default relay; a regression to "hardcoded
			// DEFAULT_NIP46_RELAYS[0]" renders a different label and fails below.
			let servedConfig: Record<string, unknown> | null = null
			await context.route('**/api/config', async (route) => {
				const response = await route.fetch()
				servedConfig = (await response.json()) as Record<string, unknown>
				await route.fulfill({
					response,
					json: { ...servedConfig, nip46Relay: SENTINEL_NIP46_RELAY },
				})
			})

			await page.goto('/')
			await page.waitForLoadState('domcontentloaded')
			await openLoginDialog(page)
			await openQrLane(page)

			// The app must not be in setup mode, otherwise the lane is unreachable.
			await expect(page).not.toHaveURL(/\/setup/)
			expect(servedConfig, 'config read was not intercepted').not.toBeNull()

			// (1) the CLOSED trigger already renders the server relay
			await expect(page.locator(SELECT_VALUE)).toHaveText(relayMatcher(SENTINEL_NIP46_RELAY))

			// (2) and it is the CHECKED option in the open list
			await page.locator('[role="combobox"]').click()
			await expect(page.locator('[role="option"][data-state="checked"]')).toHaveText(relayMatcher(SENTINEL_NIP46_RELAY))
			await page.keyboard.press('Escape')

			// (3) the emitted URI carries the same relay — this is the value a
			// real signer would dial.
			const urlInput = page.locator('input[readonly]')
			await expect(urlInput).toBeVisible({ timeout: 15_000 })
			const uri = await urlInput.inputValue()
			expect(uri).toContain('nostrconnect://')
			expect(relayParamOf(uri)).toBe(SENTINEL_NIP46_RELAY)
		})

		test('a user can log in over the advertised NIP-46 relay and use the app', async ({ recorded }) => {
			test.setTimeout(180_000)
			const { context, page } = recorded
			const consoleErrors = collectConsoleErrors(page)
			const relayTraffic = trackRelayFrames(page)

			await seedFreshContext(context)
			await stubExternalImages(context)
			// Hermetic: only the app origin and the suite relay reach the network.
			const stubbedRelays = await stubThirdPartyRelays(context)

			// Seeding writes to the relay, so it is only ever done against the
			// suite's own relay. A foreign (preview) relay is not ours to seed,
			// and the relay-backed-read assertion below tolerates an empty feed.
			if (!TARGETS_EXTERNAL_APP) {
				await ensureScenario('marketplace')
			}

			const mock = new Nip46Mock(devUser2.sk)
			try {
				// The relay the server actually advertises right now (NOT stubbed).
				const configResponse = await page.request.get('/api/config')
				expect(configResponse.ok(), `GET /api/config -> ${configResponse.status()}`).toBe(true)
				const config = (await configResponse.json()) as { nip46Relay?: string; needsSetup?: boolean }
				console.log(`\n  app under test: ${BASE_URL}`)
				console.log(`  /api/config.nip46Relay = ${config.nip46Relay}`)
				expect(config.needsSetup, 'app is still in setup mode — no login lane to test').toBe(false)
				expect(config.nip46Relay, '/api/config did not advertise a NIP-46 relay').toBeTruthy()
				const advertisedRelay = config.nip46Relay!

				await page.goto('/')
				await page.waitForLoadState('domcontentloaded')

				// (0) the shell renders and is NOT the setup wizard
				await expect(page).not.toHaveURL(/\/setup/)

				// (1) THE ASSERTION THE REVIEWER SAID EXISTED NOWHERE, at the
				// environment's own value: the QR lane's default advertised relay
				// equals /api/config.nip46Relay. No picker interaction.
				await openLoginDialog(page)
				await openQrLane(page)
				await expect(page.locator(SELECT_VALUE)).toHaveText(relayMatcher(advertisedRelay))

				let urlInput = page.locator('input[readonly]')
				await expect(urlInput).toBeVisible({ timeout: 15_000 })
				let uri = await urlInput.inputValue()
				expect(uri).toContain('nostrconnect://')
				// (2) the emitted URI carries the advertised relay — the value a
				// real signer dials.
				expect(relayParamOf(uri), 'the nostrconnect URI did not advertise the config relay').toBe(advertisedRelay)

				// (3) THE HANDSHAKE. `Nip46Mock.respondToConnect()` dials
				// `parsed.relays[0]` from the URI above, so the login can only
				// complete if the app advertised that relay AND wrote its
				// kind-24133 response there.
				//
				// The suite may only *witness* a handshake over a relay it
				// controls — writing to an unrelated public relay from a test run
				// would be a hidden external dependency (and relays differ in
				// whether they accept kind-24133 writes at all). When the
				// advertised relay is not the suite relay, the config read is
				// re-pointed at the suite relay and the substitution is logged;
				// the un-stubbed assertion above already proves the derivation.
				let loginRelay = advertisedRelay
				if (advertisedRelay !== RELAY_URL) {
					console.log(
						`  NOTE: advertised relay ${advertisedRelay} is not the suite relay ${RELAY_URL};` +
							' re-pointing the config read at the suite relay for the handshake leg',
					)
					await context.route('**/api/config', async (route) => {
						const response = await route.fetch()
						const body = (await response.json()) as Record<string, unknown>
						await route.fulfill({ response, json: { ...body, nip46Relay: RELAY_URL } })
					})
					loginRelay = RELAY_URL

					// Re-enter the lane so the app re-derives from the re-pointed config.
					await page.goto('/')
					await page.waitForLoadState('domcontentloaded')
					await openLoginDialog(page)
					await openQrLane(page)
					await expect(page.locator(SELECT_VALUE)).toHaveText(relayMatcher(loginRelay))
					urlInput = page.locator('input[readonly]')
					await expect(urlInput).toBeVisible({ timeout: 15_000 })
					uri = await urlInput.inputValue()
					expect(relayParamOf(uri)).toBe(loginRelay)
				}
				console.log(`  login handshake relay = ${loginRelay}`)

				await mock.respondToConnect(uri)
				await expect(page.locator('[data-testid="dashboard-button"]').first()).toBeVisible({
					timeout: 45_000,
				})
				console.log('  authenticated: dashboard-button visible')

				// (4) the app is USABLE after login
				await expect(page).not.toHaveURL(/\/setup/)

				const frames = relayTraffic()
				console.log(`  relay sockets: ${frames.relayUrls.join(', ')} (sent=${frames.sent}, received=${frames.received})`)
				console.log(`  third-party relay sockets stubbed: ${stubbedRelays().join(', ') || '(none)'}`)
				expect(frames.relayUrls, 'the app opened no relay WebSocket').not.toHaveLength(0)
				expect(frames.received, 'no relay frame was ever received — no relay-backed read happened').toBeGreaterThan(0)

				// A relay-backed read on `/` must reach a terminal state. On the
				// seeded stack that is a rendered product card; on a foreign relay
				// (which this suite must not seed) an empty feed is the terminal
				// result and is reported as such — it still proves the read
				// completed rather than hanging or erroring.
				await page.goto('/')
				const productCard = page.locator('[data-testid="product-card"]').first()
				const emptyFeed = page.getByText('No products found', { exact: false }).first()
				const firstProduct = await productCard
					.waitFor({ state: 'visible', timeout: 45_000 })
					.then(() => true)
					.catch(() => false)
				if (firstProduct) {
					console.log('  relay-backed read on /: product-card rendered')
					await expect(productCard).toBeVisible()
				} else {
					console.log('  relay-backed read on /: empty feed (no seeded products on this relay)')
					await expect(emptyFeed).toBeVisible({ timeout: 15_000 })
				}

				// (5) no console errors anywhere in the flow
				expect(consoleErrors, `console errors during login flow:\n${consoleErrors.map((e) => `    ${e}`).join('\n')}`).toEqual([])
			} finally {
				// Always surface what the app logged, so a failure is
				// self-explaining instead of just "element not found".
				console.log(
					consoleErrors.length
						? `  app console errors (verbatim):\n${consoleErrors.map((e) => `    ${e}`).join('\n')}`
						: '  app console errors: none',
				)
				mock.close()
			}
		})
	})
})
