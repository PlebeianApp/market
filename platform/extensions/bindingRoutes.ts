import { parseRemoteBindingRequest, type RepositorySnapshot } from '@sdk/core/extensions'
import { adminError, adminOk, authenticateAdminRequest, parseJsonBody, type AdminAuthDeps } from './adminAuth'
import { parseServerPubkey } from './serverRoutes'
import { MAX_BINDINGS, type ExtensionStateStore, type RemoteBindingRecord } from './stateStore'

export interface BindingRouteDeps extends AdminAuthDeps {
	store: () => ExtensionStateStore
	/** A fresh repository snapshot; binding and approval pin what the server announces right now. */
	getSnapshot: () => Promise<RepositorySnapshot | undefined>
	onChange: () => void
}

type Params = { params?: Record<string, string> }

export const MAX_BINDING_BATCH = 20

export interface PrepareBindingsParams {
	rawRequests: readonly unknown[]
	/** Prefix errors with the tool name, for batches. */
	labelled: boolean
	getSnapshot: () => Promise<RepositorySnapshot | undefined>
	/** Whether the server counts as added; adding and binding together treats the server being added as added. */
	isAdded: (serverPubkey: string) => boolean
	createdBy: string
	createdAt: number
}

/**
 * Validates binding requests and pins each tool to its currently announced definition. Nothing is stored here, so
 * callers can store the records atomically (all or none).
 */
export async function prepareBindingRecords(
	params: PrepareBindingsParams,
): Promise<{ records: RemoteBindingRecord[] } | { error: string }> {
	if (params.rawRequests.length === 0 || params.rawRequests.length > MAX_BINDING_BATCH) {
		return { error: `Accept between 1 and ${MAX_BINDING_BATCH} bindings at a time` }
	}
	const snapshot = await params.getSnapshot()
	const records: RemoteBindingRecord[] = []
	const seen = new Set<string>()
	for (const raw of params.rawRequests) {
		const toolLabel = raw && typeof raw === 'object' ? String((raw as { toolName?: unknown }).toolName ?? '?').slice(0, 100) : '?'
		const label = params.labelled ? `${toolLabel}: ` : ''
		const parsed = parseRemoteBindingRequest(raw)
		if (!parsed.ok) return { error: `${label}${parsed.error.message}` }
		const binding = parsed.value
		const key = `${binding.serverPubkey}/${binding.actionName}`
		if (seen.has(key)) return { error: `${label}Two bindings use the action name ${binding.actionName}` }
		seen.add(key)

		if (!params.isAdded(binding.serverPubkey)) return { error: `${label}Add this extension to the marketplace before binding its tools` }
		const entry = snapshot?.entries.find((item) => item.serverPubkey === binding.serverPubkey)
		if (!entry || entry.state !== 'listed') return { error: `${label}The server is not listed with a valid announcement` }
		const tool = entry.tools.find((item) => item.name === binding.toolName)
		if (!tool) return { error: `${label}The server does not announce this tool` }
		if (tool.price) return { error: `${label}Paid tools cannot be bound: paying third-party services is not supported` }
		if (!tool.inputSchemaHash) return { error: `${label}The tool definition could not be verified` }

		records.push({
			serverPubkey: binding.serverPubkey,
			toolName: binding.toolName,
			actionName: binding.actionName,
			capability: binding.capability,
			auth: binding.auth,
			perPubkey: binding.rateLimit.perPubkey,
			windowSeconds: binding.rateLimit.windowSeconds,
			inputSchemaHash: tool.inputSchemaHash,
			serverName: entry.name,
			enabled: true,
			createdBy: params.createdBy,
			createdAt: params.createdAt,
		})
	}
	return { records }
}

/**
 * Admin-only remote binding management (ADR-0023 §7.5), NIP-98-authenticated, 404 for non-admins:
 * - `POST /api/extensions/bindings` binds a tool, or `{ bindings: [...] }` all at once (all or none), pinning each
 *   tool's current `inputSchema` hash;
 * - `PATCH /api/extensions/bindings/:server/:action` enables/disables or approves the current definition;
 * - `DELETE /api/extensions/bindings/:server/:action` removes it.
 */
