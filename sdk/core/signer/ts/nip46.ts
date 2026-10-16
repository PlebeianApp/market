/**
 * The NIP-46 lanes behind the capability seam — `bunker://` and
 * `nostrconnect://` — harvested from the market's
 * `src/lib/nostr/nostr-connect-signer.ts` and `nostr-connect-session.ts` at
 * `4bc7f8c0`, with two changes, both stated:
 *
 * 1. **the transport is injected.** `defaultPool()` — which reached the market's
 *    own relay adapter (`./io-applesauce`) — is gone; every entry point takes a
 *    {@link TransportPort} and refuses at run time when none was supplied, so
 *    the module carries no hidden dependency on a host's relay layer.
 * 2. **the clock is injected.** `withRpcTimeout` used the global `setTimeout`;
 *    here it takes a {@link ClockPort}, so the module holds no timer of its own.
 *
 * Everything else is the library's behaviour plus the app-side wrappers the
 * library does not provide:
 *
 *  - **strict binding (I1):** the library binds an unknown remote on a bare
 *    `"ack"` OR a secret echo (`result === "ack" || result === connectSecret`).
 *    {@link strictBindPool} gates the client-initiated handshake so a bare `ack`
 *    is dropped and only a validated connect-secret echo binds.
 *  - **pubkey separation (I2):** the remote-signer pubkey stays distinct from
 *    the authenticated identity, which is learned only through `getPublicKey()`.
 *  - **RPC timeout:** `makeRequest` pends forever on a silent remote; every RPC
 *    is bounded and rejects with a lane-specific error instead of hanging.
 *  - **authUrl:** the caller supplies the sink; the module never reaches for a
 *    browser global to display anything.
 *  - **identity (I3):** the signed-event assertion is applied by
 *    {@link bindIdentity} — one implementation, all lanes (#6f4c1c).
 */
import { NostrConnectSigner, PrivateKeySigner } from 'applesauce-signers'
import type { NostrPool } from 'applesauce-signers'
import { bytesToHex } from 'nostr-tools/utils'
import { filter, from, mergeMap } from 'rxjs'

import { withDeadline } from './capability'
import { AuthSinkRequiredError, ClockRequiredError, LaneUnavailableError, Nip46RpcTimeoutError, TransportRequiredError } from './errors'
import type { ClockPort, EventTemplate, NipEncryptionCapability, SignerCapability, SignedEvent, TransportPort } from './types'
import { buildNostrConnectUri } from './uri'
import type { NostrConnectUriMetadata } from './uri'

/** Default deadline for a NIP-46 RPC (sign / encrypt / decrypt). */
/** #179fde — NIP46_RPC_TIMEOUT_MS: the default per-RPC deadline (sign / encrypt / decrypt). */
export const NIP46_RPC_TIMEOUT_MS = 30_000

/**
 * Default deadline for the `connect` / auth-challenge phase. The secretless
 * bunker flow parks `connect` on a human-bound `auth_url` approval, so a 30s RPC
 * deadline would race a human taking longer to approve and leak the
 * subscription. This phase gets a longer budget; per-RPC deadlines stay at
 * {@link NIP46_RPC_TIMEOUT_MS}.
 */
/** #179fde — NIP46_CONNECT_TIMEOUT_MS: the longer connect / auth-challenge deadline, so a human approval is not raced. */
export const NIP46_CONNECT_TIMEOUT_MS = 5 * 60_000

/** NIP-46 permissions requested at connect (get_public_key + sign + nip crypto). */
/** #179fde — NIP46_PERMISSIONS: the permissions requested at connect (get_public_key, sign, nip04/nip44 crypto). */
export const NIP46_PERMISSIONS = ['get_public_key', 'sign_event', 'nip04_encrypt', 'nip04_decrypt', 'nip44_encrypt', 'nip44_decrypt']

/**
 * The transport is required **in behaviour, not in the type**: a lane without an
 * injected pool refuses here, at run time. Making the property required would
 * break the two option bags that default to `{}` and no check in this module can
 * see a type-level break, so the refusal is the enforcement.
 */
/** #179fde — requireTransport: the transport is required in behaviour; a lane without one refuses at run time. */
export function requireTransport(transport: TransportPort | undefined): TransportPort {
	if (!transport) throw new TransportRequiredError()
	return transport
}

/** The clock is required in behaviour for the same reason the transport is. */
/** #179fde — requireClock: the clock is required in behaviour for the same reason the transport is. */
export function requireClock(clock: ClockPort | undefined): ClockPort {
	if (!clock) throw new ClockRequiredError()
	return clock
}

