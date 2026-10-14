/**
 * adapter.ts — the **vendor surface, one file**. This is the only file in the module (and the only file in
 * the whole SDK) that names `applesauce-common`. Everything it exposes is a **store subscription**: every
 * model below is `events.replaceable(...)` inside the library, so a read here never dials a relay.
 *
 * What the library does, and what we therefore do not write:
 *
 * - `MailboxesModel` (`applesauce-core/models`) reads the `10002` relay list's `inbox`/`outbox` markers.
 * - `FavoriteRelaysModel` / `SearchRelaysModel` / `BlockedRelaysModel` (`applesauce-common/models`) read
 *   `10012` / `10007` / `10006` and parse their `relay` tags.
 * - `isValidDirectMessageRelaysList` (`applesauce-common/helpers/relay-list`) validates the `10050`, and
 *   `isValidLookupRelayList` validates the `10086`; neither has a model of its own in 6.2.0, so each is a
 *   `replaceable(kind, pubkey)` subscription piped through the library's validator.
 * - `getRelaysFromList` (`applesauce-common/helpers/lists`) parses the `relay` tags — the **library's**
 *   parser. The hand-rolled `parseNip17DmRelays` this architecture exists to delete is not written here.
 *
 * Nothing in this file inspects `src/`, the app, or a host global. The specifier allow-list for `ts/` is
 * `./<module file>`, `applesauce-core[/…]`, `applesauce-common[/…]`, `nostr-tools[/…]`, `rxjs` and
 * `bun:test` (tests only); `evidence/run.sh` diffs it.
 */
import { kinds } from 'applesauce-core/helpers/event'
import type { IEventStore } from 'applesauce-core/event-store'
import { MailboxesModel } from 'applesauce-core/models'
import { LOOKUP_RELAY_LIST_KIND, isValidDirectMessageRelaysList, isValidLookupRelayList } from 'applesauce-common/helpers/relay-list'
import { getRelaysFromList } from 'applesauce-common/helpers/lists'
import { BlockedRelaysModel, FavoriteRelaysModel, SearchRelaysModel } from 'applesauce-common/models'
import { map } from 'rxjs'
import type { Observable } from 'rxjs'
import type { RelayRole } from './types'

/** NIP-17's `10050`, the DM relay list — the recipient's relays to **receive** on. */
export const DM_RELAYS_KIND = kinds.DirectMessageRelaysList
/** NIP-51's `10086`, the indexer / lookup relay list. */
export const LOOKUP_RELAYS_KIND = LOOKUP_RELAY_LIST_KIND

/** The mailbox pair the library parses from a `10002` — `inboxes` is `read`, `outboxes` is `write`. */
export type Mailboxes = { inboxes: string[]; outboxes: string[] }

/**
 * The `10002` mailboxes, via `applesauce-core`'s `MailboxesModel`. `undefined` when no `10002` is in the
 * store — the caller renames the two fields at the model boundary and decides what absence means.
 */
export function readMailboxes(es: IEventStore, pubkey: string): Observable<Mailboxes | undefined> {
	return es.model(MailboxesModel, pubkey) as Observable<Mailboxes | undefined>
}

/**
 * The recipient's `10050`, via the library's validator and its relay-tag parser. `undefined` when the
 * event is absent or is not a valid `10050` — **no** `10002` is substituted (O4, `17.md:77`).
 */
export function readDmRelays(es: IEventStore, pubkey: string): Observable<string[] | undefined> {
	return es
		.replaceable(DM_RELAYS_KIND, pubkey)
		.pipe(map((event) => (event && isValidDirectMessageRelaysList(event) ? getRelaysFromList(event) : undefined)))
}

/**
 * The library-modelled roles, one adapter each. `search`/`blocked`/`favorite` go through the library's own
 * models; `lookup` has no model in 6.2.0, so it is a `10086` subscription validated by the library's
 * `isValidLookupRelayList` and parsed by `getRelaysFromList`. `undefined` when the list is absent.
 */
export function readRoleRelays(es: IEventStore, role: RelayRole, pubkey: string): Observable<string[] | undefined> {
	switch (role) {
		case 'search':
			return es.model(SearchRelaysModel, pubkey) as Observable<string[] | undefined>
		case 'blocked':
			return es.model(BlockedRelaysModel, pubkey) as Observable<string[] | undefined>
		case 'favorite':
			return es.model(FavoriteRelaysModel, pubkey) as Observable<string[] | undefined>
		case 'lookup':
			return es
				.replaceable(LOOKUP_RELAYS_KIND, pubkey)
				.pipe(map((event) => (event && isValidLookupRelayList(event) ? getRelaysFromList(event) : undefined)))
	}
}
