/**
 * NIP-46 session rehydration from a vaulted nbunksec (ADR-0008 B-3).
 *
 * Rehydration immediately re-sends `connect` over the stored relays, so this
 * factory is only invoked from the unlock prompt (the user just typed the
 * vault passphrase) — never speculatively at boot.
 *
 * The rehydrated signer goes through the SAME B-2 invariant wrapper
 * (`createNostrConnectCapability`) as a fresh login — and the same strict-bind
 * transport: the connect RPC is deadline-bounded here too, so a silent bunker
 * cannot hang `unlockVaultedSession` with `isAuthenticating` stuck (review
 * 5654374915 item 5 / review 5191403562 C).
 */
import { NostrConnectSigner, PrivateKeySigner } from 'applesauce-signers'
import type { NostrPool } from 'applesauce-signers'
import { bytesToHex } from 'nostr-tools/utils'

import {
	createNostrConnectCapability,
	NIP46_PERMISSIONS,
	NIP46_RPC_TIMEOUT_MS,
	strictBindPoolFor,
	withRpcTimeout,
} from './nostr-connect-signer'
import type { NostrConnectBundle } from './nostr-connect-signer'

export interface RehydrateOptions {
	permissions?: string[]
	/** Injected transport (tests). Defaults to the shared relay pool. */
	pool?: NostrPool
	rpcTimeoutMs?: number
}

/**
 * Rehydrate a NIP-46 session from a plaintext nbunksec string (already
 * unwrapped from the vault by the caller) and wrap it in the ADR-0008
 * capability seam. The `connect` RPC is deadline-bounded; a signer whose
 * connect times out is closed before the rejection propagates so the partial
 * restore does not leak its REQ subscription on the shared relay pool.
 *
 * The signer is constructed here rather than through
 * `NostrConnectSigner.fromNbunksec` precisely so the partial signer is in
 * hand on the failure path (fromNbunksec keeps its own reference private).
 */
export async function rehydrateNostrConnectSession(nbunksec: string, options: RehydrateOptions = {}): Promise<NostrConnectBundle> {
	const { remote, clientKey, relays, bunkerSecret } = NostrConnectSigner.parseNbunksec(nbunksec)
	const permissions = options.permissions ?? NIP46_PERMISSIONS
	const timeoutMs = options.rpcTimeoutMs ?? NIP46_RPC_TIMEOUT_MS

	const clientSigner = PrivateKeySigner.fromKey(clientKey)
	const signer = new NostrConnectSigner({
		relays,
		remote,
		signer: clientSigner,
		bunkerSecret,
		// Same transport as a fresh login (shared relay pool behind the
		// strict-bind gate); only tests inject `options.pool`.
		pool: strictBindPoolFor(clientSigner, options.pool),
	})

	try {
		await withRpcTimeout('rehydrate_connect', signer.connect(bunkerSecret, permissions), timeoutMs)
	} catch (error) {
		// close(), not logout(): logout() would send a courtesy Logout RPC to
		// a remote that just proved it is silent, adding a second hang.
		// close() unsubscribes the partial REQ and rejects the pending
		// waitingPromise, so the abandoned connect() settles too.
		try {
			await signer.close()
		} catch {
			// Already closed by connect()'s own failure path — nothing to do.
		}
		throw error
	}

	return {
		signer,
		capability: createNostrConnectCapability(signer, timeoutMs),
		clientKeyHex: bytesToHex(signer.signer.key),
	}
}
