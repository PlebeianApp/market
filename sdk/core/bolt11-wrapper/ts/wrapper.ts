/**
 * bolt11-wrapper/ts/wrapper.ts — the contract's port, implemented over the bolt11 rail.
 *
 * `#e168d7` the wrapper implements the port: `obtain` writes the leg's durable reference before money
 * moves, `submit` is the one irreversible step, and `reconcile` re-reads an authority and never submits.
 * The rail's four legs each declare the subset of the port's operations they have (`#c912d5`), the leg
 * record carries an absolute reconcile deadline from the injected clock (`#4709ce`), and the witness
 * handling is the contract's ladder (`#745885`).
 */
import { Bolt11WrapperError } from './errors'
import type {
	Bolt11LegCommand,
	Bolt11LegKind,
	Bolt11LegRecord,
	Bolt11OperationsDeclaration,
	Bolt11WrapperOptions,
} from './types'
import type {
	FundsAuthorityKind,
	FundsHandle,
	FundsOperations,
	FundsQuote,
	FundsRefusal,
	FundsStep,
	FundsWitness,
	FundsWitnessKind,
	WrapperRegistration,
} from '../../funds-contract/ts/index'

const METHOD = 'bolt11'
const CONTRACT_PORT = 'funds-contract'
const AUTHORITY_KIND: FundsAuthorityKind = 'remote-and-observable'

/** The port's canonical order; every leg's plan is this order projected onto the leg's subset. */
const CANONICAL: readonly FundsStep[] = ['obtain', 'submit', 'reconcile']
const ALL_OPERATIONS: FundsOperations = ['obtain', 'submit', 'reconcile']

/** The port's operations each leg declares it has. The passive legs omit `submit` by construction. */
const LEG_OPERATIONS: Record<Bolt11LegKind, FundsOperations> = {
	webln: ['obtain', 'submit', 'reconcile'],
	'manual-preimage': ['obtain', 'submit', 'reconcile'],
	'broadcast-quote': ['obtain', 'reconcile'],
	'lnurl-request': ['obtain', 'reconcile'],
}

const planFor = (operations: FundsOperations): readonly FundsStep[] =>
	CANONICAL.filter((step) => operations.includes(step))

const LEG_KINDS = Object.keys(LEG_OPERATIONS) as Bolt11LegKind[]

const LEG_DECLARATIONS: readonly Bolt11OperationsDeclaration[] = LEG_KINDS.map((kind) => ({
	kind,
	operations: LEG_OPERATIONS[kind],
	plan: planFor(LEG_OPERATIONS[kind]),
}))

/** The witness kinds the rail can produce: a validated preimage (cryptographic), and the declared two. */
const WITNESS_KINDS: readonly FundsWitnessKind[] = ['preimage', 'lnurl_verify', 'ack']

const handleFor = (record: Bolt11LegRecord): FundsHandle => ({
	wrapperId: record.wrapperId,
	legId: record.legId,
	progress: record.progress,
	rung: record.rung,
	witness: record.witness,
	unwitnessed: record.unwitnessed,
	reconcileDeadlineAt: record.reconcileDeadlineAt,
})

const refusal = (reason: string, field: string): FundsRefusal => ({ refused: true, reason, field })

/**
 * `#e168d7` Bolt11Wrapper — the contract's port over the bolt11 rail. Every library call (the invoice
 * codec, the signer, the LNURL requester, the LNURL verifier) and the leg store and clock are injected;
 * the module opens no network of its own (`#885295`).
 */
export class Bolt11Wrapper {
	private readonly options: Bolt11WrapperOptions

	constructor(options: Bolt11WrapperOptions) {
		if (typeof options.now !== 'function') {
			throw new Bolt11WrapperError('bolt11_configuration', 'the wrapper requires an injected clock')
		}
		if (!Number.isFinite(options.reconcileDeadlineMs) || options.reconcileDeadlineMs < 0) {
			throw new Bolt11WrapperError('bolt11_configuration', 'reconcileDeadlineMs must be a non-negative number')
		}
		this.options = options
	}

