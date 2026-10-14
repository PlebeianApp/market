export type SdkErrorCode = 'validation_failed' | 'unsupported_operation' | 'operation_failed' | 'workflow_failed' | 'outcome_uncertain'

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

export type WorkflowErrorStatus = 'failed' | 'uncertain'

/** Structured failure metadata shared by SDK workflows; domain outcomes retain their own statuses/details. */
export class WorkflowError extends SdkError {
	readonly workflow: string
	readonly phase: string
	readonly status: WorkflowErrorStatus

	constructor(params: { workflow: string; phase: string; status: WorkflowErrorStatus; message: string; cause?: unknown }) {
		super(params.status === 'uncertain' ? 'outcome_uncertain' : 'workflow_failed', params.message, params.cause)
		this.name = 'WorkflowError'
		this.workflow = params.workflow
		this.phase = params.phase
		this.status = params.status
	}
}

export function createWorkflowError(params: {
	workflow: string
	phase: string
	status?: WorkflowErrorStatus
	error: unknown
}): WorkflowError {
	return new WorkflowError({
		workflow: params.workflow,
		phase: params.phase,
		status: params.status ?? 'failed',
		message: params.error instanceof Error ? params.error.message : String(params.error),
		cause: params.error,
	})
}
