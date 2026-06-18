/**
 * E2E test for ContextVM oracle configuration validation.
 *
 * WHY THIS TEST EXISTS:
 *
 * This test catches the CVM_SERVER_KEY misconfiguration at the highest level —
 * by checking what the browser actually receives from /api/config.
 *
 * THE BUG THIS PREVENTS:
 *
 * When CVM_SERVER_KEY in .env is set to the same value as APP_PRIVATE_KEY:
 *
 *   1. Server resolves CVM oracle pubkey → app's own pubkey (wrong!)
 *   2. /api/config returns { cvmServerPubkey: "<app's own pubkey>" }
 *   3. Browser CVM client sends BTC price requests to the app's own pubkey
 *   4. No oracle is listening → every request times out after 5-20 seconds
 *   5. Each product on the page triggers a separate CVM call
 *   6. The flood of failed gift-wrap publishes causes relay rate-limiting
 *      ("you are noting too much" from relay.damus.io)
 *   7. Console fills with hundreds of "ContextVM call timed out" errors
 *   8. App falls back to Yadio for BTC rates (works but slowly)
 *
 * WHAT THIS TEST CHECKS:
 *
 * 1. /api/config endpoint returns a valid cvmServerPubkey (64 hex chars)
 * 2. The cvmServerPubkey is NOT the app's own public key
 * 3. The cvmServerPubkey matches the real ContextVM oracle identity
 *
 * If the self-detection guard in getCvmServerPublicKey() is removed or
 * bypassed, this E2E test will fail because the Playwright dev server
 * starts with APP_PRIVATE_KEY set (via playwright.config.ts) and the
 * default CVM_SERVER_KEY derivation would match the app's own key.
 */

import { test, expect } from '@playwright/test'
import { BASE_URL } from '../test-config'
import { getPublicKey } from 'nostr-tools/pure'
import { TEST_APP_PRIVATE_KEY, TEST_APP_PUBLIC_KEY } from '../test-config'

// The real ContextVM oracle pubkey — the production default.
const CVM_ORACLE_PUBKEY = '29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15'

test.describe('CVM oracle configuration', () => {
	test('/api/config returns cvmServerPubkey that is not the app own key', async ({ request }) => {
		// Fetch the config endpoint that the browser client uses to discover
		// the CVM oracle server's identity.
		const response = await request.get(`${BASE_URL}/api/config`)
		expect(response.ok()).toBeTruthy()

		const config = await response.json()

		// cvmServerPubkey must be present and valid (64 hex chars)
		expect(config.cvmServerPubkey).toBeDefined()
		expect(config.cvmServerPubkey).toMatch(/^[0-9a-f]{64}$/)

		// CRITICAL CHECK: cvmServerPubkey must NOT be the app's own pubkey.
		//
		// If CVM_SERVER_KEY is set to APP_PRIVATE_KEY (or derived from it),
		// the CVM client would send requests to itself. This is the exact
		// misconfiguration that caused the production ContextVM timeout cascade.
		//
		// The test key (TEST_APP_PRIVATE_KEY) derives to TEST_APP_PUBLIC_KEY.
		// If cvmServerPubkey matches TEST_APP_PUBLIC_KEY, the self-detection
		// guard has failed or been removed.
		expect(config.cvmServerPubkey).not.toBe(TEST_APP_PUBLIC_KEY)

		// Verify it's the real oracle pubkey (or at least not the app key)
		expect(config.cvmServerPubkey).toBe(CVM_ORACLE_PUBKEY)
	})

	test('/api/config cvmServerPubkey matches the known ContextVM oracle identity', async ({ request }) => {
		// Additional regression check: the oracle pubkey should be the specific
		// known value for the ContextVM oracle server at relay.contextvm.org.
		// If someone accidentally changes the hardcoded default, this test fails.
		const response = await request.get(`${BASE_URL}/api/config`)
		const config = await response.json()

		expect(config.cvmServerPubkey).toBe(CVM_ORACLE_PUBKEY)
	})

	test('/api/config appPublicKey is different from cvmServerPubkey', async ({ request }) => {
		// Double-check that appPublicKey and cvmServerPubkey are different.
		// They serve different purposes:
		//   - appPublicKey: the app's Nostr identity (signs events, receives DMs)
		//   - cvmServerPubkey: the ContextVM oracle's identity (responds to BTC price requests)
		// If they were the same, the app would be its own oracle — which it isn't.
		const response = await request.get(`${BASE_URL}/api/config`)
		const config = await response.json()

		expect(config.appPublicKey).toBeDefined()
		expect(config.cvmServerPubkey).toBeDefined()
		expect(config.appPublicKey).not.toBe(config.cvmServerPubkey)
	})
})
