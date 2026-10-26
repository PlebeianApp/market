/**
 * composition-root.ts — **the composition root**: the one place the `validator` is composed and its
 * `accept` is handed to `event-access` as the policy's accept hook.
 *
 * **Why this file, and why here.** The design's composition root is a rung of its own
 * (`runs/2026-10-13-validation-layer/proposal/FINAL-composed.md` §1.4/§1.1): `validation` is the
 * engine, `event-access` hosts the one accept boundary, and **the composition root** builds the
 * preset set and calls `createValidator({ presets })`. The engine may not import outward
 * (`validation.md` `#8e6079`) and `event-access` declares its ports structurally and imports
 * neither sibling (`event-access/ts/index.ts` `#0c7fe3`), so the composition root cannot live in
 * either — it is a distinct rung. **It now sits at its own rung, `sdk/core/composition`**, which is
 * the design's `core/composition` (`design.md` §4.9): the relocation the earlier increment reported
 * as a named need has landed, and the `../../validation/ts/index` specifier that was a **measured
 * violation** of `event-access`'s independence criterion (`#0c7fe3`, D-O19; run.sh §4/§4b) is gone
 * with it. Composing siblings is this rung's whole job, so its own rule is not "no sibling
 * specifier" but **"no app import and no framework"** — the `sdk/boundary.test.ts` rule — with every
 * sibling it composes named in the declared sibling list (`./siblings.ts`). **This file is a rung
 * above the module, consumed by path, not a member of `event-access`'s contract surface.**
 *
 * **What it does, in one line.** It constructs the validator from the host's declared validation
 * options and passes `validator.accept` as `WriteBackPolicy.accept` on the policy handed to the
 * **existing** construction site — `createEventAccess({ endpoint, upstream, … })` — which is already
 * the composition where the endpoint is built. No new accept rule is grown, no second call site is
 * added, and `event-access`'s implementation is untouched: the socket it already has
 * (`WriteBackPolicy.accept`, `#c8e35c`) is filled exactly as the maintainer's decision D-O21/D-O24
 * requires.
 *
 * **The two decisions this file takes, stated.**
 *
 * 1. **Absent `validation` leaves the socket absent.** `validation` absent means no hook is installed
 *    and the policy is the one the host declared (or `DEFAULT_WRITE_BACK`), so `access.policy.accept`
 *    stays `undefined` — the socket's documented pass-through default, *"Absent means accept
 *    everything, which is `validation`'s pass-through default"* (`event-access/ts/types.ts:302`). The
 *    fewer-assumption reading is to change no existing behaviour when the host declares nothing;
 *    installing a pass-through hook unconditionally would make `access.policy` differ from
 *    `DEFAULT_WRITE_BACK` and turn a documented identity into a lookalike.
 * 2. **A declared `validation` wins the hook.** When `validation` is supplied the validator's `accept`
 *    occupies `WriteBackPolicy.accept`, overriding any hook the host put on `policy` — the host asked
 *    for validation, and *"never a second accept rule"* (`#c8e35c`) means one hook, not two.
 */
import { createValidator } from '../../validation/ts/index'
import type { Validator, ValidatorOptions } from '../../validation/ts/index'
import { createEventAccess, DEFAULT_WRITE_BACK } from '../../event-access/ts/index'
import type { AcceptContext, AcceptDecision, Event, EventAccess, EventAccessOptions, WriteBackPolicy } from '../../event-access/ts/index'

/**
 * The composition root's options: the two ports and the optional injected resolver and fill that
 * `createEventAccess` already takes, plus **the host's declared validation demands** — handed
 * straight to `createValidator`, so the port, the bounds and the clock are the host's to supply
 * (`#8e6079`).
 */
export interface ComposedEventAccessOptions {
	readonly endpoint: EventAccessOptions['endpoint']
	readonly upstream: EventAccessOptions['upstream']
	readonly fill?: EventAccessOptions['fill']
	readonly resolver?: EventAccessOptions['resolver']
	readonly policy?: WriteBackPolicy
	/**
	 * The host's validation options — `presets`, and optionally the port, the bounds and the clock
	 * (`ValidatorOptions`, `validation/ts/types.ts:302`). **Absent means the socket stays absent and
	 * every candidate is admitted** (the pass-through default). Supplied — even `{}` — means the
	 * validator is composed and its `accept` occupies the one hook.
	 */
	readonly validation?: ValidatorOptions
}

/** What the root hands back: the composed handle, and the validator the hook is drawn from. */
export interface ComposedEventAccess {
	readonly access: EventAccess
	readonly validator: Validator
}

/**
 * `composeEventAccess` — the composition root. Builds the validator from the host's declared
 * demands, wires `validator.accept` into the policy's one hook, and composes through the existing
 * `createEventAccess` construction site. With no `validation` declared it is `createEventAccess`
 * unchanged: no hook, accept everything.
 */
export function composeEventAccess(options: ComposedEventAccessOptions): ComposedEventAccess {
	// The validator is always built (an empty option set is the spec's pass-through), so the caller
	// holds the handle and can drive `validate` for a direct read that must name the failing
	// constraint — the refresh command's own caller shape (FINAL-composed §1.8), never a second rule.
	const validator = createValidator(options.validation ?? {})

	const base = options.policy ?? DEFAULT_WRITE_BACK
	// Decision 1 vs 2, in one expression: no declared validation ⇒ the socket stays as the host left
	// it (absent, by default); a declared one ⇒ the validator's `accept` IS the hook.
	const policy: WriteBackPolicy =
		options.validation === undefined
			? base
			: {
					...base,
					accept: (event: Event, context: AcceptContext): AcceptDecision | Promise<AcceptDecision> => validator.accept(event, context),
				}

	const access = createEventAccess({
		endpoint: options.endpoint,
		upstream: options.upstream,
		fill: options.fill,
		resolver: options.resolver,
		policy,
	})

	return { access, validator }
}