	get wrapperId(): string {
		return this.options.wrapperId
	}

	/** The rail has four legs, each declaring the subset of the port's operations it has (`#c912d5`). */
	get declarations(): readonly Bolt11OperationsDeclaration[] {
		return LEG_DECLARATIONS
	}

	/** The subset of the port's three operations one leg kind has, in the port's canonical order. */
	operationsFor(kind: Bolt11LegKind): FundsOperations {
		return LEG_OPERATIONS[kind]
	}

	/** The leg's declared plan: its operations projected onto the port's canonical order. */
	planFor(kind: Bolt11LegKind): readonly FundsStep[] {
		return planFor(LEG_OPERATIONS[kind])
	}

	/** The declaration the aggregator's acceptance gate validates (`#388e47`). */
	get registration(): WrapperRegistration {
		return {
			wrapperId: this.options.wrapperId,
			method: METHOD,
			port: CONTRACT_PORT,
			authorityKind: AUTHORITY_KIND,
			operations: ALL_OPERATIONS,
			plan: planFor(ALL_OPERATIONS),
			store: 'bolt11-leg-store',
			storeKind: this.options.storeKind,
			witnessKinds: WITNESS_KINDS,
			reconcileDeadlineMs: this.options.reconcileDeadlineMs,
			journalReference: { shape: 'bolt11+payment_hash', writtenBefore: 'submit' },
			ceiling: this.options.ceiling,
			contractVersion: this.options.contractVersion,
		}
	}

	/**
	 * `#e168d7` obtain — resolve the leg's durable reference (the invoice and its payment hash, plus the
	 * LNURL verification URL when the request carries one) and **write the leg record before any money
	 * moves**. The record is created at exposure for every leg, money-moving or passive alike.
	 */
	async obtain(command: Bolt11LegCommand): Promise<FundsQuote | FundsRefusal> {
		const now = this.options.now()
		let bolt11: string | undefined = command.bolt11
		let verifyUrl: string | null | undefined = command.verifyUrl ?? null

		if (!bolt11) {
			if (!command.lnurl) return refusal('no-reference', 'bolt11')
			if (!this.options.lnurlRequester) return refusal('missing-requester', 'lnurlRequester')
			const requested = await this.options.lnurlRequester.requestInvoice(
				command.lnurl,
				command.amountSat,
				command.description,
			)
			bolt11 = requested.bolt11
			verifyUrl = requested.verifyUrl ?? null
		}
		if (!bolt11) return refusal('no-reference', 'bolt11')

		let paymentHash: string
		try {
			paymentHash = this.options.codec.paymentHash(bolt11)
		} catch {
			return refusal('undecodable-invoice', 'bolt11')
		}
		if (!paymentHash) return refusal('undecodable-invoice', 'bolt11')

		const operations = this.operationsFor(command.kind)
		const record: Bolt11LegRecord = {
			wrapperId: this.options.wrapperId,
			legId: paymentHash,
			kind: command.kind,
			method: METHOD,
			authorityKind: AUTHORITY_KIND,
			operations,
			plan: planFor(operations),
			bolt11,
			paymentHash,
			verifyUrl,
			progress: 'attempted',
			rung: 'unresolved',
			unwitnessed: true,
			reconcileDeadlineAt: now + this.options.reconcileDeadlineMs,
			revision: 0,
			createdAt: now,
			updatedAt: now,
		}
		// The durable reference is written BEFORE the irreversible step: nothing moves unless this landed.
		const stored = await this.options.store.createOrGet(record)

		return {
			wrapperId: stored.record.wrapperId,
			legId: stored.record.legId,
			method: METHOD,
			authorityKind: AUTHORITY_KIND,
			operations: stored.record.operations,
			plan: stored.record.plan,
			reference: stored.record.bolt11,
		}
	}

