export const NIP17_DM_RELAY_LIST_KIND = 10050

export type Nip17DmRelayListEvent = {
	id?: string
	kind: number
	pubkey: string
	created_at: number
	tags: string[][]
	content?: string
}

export type Nip17DmRelayListFilter = {
	kinds: [typeof NIP17_DM_RELAY_LIST_KIND]
	authors: [string]
	limit: 1
}

export type Nip17DmRelayListReadyResult = {
	status: 'ready'
	pubkey: string
	event: Nip17DmRelayListEvent
	relays: string[]
}

export type Nip17DmRelayListMissingResult = {
	status: 'missing'
	pubkey: string
	relays: []
}

export type Nip17DmRelayListEmptyResult = {
	status: 'empty'
	pubkey: string
	event: Nip17DmRelayListEvent
	relays: []
}

export type Nip17DmRelayListResult = Nip17DmRelayListReadyResult | Nip17DmRelayListMissingResult | Nip17DmRelayListEmptyResult

export type ResolveNip17RelayTargetsFromEventsParams = {
	recipientPubkey: string
	senderPubkey: string
	recipientEvents: Nip17DmRelayListEvent[]
	senderEvents: Nip17DmRelayListEvent[]
}

export type Nip17RelayTargetsResult = {
	ready: boolean
	recipient: Nip17DmRelayListResult
	sender: Nip17DmRelayListResult
}

export function buildNip17DmRelayListFilter(pubkey: string): Nip17DmRelayListFilter {
	return {
		kinds: [NIP17_DM_RELAY_LIST_KIND],
		authors: [pubkey],
		limit: 1,
	}
}

export function parseNip17DmRelays(event: Pick<Nip17DmRelayListEvent, 'tags'>): string[] {
	const relays: string[] = []
	const seen = new Set<string>()

	for (const tag of event.tags) {
		if (tag[0] !== 'relay') continue

		const relay = normalizeRelayUrl(tag[1])
		if (!relay || seen.has(relay)) continue

		seen.add(relay)
		relays.push(relay)
	}

	return relays
}

export function resolveNip17DmRelayListFromEvents(events: Nip17DmRelayListEvent[], pubkey: string): Nip17DmRelayListResult {
	const event = latestNip17DmRelayListEvent(events, pubkey)

	if (!event) {
		return {
			status: 'missing',
			pubkey,
			relays: [],
		}
	}

	const relays = parseNip17DmRelays(event)

	if (relays.length === 0) {
		return {
			status: 'empty',
			pubkey,
			event,
			relays: [],
		}
	}

	return {
		status: 'ready',
		pubkey,
		event,
		relays,
	}
}

export function resolveNip17RelayTargetsFromEvents(params: ResolveNip17RelayTargetsFromEventsParams): Nip17RelayTargetsResult {
	const recipient = resolveNip17DmRelayListFromEvents(params.recipientEvents, params.recipientPubkey)
	const sender = resolveNip17DmRelayListFromEvents(params.senderEvents, params.senderPubkey)

	return {
		ready: recipient.status === 'ready' && sender.status === 'ready',
		recipient,
		sender,
	}
}

function latestNip17DmRelayListEvent(events: Nip17DmRelayListEvent[], pubkey: string): Nip17DmRelayListEvent | undefined {
	return events
		.filter((event) => event.kind === NIP17_DM_RELAY_LIST_KIND && event.pubkey === pubkey)
		.sort(compareRelayListEventsNewestFirst)[0]
}

function compareRelayListEventsNewestFirst(a: Nip17DmRelayListEvent, b: Nip17DmRelayListEvent): number {
	if (a.created_at !== b.created_at) return b.created_at - a.created_at

	const aId = a.id ?? ''
	const bId = b.id ?? ''
	return bId.localeCompare(aId)
}

function normalizeRelayUrl(value: string | undefined): string | undefined {
	if (!value) return undefined

	try {
		const url = new URL(value.trim())
		if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return undefined
		if (!url.hostname) return undefined
		if (url.username || url.password) return undefined

		url.protocol = url.protocol.toLowerCase()
		url.hostname = url.hostname.toLowerCase()

		const normalized = url.toString()
		if (url.pathname === '/' && !url.search && !url.hash) {
			return normalized.slice(0, -1)
		}

		return normalized
	} catch {
		return undefined
	}
}
