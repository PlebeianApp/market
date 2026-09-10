/**
 * NIP-46 session rehydration from a vaulted nbunksec (ADR-0002 B-3).
 *
 * `NostrConnectSigner.fromNbunksec()` immediately re-sends `connect` over
 * its relays, so this factory is only invoked from the unlock prompt (the
 * user just typed the vault passphrase) — never speculatively at boot.
 *
 * The rehydrated signer goes through the SAME B-2 invariant wrapper
 * (`createNostrConnectCapability`) as a fresh login, so RPC timeouts and the
 * signed-event pubkey-equality assertion hold on restore too.
 */
import { NostrConnectSigner } from 'applesauce-signers'
import type { NostrPool } from 'applesauce-signers'
import { bytesToHex } from 'nostr-tools/utils'

import { createNostrConnectCapability, NIP46_PERMISSIONS } from './nostr-connect-signer'
import type { NostrConnectBundle } from './nostr-connect-signer'

export interface RehydrateOptions {
	permissions?: string[]
	/** Injected transport (tests). Defaults to the shared relay pool. */
	pool?: NostrPool
	rpcTimeoutMs?: number
}

/**
 * Rehydrate a NIP-46 session from a plaintext nbunksec string (already
 * unwrapped from the vault by the caller) and wrap it in the ADR-0002
 * capability seam. `NostrConnectSigner.fromNbunksec` performs the connect
 * RPC against the stored remote.
 */
export async function rehydrateNostrConnectSession(nbunksec: string, options: RehydrateOptions = {}): Promise<NostrConnectBundle> {
	const signer = await NostrConnectSigner.fromNbunksec(nbunksec, {
		permissions: options.permissions ?? NIP46_PERMISSIONS,
		pool: options.pool,
	})
	return {
		signer,
		capability: createNostrConnectCapability(signer, options.rpcTimeoutMs),
		clientKeyHex: bytesToHex(signer.signer.key),
	}
}
