/**
 * instance/productAdmission.ts — the admission edge: untrusted event in, a
 * product item or nothing out.
 *
 * AGENTS.md ("Event Validation Before Surfacing") states the rule this file
 * implements: **relay data is untrusted, and an event becomes an item only after
 * the repository's parser for its kind accepts it.** The single definition of
 * valid for kind 30402 is `src/lib/schemas/productListing.ts`, which
 * `sdk/commerce/products/validationDeclaration.ts` also names as the kind's
 * `source`/`parser`.
 *
 * `src/` is a legacy layer whose modules the host may depend on transitionally —
 * the same licence `apps/web/boot.ts` already documents for itself ("Dependencies
 * on the legacy `src/` application modules are transitional"). The SDK exposes no
 * importable kind-30402 parser of its own, which is why this edge cannot yet be
 * composed purely from `sdk/`. That gap is reported as a named need.
 */

import { ProductListingSchema } from '@/lib/schemas/productListing'
import type { ProductReadEvent } from '@sdk/commerce/discovery'

/**
 * Admit a candidate event as a product item.
 *
 * Returns the shape the SDK's discovery read model consumes, or `null` when the
 * repository's parser rejects the event. A `null` is a *decision*, not an
 * absence: discovery surfaces drop what the parser rejects (AGENTS.md), and the
 * caller is expected to count the drops rather than hide them.
 */
export function admitProductListing(event: unknown): ProductReadEvent | null {
	const parsed = ProductListingSchema.safeParse(event)
	if (!parsed.success) return null

	const pubkey = (event as { pubkey?: unknown }).pubkey
	return {
		pubkey: typeof pubkey === 'string' ? pubkey : undefined,
		created_at: parsed.data.created_at,
		content: parsed.data.content,
		tags: parsed.data.tags.map((tag) => (tag as readonly unknown[]).filter((part): part is string => typeof part === 'string')),
	}
}