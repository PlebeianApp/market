import type { Signer, SignedEventLike } from './signer'

/**
 * Per-call publishing dependencies supplied by the host. Workflows receive these
 * explicitly instead of reading a process-wide client, so each market instance
 * can bind its own signer and relay policy.
 */
export interface EventPublishContext<SignedEvent extends SignedEventLike = SignedEventLike> {
	signer: Signer<SignedEvent>
	/** Resolves once the host's relay policy accepted the event; rejects otherwise. */
	publish(event: SignedEvent): Promise<void>
	/** Pubkey the signer signs as. */
	authorPubkey: string
	/** Unix seconds; injectable for deterministic tests. */
	now(): number
}
