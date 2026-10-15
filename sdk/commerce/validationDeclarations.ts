/**
 * validationDeclarations.ts — **the collection**, by name (`design.md` §4.1, §6 step 2).
 *
 * Each `sdk/commerce/<module>` exports one `validationDeclaration` value; this file collects them into the
 * one array the host hands the composition rung. It is a **value a test reads** (the `WriteBackPolicy`
 * precedent, `#d4f95d`), not a call: what the tree declares is inspectable without driving anything.
 *
 * The collection is explicit rather than a glob, on purpose: a module that is added without a
 * declaration must be *seen* to be missing here, not silently absent from a directory walk. The
 * one-for-one criterion — **one module ↔ one declaration ↔ one `KindOwnership` per owned kind** — is held
 * by `declarations.test.ts`.
 */
import type { CommerceValidationDeclaration } from '../core/composition/ts/index'
import { validationDeclaration as auctions } from './auctions/validationDeclaration'
import { validationDeclaration as cart } from './cart/validationDeclaration'
import { validationDeclaration as checkout } from './checkout/validationDeclaration'
import { validationDeclaration as collections } from './collections/validationDeclaration'
import { validationDeclaration as discovery } from './discovery/validationDeclaration'
import { validationDeclaration as messaging } from './messaging/validationDeclaration'
import { validationDeclaration as orders } from './orders/validationDeclaration'
import { validationDeclaration as payments } from './payments/validationDeclaration'
import { validationDeclaration as products } from './products/validationDeclaration'
import { validationDeclaration as shipping } from './shipping/validationDeclaration'

export const commerceValidationDeclarations: readonly CommerceValidationDeclaration[] = Object.freeze([
	auctions,
	cart,
	checkout,
	collections,
	discovery,
	messaging,
	orders,
	payments,
	products,
	shipping,
])
