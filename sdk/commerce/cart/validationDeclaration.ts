/**
 * cart/validationDeclaration.ts — this module's declaration (`design.md` §4.1).
 *
 * `cart` owns kind 30078 (`src/lib/schemas/cartPersistence.ts:18` — the cart-persistence app-data event),
 * cited to that parser. `checks: []` is a declared "demands nothing yet".
 */
import type { CommerceValidationDeclaration } from '../../core/composition/ts/index'

/** The cart-persistence app-data kind — `src/lib/schemas/cartPersistence.ts:18`. */
const CART_PERSISTENCE_KIND = 30078

export const validationDeclaration: CommerceValidationDeclaration = {
	owner: 'commerce.cart',
	kinds: [
		{
			kind: CART_PERSISTENCE_KIND,
			source: 'src/lib/schemas/cartPersistence.ts',
			parser: 'src/lib/schemas/cartPersistence.ts#isCartPersistenceEvent',
			checks: [],
		},
	],
	contributions: [],
	accepts: [],
}
