/**
 * registry.ts — **the declaration registry, its guard, the preset snapshot and the report** (`design.md`
 * §4.4, §4.5, §4.6).
 *
 * The seed this absorbs was `sdk/core/validation.ts`'s `EventSchemaRegistry`: one registration per kind,
 * one owner, a duplicate kind refused — but a **bare** refusal, with no admissible configuration for the
 * tree's own two-surface reality. This widens exactly that rule (`design.md` §4.5):
 *
 * - **one structural owner per kind.** The owner is the module that owns the kind's *meaning and spec*.
 *   A second module with a genuine demand contributes it by name (`Contribution.via`), and the owner
 *   admits it by name (`ContributionGrant.from`). **Both halves must exist.**
 * - **an undeclared overlap is refused**, naming the closed **`(kind, claimed-by-two)`** pair — the
 *   `FundsRegistrationGate` shape (naming only the pair, never echoing anything else).
 * - **a bad declaration is refused before any candidate is judged.** An uninterpretable check — a
 *   comparator outside the closed `eq · exists · in` vocabulary, a `maxChainDepth` above one hop, or a
 *   declaration whose reference count exceeds `maxReferencesPerEvent` — is a **configuration error at
 *   registration**, loud at boot, never a per-event verdict.
 * - **the report is a value a test reads**: owned kinds, owned-with-no-rules, contributions and grants,
 *   and the kinds the host renders that no declaration owns.
 *
 * **The engine carries no kind table and gains none.** Everything here is the declaration layer's, one
 * rung above (`design.md` §7.5).
 */
import { createValidator } from '../../validation/ts/index'
import type { Validator, ValidationCheck, ValidationPreset } from '../../validation/ts/index'
import type { CommerceValidationDeclaration, Contribution, KindOwnership, ParserRef } from './declaration'
import type { OwnerKey } from './declaration'

/** The closed comparator vocabulary the guard refuses outside of (`#0fea4f`; the engine's own vocabulary). */
const COMPARATORS: readonly string[] = ['eq', 'exists', 'in']

/**
 * The engine's **own declared defaults**, read through the module's entry — never minted here, so there
 * is only one definition of the fan-out ceiling and the chain depth. Lazily computed so importing this
 * module has no cost beyond the type.
 */
let cachedEngineBounds: Validator['bounds'] | undefined
function engineBounds(): Validator['bounds'] {
	cachedEngineBounds ??= createValidator().bounds
	return cachedEngineBounds
}

/** The closed refusal vocabulary — in the engine's own style (`design.md` §4.5). */
export type DeclarationRefusalReason =
	| 'not-a-positive-kind'
	| 'duplicate-owner'
	| 'claimed-by-two'
	| 'contribution-ungranted'
	| 'grant-without-contribution'
	| 'uninterpretable-check'

/**
 * A refusal names only what it must: the closed reason, and for `claimed-by-two` the closed
 * `(kind, claimed-by-two)` pair. Nothing here is inferred from prose and nothing echoes a message.
 */
export interface DeclarationRefusal {
	readonly reason: DeclarationRefusalReason
	readonly kind?: number
	/** The two owners of `kind` — the closed pair `claimed-by-two` names. */
	readonly claimedBy?: readonly [OwnerKey, OwnerKey]
	readonly check?: string
	readonly detail: string
}

/** The registration error: the module's only thrown shape here, raised only for a host's misdeclaration. */
export class DeclarationError extends Error {
	readonly refusal: DeclarationRefusal

	constructor(refusal: DeclarationRefusal) {
		super(refusal.detail)
		this.name = 'DeclarationError'
		this.refusal = refusal
	}
}

/** One owned kind, as the report lists it. `checks` is the **merged** count (owner's plus granted contributions'). */
export interface OwnedKindRecord {
	readonly owner: OwnerKey
	readonly kind: number
	readonly source: string
	readonly parser?: ParserRef
	readonly checks: number
}

/** One routed demand, as the report lists it. */
export interface ContributionRecord {
	readonly owner: OwnerKey
	readonly contributor: OwnerKey
	readonly kind: number
	readonly source: string
}

