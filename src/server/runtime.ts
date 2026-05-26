import { getPublicKey } from 'nostr-tools/pure'
import { fetchAppSettings } from '../lib/appSettings'

/**
 * Process-level mutable state and environment for the auction issuer / Bun
 * server. Kept in one place so handler modules can read it without each
 * having to know how it's wired up.
 *
 * Set during `initializeAppSettings` (in `./startup.ts`); reading these
 * before init throws.
 */

export const RELAY_URL = process.env.APP_RELAY_URL
export const NIP46_RELAY_URL = process.env.NIP46_RELAY_URL || 'wss://relay.nsec.app'
export const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY
export const PORT = Number(process.env.PORT || 3000)

let APP_PUBLIC_KEY: string | undefined
let CVM_SERVER_PUBKEY: string | undefined
let appSettings: Awaited<ReturnType<typeof fetchAppSettings>> = null
let eventHandlerReady = false

export function getAppPublicKeyOrThrow(): string {
	if (APP_PUBLIC_KEY) return APP_PUBLIC_KEY
	if (!APP_PRIVATE_KEY) throw new Error('Missing APP_PRIVATE_KEY')

	const privateKeyBytes = new Uint8Array(Buffer.from(APP_PRIVATE_KEY, 'hex'))
	APP_PUBLIC_KEY = getPublicKey(privateKeyBytes)
	return APP_PUBLIC_KEY
}

export function setAppPublicKey(value: string): void {
	APP_PUBLIC_KEY = value
}

export const CVM_ORACLE_DEFAULT_PUBKEY = '7b3979f5936f590541eb4f51c2ce3094194d1c57386e706dd05aca98766a7ceb'

/**
 * Pure, testable CVM oracle pubkey resolution logic.
 *
 * WHY THIS EXISTS AS A SEPARATE FUNCTION:
 *
 * The production `getCvmServerPublicKey()` reads env vars and caches the result
 * in a module-level variable. This makes it impossible to test different
 * configurations in the same process (bun:test runs all test files in one
 * process, and the module cache persists across files).
 *
 * By extracting the resolution logic into a pure function with explicit
 * parameters, we can test every code path without env var manipulation or
 * module cache tricks.
 *
 * Priority:
 *   1. explicitPubkey  — CVM_SERVER_PUBKEY env var (operator override)
 *   2. serverKey       — CVM_SERVER_KEY env var (derive pubkey from private key)
 *   3. Hardcoded default — the real ContextVM oracle on relay.contextvm.org
 *
 * **Self-detection guard**: if (2) derives a pubkey that matches the app's own
 * pubkey (from APP_PRIVATE_KEY), the CVM client would send encrypted BTC-price
 * requests *to itself* — no oracle server is listening under that key on any
 * relay, so every request times out after 5-20s and the cascade of failed
 * gift-wrap publishes gets the app rate-limited ("you are noting too much").
 *
 * This happened in production when `.env` had `CVM_SERVER_KEY` set to the same
 * test key as `APP_PRIVATE_KEY`. The guard catches this misconfiguration and
 * falls back to the real oracle pubkey with a loud warning.
 *
 * @returns The resolved pubkey and whether a self-detection warning was emitted.
 */
export function resolveCvmServerPubkey(options: { explicitPubkey?: string; serverKey?: string; appPrivateKey?: string }): {
	pubkey: string
	selfDetected: boolean
} {
	// Priority 1: explicit pubkey override (CVM_SERVER_PUBKEY env var).
	// If the operator explicitly sets this, we trust it — even if it matches
	// the app's own pubkey. They may be running a local CVM oracle under the
	// same key intentionally (e.g., in a test environment with a mock oracle).
	if (options.explicitPubkey) {
		return { pubkey: options.explicitPubkey, selfDetected: false }
	}

	// Priority 2: derive from private key (CVM_SERVER_KEY env var).
	if (options.serverKey && /^[0-9a-fA-F]{64}$/.test(options.serverKey)) {
		const derivedPubkey = getPublicKey(new Uint8Array(Buffer.from(options.serverKey, 'hex')))

		// Self-detection: if CVM_SERVER_KEY derives to the app's own pubkey,
		// the CVM client would talk to itself and every request would timeout.
		//
		// This was a production outage: CVM_SERVER_KEY and APP_PRIVATE_KEY were
		// both set to the test key "0000...0001" in .env. The CVM client sent
		// encrypted BTC price requests to itself on relay.damus.io, causing:
		//   - 19 parallel requests × 5-20s timeouts per page load
		//   - Flood of gift-wrap publishes → "you are noting too much" rate-limit
		//   - All requests fell back to Yadio (slower, no oracle benefits)
		if (options.appPrivateKey) {
			const appPubkey = getPublicKey(new Uint8Array(Buffer.from(options.appPrivateKey, 'hex')))
			if (derivedPubkey === appPubkey) {
				return { pubkey: CVM_ORACLE_DEFAULT_PUBKEY, selfDetected: true }
			}
		}

		return { pubkey: derivedPubkey, selfDetected: false }
	}

	// Priority 3: hardcoded default — the real ContextVM oracle.
	// This is the expected production value when no CVM env vars are set.
	return { pubkey: CVM_ORACLE_DEFAULT_PUBKEY, selfDetected: false }
}

/**
 * Production wrapper: reads env vars, delegates to resolveCvmServerPubkey(),
 * and caches the result in a module-level variable.
 */
export function getCvmServerPublicKey(): string {
	if (CVM_SERVER_PUBKEY) return CVM_SERVER_PUBKEY

	const { pubkey, selfDetected } = resolveCvmServerPubkey({
		explicitPubkey: process.env.CVM_SERVER_PUBKEY,
		serverKey: process.env.CVM_SERVER_KEY,
		appPrivateKey: APP_PRIVATE_KEY,
	})

	if (selfDetected) {
		console.error(
			`[CVM] CVM_SERVER_KEY derives to the app's own pubkey (${pubkey.slice(0, 12)}...). ` +
				`The CVM client would send requests to itself — no oracle would respond. ` +
				`Falling back to the default oracle pubkey (${CVM_ORACLE_DEFAULT_PUBKEY.slice(0, 12)}...). ` +
				`Remove CVM_SERVER_KEY from .env to suppress this warning.`,
		)
	}

	CVM_SERVER_PUBKEY = pubkey
	return CVM_SERVER_PUBKEY
}

export function getAppSettings() {
	return appSettings
}

export function setAppSettings(value: Awaited<ReturnType<typeof fetchAppSettings>>): void {
	appSettings = value
}

export function isEventHandlerReady(): boolean {
	return eventHandlerReady
}

export function setEventHandlerReady(value: boolean): void {
	eventHandlerReady = value
}

/** Determine the deployment stage from APP_STAGE / NODE_ENV. */
export function determineStage(): 'production' | 'staging' | 'development' {
	const explicitStage = process.env.APP_STAGE
	if (explicitStage === 'staging' || explicitStage === 'production' || explicitStage === 'development') {
		return explicitStage
	}

	const env = process.env.NODE_ENV
	if (env === 'staging') return 'staging'
	if (env === 'production') return 'production'
	return 'development'
}
