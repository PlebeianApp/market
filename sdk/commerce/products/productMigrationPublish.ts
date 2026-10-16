import type { EventPublishContext } from '../../core/ports/eventPublish'
import type { SignedEventLike } from '../../core/ports/signer'
import { signAndPublish } from '../../core/publishing'
import {
	buildSellerProductEventData,
	validateSellerProductForPublish,
	type SellerProductListingInput,
	type SellerProductPublishValidationIssue,
} from './productListingWorkflow'

export type ProductMigrationStep = 'preparing' | 'signing' | 'publishing' | 'done'

export interface ProductMigrationPublishContext<SignedEvent extends SignedEventLike> extends EventPublishContext<SignedEvent> {
	createProductId(): string
	onStep?(step: ProductMigrationStep): void
}

export type ProductMigrationOutcome<SignedEvent> =
	| { ok: true; event: SignedEvent }
	| { ok: false; issue: SellerProductPublishValidationIssue }

/** Listing rules minus shipping: NIP-15 stalls carried shipping separately, so migrated listings may have none yet. */
export function validateMigratedProductForPublish(
	input: SellerProductListingInput,
): { ok: true } | { ok: false; issue: SellerProductPublishValidationIssue } {
	const result = validateSellerProductForPublish(input)
	if (result.ok || result.issue === 'product-shipping-required') return { ok: true }
	return result
}

/** Publishes a NIP-99 listing tagged `migrated` with the original NIP-15 event id. */
export async function publishMigratedProductWorkflow<SignedEvent extends SignedEventLike>(
	context: ProductMigrationPublishContext<SignedEvent>,
	input: SellerProductListingInput,
	originalNip15EventId: string,
): Promise<ProductMigrationOutcome<SignedEvent>> {
	context.onStep?.('preparing')
	const validation = validateMigratedProductForPublish(input)
	if (!validation.ok) return validation

	const data = buildSellerProductEventData(input, context.createProductId())
	context.onStep?.('signing')
	const event = await signAndPublish(
		{
			...context,
			publish: async (signed) => {
				context.onStep?.('publishing')
				await context.publish(signed)
			},
		},
		{ ...data, tags: [...data.tags, ['migrated', originalNip15EventId]] },
	)
	context.onStep?.('done')
	return { ok: true, event }
}