/** One admitted contribution, as the report lists it. */
export interface GrantRecord {
	readonly owner: OwnerKey
	readonly contributor: OwnerKey
	readonly kinds: readonly number[]
}

/**
 * **The completeness report, as a value a test reads** (`design.md` §4.6). A kind that is rendered but
 * owned by no declaration is a named entry here, never a silence — the shape that let kind 30408 go
 * ungated.
 */
export interface CompletenessReport {
	readonly owners: readonly OwnerKey[]
	readonly owned: readonly OwnedKindRecord[]
	readonly ownedWithNoRules: readonly OwnedKindRecord[]
	readonly contributions: readonly ContributionRecord[]
	readonly grants: readonly GrantRecord[]
	/** Kinds the host declares it renders that no declaration owns (nor contributes to). */
	readonly unplaced: readonly number[]
}

/**
 * **The insertable thing is the registry, not the engine** (`design.md` §4.4). `register`/`withdraw` are
 * runtime in the ordinary sense; `snapshot` yields the engine's preset set, derived now.
 */
export interface PresetRegistry {
	readonly owners: readonly OwnerKey[]
	register(declaration: CommerceValidationDeclaration): void
	withdraw(owner: OwnerKey, kind?: number): void
	snapshot(): readonly ValidationPreset[]
	report(): CompletenessReport
}

export interface PresetRegistryOptions {
	readonly declarations?: readonly CommerceValidationDeclaration[]
	/** The kinds the host declares it renders — `unplaced` is rendered − owned. */
	readonly rendered?: readonly number[]
}

/** A mutable per-owner record: the declaration, with its owned kinds list, so `withdraw` can narrow it. */
interface Entry {
	readonly declaration: CommerceValidationDeclaration
	kinds: readonly KindOwnership[]
}

class RegistryImpl implements PresetRegistry {
	private readonly entries = new Map<OwnerKey, Entry>()
	private readonly byKind = new Map<number, OwnerKey>()
	private readonly rendered: readonly number[]

	constructor(options: PresetRegistryOptions) {
		this.rendered = options.rendered ?? []
		for (const declaration of options.declarations ?? []) this.admit(declaration)
		// Phase 2 runs ONCE over the whole set, so boot-time collection is order-independent: a
		// contributor may be declared before its owner and both halves are still checked.
		this.verify()
	}

	get owners(): readonly OwnerKey[] {
		return [...this.entries.keys()]
	}

	/**
	 * Runtime insertion (`design.md` §4.4). Phase 1 is admitted and applied; phase 2 is then checked
	 * against the **current** set, and a failure rolls the admission back — so a partial registration
	 * never leaves the registry inconsistent.
	 */
	register(declaration: CommerceValidationDeclaration): void {
		this.admit(declaration)
		try {
			this.verify()
		} catch (error) {
			this.retract(declaration.owner)
			throw error
		}
	}

	/** Remove an owner's declaration entirely, or one kind of it — restoring the engine's pass-through. */
	withdraw(owner: OwnerKey, kind?: number): void {
		const entry = this.entries.get(owner)
		if (entry === undefined) return
		if (kind === undefined) {
			this.retract(owner)
			return
		}
		entry.kinds = entry.kinds.filter((owned) => owned.kind !== kind)
		if (this.byKind.get(kind) === owner) this.byKind.delete(kind)
		// A withdrawal may strand the other half of a contribution; that is a state change, not a
		// declaration error, so it is surfaced by the next `snapshot`/`report` rather than thrown here.
		if (entry.kinds.length === 0 && entry.declaration.contributions.length === 0) this.retract(owner)
	}

	/** The engine's preset set, derived now: one preset per owned kind, with granted contributions merged. */
	snapshot(): readonly ValidationPreset[] {
		const presets: ValidationPreset[] = []
		for (const [owner, entry] of this.entries) {
			for (const owned of entry.kinds) {
				presets.push({
					name: `${owner}:${owned.kind}`,
					kinds: [owned.kind],
					checks: [...owned.checks, ...this.grantedChecks(owner, owned.kind)],
					...(entry.declaration.bounds === undefined ? {} : { bounds: entry.declaration.bounds }),
				})
			}
		}
		return presets
	}

