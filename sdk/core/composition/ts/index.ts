/**
 * composition/ts/index.ts — the composition rung's entry (`sdk/core/composition`).
 *
 * **The rung, in one line.** A composition root may legitimately name its siblings, which is why the
 * allow-list conflict disappears here and cannot in `event-access` (`design.md` §4.9). This rung
 * builds the validator from the host's declared demands, wires `validator.accept` into
 * `event-access`'s one accept hook, and composes through the **existing** construction site
 * (`composeEventAccess`, relocated verbatim from `event-access/ts/composition-root.ts` by V0).
 *
 * From V2 on this entry also owns the **declaration registry** and its guard — the contribution path
 * by which a `sdk/commerce` module declares the validation its kinds demand. The rung's independence
 * rule is *not* "no sibling specifier" (it composes siblings: see `./siblings.ts`); it is **"no app
 * import and no framework"**, the `sdk/boundary.test.ts` rule, with every sibling named on the
 * declared list.
 */
export { composeEventAccess } from './composition-root'
export type { ComposedEventAccess, ComposedEventAccessOptions } from './composition-root'
export { validateWithSchema } from './schema'
export type { RuntimeSchema } from './schema'
export { COMPOSITION_SIBLINGS } from './siblings'