/**
 * Bound an RPC with a deadline. Rejects with a lane-specific
 * {@link Nip46RpcTimeoutError} when the operation does not settle in time;
 * otherwise resolves/rejects with the operation's own outcome. An underlying
 * rejection is never swallowed.
 */
/** #179fde — withRpcTimeout: bound an RPC with the injected deadline; a disarmed timer cannot veto a settled result. */
export function withRpcTimeout<T>(
	clock: ClockPort,
	lane: string,
	operation: Promise<T>,
	timeoutMs: number = NIP46_RPC_TIMEOUT_MS,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const handle = clock.setTimeout(() => reject(new Nip46RpcTimeoutError(lane, timeoutMs)), timeoutMs)
		// The deadline is disarmed *around* the settle, and a misbehaving host clock
		// cannot veto an operation that already met its deadline: the exception from
		// clearTimeout used to escape the callback and leave the promise unsettled,
		// which turned a completed RPC into a user-visible hang.
		const disarm = () => {
			try {
				clock.clearTimeout(handle)
			} catch {
				// Best-effort: a clock that cannot clear its own timer is a port fault,
				// not a reason to discard a result that has already arrived.
			}
		}
		operation.then(
			(value) => {
				disarm()
				resolve(value)
			},
			(error) => {
				disarm()
				reject(error)
			},
		)
	})
}

/**
 * The structural surface of a `NostrConnectSigner` the capability wrapper
 * consumes — structural so a test double does not have to import the class.
 */
/** #cb66c4 — NostrConnectSignerLike: the structural surface the NIP-46 capability wrapper consumes. */
export type NostrConnectSignerLike = {
	getPublicKey(): Promise<string>
	signEvent(template: EventTemplate & { pubkey?: string }): Promise<SignedEvent>
	nip04?: NipEncryptionCapability | undefined
	nip44?: NipEncryptionCapability | undefined
}

/**
 * Classify an inbound kind-24133 event during the unbound phase: is it a bare
 * `"ack"` (no id, no method) that the lax library bind would accept? Only a
 * top-level `{ result: "ack" }` with NO request id is a bare ack — an RPC
 * `connect` response (`{ id, result: "ack" }`) is a different, legitimate path.
 */
async function isBareAckResponse(clientSigner: PrivateKeySigner, event: SignedEvent): Promise<boolean> {
	const content = event.content
	let plaintext: string | null = null
	if (content.includes('?iv=')) {
		try {
			plaintext = await clientSigner.nip04.decrypt(event.pubkey, content)
		} catch {
			plaintext = null
		}
	} else {
		try {
			plaintext = await clientSigner.nip44.decrypt(event.pubkey, content)
		} catch {
			try {
				plaintext = await clientSigner.nip04.decrypt(event.pubkey, content)
			} catch {
				plaintext = null
			}
		}
	}
	if (plaintext == null) return false
	try {
		const parsed = JSON.parse(plaintext) as { result?: unknown; id?: unknown; method?: unknown }
		return parsed.result === 'ack' && parsed.id === undefined && parsed.method === undefined
	} catch {
		return false
	}
}

/**
 * Wrap a transport's subscription so a bare `"ack"` from an unknown remote never
 * reaches the library's lax bind (I1). Every inbound event is decrypted and
 * inspected; a bare ack is dropped, everything else (a secret echo, RPC
 * responses) passes through.
 */
function strictBindPool(clientSigner: PrivateKeySigner, transport: TransportPort): NostrPool {
	return {
		publish: (relays, event) => transport.publish(relays, event),
		subscription: (relays, filters) =>
			from(transport.subscription(relays, filters)).pipe(
				mergeMap(async (item) => {
					if (typeof item === 'string') return item
					if (await isBareAckResponse(clientSigner, item)) return null
					return item
				}),
				filter((item): item is SignedEvent | string => item != null),
			),
	}
}

/** The two environmental dependencies every NIP-46 entry point needs. */
/** #cb66c4 — Nip46Deps: the two environmental dependencies every NIP-46 entry point needs. */
export interface Nip46Deps {
	transport?: TransportPort
	clock?: ClockPort
}

