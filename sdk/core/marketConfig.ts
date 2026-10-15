import { failure, success, type Result } from './result'
import { ValidationError } from './errors'

export interface MarketConfig {
	schemaVersion: 'market-config-v1'
	marketId: string
	name?: string
	displayName?: string
	siteUrl?: string
	appRelay?: string
	relayUrls: readonly string[]
	trustedMints?: readonly string[]
	defaultCurrency?: string
}

/** Parse an explicit, versioned relay target list. This function performs no I/O. */
export function parseMarketConfig(input: unknown): Result<MarketConfig, ValidationError> {
	if (!isRecord(input)) return failure(new ValidationError('Market config must be an object'))
	if (input.schemaVersion !== 'market-config-v1') {
		return failure(new ValidationError('Unsupported market config schemaVersion', ['schemaVersion']))
	}
	if (typeof input.marketId !== 'string' || !input.marketId.trim()) {
		return failure(new ValidationError('marketId must be a non-empty string', ['marketId']))
	}
	for (const field of ['name', 'displayName', 'defaultCurrency'] as const) {
		if (input[field] !== undefined && (typeof input[field] !== 'string' || !input[field].trim())) {
			return failure(new ValidationError(`${field} must be a non-empty string when provided`, [field]))
		}
	}
	if (input.siteUrl !== undefined && !isHttpUrl(input.siteUrl)) {
		return failure(new ValidationError('siteUrl must use http or https', ['siteUrl']))
	}
	if (input.appRelay !== undefined && !normalizeRelayUrl(input.appRelay)) {
		return failure(new ValidationError('appRelay must use ws or wss and contain no credentials', ['appRelay']))
	}
	if (!Array.isArray(input.relayUrls) || input.relayUrls.length === 0 || !input.relayUrls.every((url) => typeof url === 'string')) {
		return failure(new ValidationError('relayUrls must contain at least one relay URL', ['relayUrls']))
	}
	if (input.trustedMints !== undefined && (!Array.isArray(input.trustedMints) || !input.trustedMints.every(isHttpUrl))) {
		return failure(new ValidationError('trustedMints must contain only http or https URLs', ['trustedMints']))
	}

	const relayUrls: string[] = []
	for (let index = 0; index < input.relayUrls.length; index++) {
		const normalized = normalizeRelayUrl(input.relayUrls[index] as string)
		if (!normalized) return failure(new ValidationError('Relay URL must use ws or wss and contain no credentials', ['relayUrls', index]))
		if (!relayUrls.includes(normalized)) relayUrls.push(normalized)
	}

	return success({
		schemaVersion: 'market-config-v1',
		marketId: input.marketId.trim(),
		...(typeof input.name === 'string' ? { name: input.name.trim() } : {}),
		...(typeof input.displayName === 'string' ? { displayName: input.displayName.trim() } : {}),
		...(typeof input.siteUrl === 'string' ? { siteUrl: normalizeHttpUrl(input.siteUrl) } : {}),
		...(typeof input.appRelay === 'string' ? { appRelay: normalizeRelayUrl(input.appRelay)! } : {}),
		relayUrls,
		...(Array.isArray(input.trustedMints)
			? { trustedMints: [...new Set(input.trustedMints.map((mint) => normalizeHttpUrl(mint as string)))] }
			: {}),
		...(typeof input.defaultCurrency === 'string' ? { defaultCurrency: input.defaultCurrency.trim() } : {}),
	})
}

function normalizeRelayUrl(value: string): string | undefined {
	try {
		const url = new URL(value.trim())
		if ((url.protocol !== 'ws:' && url.protocol !== 'wss:') || !url.hostname || url.username || url.password) return undefined
		url.protocol = url.protocol.toLowerCase()
		url.hostname = url.hostname.toLowerCase()
		const normalized = url.toString()
		return url.pathname === '/' && !url.search && !url.hash ? normalized.slice(0, -1) : normalized
	} catch {
		return undefined
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpUrl(value: unknown): value is string {
	if (typeof value !== 'string') return false
	try {
		const url = new URL(value.trim())
		return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname && !url.username && !url.password
	} catch {
		return false
	}
}

function normalizeHttpUrl(value: string): string {
	const url = new URL(value.trim())
	url.protocol = url.protocol.toLowerCase()
	url.hostname = url.hostname.toLowerCase()
	return url.toString()
}
