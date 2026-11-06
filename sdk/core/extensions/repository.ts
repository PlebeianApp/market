import type { NostrEventLike } from '../nostr/eventLike'
import { verifyNostrEvent } from '../nostr/eventValidation'
import { sha256Hex } from '../nostr/nip98'

/**
 * Extension repository (ADR-0023 §7.2). A curator publishes a NIP-51 follow set (kind 30000) whose `d` tag is
 * `plebeian-extension-registry` and whose `p` tags are ContextVM server pubkeys. Entries are described by the
 * servers' own ContextVM announcements. No new event kind is introduced.
 */
export const EXTENSION_REGISTRY_LIST_KIND = 30000
export const EXTENSION_REGISTRY_D_TAG = 'plebeian-extension-registry'
/** ContextVM announcement kinds, mirrored here so the SDK does not depend on `@contextvm/sdk`. */
export const CONTEXTVM_SERVER_ANNOUNCEMENT_KIND = 11316
export const CONTEXTVM_TOOLS_LIST_KIND = 11317

const HEX_PUBKEY = /^[0-9a-f]{64}$/
const MAX_SERVERS_PER_REGISTRY = 200
const MAX_TOOLS = 100
const MAX_TEXT = 300
const MAX_NAME = 100

export interface RepositoryTool {
	name: string
	title?: string
	description?: string
	/** Top-level input property names, for display only. */
	inputFields: readonly string[]
	/** sha256 of the canonical JSON of the announced `inputSchema`; remote bindings pin this (ADR-0023 §7.5). */
	inputSchemaHash: string
	/** CEP-8 price from a `cap` tag, as advertised (untrusted display text). */
	price?: { amount: string; unit: string }
}

/**
 * `listed`: a valid server announcement was found. `unavailable`: a registry lists the server, but no valid
 * announcement was found on the operator's relays; `problem` says which constraint failed.
 */
export type RepositoryEntryState = 'listed' | 'unavailable'

export interface RepositoryExtensionEntry {
	serverPubkey: string
	/** Curator pubkeys whose registry lists this server. */
	listedBy: readonly string[]
	/** Added directly by an admin of this instance by pubkey (ADR-0023 §7.2). */
	sideloaded: boolean
	state: RepositoryEntryState
	name: string
	about?: string
	website?: string
	picture?: string
	version?: string
	tools: readonly RepositoryTool[]
	/** True if any tool advertises a price; paid tools are not installable (ADR-0023 §7.2). */
	paid: boolean
	encrypted: boolean
	announcedAt?: number
	problem?: string
}

export interface RepositorySnapshot {
	curators: readonly string[]
	relays: readonly string[]
	/** Server pubkeys sideloaded by admins of this instance. */
	sideloaded: readonly string[]
	entries: readonly RepositoryExtensionEntry[]
	/** Curators with no valid registry list on the operator's relays. */
	missingRegistries: readonly string[]
	fetchedAt: number
	/** Set when relays could not be queried; entries may then be stale or empty. */
	problem?: string
}

/** Server pubkeys from a curator's registry list; `undefined` if the event is not a valid list by that curator. */
export function parseRegistryList(event: unknown, curatorPubkey: string): string[] | undefined {
	const verified = verifyNostrEvent(event)
	if (!verified.ok) return undefined
	const list = verified.value
	if (list.kind !== EXTENSION_REGISTRY_LIST_KIND || list.pubkey !== curatorPubkey) return undefined
	if (!list.tags.some((tag) => tag[0] === 'd' && tag[1] === EXTENSION_REGISTRY_D_TAG)) return undefined
	const servers = new Set<string>()
	for (const tag of list.tags) {
		if (tag[0] === 'p' && typeof tag[1] === 'string' && HEX_PUBKEY.test(tag[1])) servers.add(tag[1])
		if (servers.size >= MAX_SERVERS_PER_REGISTRY) break
	}
	return [...servers]
}