/** #cb66c4 — NostrConnectClientOptions: the inputs a client-initiated lane is built from. */
export interface NostrConnectClientOptions extends Nip46Deps {
	relays: string[]
	/** Local client private key (hex). Generated when omitted. */
	clientKeyHex?: string
	/** Remote signer pubkey (`bunker://` flow). */
	remote?: string
	/** Client-initiated secret (the `secret` in a `nostrconnect://` URI). */
	connectSecret?: string
	/** Bunker authorization secret (`bunker://` flow). */
	bunkerSecret?: string
	/** The sink for an `auth_url` challenge. Without one the lane refuses rather than driving the host. */
	onAuthUrl?: (url: string) => Promise<void>
	/** App metadata carried in the emitted `nostrconnect://` URI. */
	metadata?: NostrConnectUriMetadata
}

/** An `auth_url` arrived and this host supplied no sink for it. */
async function refuseAuthWithoutSink(url: string) {
	throw new AuthSinkRequiredError(
		`The remote signer requires approval at ${url} — this host supplied no auth-URL sink, so nothing opened it`,
	)
}

/** Build a `NostrConnectSigner` whose transport is gated by the strict-bind wrapper. */
/** #cb66c4 — createNostrConnectClient: a client signer whose transport is gated by the strict-bind wrapper (I1). */
export function createNostrConnectClient(options: NostrConnectClientOptions): NostrConnectSigner {
	const clientSigner = options.clientKeyHex ? PrivateKeySigner.fromKey(options.clientKeyHex) : new PrivateKeySigner()
	const transport = requireTransport(options.transport)
	return new NostrConnectSigner({
		relays: options.relays,
		remote: options.remote,
		signer: clientSigner,
		connectSecret: options.connectSecret,
		bunkerSecret: options.bunkerSecret,
		onAuth: options.onAuthUrl ?? refuseAuthWithoutSink,
		pool: strictBindPool(clientSigner, transport),
	})
}

/** The `nostrconnect://` URI a client-initiated session is approved through (it carries the secret). */
/** #92bb8c — nostrConnectUri: the connect URI a client-initiated session is approved through; it carries the secret. */
export function nostrConnectUri(client: NostrConnectSigner, metadata?: NostrConnectUriMetadata): string {
	const relay = client.relays[0]
	if (!relay) throw new LaneUnavailableError('A nostrconnect:// URI needs at least one relay')
	return buildNostrConnectUri({
		clientPubkey: client.clientPubkey,
		relay,
		secret: client.connectSecret,
		metadata,
	})
}

/** #cb66c4 — NostrConnectBundle: a NIP-46 lane's capability with the session token that is vaulted. */
export interface NostrConnectBundle {
	signer: NostrConnectSigner
	capability: SignerCapability
	/** The local client private key (hex) — secret material; the record that is vaulted. */
	clientKeyHex: string
	/** The session token: bech32 over the client key + the bunker pointer. Encrypted at rest (I5). */
	nbunksec: string
}

/** #cb66c4 — BunkerConnectOptions: the deadlines, permissions and key a bunker:// connect is driven with. */
export interface BunkerConnectOptions extends Nip46Deps {
	/** Local client private key (hex). Generated when omitted. */
	clientKeyHex?: string
	onAuthUrl?: (url: string) => Promise<void>
	rpcTimeoutMs?: number
	connectTimeoutMs?: number
	permissions?: string[]
}

/** Connect to a `bunker://` URI behind the strict-bind transport + RPC deadlines. */
/** #cb66c4 — connectBunkerSigner: parse a bunker:// URI and connect behind the strict bind and the RPC deadlines. */
export async function connectBunkerSigner(bunkerUrl: string, options: BunkerConnectOptions = {}): Promise<NostrConnectBundle> {
	const { remote, relays, bunkerSecret } = NostrConnectSigner.parseBunkerURI(bunkerUrl)
	const clientSigner = options.clientKeyHex ? PrivateKeySigner.fromKey(options.clientKeyHex) : new PrivateKeySigner()
	const transport = requireTransport(options.transport)
	const clock = requireClock(options.clock)
	const signer = new NostrConnectSigner({
		relays,
		remote,
		signer: clientSigner,
		bunkerSecret,
		onAuth: options.onAuthUrl ?? refuseAuthWithoutSink,
		pool: strictBindPool(clientSigner, transport),
	})
	const rpcTimeoutMs = options.rpcTimeoutMs ?? NIP46_RPC_TIMEOUT_MS
	const connectTimeoutMs = options.connectTimeoutMs ?? NIP46_CONNECT_TIMEOUT_MS
	await withRpcTimeout(clock, 'connect', signer.connect(bunkerSecret, options.permissions ?? NIP46_PERMISSIONS), connectTimeoutMs)
	return {
		signer,
		capability: createNostrConnectCapability(signer, { clock, rpcTimeoutMs }),
		clientKeyHex: bytesToHex(clientSigner.key),
		nbunksec: signer.getNbunksec(),
	}
}

