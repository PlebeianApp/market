import { nip19 } from 'nostr-tools'
import { adminError, adminOk, authenticateAdminRequest, parseJsonBody, type AdminAuthDeps } from './adminAuth'
import type { RepositorySnapshot } from '@sdk/core/extensions'
import { prepareBindingRecords } from './bindingRoutes'
import { MAX_ADDED_SERVERS, MAX_BINDINGS, type ExtensionStateStore } from './stateStore'

export interface ServerRouteDeps extends AdminAuthDeps {
	store: () => ExtensionStateStore
	/** Used to pin bindings sent together with an add. */
	getSnapshot: () => Promise<RepositorySnapshot | undefined>
	/** Called after a change so cached repository listings are refreshed. */
	onChange: () => void
}

/** Hex pubkey from a hex string or npub; anything else (nsec, nprofile, garbage) is rejected. */
export function parseServerPubkey(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const trimmed = value.trim()
	if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
	if (!trimmed.startsWith('npub1')) return undefined
	try {
		const decoded = nip19.decode(trimmed)
		return decoded.type === 'npub' ? decoded.data : undefined
	} catch {
		return undefined
	}
}

/**
 * `POST /api/extensions/servers` and `DELETE /api/extensions/servers/:pubkey` (ADR-0023 §7.2, §7.5). Admin-only via
 * NIP-98; non-admins get 404 like the catalog. Adding a server makes its tools bindable; it grants nothing by itself.
 * A server not listed by any trusted registry is a sideload. Removal is refused while bindings remain.
 */
export function createServerHandlers(deps: ServerRouteDeps) {
	const add = async (request: Request): Promise<Response> => {
		const auth = await authenticateAdminRequest(request, deps)
		if (!auth.ok) return auth.response
		const body = parseJsonBody(auth.body) as { server?: unknown; bindings?: unknown } | undefined
		const server = parseServerPubkey(body?.server)
		if (!server) return adminError('invalid_input', 'Enter a server pubkey as 64-character hex or npub')
		const now = Math.floor((deps.nowMs?.() ?? Date.now()) / 1000)
		const record = { pubkey: server, addedBy: auth.pubkey, addedAt: now }

		if (body?.bindings === undefined) {
			const result = deps.store().addServer(record)
			if (result === 'limit_reached') return adminError('invalid_input', `At most ${MAX_ADDED_SERVERS} servers can be added`)
			if (result === 'added') deps.onChange()
			return adminOk({ pubkey: server })
		}

		// Add and accept together: one signed request, stored all or none.
		if (!Array.isArray(body.bindings)) return adminError('invalid_input', 'bindings must be a list')
		const alreadyAdded = new Set(
			deps
				.store()
				.listAddedServers()
				.map((item) => item.pubkey),
		)
		const prepared = await prepareBindingRecords({
			rawRequests: body.bindings,
			labelled: true,
			getSnapshot: deps.getSnapshot,
			isAdded: (pubkey) => pubkey === server || alreadyAdded.has(pubkey),
			createdBy: auth.pubkey,
			createdAt: now,
		})
		if ('error' in prepared) return adminError('invalid_input', prepared.error)
		if (prepared.records.some((binding) => binding.serverPubkey !== server)) {
			return adminError('invalid_input', 'Bindings must belong to the added server')
		}

		const result = deps.store().addServerWithBindings(record, prepared.records)
		if (result.status === 'server_limit_reached') return adminError('invalid_input', `At most ${MAX_ADDED_SERVERS} servers can be added`)
		if (result.status === 'exists') return adminError('invalid_input', `This server already has an action named ${result.actionName}`)
		if (result.status === 'limit_reached') return adminError('invalid_input', `At most ${MAX_BINDINGS} tools can be bound`)
		deps.onChange()
		return adminOk({ pubkey: server, created: prepared.records.length })
	}

	const remove = async (request: Request & { params?: Record<string, string> }): Promise<Response> => {
		const auth = await authenticateAdminRequest(request, deps)
		if (!auth.ok) return auth.response
		const pubkey = parseServerPubkey(request.params?.pubkey)
		if (
			!pubkey ||
			!deps
				.store()
				.listAddedServers()
				.some((record) => record.pubkey === pubkey)
		)
			return adminError('not_found')
		const bound = deps
			.store()
			.listBindings()
			.filter((binding) => binding.serverPubkey === pubkey).length
		if (bound > 0) return adminError('invalid_input', `Remove this server's ${bound === 1 ? 'binding' : `${bound} bindings`} first`)
		deps.store().removeServer(pubkey)
		deps.onChange()
		return adminOk({ pubkey })
	}

	return { add, remove }
}