interface ParsedAnnouncement {
	name?: string
	about?: string
	website?: string
	picture?: string
	version?: string
	encrypted: boolean
	createdAt: number
}

export function parseServerAnnouncement(event: unknown): { pubkey: string; value: ParsedAnnouncement } | { problem: string } {
	const verified = verifyNostrEvent(event)
	if (!verified.ok) return { problem: 'Announcement signature is invalid' }
	const announcement = verified.value
	if (announcement.kind !== CONTEXTVM_SERVER_ANNOUNCEMENT_KIND) return { problem: 'Not a ContextVM server announcement' }
	const content = parseJsonObject(announcement.content)
	if (!content) return { problem: 'Announcement content is not a JSON object' }
	const serverInfo = isRecord(content.serverInfo) ? content.serverInfo : {}
	const tag = (name: string) => announcement.tags.find((item) => item[0] === name)?.[1]
	return {
		pubkey: announcement.pubkey,
		value: {
			name: text(tag('name'), MAX_NAME) ?? text(serverInfo.name, MAX_NAME),
			about: text(tag('about'), MAX_TEXT),
			website: httpsUrl(tag('website')),
			picture: httpsUrl(tag('picture')),
			version: text(serverInfo.version, 40),
			encrypted: announcement.tags.some((item) => item[0] === 'support_encryption'),
			createdAt: announcement.created_at,
		},
	}
}

export function parseToolsList(event: unknown): { pubkey: string; tools: RepositoryTool[]; createdAt: number } | { problem: string } {
	const verified = verifyNostrEvent(event)
	if (!verified.ok) return { problem: 'Tool list signature is invalid' }
	const list = verified.value
	if (list.kind !== CONTEXTVM_TOOLS_LIST_KIND) return { problem: 'Not a ContextVM tool list' }
	const content = parseJsonObject(list.content)
	if (!content || !Array.isArray(content.tools)) return { problem: 'Tool list content has no tools array' }

	const prices = new Map<string, { amount: string; unit: string }>()
	for (const tag of list.tags) {
		if (tag[0] !== 'cap' || typeof tag[1] !== 'string' || !tag[1].startsWith('tool:')) continue
		const amount = text(tag[2], 40)
		const unit = text(tag[3], 20)
		if (amount && unit) prices.set(tag[1].slice('tool:'.length), { amount, unit })
	}

	const tools: RepositoryTool[] = []
	const seen = new Set<string>()
	for (const raw of content.tools.slice(0, MAX_TOOLS)) {
		if (!isRecord(raw)) continue
		const name = text(raw.name, MAX_NAME)
		if (!name || seen.has(name)) continue
		seen.add(name)
		const properties = isRecord(raw.inputSchema) && isRecord(raw.inputSchema.properties) ? Object.keys(raw.inputSchema.properties) : []
		const inputSchemaHash = hashInputSchema(raw.inputSchema)
		const price = prices.get(name)
		tools.push({
			name,
			...(text(raw.title, MAX_NAME) ? { title: text(raw.title, MAX_NAME) } : {}),
			...(text(raw.description, MAX_TEXT) ? { description: text(raw.description, MAX_TEXT) } : {}),
			inputFields: properties.slice(0, 20).map((field) => field.slice(0, 60)),
			inputSchemaHash,
			...(price ? { price } : {}),
		})
	}
	return { pubkey: list.pubkey, tools, createdAt: list.created_at }
}

export interface BuildRepositoryParams {
	curators: readonly string[]
	relays: readonly string[]
	/** Untrusted events from the operator's relays. */
	registryEvents: readonly NostrEventLike[]
	announcementEvents: readonly NostrEventLike[]
	/** Server pubkeys added directly by admins; shown even if no registry lists them. */
	sideloaded?: readonly string[]
	nowMs: number
}

