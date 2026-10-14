/**
 * payments/validationDeclaration.ts — this module's declaration (`design.md` §4.1).
 *
 * `payments` owns no Nostr event kind: a Cashu proof is not a Nostr event, and the payment request travels
 * as an order-message kind owned by `messaging`. Declaring nothing is a **named** fact (`design.md` §4.6),
 * and the engine's pass-through default holds for it unchanged.
 */
import { emptyDeclaration } from '../../core/composition/ts/index'
import type { CommerceValidationDeclaration } from '../../core/composition/ts/index'

export const validationDeclaration: CommerceValidationDeclaration = emptyDeclaration('commerce.payments')
