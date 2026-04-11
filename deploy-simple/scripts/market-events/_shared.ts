import { mkdir, readdir } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { type Event, type Filter, SimplePool } from 'nostr-tools'
import {
	fetchAppConfig,
	parseStage,
	queryRelay,
	resolveStageTargets,
	type AppConfigResponse,
	type Stage,
	type StageTargets,
	usageAndExit,
} from '../app-settings/_shared'

export type MarketScopeName = 'app-authored' | 'catalog' | 'lists' | 'app-data' | 'orders'

export interface MarketScopeDefinition {
	name: MarketScopeName
	description: string
	filter: Filter
}

export interface MarketBackupScopeSummary {
	name: MarketScopeName
	description: string
	file: string
	count: number
	filter: Filter
}

export interface MarketBackupManifest {
	version: 1
	createdAt: string
	stage: Stage
	apiUrl: string
	relayUrl: string
	appPubkey: string
	totalEvents: number
	allFile: string
	scopes: MarketBackupScopeSummary[]
}

export const ALL_MARKET_SCOPES: MarketScopeName[] = ['app-authored', 'catalog', 'lists', 'app-data', 'orders']

export interface ResolveBackupContextOptions {
	stage: Stage
	apiUrl?: string
	relayUrl?: string
	appPubkey?: string
}

export interface BackupContext {
	stage: Stage
	targets: StageTargets
	appConfig: AppConfigResponse | null
	appPubkey: string
}

export async function resolveBackupContext(options: ResolveBackupContextOptions): Promise<BackupContext> {
	const targets = resolveStageTargets(options.stage, options.apiUrl, options.relayUrl)
	let appConfig: AppConfigResponse | null = null
	let appPubkey = options.appPubkey?.trim()

	if (!appPubkey) {
		appConfig = await fetchAppConfig(targets.apiUrl)
		appPubkey = appConfig.appPublicKey?.trim()
	}

	if (!appPubkey) {
		throw new Error('Unable to resolve app pubkey. Pass --app-pubkey or ensure /api/config returns appPublicKey.')
	}

	return {
		stage: options.stage,
		targets,
		appConfig,
		appPubkey,
	}
}

export function parseScopes(rawValue: string | undefined): MarketScopeName[] {
	if (!rawValue || rawValue.trim() === '' || rawValue === 'all') {
		return [...ALL_MARKET_SCOPES]
	}

	const scopes = rawValue
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean)

	if (scopes.length === 0) {
		throw new Error('No valid scopes provided')
	}

	const invalid = scopes.filter((scope): scope is string => !ALL_MARKET_SCOPES.includes(scope as MarketScopeName))
	if (invalid.length > 0) {
		throw new Error(`Invalid scope(s): ${invalid.join(', ')}. Valid scopes: ${ALL_MARKET_SCOPES.join(', ')}`)
	}

	return scopes as MarketScopeName[]
}

export function createMarketScopes(
	appPubkey: string,
	selectedScopes: MarketScopeName[],
	since?: number,
	until?: number,
): MarketScopeDefinition[] {
	return selectedScopes.map((name) => {
		const definition = baseScopeDefinition(appPubkey, name)
		const filter: Filter = { ...definition.filter }

		if (typeof since === 'number') filter.since = since
		if (typeof until === 'number') filter.until = until

		return {
			...definition,
			filter,
		}
	})
}

function baseScopeDefinition(appPubkey: string, name: MarketScopeName): Omit<MarketScopeDefinition, 'filter'> & { filter: Filter } {
	switch (name) {
		case 'app-authored':
			return {
				name,
				description: 'All events authored by the app pubkey',
				filter: {
					authors: [appPubkey],
				},
			}
		case 'catalog':
			return {
				name,
				description: 'All product and collection events (kinds 30402 and 30405)',
				filter: {
					kinds: [30402, 30405],
				},
			}
		case 'lists':
			return {
				name,
				description: 'All featured/list events using kind 30003',
				filter: {
					kinds: [30003],
				},
			}
		case 'app-data':
			return {
				name,
				description: 'All NIP-78 app-specific data events (kind 30078)',
				filter: {
					kinds: [30078],
				},
			}
		case 'orders':
			return {
				name,
				description: 'All order and payment events (kinds 14, 16, 17)',
				filter: {
					kinds: [14, 16, 17],
				},
			}
	}
}

export async function collectScopeEvents(
	relayUrl: string,
	scopeDefinitions: MarketScopeDefinition[],
	maxWait: number,
): Promise<Array<{ scope: MarketScopeDefinition; events: Event[] }>> {
	const collected = await Promise.all(
		scopeDefinitions.map(async (scope) => ({
			scope,
			events: await queryRelay(relayUrl, scope.filter, maxWait),
		})),
	)

	return collected.map(({ scope, events }) => ({
		scope,
		events: sortEventsAscending(events),
	}))
}

export function dedupeEvents(events: Event[]): Event[] {
	const byId = new Map<string, Event>()

	for (const event of events) {
		byId.set(event.id, event)
	}

	return sortEventsAscending(Array.from(byId.values()))
}

