import { defaultRelaysUrls } from '@/lib/constants'
import { ndkStore } from '@/lib/stores/ndk'

// Simple in-memory cache for NIP-11 capability lookups
const nip11Cache = new Map<string, { supports50: boolean; checkedAt: number }>()
const ONE_HOUR_MS = 60 * 60 * 1000

function normalizeRelayUrl(url: string): string {
	if (!url) return url
	// Ensure ws/wss prefix
	if (url.startsWith('ws://') || url.startsWith('wss://')) return url
	return `wss://${url}`
}

function toHttpUrl(relayUrl: string): string | null {
	try {
		const u = new URL(relayUrl)
		// Convert ws(s) to http(s)
		if (u.protocol === 'wss:') u.protocol = 'https:'
		else if (u.protocol === 'ws:') u.protocol = 'http:'
		return u.toString()
	} catch {
		return null
	}
}

async function fetchWithTimeout(resource: string, options: RequestInit = {}, timeout = 5000): Promise<Response> {
	const controller = new AbortController()
	const id = setTimeout(() => controller.abort(), timeout)
	try {
		const res = await fetch(resource, { ...options, signal: controller.signal })
		return res
	} finally {
		clearTimeout(id)
	}
}

export async function relaySupportsNip50(relayUrl: string): Promise<boolean> {
	const url = normalizeRelayUrl(relayUrl)
	const cached = nip11Cache.get(url)
	if (cached && Date.now() - cached.checkedAt < ONE_HOUR_MS) return cached.supports50

	const httpUrl = toHttpUrl(url)
	if (!httpUrl) {
		nip11Cache.set(url, { supports50: false, checkedAt: Date.now() })
		return false
	}

	try {
		const res = await fetchWithTimeout(
			httpUrl,
			{
				headers: { Accept: 'application/nostr+json' },
			},
			6000,
		)
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		const info = await res.json().catch(() => ({}))
		const nips: number[] | undefined = info?.supported_nips
		const supports = Array.isArray(nips) ? nips.includes(50) : false
		nip11Cache.set(url, { supports50: supports, checkedAt: Date.now() })
		return supports
	} catch (e) {
		// Network errors: cache negative briefly to avoid hammering
		nip11Cache.set(url, { supports50: false, checkedAt: Date.now() })
		return false
	}
}

/**
 * Discover relays that claim NIP-50 search support via NIP-11 relay info.
 * Uses:
 * - currently configured explicit relays from NDK store
 * - defaultRelaysUrls as seeds
 * - optional extra seed relays passed in
 */
export async function discoverNip50Relays(extraSeeds: string[] = []): Promise<string[]> {
	const state = ndkStore.state
	const configured = state?.explicitRelayUrls ?? []
	const candidates = Array.from(new Set([...defaultRelaysUrls, ...configured, ...extraSeeds].map(normalizeRelayUrl)))

	const results = await Promise.all(candidates.map(async (url) => ({ url, ok: await relaySupportsNip50(url) })))
	return results.filter((r) => r.ok).map((r) => r.url)
}
