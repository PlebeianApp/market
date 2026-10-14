/**
 * messaging/validationDeclaration.ts — this module's declaration (`design.md` §4.1).
 *
 * `messaging` **owns** the order-message kinds 14 · 16 · 17: their schema lives here
 * (`messaging/orderSchema.ts`; `src/lib/schemas/order.ts` is a deprecated re-export shim pointing back at
 * it), so this is the module that owns their *meaning and spec*. The `orders` module builds the
 * templates but owns no kind — it **contributes** its demand for 16 and 17, and this module **admits**
 * it by name. That is the tree's own two-surface arrangement landing through the declared contribution
 * path (`design.md` §4.5), with no second owner.
 */
import type { CommerceValidationDeclaration } from '../../core/composition/ts/index'
import { COMMENT_KIND } from './commentEvents'
import { LIVE_CHAT_KIND } from './liveChatEvents'
import { ORDER_GENERAL_KIND } from './orderSchema'

/** The order-process kind — `messaging/orderSchema.ts` (§1 order creation … §4 shipping update). */
const ORDER_PROCESS_KIND = 16
/** The payment-receipt kind — `messaging/orderSchema.ts` (§6). */
const PAYMENT_RECEIPT_KIND = 17

export const validationDeclaration: CommerceValidationDeclaration = {
	owner: 'commerce.messaging',
	kinds: [
		{ kind: ORDER_GENERAL_KIND, source: 'sdk/commerce/messaging/orderSchema.ts', checks: [] },
		{ kind: ORDER_PROCESS_KIND, source: 'sdk/commerce/messaging/orderSchema.ts', checks: [] },
		{ kind: PAYMENT_RECEIPT_KIND, source: 'sdk/commerce/messaging/orderSchema.ts', checks: [] },
		{ kind: COMMENT_KIND, source: 'sdk/commerce/messaging/commentEvents.ts', checks: [] },
		{ kind: LIVE_CHAT_KIND, source: 'sdk/commerce/messaging/liveChatEvents.ts', checks: [] },
	],
	contributions: [],
	accepts: [{ from: 'commerce.orders', kinds: [ORDER_PROCESS_KIND, PAYMENT_RECEIPT_KIND] }],
}
