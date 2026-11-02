/**
 * Server-side recovery-only admission guard.
 *
 * Route names are mapped inside the fixed authority service; a browser cannot
 * select a guard capability.  Every mutating recovery request must resolve to
 * durable state that existed before recovery-only mode was enabled.  Absence,
 * timeout, malformed identity, or store error always refuses the request.
 */
import {
	validateDemoFridayFundingAbortRecoveryCapsule,
	type DemoFridayFundingAbortRecoveryCapsuleV1,
} from './demo-friday-funding-abort-capsule'

const HEX_32 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/

export type DemoFridayRecoveryOnlyAction =
	| 'funding_confirm'
	| 'funding_status'
	| 'terminal_read'
	| 'terminal_ack'
	| 'seller_challenge'
	| 'seller_read'
	| 'seller_register'
	| 'auction_funding_read'
	| 'abort_capsule'
	| 'abort_prepare'
	| 'abort_request'
	| 'abort_status'

export interface DemoFridayRecoveryOnlyGuardPort {
	assertRecordedExact(action: DemoFridayRecoveryOnlyAction, value: unknown): Promise<void>
}

export interface DemoFridayRecoveryOnlySources {
	/**
	 * Read the exact durable broadcast phase. Recovery mode may observe any
	 * recorded row, but it may only resume confirm for a transaction which was
	 * already submitted (or admitted) before the mode was enabled. In
	 * particular, a merely prepared/signed row must never become a new broadcast
	 * through the recovery endpoint.
	 */
	readFundingRecoveryPhaseExact(eventId: string):
		| 'claimed' | 'prepared' | 'signed' | 'broadcasting' | 'broadcast' | 'admitted' | 'quarantined' | null
	hasTerminalNoticeExact(actor: string, operationId: string): boolean
	hasSellerPlanExact(operationId: string): boolean
	readAbortCapsuleExact(operationId: string): Promise<DemoFridayFundingAbortRecoveryCapsuleV1>
}

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_RECOVERY_ONLY: ${message}`) }
function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('request is not an object')
	return value as Record<string, unknown>
}
function operation(value: unknown): string {
	if (typeof value !== 'string' || !ID.test(value)) refuse('operation identity is malformed')
	return value
}
function actor(value: unknown): string {
	if (typeof value !== 'string' || !HEX_32.test(value)) refuse('actor identity is malformed')
	return value
}
function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') refuse('unsupported value')
	const held = value as Record<string, unknown>
	return `{${Object.keys(held).sort().map((key) => `${JSON.stringify(key)}:${canonical(held[key])}`).join(',')}}`
}

async function exactAbortCapsule(sources: DemoFridayRecoveryOnlySources, operationId: string) {
	return validateDemoFridayFundingAbortRecoveryCapsule(await sources.readAbortCapsuleExact(operationId))
}

export function createDemoFridayRecoveryOnlyGuard(
	sources: DemoFridayRecoveryOnlySources,
): DemoFridayRecoveryOnlyGuardPort {
	return Object.freeze({
		async assertRecordedExact(action: DemoFridayRecoveryOnlyAction, value: unknown): Promise<void> {
			const raw = record(value)
			if (action === 'funding_confirm' || action === 'funding_status') {
				const eventId = String(raw.fundingAuthorizationEventId)
				const phase = HEX_32.test(eventId) ? sources.readFundingRecoveryPhaseExact(eventId) : null
				if (phase === null) {
					refuse('funding authorization was not recorded before recovery mode')
				}
				if (action === 'funding_confirm' && !['broadcasting', 'broadcast', 'admitted'].includes(phase)) {
					refuse('funding authorization was not already broadcast before recovery mode')
				}
				return
			}
			if (action === 'terminal_read' || action === 'terminal_ack') {
				if (!sources.hasTerminalNoticeExact(actor(raw.actor), operation(raw.fundingOperationId))) {
					refuse('terminal notice was not recorded before recovery mode')
				}
				return
			}
			if (action === 'seller_challenge' || action === 'seller_read'
				|| action === 'auction_funding_read') {
				if (!sources.hasSellerPlanExact(operation(raw.fundingOperationId))) {
					refuse('seller plan was not recorded before recovery mode')
				}
				return
			}
			if (action === 'seller_register') {
				const operationId = operation((raw.plan as Record<string, unknown> | undefined)?.fundingOperationId)
				if (!sources.hasSellerPlanExact(operationId)) {
					refuse('seller challenge was not recorded before recovery mode')
				}
				return
			}
			if (action === 'abort_capsule') {
				const supplied = validateDemoFridayFundingAbortRecoveryCapsule(
					value as DemoFridayFundingAbortRecoveryCapsuleV1,
				)
				const held = await exactAbortCapsule(sources, supplied.refund.operationId)
				if (canonical(held) !== canonical(supplied)) refuse('abort capsule differs from recorded operation')
				return
			}
			if (action === 'abort_prepare' || action === 'abort_status') {
				await exactAbortCapsule(sources, operation(raw.fundingOperationId))
				return
			}
			if (action === 'abort_request') {
				const event = record(raw.actorAbortEvent)
				let content: unknown
				try { content = JSON.parse(String(event.content)) as unknown }
				catch { return refuse('abort authorization content is not JSON') }
				await exactAbortCapsule(sources, operation(record(content).operationId))
				return
			}
			refuse('recovery action is unsupported')
		},
	})
}
