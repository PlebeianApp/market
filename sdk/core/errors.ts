export type SdkErrorCode = 'validation_failed' | 'unsupported_operation' | 'operation_failed'

export class SdkError extends Error {
	readonly code: SdkErrorCode
	readonly cause?: unknown

	constructor(code: SdkErrorCode, message: string, cause?: unknown) {
		super(message)
		this.name = 'SdkError'
		this.code = code
		this.cause = cause
	}
}

export class ValidationError extends SdkError {
	readonly path?: readonly (string | number)[]

	constructor(message: string, path?: readonly (string | number)[], cause?: unknown) {
		super('validation_failed', message, cause)
		this.name = 'ValidationError'
		this.path = path
	}
}
