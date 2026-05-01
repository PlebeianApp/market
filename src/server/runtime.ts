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

export function getCvmServerPublicKey(): string {
	if (CVM_SERVER_PUBKEY) return CVM_SERVER_PUBKEY
	if (process.env.CVM_SERVER_PUBKEY) {
		CVM_SERVER_PUBKEY = process.env.CVM_SERVER_PUBKEY
		return CVM_SERVER_PUBKEY
	}
	const serverPrivateKey = process.env.CVM_SERVER_KEY
	if (serverPrivateKey && /^[0-9a-fA-F]{64}$/.test(serverPrivateKey)) {
		CVM_SERVER_PUBKEY = getPublicKey(new Uint8Array(Buffer.from(serverPrivateKey, 'hex')))
		return CVM_SERVER_PUBKEY
	}

	CVM_SERVER_PUBKEY = '29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15'
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
