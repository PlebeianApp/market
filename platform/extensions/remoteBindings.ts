import { ApplesauceRelayPool, NostrClientTransport, PrivateKeySigner } from '@contextvm/sdk'
import { Client } from '@modelcontextprotocol/sdk/client'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import {
	ExtensionActionError,
	remoteExtensionId,
	toRemoteActionOutput,
	type ExtensionActionAuth,
	type ExtensionActionRateLimit,
	type PublicExtensionDescriptor,
	type RemoteActionOutput,
	type RemoteBindingView,
	type RepositorySnapshot,
} from '@sdk/core/extensions'
import { failure, type Result } from '@sdk/core/result'
import type { RemoteBindingRecord } from './stateStore'

export const REMOTE_CALL_TIMEOUT_MS = 30_000
/** After a failed call, a binding reports `unreachable` and is not called again for this long. */
export const UNREACHABLE_FOR_MS = 2 * 60_000
/** JSON-RPC error code the MCP client uses for request timeouts. */
const MCP_REQUEST_TIMEOUT = -32001

/** Calls one tool on one ContextVM server. Production uses ContextVM; tests inject a fake. */
export interface RemoteToolCaller {
	callTool(params: { serverPubkey: string; toolName: string; args: Record<string, unknown>; signal: AbortSignal }): Promise<unknown>
	close(): Promise<void>
}

/** Accepts `EXTENSIONS_CLIENT_KEY` as hex or nsec. Without it, a per-process key is generated (servers with allowlists need a stable key). */
export function resolveClientKey(value: string | undefined): { privateKeyHex: string; pubkey: string; ephemeral: boolean } {
	const trimmed = value?.trim()
	let bytes: Uint8Array | undefined
	if (trimmed && /^[0-9a-f]{64}$/i.test(trimmed)) bytes = Uint8Array.from(trimmed.match(/../g)!.map((byte) => parseInt(byte, 16)))
	else if (trimmed?.startsWith('nsec1')) {
		const decoded = nip19.decode(trimmed)
		if (decoded.type === 'nsec') bytes = decoded.data
	}
	if (trimmed && !bytes) throw new Error('EXTENSIONS_CLIENT_KEY must be a 64-character hex secret key or an nsec')
	const ephemeral = !bytes
	const key = bytes ?? generateSecretKey()
	return { privateKeyHex: bytesToHex(key), pubkey: getPublicKey(key), ephemeral }
}

/**
 * ContextVM client for remote bindings, signing with the dedicated instance client key (never the app key).
 * Each server gets its own explicit relay pool: the transport then does no relay discovery beyond the operator's
 * relays, and closing one server's transport (which disconnects its pool for good) cannot break other servers.
 */
export function createContextVmToolCaller(options: {
	privateKeyHex: string
	relays: readonly string[]
	timeoutMs?: number
}): RemoteToolCaller {
	const signer = new PrivateKeySigner(options.privateKeyHex)
	const clients = new Map<string, Promise<{ client: Client; transport: NostrClientTransport }>>()

	const connect = (serverPubkey: string) => {
		let pending = clients.get(serverPubkey)
		if (!pending) {
			pending = (async () => {
				const client = new Client({ name: 'plebeian-market-extensions', version: '1.0.0' })
				const relayHandler = new ApplesauceRelayPool([...options.relays])
				const transport = new NostrClientTransport({ serverPubkey, signer, relayHandler, isStateless: true, logLevel: 'error' })
				await client.connect(transport)
				return { client, transport }
			})()
			clients.set(serverPubkey, pending)
			pending.catch(() => clients.delete(serverPubkey))
		}
		return pending
	}

	return {
		async callTool({ serverPubkey, toolName, args, signal }) {
			try {
				const { client } = await connect(serverPubkey)
				return await client.callTool({ name: toolName, arguments: args }, undefined, {
					signal,
					timeout: options.timeoutMs ?? REMOTE_CALL_TIMEOUT_MS,
				})
			} catch (error) {
				// Drop this server's connection and pool so the next call starts clean; other servers are unaffected.
				const stale = clients.get(serverPubkey)
				clients.delete(serverPubkey)
				void stale?.then(({ transport }) => transport.close()).catch(() => undefined)
				throw error
			}
		},
		async close() {
			const pending = [...clients.values()]
			clients.clear()
			await Promise.allSettled(pending.map(async (entry) => (await entry).transport.close()))
		},
	}
}

