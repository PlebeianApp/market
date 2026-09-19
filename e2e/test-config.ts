import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'

/**
 * Fixed test app private key used by both the Playwright config (for the dev server)
 * and the global setup (for publishing app settings to the relay).
 *
 * This defaults to a valid secp256k1 private key (64 hex chars), but can be
 * overridden for local automation via TEST_APP_PRIVATE_KEY.
 */
export const TEST_APP_PRIVATE_KEY = process.env.TEST_APP_PRIVATE_KEY || 'e2e0000000000000000000000000000000000000000000000000000000000001'

export const TEST_APP_PUBLIC_KEY = getPublicKey(hexToBytes(TEST_APP_PRIVATE_KEY))

/**
 * Relay the suite talks to.
 *
 * Defaults to the local `nak serve` relay that the Playwright config starts
 * (and that CI starts manually) so CI behaviour is unchanged. Override with
 * `E2E_RELAY_URL` to point the same specs at a published preview relay, e.g.
 *
 *   E2E_BASE_URL=https://pr1363.test-market.orangesync.tech \
 *   E2E_RELAY_URL=wss://pr1363.test-market.orangesync.tech/relay \
 *   bun run test:e2e -- e2e/tests/login-nip46-relay.spec.ts --retries=0
 */
export const RELAY_URL = process.env.E2E_RELAY_URL || 'ws://localhost:10547'

// Use a dedicated high port to prevent reusing a production-connected dev server
// and to avoid common local conflicts on more frequently used low ports.
export const TEST_PORT = Number(process.env.E2E_TEST_PORT || 34567)

/**
 * App under test. Defaults to the local dev server started by the Playwright
 * config; override with `E2E_BASE_URL` to run against a deployed preview.
 * When this is not a loopback URL the Playwright config starts no local
 * servers at all (see playwright.config.ts).
 */
export const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${TEST_PORT}`

/** True when the suite targets a non-loopback app (a deployed preview). */
export const TARGETS_EXTERNAL_APP = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/.test(BASE_URL)
