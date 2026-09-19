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
 * The ContextVM identity the dev server is configured with.
 *
 * Must stay in sync with `CVM_SERVER_KEY` in `playwright.config.ts`: the live
 * activity reader fails closed on any author other than the configured CVM
 * pubkey, so a spec that seeds a kind-30311 activity with a `devUser` key can
 * never be seen by the app — the panel falls back to "Live chat not available"
 * and any assertion on the chat UI would be about that fallback.
 */
export const TEST_CVM_PRIVATE_KEY = process.env.TEST_CVM_PRIVATE_KEY || 'e2e2222222222222222222222222222222222222222222222222222222222222'

export const TEST_CVM_PUBLIC_KEY = getPublicKey(hexToBytes(TEST_CVM_PRIVATE_KEY))

export const RELAY_URL = 'ws://localhost:10547'
// Use a dedicated high port to prevent reusing a production-connected dev server
// and to avoid common local conflicts on more frequently used low ports.
export const TEST_PORT = 34567
export const BASE_URL = `http://localhost:${TEST_PORT}`
