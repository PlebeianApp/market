/**
 * index.ts — the contract entry: `createRelayConfig`, `RelayConfigPort` and the port's types. Exactly the
 * module MD's `contract.exports` and `contract.types`, and nothing else.
 *
 * **What is ours.** The specified contract; the role split (which members are the library's and which are
 * the app's); the default layer **injected as data**; the two switches `outboxEnabled()` / `dmFallback()`;
 * the one configuration write `setWriteRelay()`; and the per-role cap `MAX_READ_POOL = 12` (the app's own
 * token, `market-app/ts/relays.ts:44` @ `7ad658d4`, carried as our rule). The vendor supplies the relay-list
 * models and their parse; not the contract, not the roles, not the switches.
 *
 * **What is not here at all.** A pool, a socket, a relay handle, a store of our own, a cache. Every
 * library-derived member is a subscription on the injected store, so the port cannot dial: `role(...)` reads
 * `SearchRelaysModel` and never opens a connection. That is the property test 4 asserts with a pool spy.
 *
 * **The default layer, and the ZAP rule.** `instance('zap')` is the union of the injected dedicated zap
 * relays, any instance-configured zap relays, and the app's read set — `resolveZapRelays`
 * (`src/lib/relay-policy.ts:131-147` @ `7ad658d4`) reproduced as the SDK rule. `ZAP_RELAYS` is never dropped:
 * an instance zap set is **additive**, never a replacement.
 */
import { map } from 'rxjs'
import { readDmRelays, readMailboxes, readRoleRelays } from './adapter'
import type { DmFallback, InstanceRole, RelayConfigPort, RelayDefaults, RelayStoreHandle } from './types'

/**
 * MAX_READ_POOL — the largest read pool one role may carry, `market-app/ts/relays.ts:44` @ `7ad658d4`,
 * unchanged in value and now **per role**. `role(...)` returns at most this many relays for any role.
 */
const MAX_READ_POOL = 12

/** Insertion-ordered dedupe of relay URLs, so an additive union keeps each relay exactly once. */
function unique(relays: readonly string[]): string[] {
	return Array.from(new Set(relays))
}

/**
 * createRelayConfig — the contract's factory. It wires the port to the injected store handle and the
 * injected default layer and holds **no** pool. `setWriteRelay(url)` records the one relay this app writes
 * to; a subsequent `instance('app')` leads with it (the app's own rule: it writes that address and leads
 * the read with it), otherwise the injected instance slots answer unchanged.
 */
function createRelayConfig(store: RelayStoreHandle, defaults: RelayDefaults): RelayConfigPort {
	// The one piece of mutable state: the app's write relay, set by the one configuration write. It is not a
	// directed call and it dials nothing.
	let writeRelay: string | undefined

	const events = () => store.modelStore()

	const cap = (relays: string[] | undefined): string[] | undefined => (relays === undefined ? undefined : relays.slice(0, MAX_READ_POOL))

	const instance = (role: InstanceRole): readonly string[] => {
		switch (role) {
			case 'app':
				return writeRelay ? [writeRelay] : [...defaults.instance.app]
			case 'bug':
				return [...defaults.instance.bug]
			case 'cvm':
				return [...defaults.instance.cvm]
			case 'zap':
				// Additive, never a replacement: the dedicated zap relays stand, instance zap relays extend
				// them, and the app's read set is unioned on top (`resolveZapRelays`).
				return unique([...defaults.instance.zap, ...(defaults.instanceZap ?? []), ...defaults.instance.app])
		}
	}

	return {
		// `inboxes` is the library's `read`, `outboxes` its `write`; the rename happens here, once.
		userRead: (pubkey) => readMailboxes(events(), pubkey).pipe(map((mailboxes) => mailboxes?.inboxes ?? [])),
		userWrite: (pubkey) => readMailboxes(events(), pubkey).pipe(map((mailboxes) => mailboxes?.outboxes ?? [])),
		// `undefined` when absent — the library's own answer, and no `10002` is substituted for it.
		dmRelays: (pubkey) => readDmRelays(events(), pubkey),
		role: (role, pubkey) => readRoleRelays(events(), role, pubkey).pipe(map(cap)),
		instance,
		outboxEnabled: () => defaults.outboxEnabled,
		dmFallback: (): DmFallback => defaults.dmFallback ?? 'refuse',
		setWriteRelay: (url) => {
			writeRelay = url
		},
	}
}

export { createRelayConfig, MAX_READ_POOL }
export { DM_RELAYS_KIND, LOOKUP_RELAYS_KIND } from './adapter'
export type { Mailboxes } from './adapter'
export type { DmFallback, InstanceRole, RelayConfigPort, RelayDefaults, RelayRole, RelayStoreHandle } from './types'
