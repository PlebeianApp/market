/**
 * harness.ts — the host side of the port, for the tests. It is **not** part of the implementation's
 * inventory of behaviour; it is the specimen the tests hand the port: a real `applesauce-core` `EventStore`
 * (the vendor's own store, the thing `event-store`'s `modelStore()` returns), signed events to seed it, a
 * store handle of the exact structural shape the port asks for, the app's default layer as data, a reader
 * that takes one value from a stream, and a **pool spy** that throws from every method so a dial cannot be
 * silent.
 */
import { EventStore } from 'applesauce-core/event-store'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { firstValueFrom } from 'rxjs'
import type { Observable } from 'rxjs'
import type { RelayDefaults, RelayStoreHandle } from './types'

/** A key pair minted at run time — no fixture, no shared pubkey between cases. */
export type Identity = { secret: Uint8Array; pubkey: string }

export function identity(): Identity {
	const secret = generateSecretKey()
	return { secret, pubkey: getPublicKey(secret) }
}

/** A signed event of `kind` by `who`, with the given tags. */
export function sign(kind: number, who: Identity, tags: string[][] = [], content = ''): ReturnType<typeof finalizeEvent> {
	return finalizeEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags, content }, who.secret)
}

/** A relay-list event: `n` `relay` tags on one event. */
export function relayList(kind: number, who: Identity, relays: string[]): ReturnType<typeof finalizeEvent> {
	return sign(
		kind,
		who,
		relays.map((url) => ['relay', url]),
	)
}

/** A fresh vendor store — the live store the models subscribe to, and a loader could write into. */
export function newStore(): EventStore {
	return new EventStore()
}

/** The port's store handle: exactly `{ modelStore(): IEventStore }`, nothing more. */
export function handle(store: EventStore): RelayStoreHandle {
	return { modelStore: () => store }
}

/** The app's instance config, as data — the default layer. `zap` is the never-dropped dedicated set. */
export function defaults(overrides: Partial<RelayDefaults> = {}): RelayDefaults {
	return {
		instance: {
			app: ['wss://app.test/'],
			bug: ['wss://bugs.plebeian.market/'],
			cvm: [],
			zap: ['wss://relay.coinos.io', 'wss://nwc.primal.net'],
		},
		outboxEnabled: true,
		...overrides,
	}
}

/** One value from a stream, or a rejection — never a hang. */
export function read<T>(stream: Observable<T>): Promise<T> {
	return firstValueFrom(stream)
}

/** A pool spy: it records nothing and **throws from every method**, so any dial fails the read loudly. */
export type PoolSpy = { calls: number; request: () => never; subscribe: () => never }

export function poolSpy(): PoolSpy {
	const spy: PoolSpy = {
		calls: 0,
		request: (): never => {
			spy.calls += 1
			throw new Error('the relay-config port dialled: request() was called')
		},
		subscribe: (): never => {
			spy.calls += 1
			throw new Error('the relay-config port dialled: subscribe() was called')
		},
	}
	return spy
}
