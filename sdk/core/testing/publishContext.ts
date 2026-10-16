import type { EventTemplate } from 'nostr-tools/pure'
import type { EventPublishContext } from '../ports/eventPublish'

export type TestSignedEvent = EventTemplate & { id: string; pubkey: string }

/** In-memory publish context for workflow tests: deterministic clock and ids, records every published event. */
export function createTestPublishContext(authorPubkey = 'author') {
	const published: TestSignedEvent[] = []
	let counter = 0
	const context: EventPublishContext<TestSignedEvent> = {
		authorPubkey,
		now: () => 1_700_000_000,
		signer: { sign: async (template) => ({ ...template, id: `event-${++counter}`, pubkey: authorPubkey }) },
		publish: async (event) => {
			published.push(event)
		},
	}
	return { context, published }
}