/** Derives each binding's state from its pin, the latest repository snapshot, and recent call health. */
export function evaluateBindings(
	records: readonly RemoteBindingRecord[],
	snapshot: RepositorySnapshot | undefined,
	lastFailureAt: ReadonlyMap<string, number>,
	nowMs: number,
): RemoteBindingView[] {
	return records.map((record) => {
		const base = {
			serverPubkey: record.serverPubkey,
			serverName: record.serverName,
			toolName: record.toolName,
			actionName: record.actionName,
			capability: record.capability,
			auth: record.auth,
			rateLimit: { perPubkey: record.perPubkey, windowSeconds: record.windowSeconds },
			enabled: record.enabled,
		}
		const problem = bindingProblem(record, snapshot, lastFailureAt, nowMs)
		const entry = snapshot?.entries.find((item) => item.serverPubkey === record.serverPubkey)
		const serverName = entry?.state === 'listed' ? entry.name : record.serverName
		if (!record.enabled) return { ...base, serverName, state: 'installed_disabled', ...(problem ? { problem: problem.message } : {}) }
		if (problem) return { ...base, serverName, state: problem.state, problem: problem.message }
		return { ...base, serverName, state: 'installed_enabled' }
	})
}

function bindingProblem(
	record: RemoteBindingRecord,
	snapshot: RepositorySnapshot | undefined,
	lastFailureAt: ReadonlyMap<string, number>,
	nowMs: number,
): { state: 'misconfigured' | 'unreachable'; message: string } | undefined {
	if (!snapshot) return { state: 'unreachable', message: 'The repository listing has not been loaded yet' }
	const entry = snapshot.entries.find((item) => item.serverPubkey === record.serverPubkey)
	if (!entry) return { state: 'misconfigured', message: 'The server is no longer listed by a registry or sideloaded' }
	if (entry.state !== 'listed') return { state: 'unreachable', message: entry.problem ?? 'The server has no valid announcement' }
	const tool = entry.tools.find((item) => item.name === record.toolName)
	if (!tool) return { state: 'misconfigured', message: 'The server no longer announces this tool' }
	if (tool.price) return { state: 'misconfigured', message: 'The tool now asks for payment, which is not supported' }
	if (tool.inputSchemaHash !== record.inputSchemaHash) {
		return {
			state: 'misconfigured',
			message: 'The tool definition changed since it was reviewed. Review it and approve the new definition.',
		}
	}
	const failedAt = lastFailureAt.get(record.serverPubkey)
	if (failedAt !== undefined && nowMs - failedAt < UNREACHABLE_FOR_MS)
		return { state: 'unreachable', message: 'The last call to this server failed' }
	return undefined
}

/** Public descriptors for enabled, healthy bindings, one per server, so UI finds them by capability. */
export function describeRemoteBindings(
	views: readonly RemoteBindingView[],
	snapshot: RepositorySnapshot | undefined,
): PublicExtensionDescriptor[] {
	const byServer = new Map<string, RemoteBindingView[]>()
	for (const view of views) {
		if (view.state !== 'installed_enabled') continue
		byServer.set(view.serverPubkey, [...(byServer.get(view.serverPubkey) ?? []), view])
	}
	return [...byServer].map(([serverPubkey, bound]) => {
		const entry = snapshot?.entries.find((item) => item.serverPubkey === serverPubkey)
		return {
			id: remoteExtensionId(serverPubkey),
			version: entry?.version ?? '0.0.0',
			displayName: bound[0].serverName,
			...(entry?.picture ? { icon: entry.picture } : {}),
			capabilities: [...new Set(bound.map((view) => view.capability))],
			config: {},
			actions: bound.map((view) => ({
				name: view.actionName,
				description: `Third-party tool "${view.toolName}" on ${view.serverName}`,
				auth: view.auth,
				rateLimit: { ...view.rateLimit },
				transports: ['http' as const],
			})),
		}
	})
}

export interface RemoteActionTarget {
	auth: ExtensionActionAuth
	rateLimit: ExtensionActionRateLimit
	invoke(args: Record<string, unknown>, signal: AbortSignal): Promise<Result<RemoteActionOutput, ExtensionActionError>>
}

/** Callable target for an enabled, healthy binding; failures are recorded so the binding reports `unreachable`. */
export function createRemoteTarget(
	view: RemoteBindingView,
	caller: RemoteToolCaller,
	recordFailure: (serverPubkey: string) => void,
	recordSuccess: (serverPubkey: string) => void,
): RemoteActionTarget {
	return {
		auth: view.auth,
		rateLimit: view.rateLimit,
		async invoke(args, signal) {
			let result: unknown
			try {
				result = await caller.callTool({ serverPubkey: view.serverPubkey, toolName: view.toolName, args, signal })
			} catch (error) {
				recordFailure(view.serverPubkey)
				const timedOut = signal.aborted || (error as { code?: unknown })?.code === MCP_REQUEST_TIMEOUT
				return failure(new ExtensionActionError(timedOut ? 'upstream_timeout' : 'extension_unavailable'))
			}
			recordSuccess(view.serverPubkey)
			return toRemoteActionOutput(result)
		},
	}
}