	report(): CompletenessReport {
		const owned: OwnedKindRecord[] = []
		for (const [owner, entry] of this.entries) {
			for (const declaration of entry.kinds) {
				owned.push({
					owner,
					kind: declaration.kind,
					source: declaration.source,
					...(declaration.parser === undefined ? {} : { parser: declaration.parser }),
					checks: declaration.checks.length + this.grantedChecks(owner, declaration.kind).length,
				})
			}
		}
		const contributions: ContributionRecord[] = []
		const grants: GrantRecord[] = []
		for (const [owner, entry] of this.entries) {
			for (const contribution of entry.declaration.contributions) {
				contributions.push({ owner: contribution.via, contributor: owner, kind: contribution.kind, source: contribution.source })
			}
			for (const grant of entry.declaration.accepts) {
				grants.push({ owner, contributor: grant.from, kinds: grant.kinds })
			}
		}
		return {
			owners: this.owners,
			owned,
			ownedWithNoRules: owned.filter((record) => record.checks === 0),
			contributions,
			grants,
			unplaced: this.rendered.filter((kind) => !this.byKind.has(kind)),
		}
	}

	/* --------------------------------------------------------------------------------------------- */

	/** Phase 1 — the checks a declaration must pass on its own, plus the ownership collision. */
	private admit(declaration: CommerceValidationDeclaration): void {
		if (this.entries.has(declaration.owner)) {
			throw new DeclarationError({
				reason: 'duplicate-owner',
				detail: `owner ${declaration.owner} is already registered`,
			})
		}
		for (const owned of declaration.kinds) {
			if (!Number.isSafeInteger(owned.kind) || owned.kind < 0) {
				throw new DeclarationError({
					reason: 'not-a-positive-kind',
					kind: owned.kind,
					detail: `owner ${declaration.owner} declares kind ${String(owned.kind)}, which is not a non-negative integer`,
				})
			}
		}
		this.assertInterpretable(declaration)
		for (const owned of declaration.kinds) {
			const held = this.byKind.get(owned.kind)
			if (held !== undefined && held !== declaration.owner) {
				// The closed `(kind, claimed-by-two)` pair, and nothing else.
				throw new DeclarationError({
					reason: 'claimed-by-two',
					kind: owned.kind,
					claimedBy: [held, declaration.owner],
					detail: `kind ${owned.kind} is claimed by two owners, ${held} and ${declaration.owner}`,
				})
			}
		}
		this.entries.set(declaration.owner, { declaration, kinds: declaration.kinds })
		for (const owned of declaration.kinds) this.byKind.set(owned.kind, declaration.owner)
	}

	/** Phase 2 — the cross-declaration checks: both halves of every contribution/grant must exist. */
	private verify(): void {
		for (const [contributor, entry] of this.entries) {
			for (const contribution of entry.declaration.contributions) {
				const owner = this.byKind.get(contribution.kind)
				if (owner === undefined) {
					throw new DeclarationError({
						reason: 'contribution-ungranted',
						kind: contribution.kind,
						detail: `${contributor} contributes a demand for kind ${contribution.kind} via ${contribution.via}, but no owner is registered for that kind`,
					})
				}
				if (owner !== contribution.via) {
					throw new DeclarationError({
						reason: 'contribution-ungranted',
						kind: contribution.kind,
						detail: `${contributor} routes kind ${contribution.kind} to ${contribution.via}, but the registered owner is ${owner}`,
					})
				}
				const ownerEntry = this.entries.get(owner)
				const granted = ownerEntry?.declaration.accepts.some(
					(grant) => grant.from === contributor && grant.kinds.includes(contribution.kind),
				)
				if (granted !== true) {
					throw new DeclarationError({
						reason: 'contribution-ungranted',
						kind: contribution.kind,
						detail: `${contributor} contributes kind ${contribution.kind} via ${owner}, but ${owner} does not grant it`,
					})
				}
			}
		}
		for (const [owner, entry] of this.entries) {
			for (const grant of entry.declaration.accepts) {
				const contributor = this.entries.get(grant.from)
				if (contributor === undefined) {
					throw new DeclarationError({
						reason: 'grant-without-contribution',
						detail: `${owner} grants ${grant.from}, which declares nothing`,
					})
				}
				for (const kind of grant.kinds) {
					const contributed = contributor.declaration.contributions.some(
						(contribution: Contribution) => contribution.via === owner && contribution.kind === kind,
					)
					if (!contributed) {
						throw new DeclarationError({
							reason: 'grant-without-contribution',
							kind,
							detail: `${owner} grants ${grant.from} kind ${kind}, which ${grant.from} does not contribute`,
						})
					}
				}
			}
		}
	}

