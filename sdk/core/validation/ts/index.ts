/**
 * index.ts — the contract entry: exactly the symbols the module MD's `contract.exports` and
 * `contract.types` name, and nothing else. `evidence/run.sh` diffs the three lists, so a
 * delivered export the spec does not declare, or a declared one that does not exist, is a
 * finding.
 *
 * **The surface is presets in, checks run, and nothing by default** (`#07b8c7`, `#485b96`):
 * `createValidator` builds the module's two operations, `PASS_THROUGH` is the declared value a
 * host reads when it declares nothing, and `ValidationError` is the one error the module ever
 * raises. The eight type names are the spec's own.
 *
 * Nothing in this module reads this repository, the app or a host: the specifier allow-list is
 * `./<module file>`, `nostr-tools[/…]`, `rxjs` and `bun:test` (tests only). No specifier leaves
 * this directory (`#8e6079`, `#40d21a` (provenance)).
 */
export { createValidator } from './validator'
export { PASS_THROUGH } from './presets'
export { ValidationError } from './errors'
export type {
	Event,
	// The composition's accept hook context: the contract names it (`validation.md`), so the entry carries it -
	// `browse` used to reach into `./types` for it, off this module's declared entry (an audit's finding W10).
	AcceptContext,
	ValidationPreset,
	ValidationCheck,
	ValidationOutcome,
	ValidationRefusal,
	ValidationPort,
	ValidatorOptions,
	Validator,
} from './types'
