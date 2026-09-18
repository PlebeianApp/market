import { ensureInvoiceNdkConnected } from './ndk'
import { getAppPublicKeyOrThrow } from './runtime'

/**
 * Resolve the app's Lightning identifier (lud16 / lud06) for outgoing zap
 * invoices. Source order:
 *   1. APP_LIGHTNING_ADDRESS / APP_LUD16 / APP_LN_ADDRESS / APP_LIGHTNING_IDENTIFIER env
 *   2. The app pubkey's Nostr profile (fetched, then cached for 5 min).
 */

let cachedAppLightningIdentifier: { value: string; fetchedAtMs: number } | null = null
const APP_LIGHTNING_IDENTIFIER_TTL_MS = 5 * 60 * 1000

export async function getAppLightningIdentifier(): Promise<string> {
	const envValue =
		process.env.APP_LIGHTNING_ADDRESS || process.env.APP_LUD16 || process.env.APP_LN_ADDRESS || process.env.APP_LIGHTNING_IDENTIFIER
	if (envValue && envValue.trim()) return envValue.trim()

	const now = Date.now()
	if (cachedAppLightningIdentifier && now - cachedAppLightningIdentifier.fetchedAtMs < APP_LIGHTNING_IDENTIFIER_TTL_MS) {
		return cachedAppLightningIdentifier.value
	}

	const ndk = await ensureInvoiceNdkConnected()
	const user = ndk.getUser({ pubkey: getAppPublicKeyOrThrow() })
	await user.fetchProfile()

	const identifier = user.profile?.lud16 || user.profile?.lud06
	if (!identifier) {
		throw new Error('App does not have a Lightning Address configured (missing lud16/lud06 on app profile)')
	}

	cachedAppLightningIdentifier = { value: identifier, fetchedAtMs: now }
	return identifier
}