	/** A declared check the engine cannot interpret — refused here, at the declaration, before any candidate. */
	private assertInterpretable(declaration: CommerceValidationDeclaration): void {
		const bounds = declaration.bounds
		const chainDepth = bounds?.maxChainDepth ?? engineBounds().maxChainDepth
		if (chainDepth > 1) {
			throw new DeclarationError({
				reason: 'uninterpretable-check',
				detail: `${declaration.owner} declares maxChainDepth ${chainDepth}; the engine takes exactly one hop and does not interpret what a referenced event's own links are`,
			})
		}
		const ceiling = bounds?.maxReferencesPerEvent ?? engineBounds().maxReferencesPerEvent
		let links = 0
		for (const owned of declaration.kinds) {
			for (const check of owned.checks) {
				links += this.assertCheck(declaration.owner, check)
			}
		}
		for (const contribution of declaration.contributions) {
			for (const check of contribution.checks) links += this.assertCheck(declaration.owner, check)
		}
		if (links > ceiling) {
			throw new DeclarationError({
				reason: 'uninterpretable-check',
				detail: `${declaration.owner} declares ${links} reference(s) per event, past the maxReferencesPerEvent ceiling of ${ceiling}`,
			})
		}
	}

	/** One check: the comparator vocabulary is closed, and the union has exactly two members. Returns its link count. */
	private assertCheck(owner: OwnerKey, check: ValidationCheck): number {
		if (check.kind === 'format') return 0
		if (check.kind !== 'link') {
			throw new DeclarationError({
				reason: 'uninterpretable-check',
				detail: `${owner} declares a check of kind ${JSON.stringify((check as { kind?: unknown }).kind)}; the engine carries exactly two kinds, format and link`,
			})
		}
		for (const comparison of check.compare ?? []) {
			if (!COMPARATORS.includes(comparison.comparator)) {
				throw new DeclarationError({
					reason: 'uninterpretable-check',
					check: check.id,
					detail: `${owner}'s check ${check.id} names the comparator '${String(comparison.comparator)}', which the vocabulary (eq, exists, in) does not carry`,
				})
			}
		}
		return 1
	}

	/** The checks granted contributions route into `owner`'s `kind` — the merged half of the snapshot. */
	private grantedChecks(owner: OwnerKey, kind: number): readonly ValidationCheck[] {
		const checks: ValidationCheck[] = []
		for (const [contributor, entry] of this.entries) {
			const ownerEntry = this.entries.get(owner)
			const granted = ownerEntry?.declaration.accepts.some((grant) => grant.from === contributor && grant.kinds.includes(kind))
			if (granted !== true) continue
			for (const contribution of entry.declaration.contributions) {
				if (contribution.via === owner && contribution.kind === kind) checks.push(...contribution.checks)
			}
		}
		return checks
	}

	private retract(owner: OwnerKey): void {
		const entry = this.entries.get(owner)
		if (entry === undefined) return
		for (const owned of entry.kinds) {
			if (this.byKind.get(owned.kind) === owner) this.byKind.delete(owned.kind)
		}
		this.entries.delete(owner)
	}
}

/**
 * The registry factory. Boot-time collection is **order-independent**: every declaration is admitted
 * (phase 1) and then the whole set is verified (phase 2) once. A bad declaration throws
 * `DeclarationError` here, at boot, before any candidate is judged.
 */
export function createPresetRegistry(options: PresetRegistryOptions = {}): PresetRegistry {
	return new RegistryImpl(options)
}
