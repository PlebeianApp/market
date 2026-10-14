/**
 * checkout/validationDeclaration.ts — this module's declaration (`design.md` §4.1).
 *
 * `checkout` owns no event kind: it reads invoices and delivery requirements off events other modules
 * own. Declaring nothing is a **named** fact — `emptyDeclaration` names the module as looked at rather
 * than silent (`design.md` §4.6), and the registry installs no rule for it, so the engine's pass-through
 * default holds unchanged.
 */
import { emptyDeclaration } from '../../core/composition/ts/index'
import type { CommerceValidationDeclaration } from '../../core/composition/ts/index'

export const validationDeclaration: CommerceValidationDeclaration = emptyDeclaration('commerce.checkout')
