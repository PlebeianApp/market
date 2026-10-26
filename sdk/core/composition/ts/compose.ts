/**
 * compose.ts — **the collection path** (`design.md` §6, §4.9): declarations in, one registry, the engine
 * built from the registry's snapshot and its `accept` wired into `event-access`'s one hook.
 *
 * **R1 is preserved here, and this is where it could be lost.** The engine treats a *declared* option set
 * as declared even when empty, so an unconditional `validation: { presets: [] }` would install a
 * pass-through hook and make `access.policy` a **lookalike** of `DEFAULT_WRITE_BACK` rather than it. So
 * `composeCommerce` passes `validation` **only when the registry's snapshot is non-empty**: zero
 * declarations ⇒ `validation` stays `undefined` ⇒ no hook ⇒ `access.policy` **is** `DEFAULT_WRITE_BACK`
 * (identity), and a host that declares nothing gets exactly today's behaviour.
 */
import { composeEventAccess } from './composition-root'
import { createPresetRegistry } from './registry'
import type { PresetRegistry } from './registry'
import type { CommerceValidationDeclaration } from './declaration'
import type { EventAccess, EventAccessOptions, WriteBackPolicy } from '../../event-access/ts/index'
import type { Validator, ValidatorOptions } from '../../validation/ts/index'

/** What the host hands the rung: the declarations collected by name, the two ports, and the host's edges. */
export interface ComposeCommerceOptions {
	readonly declarations: readonly CommerceValidationDeclaration[]
	readonly endpoint: EventAccessOptions['endpoint']
	readonly upstream: EventAccessOptions['upstream']
	readonly fill?: EventAccessOptions['fill']
	readonly resolver?: EventAccessOptions['resolver']
	readonly policy?: WriteBackPolicy
	/** The kinds the host declares it renders — the report's `unplaced` is rendered − owned. */
	readonly rendered?: readonly number[]
	readonly port?: ValidatorOptions['port']
	readonly bounds?: ValidatorOptions['bounds']
	readonly clock?: ValidatorOptions['clock']
}

/**
 * What the rung hands back: the registry (mutable, for runtime insertion), the composed handle, and the
 * validator the hook is drawn from.
 */
export interface ComposedCommerce {
	readonly registry: PresetRegistry
	readonly access: EventAccess
	readonly validator: Validator
	/** `false` when the snapshot was empty and `validation` stayed `undefined`: the socket stayed absent. */
	readonly gated: boolean
}

/**
 * `composeCommerce` — the collection path. A bad declaration throws `DeclarationError` **here, at boot**,
 * before any candidate is judged (`design.md` §4.5).
 */
export function composeCommerce(options: ComposeCommerceOptions): ComposedCommerce {
	const registry = createPresetRegistry({ declarations: options.declarations, rendered: options.rendered })
	const presets = registry.snapshot()
	// The one branch that preserves R1: an empty snapshot must NOT become a declared empty option set.
	const validation: ValidatorOptions | undefined =
		presets.length === 0 ? undefined : { presets, port: options.port, bounds: options.bounds, clock: options.clock }

	const composed = composeEventAccess({
		endpoint: options.endpoint,
		upstream: options.upstream,
		fill: options.fill,
		resolver: options.resolver,
		policy: options.policy,
		validation,
	})

	return { registry, access: composed.access, validator: composed.validator, gated: presets.length > 0 }
}