/** Server pubkeys listed by the given curators, using each curator's newest valid registry list. */
export function collectRegistryServers(curators: readonly string[], registryEvents: readonly NostrEventLike[]) {
	const listedBy = new Map<string, string[]>()
	const missingRegistries: string[] = []
	for (const curator of curators) {
		const newest = newestValid(registryEvents, (event) => parseRegistryList(event, curator))
		if (!newest) {
			missingRegistries.push(curator)
			continue
		}
		for (const server of newest) listedBy.set(server, [...(listedBy.get(server) ?? []), curator])
	}
	return { listedBy, missingRegistries }
}

/** Pure: builds repository entries from registry lists and announcements. Unlisted servers are ignored. */
export function buildRepositorySnapshot(params: BuildRepositoryParams): RepositorySnapshot {
	const { listedBy, missingRegistries } = collectRegistryServers(params.curators, params.registryEvents)
	const sideloaded = [...new Set((params.sideloaded ?? []).filter((pubkey) => HEX_PUBKEY.test(pubkey)))]
	for (const pubkey of sideloaded) if (!listedBy.has(pubkey)) listedBy.set(pubkey, [])

	const entries: RepositoryExtensionEntry[] = []
	for (const [serverPubkey, curators] of listedBy) {
		const isSideloaded = sideloaded.includes(serverPubkey)
		const own = params.announcementEvents.filter((event) => event.pubkey === serverPubkey)
		const announcement = newestValid(own, (event) => {
			const parsed = parseServerAnnouncement(event)
			return 'value' in parsed && parsed.pubkey === serverPubkey ? parsed.value : undefined
		})
		const toolList = newestValid(own, (event) => {
			const parsed = parseToolsList(event)
			return 'tools' in parsed && parsed.pubkey === serverPubkey ? parsed : undefined
		})
		const tools = toolList?.tools ?? []

		if (!announcement) {
			entries.push({
				serverPubkey,
				listedBy: curators,
				sideloaded: isSideloaded,
				state: 'unavailable',
				name: `${serverPubkey.slice(0, 8)}…`,
				tools,
				paid: tools.some((tool) => tool.price),
				encrypted: false,
				problem: own.some((event) => event.kind === CONTEXTVM_SERVER_ANNOUNCEMENT_KIND)
					? 'Server announcement found but it failed validation'
					: 'No server announcement found on the configured relays',
			})
			continue
		}

		entries.push({
			serverPubkey,
			listedBy: curators,
			sideloaded: isSideloaded,
			state: 'listed',
			name: announcement.name ?? `${serverPubkey.slice(0, 8)}…`,
			...(announcement.about ? { about: announcement.about } : {}),
			...(announcement.website ? { website: announcement.website } : {}),
			...(announcement.picture ? { picture: announcement.picture } : {}),
			...(announcement.version ? { version: announcement.version } : {}),
			tools,
			paid: tools.some((tool) => tool.price),
			encrypted: announcement.encrypted,
			announcedAt: announcement.createdAt,
		})
	}

	entries.sort((a, b) => Number(b.state === 'listed') - Number(a.state === 'listed') || a.name.localeCompare(b.name))
	return { curators: [...params.curators], relays: [...params.relays], sideloaded, entries, missingRegistries, fetchedAt: params.nowMs }
}