export function createBindingHandlers(deps: BindingRouteDeps) {
	const isAdded = (serverPubkey: string) =>
		deps
			.store()
			.listAddedServers()
			.some((record) => record.pubkey === serverPubkey)

	const findTool = async (serverPubkey: string, toolName: string) => {
		const snapshot = await deps.getSnapshot()
		const entry = snapshot?.entries.find((item) => item.serverPubkey === serverPubkey)
		if (!isAdded(serverPubkey)) return { error: 'Add this extension to the marketplace before binding its tools' } as const
		if (!entry || entry.state !== 'listed') return { error: 'The server is not listed with a valid announcement' } as const
		const tool = entry.tools.find((item) => item.name === toolName)
		if (!tool) return { error: 'The server does not announce this tool' } as const
		if (tool.price) return { error: 'Paid tools cannot be bound: paying third-party services is not supported' } as const
		if (!tool.inputSchemaHash) return { error: 'The tool definition could not be verified' } as const
		return { entry, tool } as const
	}

	const create = async (request: Request): Promise<Response> => {
		const auth = await authenticateAdminRequest(request, deps)
		if (!auth.ok) return auth.response
		const body = parseJsonBody(auth.body)
		const batch = body && typeof body === 'object' && Array.isArray((body as { bindings?: unknown }).bindings)
		const prepared = await prepareBindingRecords({
			rawRequests: batch ? (body as { bindings: unknown[] }).bindings : [body],
			labelled: Boolean(batch),
			getSnapshot: deps.getSnapshot,
			isAdded,
			createdBy: auth.pubkey,
			createdAt: Math.floor((deps.nowMs?.() ?? Date.now()) / 1000),
		})
		if ('error' in prepared) return adminError('invalid_input', prepared.error)
		const { records } = prepared

		const result = deps.store().addBindings(records)
		if (result.status === 'exists') return adminError('invalid_input', `This server already has an action named ${result.actionName}`)
		if (result.status === 'limit_reached') return adminError('invalid_input', `At most ${MAX_BINDINGS} tools can be bound`)
		deps.onChange()
		if (!batch) return adminOk({ serverPubkey: records[0].serverPubkey, actionName: records[0].actionName })
		return adminOk({ created: records.map((record) => ({ serverPubkey: record.serverPubkey, actionName: record.actionName })) })
	}

	const target = (request: Params) => {
		const serverPubkey = parseServerPubkey(request.params?.server)
		const actionName = request.params?.action ?? ''
		const record = serverPubkey
			? deps
					.store()
					.listBindings()
					.find((item) => item.serverPubkey === serverPubkey && item.actionName === actionName)
			: undefined
		return record
	}

	const update = async (request: Request & Params): Promise<Response> => {
		const auth = await authenticateAdminRequest(request, deps)
		if (!auth.ok) return auth.response
		const record = target(request)
		if (!record) return adminError('not_found')
		const change = parseJsonBody(auth.body) as { enabled?: unknown; approveCurrentDefinition?: unknown } | undefined
		if (!change || (typeof change.enabled !== 'boolean' && change.approveCurrentDefinition !== true)) {
			return adminError('invalid_input', 'Nothing to change')
		}

		let inputSchemaHash: string | undefined
		if (change.approveCurrentDefinition === true) {
			const found = await findTool(record.serverPubkey, record.toolName)
			if ('error' in found) return adminError('invalid_input', found.error)
			inputSchemaHash = found.tool.inputSchemaHash
		}
		deps.store().updateBinding(record.serverPubkey, record.actionName, {
			...(typeof change.enabled === 'boolean' ? { enabled: change.enabled } : {}),
			...(inputSchemaHash ? { inputSchemaHash } : {}),
		})
		deps.onChange()
		return adminOk({ serverPubkey: record.serverPubkey, actionName: record.actionName })
	}

	const remove = async (request: Request & Params): Promise<Response> => {
		const auth = await authenticateAdminRequest(request, deps)
		if (!auth.ok) return auth.response
		const record = target(request)
		if (!record || !deps.store().removeBinding(record.serverPubkey, record.actionName)) return adminError('not_found')
		deps.onChange()
		return adminOk({ serverPubkey: record.serverPubkey, actionName: record.actionName })
	}

	return { create, update, remove }
}
