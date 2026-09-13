/**
 * Vault-unlock rehydration tests (ADR-0008 B-3, signers-api-audit gap 1).
 *
 * `rehydrateNostrConnectSession` is the restore half of the NIP-46 session
 * vault: it immediately re-sends `connect` over the stored relays. The module
 * doc claims the SAME B-2 invariant wrapper (RPC timeouts, pubkey-equality)
 * holds on restore — the capability half does, but the connect RPC itself must
 * be bounded here too, or a silent bunker hangs `unlockVaultedSession` forever
 * with `isAuthenticating` stuck (the unlock prompt's spinner never clears).
 *
 * The transport is a fake `NostrPool`: no network is touched.
 */
import { describe, expect, test } from 'bun:test'
import { Observable } from 'rxjs'
import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from 'nostr-tools/utils'
import { encodeNbunksec } from 'applesauce-signers/helpers'

import { rehydrateNostrConnectSession } from '@/lib/nostr/nostr-connect-session'
import { Nip46RpcTimeoutError } from '@/lib/nostr/nostr-connect-signer'

const CLIENT_SK = '11'.repeat(32)
const REMOTE_SK = '22'.repeat(32)
const remotePk = getPublicKey(hexToBytes(REMOTE_SK))
const RELAY = 'wss://relay.example.com'

const NBUNKSEC = encodeNbunksec({ pubkey: remotePk, local_key: CLIENT_SK, relays: [RELAY], secret: 'hunter2' })

/**
 * A transport whose subscription accepts the REQ and then goes silent, while
 * counting active subscriptions (the Observable teardown fires on
 * unsubscribe) so a leaked connect REQ is observable.
 */
function silentPool() {
	let open = 0
	return {
		opened: () => open,
		subscription: (): Observable<never> =>
			new Observable<never>(() => {
				open++
				return () => {
					open--
				}
			}),
		publish: (): Promise<unknown> => Promise.resolve([]),
	}
}

describe('rehydrate honours the NIP-46 RPC deadline (gap 1)', () => {
	test('a silent bunker rejects with Nip46RpcTimeoutError instead of hanging the unlock', async () => {
		const pool = silentPool()

		await expect(rehydrateNostrConnectSession(NBUNKSEC, { pool: pool as never, rpcTimeoutMs: 25 })).rejects.toThrow(Nip46RpcTimeoutError)

		// Review 5191403562 C: the abandoned connect() must not leave its REQ
		// subscription open on the shared relay pool.
		expect(pool.opened()).toBe(0)
	})
})
