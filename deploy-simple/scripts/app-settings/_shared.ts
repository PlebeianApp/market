import { hexToBytes } from '@noble/hashes/utils'
import { parseArgs } from 'node:util'
import { nip19, SimplePool, type Event, type Filter } from 'nostr-tools'

export type Stage = 'development' | 'staging' | 'production'

export interface StageTargets {
	apiUrl: string
	relayUrl: string
}

export interface AppConfigResponse {
	appRelay?: string
	stage?: Stage
	nip46Relay?: string
	appSettings?: unknown
	appPublicKey?: string
	needsSetup?: boolean
}

export const DEFAULT_STAGE_TARGETS: Record<Stage, StageTargets> = {
	development: {
		apiUrl: 'http://127.0.0.1:3000/api/config',
		relayUrl: 'ws://127.0.0.1:10547',
	},
	staging: {
		apiUrl: 'https://staging.plebeian.market/api/config',
		relayUrl: 'wss://relay.staging.plebeian.market',
	},
	production: {
		apiUrl: 'https://plebeian.market/api/config',
		relayUrl: 'wss://relay.plebeian.market',
	},
}

export const commonOptions = {
	stage: {
		type: 'string',
	},
	'api-url': {
		type: 'string',
	},
	'relay-url': {
		type: 'string',
	},
	'app-pubkey': {
		type: 'string',
	},
	help: {
		type: 'boolean',
		short: 'h',
	},
} as const

export function parseCommonArgs(args: string[]) {
	return parseArgs({
		args,
		options: commonOptions,
		strict: true,
		allowPositionals: false,
	})
}

export function parseStage(value: string | undefined): Stage {
	switch (value) {
		case 'development':
		case 'staging':
		case 'production':
			return value
		default:
			throw new Error(`Invalid --stage value: ${value ?? '(missing)'}`)
	}
}

export function resolveStageTargets(stage: Stage, apiUrl?: string, relayUrl?: string): StageTargets {
	const defaults = DEFAULT_STAGE_TARGETS[stage]
	return {
		apiUrl: apiUrl || defaults.apiUrl,
		relayUrl: relayUrl || defaults.relayUrl,
	}
}

export async function fetchAppConfig(apiUrl: string): Promise<AppConfigResponse> {
	const response = await fetch(apiUrl)
	if (!response.ok) {
		throw new Error(`Failed to fetch ${apiUrl}: ${response.status} ${response.statusText}`)
	}

	return (await response.json()) as AppConfigResponse
}

export async function queryRelay(relayUrl: string, filter: Filter, maxWait = 10_000): Promise<Event[]> {
	const pool = new SimplePool()
	const events: Event[] = []
	const seen = new Set<string>()

	try {
		await new Promise<void>((resolve) => {
			pool.subscribeManyEose([relayUrl], filter, {
				maxWait,
				onevent(event) {
					if (seen.has(event.id)) return
					seen.add(event.id)
					events.push(event)
				},
				onclose() {
					resolve()
				},
			})
		})
	} finally {
		pool.close([relayUrl])
	}

	return events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
}

export async function readJsonFile(path: string): Promise<unknown> {
	return JSON.parse(await Bun.file(path).text())
}

export function parsePrivateKey(input: string): string {
	const trimmed = input.trim()
	if (!trimmed) {
		throw new Error('Missing private key')
	}

	if (/^[0-9a-f]{64}$/i.test(trimmed)) {
		return trimmed.toLowerCase()
	}

	if (trimmed.startsWith('nsec1')) {
		const decoded = nip19.decode(trimmed)
		if (decoded.type !== 'nsec') {
			throw new Error('Expected an nsec private key')
		}
		return Buffer.from(decoded.data).toString('hex')
	}

	throw new Error('Private key must be a 64-char hex key or nsec')
}

export function toSecretKeyBytes(secretKey: string): Uint8Array {
	return hexToBytes(parsePrivateKey(secretKey))
}

export function assertHexPubkey(value: string, label: string): string {
	if (!/^[0-9a-f]{64}$/i.test(value)) {
		throw new Error(`Invalid ${label}: ${value}`)
	}
	return value.toLowerCase()
}

export function parsePubkeyList(raw: unknown, key: 'admins' | 'editors'): string[] {
	const values = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && key in raw ? (raw as Record<string, unknown>)[key] : undefined

	if (!Array.isArray(values)) {
		throw new Error(`Expected ${key} JSON to be an array or an object with "${key}"`)
	}

	return values.map((value, index) => {
		if (typeof value !== 'string') {
			throw new Error(`Invalid ${key}[${index}]: expected string`)
		}
		return assertHexPubkey(value, `${key}[${index}]`)
	})
}

export function latestEvent(events: Event[]): Event | null {
	return events[0] ?? null
}

export function summarizeRoleEvent(event: Event | null, role: 'admins' | 'editors') {
	if (!event) return null
	return {
		id: event.id,
		created_at: event.created_at,
		pubkey: event.pubkey,
		[role]: event.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1]),
	}
}

export function usageAndExit(message: string, exitCode = 0): never {
	console.log(message)
	process.exit(exitCode)
}
