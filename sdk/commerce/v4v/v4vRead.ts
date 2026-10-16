import { nip19 } from 'nostr-tools'
import { pickMostRecentTimestampedEvent } from '../../core/relays/relayListRead'

export const V4V_SHARE_KIND = 30078
export const V4V_SHARE_LABEL = 'v4v_share'
export const V4V_MERCHANTS_LIMIT = 100
export const V4V_DEFAULT_SHARE_PERCENTAGE = 5

export type V4VConfigurationState = 'unknown' | 'never-configured' | 'configured-zero' | 'configured-nonzero'

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type V4VShareFilter = {
	kinds: number[]
	authors?: string[]
	'#l': string[]
	limit?: number
}

/** A parsed zap split entry, before the host resolves a display name for the recipient. */
export interface V4VShareEntry {
	id: string
	pubkey: string
	percentage: number
}

export function buildV4VSharesFilter(pubkey: string): V4VShareFilter {
	return { kinds: [V4V_SHARE_KIND], authors: [pubkey], '#l': [V4V_SHARE_LABEL] }
}

export function buildV4VMerchantsFilter(): V4VShareFilter {
	return { kinds: [V4V_SHARE_KIND], '#l': [V4V_SHARE_LABEL], limit: V4V_MERCHANTS_LIMIT }
}

function padHexString(hex: string): string {
	return hex.length % 2 === 1 ? '0' + hex : hex
}

/** Accepts 60–64 char hex (odd lengths are left-padded) or an npub (optionally with a stray leading `0`). */
export function normalizeAndEncodePubkey(value: string): { pubkey: string; npub: string } | null {
	try {
		if (/^[0-9a-f]{60,64}$/i.test(value)) {
			const paddedHex = padHexString(value)
			return {
				pubkey: paddedHex,
				npub: nip19.npubEncode(paddedHex),
			}
		}

		if (value.startsWith('npub1') || value.startsWith('0npub1')) {
			const cleanValue = value.startsWith('0') ? value.substring(1) : value
			try {
				const { data: hexPubkey } = nip19.decode(cleanValue)
				return {
					pubkey: hexPubkey as string,
					npub: cleanValue,
				}
			} catch (e) {
				console.error('Failed to decode npub:', e)
				return null
			}
		}

		console.error('Unknown pubkey format:', value)
		return null
	} catch (e) {
		console.error('Error processing pubkey:', e, 'for value:', value)
		return null
	}
}

export function pickMostRecentV4VEvent<E extends { created_at?: number }>(events: Iterable<E>): E | null {
	return pickMostRecentTimestampedEvent(events) ?? null
}

export function resolveV4VConfigurationState(event: { content: string } | null | undefined): V4VConfigurationState {
	if (!event) {
		return 'never-configured'
	}

	try {
		const content = JSON.parse(event.content)
		if (!Array.isArray(content)) {
			console.warn('V4V event content is not an array')
			return 'unknown'
		}

		return content.length === 0 ? 'configured-zero' : 'configured-nonzero'
	} catch (error) {
		console.error('Error parsing V4V share content:', error)
		return 'unknown'
	}
}

/**
 * Parses `[['zap', pubkey, percentage], ...]` content. Recipients are deduped by normalized pubkey
 * before the percentage check, and ids are indexed over the deduped list. Throws on invalid JSON.
 */
export function parseV4VShareEntries(content: string): V4VShareEntry[] {
	const parsed = JSON.parse(content)
	if (!Array.isArray(parsed) || parsed.length === 0) {
		return []
	}

	const seenPubkeys = new Set<string>()
	const deduped: Array<{ zapTag: any; pubkey: string }> = []
	for (const zapTag of parsed) {
		if (zapTag[0] === 'zap' && zapTag[1]) {
			const normalized = normalizeAndEncodePubkey(zapTag[1])
			if (normalized && !seenPubkeys.has(normalized.pubkey)) {
				seenPubkeys.add(normalized.pubkey)
				deduped.push({ zapTag, pubkey: normalized.pubkey })
			}
		}
	}

	const entries: V4VShareEntry[] = []
	deduped.forEach(({ zapTag, pubkey }, index) => {
		if (zapTag[2]) {
			entries.push({
				id: `v4v-${index}-${pubkey.substring(0, 8)}`,
				pubkey,
				percentage: parseFloat(zapTag[2]) || V4V_DEFAULT_SHARE_PERCENTAGE,
			})
		}
	})
	return entries
}

/** Non-empty content that yields no usable shares is `unknown`, not `configured-zero`. */
export function resolveParsedV4VState(shareCount: number): V4VConfigurationState {
	return shareCount > 0 ? 'configured-nonzero' : 'unknown'
}

export function collectV4VMerchantPubkeys(events: Iterable<{ pubkey?: string }>): string[] {
	const pubkeySet = new Set<string>()
	for (const event of events) {
		if (event.pubkey) {
			pubkeySet.add(event.pubkey)
		}
	}
	return Array.from(pubkeySet)
}
