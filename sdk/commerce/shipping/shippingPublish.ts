import type { EventPublishContext } from '../../core/ports/eventPublish'
import type { SignedEventLike } from '../../core/ports/signer'
import { deleteAddressableEvent, signAndPublish } from '../../core/publishing'
import { createShippingReference } from './shippingReadModel'
import {
	buildShippingOptionEventData,
	prepareShippingOptionForPublish,
	SHIPPING_OPTION_KIND,
	type ShippingOptionFormInput,
	type ShippingPublishValidationIssue,
} from './shippingWorkflow'

export interface ShippingPublishContext<SignedEvent extends SignedEventLike> extends EventPublishContext<SignedEvent> {
	/** New `d` value for a fresh shipping option. */
	createShippingId(): string
}

export type ShippingPublishOutcome<SignedEvent> =
	| { ok: true; event: SignedEvent; shippingDTag: string; shippingRef: string }
	| { ok: false; issue: ShippingPublishValidationIssue }

/** Validates, builds, signs, and publishes a kind-30406 option; pass `shippingDTag` to replace an existing one. */
export async function publishShippingOptionWorkflow<SignedEvent extends SignedEventLike>(
	context: ShippingPublishContext<SignedEvent>,
	form: ShippingOptionFormInput,
	shippingDTag?: string,
): Promise<ShippingPublishOutcome<SignedEvent>> {
	const prepared = prepareShippingOptionForPublish(form)
	if (!prepared.ok) return prepared

	const dTag = shippingDTag || context.createShippingId()
	const event = await signAndPublish(context, buildShippingOptionEventData(prepared.form, dTag))

	return { ok: true, event, shippingDTag: dTag, shippingRef: createShippingReference(context.authorPubkey, dTag) }
}

/** Publishes a NIP-09 deletion for the author's shipping option. Relays may still serve the old event. */
export function deleteShippingOptionWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	shippingDTag: string,
): Promise<SignedEvent> {
	return deleteAddressableEvent(context, SHIPPING_OPTION_KIND, shippingDTag, 'Shipping option deleted')
}
