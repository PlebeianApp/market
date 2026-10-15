/**
 * schema.ts — **the kept half of the retired `sdk/core/validation.ts` seed**, absorbed into the rung.
 *
 * `sdk/core/validation.ts` asserted `EventSchemaRegistry`'s rule (one registration per kind, one owner,
 * a duplicate refused) but name-collided with the landed `sdk/core/validation/` module directory — both
 * were addressable as `./validation`, and **the file won** (`design.md` §1.1, §5). There is no aliasing
 * trick that makes a file yield to a sibling directory of the same name, so the file was removed and its
 * parts mapped one-for-one (`design.md` §5):
 *
 * | old name | fate |
 * | --- | --- |
 * | `EventSchemaRegistry.register` | becomes the declaration registry's `register`, with the bare `throw` widened to the `(kind, claimed-by-two)` refusal plus the declared contribution path (V2, §4.5) |
 * | `EventSchemaRegistry.validate` | **retired** — the engine's `Validator.validate`/`accept` is the one predicate; a second `validate` would be the "second definition of valid" |
 * | `EventSchema<Value>` | becomes `KindOwnership` (`kind` + `parser` + `checks`, §4.1) in the `sdk/commerce` declarations |
 * | `validateEventWithSchema` | **retired** — its kind check is subsumed by the engine routing by kind |
 * | `validateWithSchema` / `RuntimeSchema` | **move here, unchanged**, as the guard's own shape-check for a declaration and a parser (`Result<Value, ValidationError>`) |
 * | `isRecord` / `errorMessage` | `errorMessage` moves with `validateWithSchema`; `isRecord` retires — its only two consumers (`validateEventWithSchema`, `EventSchemaRegistry.validate`) retired with their rules, so carrying it would be dead code |
 *
 * Nothing here is new: this is the seed's kept half verbatim, so the move is falsifiable by diff.
 */
import { failure, success, type Result } from '../../result'
import { ValidationError } from '../../errors'

/**
 * The shape a parser must have: it takes untrusted input and returns the parsed value or throws. The
 * engine's own `parse`-carrying schemas are gone; this stays as the **guard's** shape-check, so a
 * declaration naming a parser can be validated at registration without the rung knowing any kind.
 */
export interface RuntimeSchema<Value> {
	parse(input: unknown): Value
}

/**
 * Apply a parser under a `Result`, turning a throw into a failed `Result` rather than an escaping
 * rejection — the shape the declaration guard wants when it checks a cited parser at boot.
 */
export function validateWithSchema<Value>(input: unknown, schema: RuntimeSchema<Value>): Result<Value, ValidationError> {
	try {
		return success(schema.parse(input))
	} catch (cause) {
		return failure(new ValidationError(errorMessage(cause), undefined, cause))
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
