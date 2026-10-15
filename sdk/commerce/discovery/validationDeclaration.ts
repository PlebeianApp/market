/**
 * discovery/validationDeclaration.ts — this module's declaration (`design.md` §4.1).
 *
 * `discovery` owns no event kind: it is a read/selection surface over kinds owned by `products` and
 * `collections`. Declaring nothing is a **named** fact (`design.md` §4.6), and the engine's pass-through
 * default holds for it unchanged.
 */
import { emptyDeclaration } from '../../core/composition/ts/index'
import type { CommerceValidationDeclaration } from '../../core/composition/ts/index'

export const validationDeclaration: CommerceValidationDeclaration = emptyDeclaration('commerce.discovery')