	/**
	 * `#e168d7` submit — the one irreversible step. It refuses a leg whose declaration omits `submit` (the
	 * passive legs are legal without one); for the browser-signer leg it hands the invoice to the injected
	 * signer, and for the manual-preimage leg it validates the preimage the buyer supplied as `reference`.
	 */
	async submit(quote: FundsQuote, reference: string): Promise<FundsHandle> {
		const record = await this.options.store.get({
			wrapperId: this.options.wrapperId,
			legId: quote.legId,
		})
		if (!record) throw new Bolt11WrapperError('bolt11_leg_unknown', `no leg ${quote.legId}`)
		if (!record.operations.includes('submit')) {
			throw new Bolt11WrapperError('bolt11_operation_absent', `leg ${record.legId} declares no submit`)
		}
		if (record.kind === 'manual-preimage') return this.submitPreimage(record, reference)
		return this.submitViaSigner(record)
	}

	/**
	 * `#e168d7` reconcile — idempotent, and it **never submits**: it re-reads the leg's verification
	 * reference and nothing else. A cryptographic settle already held is returned unchanged (write-once); a
	 * look-up that cannot conclude leaves the leg blocked. `#dc6ab1` a leg that holds no witness and whose
	 * invoice has expired reaches the non-settlement terminal `abandoned`.
	 */
	async reconcile(reference: string): Promise<FundsHandle> {
		let legId: string
		try {
			legId = this.options.codec.paymentHash(reference)
		} catch {
			throw new Bolt11WrapperError('bolt11_leg_unknown', 'reconcile: the reference names no leg')
		}
		const record = await this.options.store.get({ wrapperId: this.options.wrapperId, legId })
		if (!record) throw new Bolt11WrapperError('bolt11_leg_unknown', `reconcile: no leg ${legId}`)

		// Write-once: a cryptographic settlement is terminal and is never downgraded by a later observation.
		if (record.rung === 'witnessed-settled') return handleFor(record)
		// `#dc6ab1` the non-settlement terminal is terminal too: write-once and not reversible.
		if (record.rung === 'abandoned') return handleFor(record)
		// A declared rung that is already attested is likewise not lowered.
		if (record.rung === 'attested' && record.witness?.kind !== 'lnurl_verify') return handleFor(record)

		// The ONLY reconcile action: re-ask the rail's verification reference. No submit path is touched.
		if (record.verifyUrl && this.options.lnurlVerifier) {
			const answer = await this.options.lnurlVerifier.verify(record.verifyUrl)
			if (answer.ok && answer.settled) {
				const preimage = typeof answer.preimage === 'string' ? answer.preimage : undefined
				if (preimage && this.options.codec.validatePreimage(record.bolt11, preimage)) {
					// `#745885` a preimage validating against the payment hash settles the leg
					return this.settle(record, { kind: 'preimage', source: 'lnurl_verify', observedAt: this.options.now() })
				}
				// `#745885` a declared verification reaches only the weaker named rung
				return this.attest(record, {
					kind: 'lnurl_verify',
					source: 'lnurl_verify',
					observedAt: this.options.now(),
				})
			}
			// `#dc6ab1` a look-up that FAILED is not a conclusion: the artifact could still be reported, so
			// the leg stays blocked — a failure never reaches the non-settlement terminal.
			if (!answer.ok) return handleFor(record)
			// a definite "not settled" answer falls through to the window rule below.
		} else if (record.verifyUrl) {
			// `#dc6ab1` a verification reference exists but no verifier is injected: the channel is unwired,
			// so a witness may still arrive and the leg stays blocked.
			return handleFor(record)
		}

		// `#dc6ab1` the ONLY rule that reaches the non-settlement terminal `abandoned`: no witness exists
		// AND none can still arrive — the invoice's own window has elapsed. It is never the reconcile wait
		// bound the record carries, which is a wait bound and not a settleability bound (`#4709ce`).
		if (this.hasExpired(record)) return this.abandon(record)
		// The window is still open: a witness may still arrive — stay `unresolved`.
		return handleFor(record)
	}