/** Parses an untrusted repository snapshot from the catalog response. Malformed entries are dropped. */
export function parseRepositorySnapshot(input: unknown): RepositorySnapshot | undefined {
	if (!isRecord(input)) return undefined
	const curators = hexList(input.curators)
	const missingRegistries = hexList(input.missingRegistries)
	const relays = Array.isArray(input.relays)
		? input.relays.filter((relay): relay is string => typeof relay === 'string' && /^wss?:\/\//.test(relay))
		: []
	if (!Array.isArray(input.entries) || typeof input.fetchedAt !== 'number') return undefined
	const entries = input.entries.flatMap((raw) => {
		const entry = parseEntry(raw)
		return entry ? [entry] : []
	})
	const problem = text(input.problem, MAX_TEXT)
	const sideloaded = hexList(input.sideloaded)
	return { curators, relays, sideloaded, entries, missingRegistries, fetchedAt: input.fetchedAt, ...(problem ? { problem } : {}) }
}

function parseEntry(raw: unknown): RepositoryExtensionEntry | undefined {
	if (!isRecord(raw) || typeof raw.serverPubkey !== 'string' || !HEX_PUBKEY.test(raw.serverPubkey)) return undefined
	if (raw.state !== 'listed' && raw.state !== 'unavailable') return undefined
	const name = text(raw.name, MAX_NAME)
	if (!name) return undefined
	const tools = Array.isArray(raw.tools)
		? raw.tools.slice(0, MAX_TOOLS).flatMap((tool): RepositoryTool[] => {
				if (!isRecord(tool) || !text(tool.name, MAX_NAME)) return []
				const price = isRecord(tool.price) && text(tool.price.amount, 40) && text(tool.price.unit, 20) ? tool.price : undefined
				return [
					{
						name: text(tool.name, MAX_NAME)!,
						...(text(tool.title, MAX_NAME) ? { title: text(tool.title, MAX_NAME) } : {}),
						...(text(tool.description, MAX_TEXT) ? { description: text(tool.description, MAX_TEXT) } : {}),
						inputFields: Array.isArray(tool.inputFields)
							? tool.inputFields.filter((field): field is string => typeof field === 'string').slice(0, 20)
							: [],
						inputSchemaHash:
							typeof tool.inputSchemaHash === 'string' && /^[0-9a-f]{64}$/.test(tool.inputSchemaHash) ? tool.inputSchemaHash : '',
						...(price ? { price: { amount: String(price.amount), unit: String(price.unit) } } : {}),
					},
				]
			})
		: []
	return {
		serverPubkey: raw.serverPubkey,
		listedBy: hexList(raw.listedBy),
		sideloaded: raw.sideloaded === true,
		state: raw.state,
		name,
		...(text(raw.about, MAX_TEXT) ? { about: text(raw.about, MAX_TEXT) } : {}),
		...(httpsUrl(raw.website) ? { website: httpsUrl(raw.website) } : {}),
		...(httpsUrl(raw.picture) ? { picture: httpsUrl(raw.picture) } : {}),
		...(text(raw.version, 40) ? { version: text(raw.version, 40) } : {}),
		tools,
		paid: tools.some((tool) => tool.price),
		encrypted: raw.encrypted === true,
		...(typeof raw.announcedAt === 'number' ? { announcedAt: raw.announcedAt } : {}),
		...(text(raw.problem, MAX_TEXT) ? { problem: text(raw.problem, MAX_TEXT) } : {}),
	}
}

/** Order-independent JSON for hashing: object keys are sorted recursively. */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`
	}
	return JSON.stringify(value ?? null)
}

/** A missing schema hashes like `{}`, so adding an empty schema later is not a change. */
export function hashInputSchema(schema: unknown): string {
	return sha256Hex(canonicalJson(schema === undefined || schema === null ? {} : schema))
}

function newestValid<Value>(events: readonly NostrEventLike[], parse: (event: NostrEventLike) => Value | undefined): Value | undefined {
	const sorted = [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
	for (const event of sorted) {
		const value = parse(event)
		if (value !== undefined) return value
	}
	return undefined
}

function hexList(value: unknown): string[] {
	return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && HEX_PUBKEY.test(item)))] : []
}

/** Plain text, trimmed, control characters removed, and length-capped. */
function text(value: unknown, max: number): string | undefined {
	if (typeof value !== 'string') return undefined
	// eslint-disable-next-line no-control-regex
	const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
	return cleaned ? cleaned.slice(0, max) : undefined
}

/** Only https URLs without credentials are surfaced (links and images in an admin UI). */
function httpsUrl(value: unknown): string | undefined {
	if (typeof value !== 'string' || value.length > 2048) return undefined
	try {
		const url = new URL(value)
		return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined
	} catch {
		return undefined
	}
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(content)
		return isRecord(parsed) ? parsed : undefined
	} catch {
		return undefined
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
