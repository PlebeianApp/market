/**
 * dm.test.ts — the module's evidence, as tests. Each case states its **break case**: the change that turns it
 * red. No network call is made; every event is signed at run time.
 */
import { describe, expect, test } from 'bun:test'
import { getEventHash } from 'nostr-tools'
import { dmRelaySourceFromEvents, resolveDmRelayTargets, unwrapDm, wrapDm } from './index'
import { asRelayEvent, identity, relayList, rumor, signerFor } from './harness'

const GIFT_WRAP_KIND = 1059
const SEAL_KIND = 13
const DM_RELAYS_KIND = 10050
const NIP65_RELAY_LIST_KIND = 10002

describe('dm — the write and read paths over the library, the targets from relay-config', () => {
	/**
	 * EVIDENCE 1 — the write path mints a **fresh ephemeral author per wrap**, and neither is the real key.
	 *
	 * Break case: reuse one wrap for both directions, or sign the wrap with the real key → the two pubkeys
	 * stop being distinct / stop differing from the signer.
	 */
	test('1 · wrapDm produces two kind-1059 wraps with distinct ephemeral authors', async () => {
		const sender = identity()
		const recipient = identity()
		const signer = signerFor(sender.secret)
		const message = rumor({ pubkey: sender.pubkey, tags: [['p', recipient.pubkey]], content: 'order-info' })

		const wraps = await wrapDm({ rumor: message, recipientPubkey: recipient.pubkey, signer })

		expect(wraps.recipient.kind).toBe(GIFT_WRAP_KIND)
		expect(wraps.sender.kind).toBe(GIFT_WRAP_KIND)
		// Two fresh ephemeral authors, one per direction, and neither is the real signer key.
		expect(wraps.recipient.pubkey).not.toBe(wraps.sender.pubkey)
		expect(wraps.recipient.pubkey).not.toBe(sender.pubkey)
		expect(wraps.sender.pubkey).not.toBe(sender.pubkey)
		// The `p` tag points at the real recipient on the recipient wrap and at the sender on the self-wrap.
		expect(wraps.recipient.tags.find((tag) => tag[0] === 'p')?.[1]).toBe(recipient.pubkey)
		expect(wraps.sender.tags.find((tag) => tag[0] === 'p')?.[1]).toBe(sender.pubkey)
	})

	/**
	 * EVIDENCE 2 — both wraps carry the **same rumor**, and the read path (`unlockGiftWrap`) round-trips it.
	 *
	 * Break case: re-build the rumor per direction → the two ids diverge; hand-roll the unwrap → the rumor
	 * does not come back.
	 */
	test('2 · both wraps carry one rumor, and unwrapDm round-trips it', async () => {
		const sender = identity()
		const recipient = identity()
		const message = rumor({ pubkey: sender.pubkey, tags: [['p', recipient.pubkey]], content: 'hello' })

		const wraps = await wrapDm({ rumor: message, recipientPubkey: recipient.pubkey, signer: signerFor(sender.secret) })

		const readByRecipient = await unwrapDm({ giftWrap: wraps.recipient, signer: signerFor(recipient.secret) })
		const readBySender = await unwrapDm({ giftWrap: wraps.sender, signer: signerFor(sender.secret) })

		expect(readByRecipient.rumor.id).toBe(message.id)
		expect(readBySender.rumor.id).toBe(message.id)
		expect(readByRecipient.rumor.content).toBe('hello')
		expect(readByRecipient.seal.kind).toBe(SEAL_KIND)
		expect(getEventHash(readByRecipient.rumor)).toBe(message.id)
	})

	/**
	 * EVIDENCE 3 — the targets come from **relay-config's `dmRelays`**: a seeded `10050` per side, ready only
	 * when both are present.
	 *
	 * Break case: read a role other than `dmRelays`, or treat one missing side as ready → the assertions fail.
	 */
	test('3 · resolveDmRelayTargets reads dmRelays for both sides', async () => {
		const sender = identity()
		const recipient = identity()
		const source = dmRelaySourceFromEvents([
			asRelayEvent(relayList(DM_RELAYS_KIND, sender, ['wss://sender-dm.test/'])),
			asRelayEvent(relayList(DM_RELAYS_KIND, recipient, ['wss://recipient-dm.test/'])),
		])

		const targets = await resolveDmRelayTargets({ relaySource: source, senderPubkey: sender.pubkey, recipientPubkey: recipient.pubkey })
		expect(targets.ready).toBe(true)
		expect(targets.recipient).toEqual(['wss://recipient-dm.test/'])
		expect(targets.sender).toEqual(['wss://sender-dm.test/'])
	})

	/**
	 * EVIDENCE 4 — **no `10002` is substituted** for a missing `10050`. A recipient with a `10002` (NIP-65
	 * mailboxes) and no `10050` answers `undefined`, and the target is not ready.
	 *
	 * Break case: fall back to the recipient's `10002` read set → `undefined` becomes a relay list and NIP-17's
	 * MUST is violated.
	 */
	test('4 · a missing 10050 is undefined — no 10002 fallback', async () => {
		const sender = identity()
		const recipient = identity()
		const source = dmRelaySourceFromEvents([
			asRelayEvent(relayList(DM_RELAYS_KIND, sender, ['wss://sender-dm.test/'])),
			// The recipient has only a NIP-65 relay list, never a 10050.
			asRelayEvent(relayList(NIP65_RELAY_LIST_KIND, recipient, ['wss://inbox.test/'])),
		])

		const targets = await resolveDmRelayTargets({ relaySource: source, senderPubkey: sender.pubkey, recipientPubkey: recipient.pubkey })
		expect(targets.recipient).toBeUndefined()
		expect(targets.ready).toBe(false)
	})
})
