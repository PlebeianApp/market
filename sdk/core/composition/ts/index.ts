/**
 * composition/ts/index.ts — the composition rung's entry (`sdk/core/composition`).
 *
 * **The rung, in one line.** A composition root may legitimately name its siblings, which is why the
 * allow-list conflict disappears here and cannot in `event-access` (`design.md` §4.9). This rung builds
 * the validator from the host's declared demands, wires `validator.accept` into `event-access`'s one
 * accept hook, and composes through the **existing** construction site.
 *
 * It owns:
 *
 * 1. `composeEventAccess` (`./composition-root`) — the relocated composition root, moved verbatim by V0.
 * 2. the absorbed kept half of the retired `sdk/core/validation.ts` seed (`./schema`) — V1.
 * 3. the **declaration registry and its guard** (`./declaration`, `./registry`) — V2: the contribution
 *    path by which a `sdk/commerce` module declares the validation its kinds demand, and the report.
 * 4. the **collection path** `composeCommerce` (`./compose`) — the one place the snapshot is built and R1
 *    (zero declarations ⇒ the socket stays absent) is preserved.
 *
 * The rung's independence rule is *not* "no sibling specifier" (it composes siblings: see `./siblings.ts`);
 * it is **"no app import and no framework"**, the `sdk/boundary.test.ts` rule, with every sibling named on
 * the declared list.
 */
export { composeEventAccess } from './composition-root'
export type { ComposedEventAccess, ComposedEventAccessOptions } from './composition-root'
export { validateWithSchema } from './schema'
export type { RuntimeSchema } from './schema'
export { createPresetRegistry, DeclarationError } from './registry'
export type {
	CompletenessReport,
	ContributionRecord,
	DeclarationRefusal,
	DeclarationRefusalReason,
	GrantRecord,
	OwnedKindRecord,
	PresetRegistry,
	PresetRegistryOptions,
} from './registry'
export { emptyDeclaration } from './declaration'
export type { CommerceValidationDeclaration, Contribution, ContributionGrant, KindOwnership, OwnerKey, ParserRef } from './declaration'
export { composeCommerce } from './compose'
export type { ComposedCommerce, ComposeCommerceOptions } from './compose'
export { admissionNotice, inspectAdmission, judgeAdmission, QUARANTINE_MESSAGE } from './notice'
export type { AdmittedNotice, AdmissionNotice, QuarantineNotice, RefusalNotice } from './notice'
export { COMPOSITION_SIBLINGS } from './siblings'
