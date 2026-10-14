/**
 * relay-config.test.ts — the module's evidence, as tests. Each case states its **break case**: the change
 * that turns it red. Four of them are the packet's named evidence (1–4); the rest cover the port's other
 * contract members that the same gate exercises.
 *
 * Two facts of the library are pinned here rather than hidden, because they are observable in every answer:
 * (a) NIP-51 relay lists (`10007`/`10006`/`10012`/`10086`/`10050`) carry `relay` tags and are parsed by
 * `getRelaysFromList`; NIP-65's `10002` mailboxes carry **`r`** tags with `read`/`write` markers and are
 * parsed by `MailboxesModel`. (b) both parsers normalise a relay URL (a bare host gains its `/`), which is
 * the library's own canonicalisation — the port does not re-spell what the library answered.
 */
import { describe, expect, test } from 'bun:test'
import type { IEventStore } from 'applesauce-core/event-store'
import { createRelayConfig, MAX_READ_POOL } from './index'
import { defaults, handle, identity, newStore, poolSpy, read, relayList, sign } from './harness'

const KINDS = { relayList: 10002, blocked: 10006, search: 10007, favorite: 10012, dm: 10050, lookup: 10086 }

describe('relay-config — the port answers by role, over the library', () => {
	/**
	 * EVIDENCE 1 — `dmRelays` answers from a seeded `10050`, and `undefined` when absent.
	 *
	 * Break case: substitute the recipient's `10002` for a missing `10050` → the `undefined` case fails
	 * (it answers the mailboxes instead) and `17.md:77`'s MUST is violated. Hand-rolling the parse
	 * (`parseNip17DmRelays`) → the greppable-duplication check fails and N4 is broken.
	 */
	test('1 · dmRelays reads a seeded 10050, and is undefined when there is none', async () => {
		const recipient = identity()
		const store = newStore()
		store.add(relayList(KINDS.dm, recipient, ['wss://dm-one.test/', 'wss://dm-two.test/']))
		const port = createRelayConfig(handle(store), defaults())

		expect(await read(port.dmRelays(recipient.pubkey))).toEqual(['wss://dm-one.test/', 'wss://dm-two.test/'])

		// A recipient with a 10002 but NO 10050: the answer is the library's own — `undefined`, not the mailboxes.
		const noDm = identity()
		store.add(sign(KINDS.relayList, noDm, [['r', 'wss://inbox.test/', 'read']]))
		expect(await read(port.dmRelays(noDm.pubkey))).toBeUndefined()
	})

	/**
	 * EVIDENCE 2 — `role('search')` answers from a seeded `10007` through `SearchRelaysModel`.
	 *
	 * Break case: wire the wrong model (or return `undefined` unconditionally) → the seeded search relays
	 * are not returned. This is what proves the model adapters, not just the store subscription.
	 */
	test('2 · role("search") reads a seeded 10007 through the library model', async () => {
		const who = identity()
		const store = newStore()
		store.add(relayList(KINDS.search, who, ['wss://search.test/']))
		const port = createRelayConfig(handle(store), defaults())

		expect(await read(port.role('search', who.pubkey))).toEqual(['wss://search.test/'])
		// The other library-modelled roles are answered by their own models; absent ones are `undefined`.
		expect(await read(port.role('blocked', who.pubkey))).toBeUndefined()
		expect(await read(port.role('favorite', who.pubkey))).toBeUndefined()

		store.add(relayList(KINDS.blocked, who, ['wss://blocked.test/']))
		store.add(relayList(KINDS.favorite, who, ['wss://favorite.test/']))
		store.add(relayList(KINDS.lookup, who, ['wss://lookup.test/']))
		expect(await read(port.role('blocked', who.pubkey))).toEqual(['wss://blocked.test/'])
		expect(await read(port.role('favorite', who.pubkey))).toEqual(['wss://favorite.test/'])
		expect(await read(port.role('lookup', who.pubkey))).toEqual(['wss://lookup.test/'])
	})

	/**
	 * EVIDENCE 3 — `instance('zap')` returns the injected zap defaults, **additively**.
	 *
	 * Break case: treat an instance zap set as a replacement → the injected `ZAP_RELAYS` floor disappears
	 * from the answer and the case fails (the "ZAP_RELAYS is never dropped" rule broken).
	 */
	test('3 · instance("zap") keeps the injected zap relays when an instance zap set is configured', async () => {
		const floor = ['wss://relay.coinos.io/', 'wss://nwc.primal.net/', 'wss://relay.primal.net/']
		const port = createRelayConfig(
			handle(newStore()),
			defaults({
				instance: { app: ['wss://app.test/'], bug: [], cvm: [], zap: floor },
				instanceZap: ['wss://instance-zap.test/'],
			}),
		)
		const zap = port.instance('zap')
		// Additive: every dedicated zap relay survives, and the instance relay is added.
		for (const url of floor) expect(zap).toContain(url)
		expect(zap).toContain('wss://instance-zap.test/')
	})

	/**
	 * EVIDENCE 4 — the port never dials. A pool spy that throws from every method is never touched, while
	 * the read still answers from the store.
	 *
	 * Break case: give the port a pool (or have it dial to fill a role) → the spy throws and the read
	 * rejects, and `calls` is no longer zero.
	 */
	test('4 · a model read touches no pool: every vendor model is a store subscription', async () => {
		const who = identity()
		const store = newStore()
		store.add(relayList(KINDS.search, who, ['wss://search.test/']))
		const spy = poolSpy()
		// The handle carries a dialling `request`/`subscribe` right beside `modelStore()`: if the port ever
		// reaches for a socket, this throws.
		const port = createRelayConfig({ modelStore: () => store, ...spy } as { modelStore(): IEventStore }, defaults())

		expect(await read(port.role('search', who.pubkey))).toEqual(['wss://search.test/'])
		expect(await read(port.dmRelays(who.pubkey))).toBeUndefined()
		expect(spy.calls).toBe(0)
	})

	/** The library's `10002` answer, renamed once at the model boundary: `inboxes → read`, `outboxes → write`. */
	test('5 · userRead/userWrite are the 10002 mailboxes, renamed read/write', async () => {
		const who = identity()
		const store = newStore()
		store.add(
			sign(KINDS.relayList, who, [
				['r', 'wss://read.test/', 'read'],
				['r', 'wss://write.test/', 'write'],
			]),
		)
		const port = createRelayConfig(handle(store), defaults())

		expect(await read(port.userRead(who.pubkey))).toEqual(['wss://read.test/'])
		expect(await read(port.userWrite(who.pubkey))).toEqual(['wss://write.test/'])
		// No 10002 at all: an empty set, never a throw and never an invented relay.
		expect(await read(port.userRead(identity().pubkey))).toEqual([])
	})

	/** MAX_READ_POOL is a PER-ROLE cap: `role(...)` answers at most this many relays. */
	test('6 · role(...) is capped per role at MAX_READ_POOL', async () => {
		const who = identity()
		const store = newStore()
		const twenty = Array.from({ length: 20 }, (_, i) => `wss://search-${i}.test/`)
		store.add(relayList(KINDS.search, who, twenty))
		const port = createRelayConfig(handle(store), defaults())

		const answer = await read(port.role('search', who.pubkey))
		expect(answer).toHaveLength(MAX_READ_POOL)
		expect(answer).toEqual(twenty.slice(0, MAX_READ_POOL))
	})

	/** The app's own half: the one configuration write, and the two switches. */
	test('7 · setWriteRelay is a configuration write; the switches answer the injected data', async () => {
		const port = createRelayConfig(handle(newStore()), defaults({ outboxEnabled: false }))

		expect(port.instance('app')).toEqual(['wss://app.test/'])
		expect(port.outboxEnabled()).toBe(false)
		expect(port.dmFallback()).toBe('refuse') // the default
		port.setWriteRelay('wss://write.test/')
		expect(port.instance('app')).toEqual(['wss://write.test/'])

		expect(createRelayConfig(handle(newStore()), defaults({ dmFallback: 'nip65-read' })).dmFallback()).toBe('nip65-read')
	})
})
