import { ValidationError } from '../errors'
import { toRawEvent, type NostrEventLike } from '../nostr/eventLike'
import { buildHttpAuthTemplate, encodeHttpAuthHeader } from '../nostr/nip98'
import type { Signer, SignedEventLike } from '../ports/signer'
import { failure, success, type Result } from '../result'
import { describeExtensionActions, ExtensionActionError, type PublicExtensionActionDescriptor } from './actions'
import type { ExtensionActionFetch } from './client'
import { parseExtensionActionResponse } from './client'
import { parsePublicExtensionAction } from './descriptors'
import {
	EXTENSION_RUNTIMES,
	isValidExtensionIcon,
	MAX_DESCRIPTION_LENGTH,
	type AnyExtensionDefinition,
	type ExtensionRuntime,
} from './extension'
import { EXTENSION_HOST_PORTS, parseEgressOrigin, type ExtensionHostPortName } from './hostPorts'
import { parseRepositorySnapshot, type RepositorySnapshot } from './repository'

export const EXTENSION_CATALOG_PATH = '/api/extensions/catalog'

/**
 * Store install states (ADR-0023 §7.3) that the current env-managed runtime can produce. `needs_setup`,
 * `installed_disabled`, and `unreachable` arrive with the settings store and remote bindings.
 */
export const EXTENSION_CATALOG_STATES = ['available', 'installed_enabled', 'misconfigured'] as const
export type ExtensionCatalogState = (typeof EXTENSION_CATALOG_STATES)[number]

/** Who controls an entry's configuration. Only the environment exists today. */
export type ExtensionManagedBy = 'environment'

/** Admin-only store entry. Carries manifest metadata and state, never config values. */
export interface ExtensionCatalogEntry {
	id: string
	version: string
	displayName: string
	icon?: string
	description?: string
	capabilities: readonly string[]
	runtimes: readonly ExtensionRuntime[]
	hostPorts: readonly ExtensionHostPortName[]
	egress: readonly string[]
	actions: readonly PublicExtensionActionDescriptor[]
	hasPrivateConfig: boolean
	state: ExtensionCatalogState
	managedBy: ExtensionManagedBy
	/** Environment variable prefix that configures this extension, e.g. `EXTENSION_FOO_`. */
	envPrefix: string
	/** Safe, admin-facing reason for `misconfigured`. Never contains private values. */
	problem?: string
}

export function describeCatalogEntry(
	definition: AnyExtensionDefinition,
	status: { state: ExtensionCatalogState; envPrefix: string; problem?: string },
): ExtensionCatalogEntry {
	const { manifest } = definition
	return {
		id: manifest.id,
		version: manifest.version,
		displayName: manifest.displayName,
		...(manifest.icon ? { icon: manifest.icon } : {}),
		...(manifest.description ? { description: manifest.description } : {}),
		capabilities: [...manifest.capabilities],
		runtimes: [...manifest.runtimes],
		hostPorts: [...(manifest.hostPorts ?? [])],
		egress: [...(manifest.egress ?? [])],
		actions: describeExtensionActions(definition.actions),
		hasPrivateConfig: Boolean(manifest.privateConfig),
		state: status.state,
		managedBy: 'environment',
		envPrefix: status.envPrefix,
		...(status.problem ? { problem: status.problem.slice(0, 300) } : {}),
	}
}

const EXTENSION_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const CAPABILITY = /^[a-z0-9]+(?:[.:-][a-z0-9]+)*$/
const ENV_PREFIX = /^EXTENSION_[A-Z0-9_]+_$/
const MAX_ENTRIES = 200

/** Store contents: built-ins compiled into this release, plus third-party entries from configured repositories. */
export interface ExtensionCatalog {
	entries: readonly ExtensionCatalogEntry[]
	/** Absent when no repository curators are configured. */
	repository?: RepositorySnapshot
}

/** Parses an untrusted catalog response, including the optional repository snapshot. */
export function parseExtensionCatalogResponse(input: unknown): Result<ExtensionCatalog, ValidationError> {
	const entries = parseExtensionCatalog(input)
	if (!entries.ok) return entries
	const repository = isRecord(input) && input.repository !== undefined ? parseRepositorySnapshot(input.repository) : undefined
	return success({ entries: entries.value, ...(repository ? { repository } : {}) })
}

/** Parses an untrusted catalog response; malformed entries are dropped individually. */
export function parseExtensionCatalog(input: unknown): Result<ExtensionCatalogEntry[], ValidationError> {
	const entries = isRecord(input) ? input.entries : undefined
	if (!Array.isArray(entries)) return failure(new ValidationError('Extension catalog must contain an entries array', ['entries']))
	const seen = new Set<string>()
	const parsed: ExtensionCatalogEntry[] = []
	for (const raw of entries.slice(0, MAX_ENTRIES)) {
		const entry = parseEntry(raw)
		if (!entry || seen.has(entry.id)) continue
		seen.add(entry.id)
		parsed.push(entry)
	}
	return success(parsed)
}

export interface FetchExtensionCatalogOptions {
	baseUrl?: string
	fetch?: ExtensionActionFetch
	signal?: AbortSignal
	now?: () => number
}

/** Admin-only: `GET /api/extensions/catalog` with a NIP-98 header signed by the admin's signer. */
export function fetchExtensionCatalog(
	signer: Signer<SignedEventLike & NostrEventLike>,
	options: FetchExtensionCatalogOptions = {},
): Promise<Result<ExtensionCatalog, ExtensionActionError>> {
	return sendAdminRequest(signer, 'GET', EXTENSION_CATALOG_PATH, undefined, options, {
		parse(value) {
			const catalog = parseExtensionCatalogResponse(value)
			if (!catalog.ok) throw catalog.error
			return catalog.value
		},
	})
}

