/**
 * `#e168d7` bolt11-wrapper/ts/errors.ts — the closed error surface.
 *
 * One error type, carrying a stable code: a leg that is unknown, an operation a leg does not declare, or an
 * injected port that is missing where the leg needs it all fail closed with a code a caller can branch on.
 */
export class Bolt11WrapperError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(message)
		this.name = 'Bolt11WrapperError'
		this.code = code
	}
}
