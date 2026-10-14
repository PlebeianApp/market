import { failure, success, type Result } from './result'
import { ValidationError } from './errors'

export interface MarketConfig {
	schemaVersion: 'market-config-v1'
	marketId: string
	relayUrls: readonly string[]
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
	if (!Array.isArray(input.relayUrls) || input.relayUrls.length === 0 || !input.relayUrls.every((url) => typeof url === 'string')) {
		return failure(new ValidationError('relayUrls must contain at least one relay URL', ['relayUrls']))
	}

	const relayUrls: string[] = []
	for (let index = 0; index < input.relayUrls.length; index++) {
		const normalized = normalizeRelayUrl(input.relayUrls[index] as string)
		if (!normalized) return failure(new ValidationError('Relay URL must use ws or wss and contain no credentials', ['relayUrls', index]))
		if (!relayUrls.includes(normalized)) relayUrls.push(normalized)
	}

	return success({ schemaVersion: 'market-config-v1', marketId: input.marketId.trim(), relayUrls })
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
