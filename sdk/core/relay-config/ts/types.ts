/**
 * types.ts — the vocabulary of the `relay-config` contract.
 *
 * The spec is `../relay-config.md`; this file is the one implementation's spelling of it. It declares
 * `RelayConfigPort` **once** — the port is declared here and imported everywhere else, never re-minted.
 *
 * Three groups of members, and saying which is which is the whole point of the port:
 *
 * - **library-derivable** — `userRead`, `userWrite`, `dmRelays`, `role(...)`. Each is a thin adapter over
 *   `applesauce-core`'s `MailboxesModel` and `applesauce-common`'s relay-list models and validators: the
 *   parsing, the marker rules and the validation are the library's. `adapter.ts` names the vendor surface;
 *   nothing under `ts/` outside `adapter.ts` names a vendor symbol.
 * - **ours** — `instance`, `outboxEnabled`, `dmFallback`, `setWriteRelay`. The library models **another
 *   party's** relay lists; it has no vocabulary for *this app's* relays (app/bug/cvm/zap) or for the
 *   NDK-outbox switch. These are the app's own product rules, carried as data.
 * - **the default layer** — `RelayDefaults`. With no event to derive from (cold store, or a list never
 *   published) the instance roles answer from it. It is injected **as data**, never imported from `src/`
 *   (the SDK boundary forbids escaping `sdk/`, `sdk/boundary.test.ts`).
 *
 * **The port holds no pool and no socket.** Every vendor model it adapts is a **store subscription**
 * (`applesauce-common`'s `models/relay-lists.js:11` — `events.replaceable(...)`). Nothing in this module
 * can dial: there is no relay handle, no `request`, no `subscribe` over a wire, and no vendor pool.
 */
import type { IEventStore } from 'applesauce-core/event-store'
import type { Observable } from 'rxjs'

/**
 * The roles the **library** models, as NIP-51 relay-list events: `10007` search, `10006` blocked,
 * `10012` favorite, `10086` lookup. Each is answered by the library's own model or validator over a
 * seeded event; `undefined` is the library's own answer when the list was never published (O4).
 */
export type RelayRole = 'search' | 'blocked' | 'favorite' | 'lookup'

/**
 * The roles that are **ours**: the app's own relaying taxonomy — the app/main relay, the bug relay, the
 * CVM (currency/auction) relay family, and the dedicated zap-monitoring relays. The library has no
 * concept of any of them; they are the app's configuration, injected through `RelayDefaults`.
 */
export type InstanceRole = 'app' | 'bug' | 'cvm' | 'zap'

/**
 * What to do when a recipient has **no** `10050` (O4, `17.md:77`). `'refuse'` is the default — the DM
 * target is the recipient's `10050` **or nothing**, and no `10002` is ever substituted for it.
 */
export type DmFallback = 'refuse' | 'nip65-read'

/**
 * The one relay configuration port. Declared once, imported, never re-minted.
 *
 * `userRead`/`userWrite` are `MailboxesModel(pubkey)`'s `inboxes`/`outboxes`, renamed at the model
 * boundary (`inboxes → read`, `outboxes → write`); `10050` keeps the word `dm`. `dmRelays` and `role(...)`
 * return `undefined` when the list is absent — the library's own answer, never a substituted `10002`.
 * `instance`, `outboxEnabled`, `dmFallback` and `setWriteRelay` stay ours.
 */
export interface RelayConfigPort {
	/** LIBRARY-DERIVED — `MailboxesModel(pubkey)` → `inboxes` (10002 read-marked), renamed `read`. */
	userRead(pubkey: string): Observable<string[]>
	/** LIBRARY-DERIVED — the same model → `outboxes` (10002 write-marked), renamed `write`. */
	userWrite(pubkey: string): Observable<string[]>
	/** LIBRARY-VALIDATED — the recipient's `10050`; `undefined` when absent (the library's own answer, O4). */
	dmRelays(pubkey: string): Observable<string[] | undefined>
	/** LIBRARY MODELS, ADAPTED — one per role the library models (O1/O3). */
	role(role: RelayRole, pubkey: string): Observable<string[] | undefined>
	/** OURS — the app's own relaying rules; the library has no concept of them. */
	instance(role: InstanceRole): readonly string[]
	/** OURS — the NDK-outbox switch (`src/lib/relay-policy.ts:76` @ `7ad658d4`), carried as data. */
	outboxEnabled(): boolean
	/** OURS — `'refuse'` is the default. */
	dmFallback(): DmFallback
	/** OURS — a CONFIGURATION write, never a directed call: it sets the one relay this app writes to. */
	setWriteRelay(url: string): void
}

/**
 * The store handle the port answers its library-derived roles from: the structural shape of
 * `sdk/core/event-store`'s handle (`modelStore(): IEventStore`, landed in packet 1). Structural, so this
 * module imports **no** sibling module and the handle is whatever satisfies the shape.
 */
export interface RelayStoreHandle {
	modelStore(): IEventStore
}

/**
 * The default layer — the app's instance configuration, carried across the SDK boundary **as data**
 * (the SDK cannot import `src/`). It is the floor the library's derivation stands on: the instance roles
 * answer from it, and `instance('zap')` unions it so that `ZAP_RELAYS` is **never dropped**.
 */
export interface RelayDefaults {
	/**
	 * The app's four slots, one set per role. `zap` is the **dedicated zap-monitoring relays** whose
	 * presence is the rule (`ZAP_RELAYS is never dropped`, `src/lib/relay-policy.ts:131-147` @ `7ad658d4`).
	 */
	readonly instance: Readonly<Record<InstanceRole, readonly string[]>>
	/**
	 * Instance-configured zap relays, if any. **Additive**: they extend `instance.zap`, they never replace
	 * it. An instance set treated as a replacement silently removed the dedicated zap relays from
	 * production monitoring — the exact bug the app's own rule was written to close.
	 */
	readonly instanceZap?: readonly string[]
	/** The NDK-outbox switch, resolved by the app's own stage rule and injected here as a value. */
	readonly outboxEnabled: boolean
	/** The DM fallback policy; `'refuse'` when omitted (the default). */
	readonly dmFallback?: DmFallback
}
