/**
 * collections/validationDeclaration.ts — this module's declaration (`design.md` §4.1).
 *
 * `collections` owns kind 30405 (`collectionEvent.ts:1`), cited to the repository's own collection parser.
 * `checks: []` is a declared "demands nothing yet".
 */
import type { CommerceValidationDeclaration } from '../../core/composition/ts/index'
import { COLLECTION_EVENT_KIND } from './collectionEvent'

export const validationDeclaration: CommerceValidationDeclaration = {
	owner: 'commerce.collections',
	kinds: [
		{
			kind: COLLECTION_EVENT_KIND,
			source: 'sdk/commerce/collections/collectionEvent.ts',
			parser: 'src/lib/schemas/productCollection.ts#ProductCollectionSchema',
			checks: [],
		},
	],
	contributions: [],
	accepts: [],
}
