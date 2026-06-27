import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'

/**
 * Test app private key used by the Playwright config (dev server) and
 * the global setup (publishing app settings to the relay).
 *
 * Both the seed-relay script and the dev server run as separate processes
 * that import this module. They MUST see the same key, so we use a fixed
 * test-only key as the default. Override with TEST_APP_PRIVATE_KEY env
 * var for custom test deployments.
 *
 * This is a well-known test key — not used in production.
 */
export const TEST_APP_PRIVATE_KEY = process.env.TEST_APP_PRIVATE_KEY || 'e2e0000000000000000000000000000000000000000000000000000000000001'

export const TEST_APP_PUBLIC_KEY = getPublicKey(hexToBytes(TEST_APP_PRIVATE_KEY))

export const RELAY_URL = 'ws://localhost:10547'
export const TEST_PORT = 34567
export const BASE_URL = `http://localhost:${TEST_PORT}`
