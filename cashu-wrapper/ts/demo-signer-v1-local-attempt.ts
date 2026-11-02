/** Local liveness contract only. A cached unsigned 422 proves nothing to a peer. */
import { createDemoSignerPurePhase, DemoSignerCachedRejection, DemoSignerOpaquePolicyRefusal, DemoSignerJournalConflict, type DemoSignerPureContext, type DemoSignerPureReason } from './demo-signer-pure-policy'
import type { DemoSignerJournalInspection } from './demo-signer-rpc-journal-v2'
import type { DemoSignerSerialization } from './demo-signer-serialization'

export interface DemoSignerLocalJournal<R> {
	assertReady(): Promise<void>
	inspect(id: string, digest: string): Promise<DemoSignerJournalInspection<R>>
	claim(id: string, digest: string): Promise<{ status: 'created' } | Exclude<DemoSignerJournalInspection<R>, { status: 'absent' }>>
	rejectNoEffect(id: string, digest: string, reason: DemoSignerPureReason, witness: string): Promise<never>
}
export interface DemoSignerLocalAttempt {
	gate: DemoSignerSerialization
	captureWitness(): string
	assertWitness(witness: string): void
}
export async function runDemoSignerV1LocalAttempt<R, P>(options: {
	id: string; digest: string; signal: AbortSignal; local: DemoSignerLocalAttempt; journal: DemoSignerLocalJournal<R>
	preflight(context: DemoSignerPureContext): Promise<P>
	perform(prepared: P): Promise<R>
	replay?(response: R, context: DemoSignerPureContext): Promise<void>
}): Promise<R> {
	return options.local.gate.run(options.signal, async () => {
		const { journal, local } = options
		let uncertainPending = false
		try {
			await journal.assertReady()
			const prior = await journal.inspect(options.id, options.digest)
			if (prior.status === 'rejected') throw new DemoSignerCachedRejection(prior.body)
			if (prior.status === 'replay') {
				if (options.replay) {
					const witness = local.captureWitness(), phase = createDemoSignerPurePhase(options.signal)
					try { await phase.run((context) => options.replay!(prior.response, context)) }
					catch (error) {
						local.assertWitness(witness)
						const category = phase.classification(error)
						if (category.kind === 'unavailable') throw new DemoSignerTransientReadUnavailable()
						if (category.kind === 'refused') throw new DemoSignerOpaquePolicyRefusal(category.reason)
						throw error
					}
					local.assertWitness(witness)
				}
				return structuredClone(prior.response)
			}
			if (prior.status !== 'absent') throw new Error('DEMO_SIGNER_QUARANTINED: prior pending is never owned by this invocation')
			const witness = local.captureWitness()
			const phase = createDemoSignerPurePhase(options.signal)
			let prepared: P
			try { prepared = await phase.run(options.preflight) }
			catch (error) {
				const category = phase.classification(error)
				local.assertWitness(witness)
				if (category.kind === 'refused' && !options.signal.aborted) {
					return await journal.rejectNoEffect(options.id, options.digest, category.reason, witness)
				}
				if (category.kind === 'unavailable') throw new DemoSignerTransientReadUnavailable()
				// Unknown errors reserve an uncertain pending row. This is never a
				// terminal refusal or permission to retry/release anything remotely.
				uncertainPending = true
				await journal.claim(options.id, options.digest); throw error
			}
			local.assertWitness(witness)
			if (options.signal.aborted) throw new DemoSignerTransientReadUnavailable()
			uncertainPending = true
			const claimed = await journal.claim(options.id, options.digest)
			if (claimed.status !== 'created') throw new Error('DEMO_SIGNER_QUARANTINED: current invocation did not create pending')
			// From this point every callback/error is effectful/uncertain, including
			// idempotent claims and any Rust invocation. No pending-to-rejected path.
			if (options.signal.aborted) throw new Error('DEMO_SIGNER_QUARANTINED: canceled after durable pending')
			local.gate.check()
			return await options.perform(prepared)
		} catch (error) {
			if (uncertainPending) {
				local.gate.poison()
				throw new Error('DEMO_SIGNER_QUARANTINED: effect-stage or pending outcome uncertain')
			}
			if (error instanceof DemoSignerCachedRejection || error instanceof DemoSignerOpaquePolicyRefusal || error instanceof DemoSignerTransientReadUnavailable || error instanceof DemoSignerJournalConflict) throw error
			local.gate.poison()
			throw new Error('DEMO_SIGNER_QUARANTINED: uncertain local outcome')
		}
	})
}
export class DemoSignerTransientReadUnavailable extends Error {
	constructor() { super('DEMO_SIGNER_READ_TEMPORARILY_UNAVAILABLE'); this.name = 'DemoSignerTransientReadUnavailable' }
}
