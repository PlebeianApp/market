/**
 * currency/validationDeclaration.ts — this module's declaration (`design.md` §4.1).
 *
 * `currency` owns no event kind: it reads a rate **through** ContextVM — a Nostr
 * transport the oracle serves — and converts. Nothing it does is a candidate for
 * the validation engine to admit or refuse, so declaring nothing is a **named** fact
 * rather than an omission, and the engine's pass-through default holds unchanged.
 *
 * For the same reason it contributes no parser and accepts none: it consumes a tool
 * result, not a kind.
 */
import { emptyDeclaration } from '../../core/composition/ts/index'
import type { CommerceValidationDeclaration } from '../../core/composition/ts/index'

export const validationDeclaration: CommerceValidationDeclaration = emptyDeclaration('commerce.currency')
