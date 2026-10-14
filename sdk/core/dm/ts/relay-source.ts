/**
 * relay-source.ts — relay targets, from **our relay-config port** and nowhere else.
 *
 * The component does **not** parse a `10050` itself. It seeds the events it was handed into a live
 * `applesauce-core` `EventStore` and hands that store to `relay-config`'s `createRelayConfig`; it then reads
 * the port's `dmRelays(pubkey)` — the library's validator (`isValidDirectMessageRelaysList`) and parser
 * (`getRelaysFromList`), over the store's `replaceable(10050, pubkey)` — and no other member.
 *
 * `dmRelays` answers `undefined` when there is no `10050`; **no `10002` is ever substituted**. That is the
 * library's own answer and NIP-17's MUST, and it is relay-config's contract, not re-derived here.
 *
 * The dependency on `relay-config` is a **value** import (its factory); the port's shape is declared
 * structurally in `types.ts` (`DmRelaySource`), so nothing here names a relay-config type.
 */
import { EventStore } from 'applesauce-core/event-store'
import { firstValueFrom } from 'rxjs'
import { createRelayConfig } from '../../relay-config/ts/index.ts'
import type { DmRelayListEvent, DmRelaySource, DmRelayTargets } from './types'

/**
 * The default layer relay-config asks for. The DM path reads only `dmRelays`, which is derived from the
 * store, so the instance slots are empty and the outbox switch is off — none of them is consulted here.
 */
const DM_DEFAULTS = {
	instance: { app: [] as string[], bug: [] as string[], cvm: [] as string[], zap: [] as string[] },
	outboxEnabled: false,
}

/**
 * Build a relay-config-shaped `DmRelaySource` from the relay-list events the caller already holds. The events
 * are seeded into a fresh store; the port does all parsing and validation. No `10050` logic lives here.
 */
export function dmRelaySourceFromEvents(events: DmRelayListEvent[]): DmRelaySource {
	const store = new EventStore()
	for (const event of events) {
		store.add(event as unknown as Parameters<EventStore['add']>[0])
	}
	const config = createRelayConfig({ modelStore: () => store }, DM_DEFAULTS)
	return { dmRelays: (pubkey: string) => config.dmRelays(pubkey) }
}

/**
 * Resolve the DM relay targets for both sides by calling the relay-config port's `dmRelays` for each pubkey.
 *
 * `ready` is true only when **both** sides answered a non-empty `10050`. A side that answered `undefined`
 * (no `10050`) or an empty list is not ready — the caller must not publish on a substituted `10002`.
 */
export async function resolveDmRelayTargets(params: {
	relaySource: DmRelaySource
	senderPubkey: string
	recipientPubkey: string
}): Promise<DmRelayTargets> {
	const recipient = await firstValueFrom(params.relaySource.dmRelays(params.recipientPubkey))
	const sender = await firstValueFrom(params.relaySource.dmRelays(params.senderPubkey))
	return {
		ready: hasRelays(recipient) && hasRelays(sender),
		recipientPubkey: params.recipientPubkey,
		senderPubkey: params.senderPubkey,
		recipient,
		sender,
	}
}

function hasRelays(relays: string[] | undefined): relays is string[] {
	return Array.isArray(relays) && relays.length > 0
}
