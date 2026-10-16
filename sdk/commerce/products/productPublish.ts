import type { EventPublishContext } from '../../core/ports/eventPublish'
import type { SignedEventLike } from '../../core/ports/signer'
import { addressableCoordinate, deleteAddressableEvent, signAndPublish } from '../../core/publishing'
import {
	buildSellerProductEventData,
	validateSellerProductForPublish,
	type SellerProductListingInput,
	type SellerProductPublishValidationIssue,
} from './productListingWorkflow'

export const PRODUCT_LISTING_KIND = 30402

export interface ProductPublishContext<SignedEvent extends SignedEventLike> extends EventPublishContext<SignedEvent> {
	/** New `d` value for a fresh listing. */
	createProductId(): string
	/** Optional NIP-89 client tag supplied by the host instance. */
	clientTag?: string[]
}

export type ProductPublishOutcome<SignedEvent> =
	| { ok: true; event: SignedEvent; productDTag: string; coordinate: string }
	| { ok: false; issue: SellerProductPublishValidationIssue }

/** Validates, builds, signs, and publishes a kind-30402 listing; pass `productDTag` to replace an existing one. */
export async function publishProductListingWorkflow<SignedEvent extends SignedEventLike>(
	context: ProductPublishContext<SignedEvent>,
	input: SellerProductListingInput,
	productDTag?: string,
): Promise<ProductPublishOutcome<SignedEvent>> {
	const validation = validateSellerProductForPublish(input)
	if (!validation.ok) return validation

	const dTag = productDTag || context.createProductId()
	const event = await signAndPublish(context, buildSellerProductEventData(input, dTag, { clientTag: context.clientTag }))
	return { ok: true, event, productDTag: dTag, coordinate: addressableCoordinate(PRODUCT_LISTING_KIND, context.authorPubkey, dTag) }
}

export function deleteProductListingWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	productDTag: string,
): Promise<SignedEvent> {
	return deleteAddressableEvent(context, PRODUCT_LISTING_KIND, productDTag, 'Product deleted')
}