export const EXTENSION_SIDELOADS_PATH = '/api/extensions/sideloads'

const sideloadResult = {
	parse(value: unknown): { pubkey: string } {
		if (!isRecord(value) || typeof value.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(value.pubkey))
			throw new ValidationError('Invalid sideload response')
		return { pubkey: value.pubkey }
	},
}

/** Admin-only: sideload a ContextVM server by hex pubkey or npub. The server validates and normalizes it. */
export function addSideloadedServer(
	signer: Signer<SignedEventLike & NostrEventLike>,
	server: string,
	options: FetchExtensionCatalogOptions = {},
): Promise<Result<{ pubkey: string }, ExtensionActionError>> {
	return sendAdminRequest(signer, 'POST', EXTENSION_SIDELOADS_PATH, JSON.stringify({ server: server.trim() }), options, sideloadResult)
}

/** Admin-only: remove a sideloaded server. */
export function removeSideloadedServer(
	signer: Signer<SignedEventLike & NostrEventLike>,
	pubkey: string,
	options: FetchExtensionCatalogOptions = {},
): Promise<Result<{ pubkey: string }, ExtensionActionError>> {
	return sendAdminRequest(signer, 'DELETE', `${EXTENSION_SIDELOADS_PATH}/${encodeURIComponent(pubkey)}`, undefined, options, sideloadResult)
}

async function sendAdminRequest<Output>(
	signer: Signer<SignedEventLike & NostrEventLike>,
	method: 'GET' | 'POST' | 'DELETE',
	path: string,
	body: string | undefined,
	options: FetchExtensionCatalogOptions,
	output: { parse(value: unknown): Output },
): Promise<Result<Output, ExtensionActionError>> {
	const baseUrl = options.baseUrl ?? (globalThis as { location?: { origin?: string } }).location?.origin
	if (!baseUrl) return failure(new ExtensionActionError('network_error', 'Extension admin requests require a baseUrl outside the browser'))
	const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as ExtensionActionFetch | undefined)
	if (!fetchImpl) return failure(new ExtensionActionError('network_error', 'No fetch implementation available'))

	const url = new URL(path, baseUrl).toString()
	let authorization: string
	try {
		const createdAt = Math.floor((options.now?.() ?? Date.now()) / 1000)
		authorization = encodeHttpAuthHeader(toRawEvent(await signer.sign(buildHttpAuthTemplate({ url, method, body, createdAt }))))
	} catch (cause) {
		return failure(new ExtensionActionError('unauthorized', 'Could not sign the request', cause))
	}

	let status: number
	let text: string
	try {
		const headers: Record<string, string> = { authorization, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }
		const response = await fetchImpl(url, { method, headers, ...(body !== undefined ? { body } : {}), signal: options.signal })
		status = response.status
		text = await response.text()
	} catch (cause) {
		return failure(new ExtensionActionError('network_error', undefined, cause))
	}

	return parseExtensionActionResponse(status, text, output)
}

function parseEntry(input: unknown): ExtensionCatalogEntry | undefined {
	if (!isRecord(input)) return undefined
	const { id, version, displayName, icon, description, capabilities, runtimes, hostPorts, egress, actions, state, envPrefix, problem } =
		input
	if (typeof id !== 'string' || !EXTENSION_ID.test(id)) return undefined
	if (typeof version !== 'string' || version.length > 64) return undefined
	if (typeof envPrefix !== 'string' || !ENV_PREFIX.test(envPrefix)) return undefined
	if (typeof state !== 'string' || !(EXTENSION_CATALOG_STATES as readonly string[]).includes(state)) return undefined
	if (!isStringArray(capabilities) || !capabilities.every((value) => CAPABILITY.test(value))) return undefined
	if (!isStringArray(runtimes) || !runtimes.every((value) => (EXTENSION_RUNTIMES as readonly string[]).includes(value))) return undefined
	if (!isStringArray(hostPorts) || !hostPorts.every((value) => (EXTENSION_HOST_PORTS as readonly string[]).includes(value)))
		return undefined
	if (!isStringArray(egress) || !egress.every((value) => parseEgressOrigin(value).ok)) return undefined
	const parsedActions = Array.isArray(actions) ? actions.map(parsePublicExtensionAction) : []
	if (parsedActions.some((action) => action === undefined)) return undefined

	return {
		id,
		version,
		displayName: typeof displayName === 'string' && displayName.trim() ? displayName.slice(0, 200) : id,
		...(typeof icon === 'string' && isValidExtensionIcon(icon) ? { icon } : {}),
		...(typeof description === 'string' && description.trim() ? { description: description.slice(0, MAX_DESCRIPTION_LENGTH) } : {}),
		capabilities: [...capabilities],
		runtimes: [...runtimes] as ExtensionRuntime[],
		hostPorts: [...hostPorts] as ExtensionHostPortName[],
		egress: [...egress],
		actions: parsedActions as PublicExtensionActionDescriptor[],
		hasPrivateConfig: input.hasPrivateConfig === true,
		state: state as ExtensionCatalogState,
		managedBy: 'environment',
		envPrefix,
		...(typeof problem === 'string' && problem ? { problem: problem.slice(0, 300) } : {}),
	}
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
