/**
 * `#32b372` — the one place a capability's interface is bound to its runtime id.
 *
 * Moved verbatim from the retrofit's `ui/ts/index.ts`; see `../capability.md` for why it moved and for
 * the rule it serves. The bodies and the rule id are unchanged.
 */

/**
 * `#32b372` CapabilityId — a capability's stable runtime id. An OPEN string: the contract states no rule
 * about it and the app must not learn a plugin's name, only the id a token was minted with.
 */
export type CapabilityId = string

/**
 * `#32b372` CapabilityToken — the runtime id AND the interface it satisfies, bound once where the interface
 * is in scope. The type parameter is the whole point: a consumer gets `C` back, not `unknown`, so a
 * capability is asked for without a cast at the call site and a token is declared beside the interface
 * it names, in the module that owns the interface.
 */
export interface CapabilityToken<C> {
	/** The capability's stable runtime id — matches the id a provider's contribution carries. */
	readonly id: CapabilityId
	/** A human-readable name used in a refusal or a note (e.g. "the cart"). */
	readonly name: string
	/**
	 * A phantom marker that makes the token nominal in `C` — never present at run time and never read; it exists
	 * so two tokens with the same id but a different interface are different types, and so the token genuinely
	 * binds its interface.
	 */
	readonly __capability?: C
}

/**
 * `#32b372` capabilityToken — mint a token, the ONE place a capability's interface is bound to its runtime
 * id. It is the single cast the model permits at a call site, and here the type parameter is supplied
 * by the declaring module, so the binding is by construction.
 */
export function capabilityToken<C>(id: CapabilityId, name: string): CapabilityToken<C> {
	return { id, name }
}

/** `#32b372` capabilityId — the runtime id of a token, for a manifest read or a refusal's wording. */
export function capabilityId(token: CapabilityToken<unknown>): CapabilityId {
	return token.id
}
