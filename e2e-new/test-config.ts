import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'

/**
 * Fixed test app private key used by both the Playwright config (for the dev server)
 * and the global setup (for publishing app settings to the relay).
 *
 * This must be a valid secp256k1 private key (64 hex chars).
 */
export const TEST_APP_PRIVATE_KEY = 'e2e0000000000000000000000000000000000000000000000000000000000001'

export const TEST_APP_PUBLIC_KEY = getPublicKey(hexToBytes(TEST_APP_PRIVATE_KEY))

export const RELAY_URL = 'ws://localhost:10547'
// Use a dedicated port (3333) to prevent reusing a production-connected dev server.
// Without this, reuseExistingServer would silently use an existing :3000 server
// that may be connected to public relays, leaking test data to production.
export const TEST_PORT = 3333
export const BASE_URL = `http://localhost:${TEST_PORT}`