export function sortEventsAscending(events: Event[]): Event[] {
	return [...events].sort((left, right) => {
		const leftCreatedAt = left.created_at ?? 0
		const rightCreatedAt = right.created_at ?? 0
		if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt
		return left.id.localeCompare(right.id)
	})
}

export async function ensureDirectory(path: string): Promise<string> {
	const resolved = resolve(path)
	await mkdir(resolved, { recursive: true })
	return resolved
}

export async function writeNdjsonFile(path: string, events: Event[]): Promise<void> {
	const body = events.map((event) => JSON.stringify(event)).join('\n')
	await Bun.write(path, body.length > 0 ? `${body}\n` : '')
}

export async function writeManifest(path: string, manifest: MarketBackupManifest): Promise<void> {
	await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

export async function loadManifest(dir: string): Promise<MarketBackupManifest | null> {
	const manifestPath = join(dir, 'manifest.json')
	const file = Bun.file(manifestPath)
	if (!(await file.exists())) return null
	return (await file.json()) as MarketBackupManifest
}

export async function listNdjsonFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true })
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith('.ndjson'))
		.map((entry) => join(dir, entry.name))
		.sort((left, right) => basename(left).localeCompare(basename(right)))
}

export async function readEventsFromNdjson(path: string): Promise<Event[]> {
	const text = await Bun.file(path).text()
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)

	return lines.map((line, index) => {
		try {
			const parsed = JSON.parse(line) as Event
			assertEvent(parsed, path, index + 1)
			return parsed
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Failed to parse ${path}:${index + 1}: ${error.message}`)
			}
			throw error
		}
	})
}

function assertEvent(event: Event, path: string, lineNumber: number): void {
	if (!event || typeof event !== 'object') {
		throw new Error(`Expected event object in ${path}:${lineNumber}`)
	}
	if (typeof event.id !== 'string' || typeof event.pubkey !== 'string' || typeof event.sig !== 'string') {
		throw new Error(`Invalid event shape in ${path}:${lineNumber}`)
	}
	if (
		typeof event.kind !== 'number' ||
		typeof event.created_at !== 'number' ||
		!Array.isArray(event.tags) ||
		typeof event.content !== 'string'
	) {
		throw new Error(`Invalid event fields in ${path}:${lineNumber}`)
	}
}

export async function publishEvents(
	relayUrl: string,
	events: Event[],
	ignoreDuplicates: boolean,
): Promise<{ published: number; skippedDuplicates: number; failed: Array<{ eventId: string; reason: string }> }> {
	const pool = new SimplePool()
	let published = 0
	let skippedDuplicates = 0
	const failed: Array<{ eventId: string; reason: string }> = []

	try {
		for (const event of sortEventsAscending(events)) {
			const results = await Promise.allSettled(pool.publish([relayUrl], event))
			const reasons = results
				.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
				.map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)))

			if (reasons.length === 0) {
				published += 1
				continue
			}

			if (ignoreDuplicates && reasons.every(isDuplicateReason)) {
				skippedDuplicates += 1
				continue
			}

			failed.push({
				eventId: event.id,
				reason: reasons.join(' | '),
			})
		}
	} finally {
		pool.close([relayUrl])
	}

	return { published, skippedDuplicates, failed }
}

function isDuplicateReason(reason: string): boolean {
	const normalized = reason.toLowerCase()
	return normalized.includes('duplicate') || normalized.includes('already have') || normalized.includes('already exists')
}

export function resolveOutputDirectory(rawPath: string | undefined, stage: Stage): string {
	if (rawPath && rawPath.trim() !== '') {
		return isAbsolute(rawPath) ? rawPath : resolve(rawPath)
	}

	return resolve(process.cwd(), 'deploy-simple', 'backups', `market-${stage}-${timestampForPath(new Date())}`)
}

export function timestampForPath(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z')
}

export function parseOptionalNumber(value: string | undefined, label: string): number | undefined {
	if (!value) return undefined
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) {
		throw new Error(`Invalid ${label}: ${value}`)
	}
	return parsed
}

export function parseBackupArgs(args: string[]) {
	return parseArgsInternal(args, {
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
		'out-dir': {
			type: 'string',
		},
		scopes: {
			type: 'string',
		},
		'max-wait-ms': {
			type: 'string',
		},
		since: {
			type: 'string',
		},
		until: {
			type: 'string',
		},
		help: {
			type: 'boolean',
			short: 'h',
		},
	})
}

export function parseRestoreArgs(args: string[]) {
	return parseArgsInternal(args, {
		stage: {
			type: 'string',
		},
		'relay-url': {
			type: 'string',
		},
		'in-dir': {
			type: 'string',
		},
		scopes: {
			type: 'string',
		},
		'dry-run': {
			type: 'boolean',
		},
		'ignore-duplicates': {
			type: 'boolean',
		},
		help: {
			type: 'boolean',
			short: 'h',
		},
	})
}

function parseArgsInternal<T extends Record<string, { type: 'string' | 'boolean'; short?: string }>>(args: string[], options: T) {
	return parseArgs({
		args,
		options,
		strict: true,
		allowPositionals: false,
	})
}

export function parseStageOrExit(value: string | undefined): Stage {
	try {
		return parseStage(value)
	} catch (error) {
		usageAndExit(error instanceof Error ? error.message : String(error), 1)
	}
}
