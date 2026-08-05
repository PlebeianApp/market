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

export const RELAY_URL = 'ws://localhost:10547'
// Use a dedicated high port to prevent reusing a production-connected dev server
// and to avoid common local conflicts on more frequently used low ports.
export const TEST_PORT = 34567
export const BASE_URL = `http://localhost:${TEST_PORT}`

/**
 * Hermetic test image URL.
 *
 * In CI, the relay process (`nak serve`) runs with `--blossom`, exposing a
 * local Blossom media server on the same port (10547). A test image fixture
 * (`e2e/fixtures/test-image.png`) is seeded to it via `nak blossom upload`
 * and its URL is exported as `TEST_IMAGE_URL` before the tests run — so every
 * image the app fetches during e2e comes from localhost, never an external host
 * (placehold.co). See `docs/plans/pr-trust-pipeline.md` § Step B1.
 *
 * Locally — where no Blossom server is started — this falls back to placehold.co
 * so `bun run test:e2e` keeps working without extra setup.
 */
export const TEST_IMAGE_URL = process.env.TEST_IMAGE_URL || 'https://placehold.co/600x600'