/**
 * Wait for a client-initiated (`nostrconnect://`) remote signer to bind — the
 * library's `waitForSigner()` behind a deadline, so an unapproved QR scan ends
 * in a re-login prompt instead of a listener that never settles.
 */
/** #cb66c4 — awaitNostrConnectSigner: wait for the client-initiated remote to bind, behind the connect deadline. */
export async function awaitNostrConnectSigner(
	client: NostrConnectSigner,
	options: Nip46Deps & { rpcTimeoutMs?: number; connectTimeoutMs?: number } = {},
): Promise<NostrConnectBundle> {
	const clock = requireClock(options.clock)
	await withRpcTimeout(clock, 'connect', client.waitForSigner(), options.connectTimeoutMs ?? NIP46_CONNECT_TIMEOUT_MS)
	return {
		signer: client,
		capability: createNostrConnectCapability(client, { clock, rpcTimeoutMs: options.rpcTimeoutMs }),
		clientKeyHex: bytesToHex(client.signer.key),
		nbunksec: client.getNbunksec(),
	}
}

/** #cb66c4 — RehydrateOptions: the permissions, deadline, transport and clock a restore is rebuilt from. */
export interface RehydrateOptions extends Nip46Deps {
	permissions?: string[]
	rpcTimeoutMs?: number
}

/**
 * Rehydrate a NIP-46 session from a plaintext nbunksec string (already unwrapped
 * from the vault by the caller) and wrap it in the capability seam.
 * `NostrConnectSigner.fromNbunksec` performs the connect RPC against the stored
 * remote. The nbunksec pins the remote, so the strict-bind wrapper is not
 * required on restore — the library ignores any event that is not from the
 * pinned remote.
 */
/** #cb66c4 — rehydrateNostrConnectSession: rebuild a NIP-46 session from an nbunksec; the token pins the remote. */
export async function rehydrateNostrConnectSession(nbunksec: string, options: RehydrateOptions = {}): Promise<NostrConnectBundle> {
	const transport = requireTransport(options.transport)
	const clock = requireClock(options.clock)
	const signer = await NostrConnectSigner.fromNbunksec(nbunksec, {
		permissions: options.permissions ?? NIP46_PERMISSIONS,
		pool: transport,
	})
	return {
		signer,
		capability: createNostrConnectCapability(signer, { clock, rpcTimeoutMs: options.rpcTimeoutMs }),
		clientKeyHex: bytesToHex(signer.signer.key),
		nbunksec,
	}
}

/** #cb66c4 — Nip46CapabilityOptions: the injected clock and per-RPC deadline the capability wrapper races against. */
export interface Nip46CapabilityOptions {
	clock?: ClockPort
	rpcTimeoutMs?: number
}

/**
 * Wrap a `NostrConnectSigner` in the capability seam: every RPC bounded by a
 * deadline. The identity assertion (I2/I3) is **not** applied here — it is
 * applied once, by {@link bindIdentity} in the session's attach path, so this
 * module has exactly one implementation of that predicate and every lane goes
 * through it. This function is internal to the implementation, not contract.
 */
/** #cb66c4 — createNostrConnectCapability: the NIP-46 capability seam; identity binding is applied once, elsewhere (I3). */
export function createNostrConnectCapability(signer: NostrConnectSignerLike, options: Nip46CapabilityOptions = {}): SignerCapability {
	const clock = requireClock(options.clock)
	const timeoutMs = options.rpcTimeoutMs ?? NIP46_RPC_TIMEOUT_MS
	const race = <T>(lane: string, operation: Promise<T>, ms: number): Promise<T> => withRpcTimeout(clock, lane, operation, ms)
	return {
		getPublicKey: () => race('get_public_key', signer.getPublicKey(), timeoutMs),
		signEvent: (template) => race('sign_event', signer.signEvent(template as EventTemplate & { pubkey?: string }), timeoutMs),
		nip44: signer.nip44 ? withDeadline(signer.nip44, 'nip44', timeoutMs, race) : undefined,
		nip04: signer.nip04 ? withDeadline(signer.nip04, 'nip04', timeoutMs, race) : undefined,
	}
}
