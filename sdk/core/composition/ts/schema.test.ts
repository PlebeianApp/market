/**
 * schema.test.ts — the moved assertions for the absorbed half of `sdk/core/validation.ts`.
 *
 * These two assertions used to live in `sdk/core/core.test.ts` (the seed's only consumer outside the
 * barrel). They moved here with `validateWithSchema`/`RuntimeSchema` when the shadowing file was
 * removed (`design.md` §5), so the retired file is gone and its kept behaviour is still proved.
 *
 * **The mutation that turns it red:** make `validateWithSchema` swallow the parser's throw (return
 * `success` from the `catch`) → the failure assertion fails; drop the `try`/`catch` → the case errors.
 */
import { describe, expect, test } from 'bun:test'

import { validateWithSchema } from './schema'

describe('the absorbed half of sdk/core/validation.ts', () => {
	test('wraps schema success and failure in a Result', () => {
		const schema = { parse: (input: unknown) => ({ value: String(input) }) }
		expect(validateWithSchema(42, schema)).toEqual({ ok: true, value: { value: '42' } })
		expect(
			validateWithSchema('bad', {
				parse: () => {
					throw new Error('invalid input')
				},
			}),
		).toMatchObject({ ok: false, error: { code: 'validation_failed', message: 'invalid input' } })
	})
})
