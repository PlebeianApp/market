import { failure, success, type Result } from './result'
import { ValidationError } from './errors'

export interface RuntimeSchema<Value> {
	parse(input: unknown): Value
}

export interface EventSchema<Value> extends RuntimeSchema<Value> {
	kind?: number
}

export function validateWithSchema<Value>(input: unknown, schema: RuntimeSchema<Value>): Result<Value, ValidationError> {
	try {
		return success(schema.parse(input))
	} catch (cause) {
		return failure(new ValidationError(errorMessage(cause), undefined, cause))
	}
}

/** Check the event kind before delegating untrusted event data to its parser. */
export function validateEventWithSchema<Value>(input: unknown, schema: EventSchema<Value>): Result<Value, ValidationError> {
	if (!isRecord(input) || typeof input.kind !== 'number' || !Number.isSafeInteger(input.kind) || input.kind < 0) {
		return failure(new ValidationError('Event kind must be a non-negative integer', ['kind']))
	}
	if (schema.kind !== undefined && input.kind !== schema.kind) {
		return failure(new ValidationError(`Expected event kind ${schema.kind}, received ${input.kind}`, ['kind']))
	}
	return validateWithSchema(input, schema)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