	/** `#dc6ab1` the rail's window: the invoice's own expiry, from the injected codec and the injected clock. */
	private hasExpired(record: Bolt11LegRecord): boolean {
		try {
			return this.options.now() >= this.options.codec.expiresAt(record.bolt11)
		} catch {
			return false
		}
	}

	/**
	 * `#dc6ab1` abandon — record the non-settlement terminal, and the one place the terminal's condition is
	 * enforced. It is **not a settlement**: the leg carries no witness and stays unwitnessed. It is reached
	 * **only where no witness exists** — a settled, attested or already-abandoned leg is returned unchanged —
	 * and it is write-once and not reversible, so a later observation never reopens it to a settlement.
	 */
	private async abandon(record: Bolt11LegRecord): Promise<FundsHandle> {
		if (record.rung !== 'unresolved' || record.unwitnessed !== true) return handleFor(record)
		const next: Bolt11LegRecord = {
			...record,
			rung: 'abandoned',
			revision: record.revision + 1,
			updatedAt: this.options.now(),
		}
		const stored = await this.options.store.compareAndSet(
			{ wrapperId: record.wrapperId, legId: record.legId },
			record.revision,
			next,
		)
		return handleFor(stored)
	}

	private async submitViaSigner(record: Bolt11LegRecord): Promise<FundsHandle> {
		if (!this.options.signer) {
			throw new Bolt11WrapperError('bolt11_missing-signer', `leg ${record.legId} needs an injected signer`)
		}
		// THE IRREVERSIBLE STEP. The record, with its reference, already exists from `obtain`.
		const result = await this.options.signer.sendPayment(record.bolt11)
		const preimage = result && typeof result.preimage === 'string' ? result.preimage : undefined
		if (preimage && this.options.codec.validatePreimage(record.bolt11, preimage)) {
			// `#745885` a validated preimage is the cryptographic witness that settles
			return this.settle(record, { kind: 'preimage', source: 'webln', observedAt: this.options.now() })
		}
		// `#745885` a bare acknowledgement with no preimage is a DECLARED witness: attested, never settled
		return this.attest(record, { kind: 'ack', source: 'webln', observedAt: this.options.now() })
	}

	private async submitPreimage(record: Bolt11LegRecord, preimage: string): Promise<FundsHandle> {
		if (!preimage) return handleFor(record)
		if (this.options.codec.validatePreimage(record.bolt11, preimage)) {
			// `#745885` a preimage validated against the payment hash settles the manual leg
			return this.settle(record, { kind: 'preimage', source: 'manual', observedAt: this.options.now() })
		}
		// `#745885` a preimage that does not validate settles nothing and the leg keeps its state
		return handleFor(record)
	}

	private async settle(record: Bolt11LegRecord, witness: FundsWitness): Promise<FundsHandle> {
		// `#dc6ab1` not reversible: a later observation never reopens an abandoned leg to a settlement.
		if (record.rung === 'witnessed-settled' || record.rung === 'abandoned') return handleFor(record)
		const next: Bolt11LegRecord = {
			...record,
			progress: 'submitted',
			rung: 'witnessed-settled',
			witness,
			unwitnessed: false,
			revision: record.revision + 1,
			updatedAt: this.options.now(),
		}
		const stored = await this.options.store.compareAndSet(
			{ wrapperId: record.wrapperId, legId: record.legId },
			record.revision,
			next,
		)
		return handleFor(stored)
	}

	private async attest(record: Bolt11LegRecord, witness: FundsWitness): Promise<FundsHandle> {
		// `#dc6ab1` not reversible: a later observation never reopens an abandoned leg.
		if (record.rung === 'witnessed-settled' || record.rung === 'abandoned') return handleFor(record)
		const next: Bolt11LegRecord = {
			...record,
			progress: 'submitted',
			rung: 'attested',
			witness,
			unwitnessed: false,
			revision: record.revision + 1,
			updatedAt: this.options.now(),
		}
		const stored = await this.options.store.compareAndSet(
			{ wrapperId: record.wrapperId, legId: record.legId },
			record.revision,
			next,
		)
		return handleFor(stored)
	}
}
