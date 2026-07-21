import { getPublicKey } from 'nostr-tools/pure'
import { fetchAppSettings } from '../lib/appSettings'
import { hexToBytes } from 'nostr-tools/utils'

function isValidHexPubkey(value: string): boolean {
	return /^[0-9a-fA-F]{64}$/.test(value)
}

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

/**
 * Resolves the CVM server pubkey using a consistent fallback order
 * (most specific to least specific):
 *
 *   1. Service-specific pubkey (CVM_CURRENCY_SERVER_PUBLIC_KEY / CURRENCY_SERVER_PUBKEY)
 *   2. General CVM pubkey (CVM_SERVER_PUBLIC_KEY / CVM_SERVER_PUBKEY)
 *   3. Derive from CVM private key (CVM_SERVER_KEY)
 *   4. Throw — NO hardcoded fallback
 *
 * Per Franchovy's review on #975: "currency → public → private"
 */
export function resolveCvmServerPubkey(): string {
	const servicePubkey = process.env.CVM_CURRENCY_SERVER_PUBLIC_KEY || process.env.CURRENCY_SERVER_PUBKEY
	if (servicePubkey && isValidHexPubkey(servicePubkey)) return servicePubkey

	const generalPubkey = process.env.CVM_SERVER_PUBLIC_KEY || process.env.CVM_SERVER_PUBKEY
	if (generalPubkey && isValidHexPubkey(generalPubkey)) return generalPubkey

	const privateKey = process.env.CVM_SERVER_KEY
	if (privateKey && isValidHexPubkey(privateKey)) {
		return getPublicKey(hexToBytes(privateKey))
	}

	throw new Error('No CVM server pubkey available. Set CVM_SERVER_PUBLIC_KEY or CVM_SERVER_KEY in your environment.')
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
