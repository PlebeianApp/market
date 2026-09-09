/**
 * Deposit identity preservation across a paid-or-uncertain close — review
 * contract item 3 for PR #1235 (blocker 3).
 *
 * Invariants under test:
 *  1. `cancelDeposit({ preserveRecovery: true })` keeps the deposit/quote
 *     identity so `checkDepositNow()` / `retryDepositConfirmation()` can
 *     still reconcile the SAME Lightning payment without creating a new
 *     funding session.
 *  2. Default `cancelDeposit()` still fully clears the session
 *     (backward compatibility).
 *  3. The `success`/`error` listeners `startDeposit` attaches are
 *     identity-guarded: a late event from deposit #1 must not corrupt
 *     deposit #2's status.
 *
 * The tests drive the real store actions with an in-memory wallet mock —
 * zero external network calls (ADR-0005). The mock invoice is a
 * checksum-valid bolt11 string for 2000 sats (taken from
 * light-bolt11-decoder's own fixtures) so `startDeposit`'s real invoice
 * validation path (`extractInvoiceAmountSats` +
 * `validateAuctionDepositInvoiceQuote`) executes as in production.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { nip60Actions, nip60Store } from '@/lib/stores/nip60'

const TEST_MINT = 'https://mint.example.test'
/** Checksum-valid bolt11 invoice encoding a 2,000 sat amount. */
const BOLT11_INVOICE_2000_SATS =
	'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567'

type DepositEventName = 'success' | 'error'
type DepositHandler = (value?: unknown) => void

interface MockDeposit {
	on: (event: DepositEventName, handler: DepositHandler) => undefined
	start: () => Promise<string>
	check: (timeoutMs?: number) => Promise<void>
	/**
	 * Whether the next check() call finds the quote paid — mimics the real
	 * NDKCashuDeposit.check() emitting 'success' when the mint reports the
	 * Lightning invoice settled.
	 */
	checkFindsPayment: boolean
	emitSuccess: () => void
	emitError: (error: string) => void
	getCheckCalls: () => number
}

const createMockDeposit = (invoice: string): MockDeposit => {
	// EventEmitter semantics: multiple listeners per event (the store
	// listeners and monitorDepositConfirmation both subscribe).
	const handlers: Record<DepositEventName, DepositHandler[]> = { success: [], error: [] }
	let checkCalls = 0
	let checkFindsPayment = false
	const deposit: MockDeposit = {
		on: (event, handler) => {
			handlers[event].push(handler)
			return undefined
		},
		start: async () => invoice,
		check: async () => {
			checkCalls += 1
			if (checkFindsPayment) deposit.emitSuccess()
		},
		get checkFindsPayment() {
			return checkFindsPayment
		},
		set checkFindsPayment(value: boolean) {
			checkFindsPayment = value
		},
		emitSuccess: () => handlers.success.forEach((handler) => handler(null)),
		emitError: (error) => handlers.error.forEach((handler) => handler(error)),
		getCheckCalls: () => checkCalls,
	}
	return deposit
}

interface MockWallet {
	mints: string[]
	mintBalances: Record<string, number>
	state: { getProofs: () => never[]; dump: () => { proofs: unknown[] } }
	deposit: (amount: number, mint: string) => MockDeposit
	fetchTransactions: () => Promise<never[]>
	subscribeTransactions: (callback: (tx: unknown) => void) => () => void
}

const createMockWallet = (deposits: MockDeposit[]): MockWallet => ({
	mints: [],
	mintBalances: {},
	state: {
		getProofs: () => [],
		dump: () => ({ proofs: [] }),
	},
	deposit: (_amount, _mint) => {
		const deposit = createMockDeposit(BOLT11_INVOICE_2000_SATS)
		deposits.push(deposit)
		return deposit
	},
	fetchTransactions: async () => [],
	subscribeTransactions: () => () => undefined,
})

/** Install a mock wallet in the store and start a real `startDeposit` flow. */
const startMockDeposit = async (): Promise<MockDeposit[]> => {
	const deposits: MockDeposit[] = []
	nip60Store.setState((s) => ({
		...s,
		wallet: createMockWallet(deposits) as never,
		status: 'ready',
		activeDeposit: null,
		depositInvoice: null,
		depositStatus: 'idle',
		error: null,
	}))
	const invoice = await nip60Actions.startDeposit(2000, TEST_MINT)
	expect(invoice).toBe(BOLT11_INVOICE_2000_SATS)
	return deposits
}

afterEach(() => {
	nip60Store.setState((state) => ({
		...state,
		wallet: null,
		status: 'idle',
		activeDeposit: null,
		depositInvoice: null,
		depositStatus: 'idle',
		error: null,
	}))
})

describe('cancelDeposit preserveRecovery (PR #1235 blocker 3)', () => {
	test('keeps the quote identity so checkDepositNow reconciles the same payment', async () => {
		const deposits = await startMockDeposit()
		const deposit = deposits[0]

		expect(nip60Store.state.depositStatus).toBe('pending')
		expect(nip60Store.state.activeDeposit).toBe(deposit as never)
		expect(nip60Store.state.depositInvoice).toBe(BOLT11_INVOICE_2000_SATS)

		// Paid-or-uncertain close, as DepositLightningModal performs it.
		nip60Actions.cancelDeposit({ preserveRecovery: true })

		// Identity retained: the SAME quote can still be reconciled without a
		// fresh funding session (no new wallet.deposit() call happens).
		expect(nip60Store.state.activeDeposit).toBe(deposit as never)
		expect(nip60Store.state.depositInvoice).toBe(BOLT11_INVOICE_2000_SATS)
		expect(nip60Store.state.depositStatus).toBe('pending')

		// The mint finds the payment on the next check of the same quote.
		deposit.checkFindsPayment = true
		await nip60Actions.checkDepositNow()

		expect(deposit.getCheckCalls()).toBe(1)
		expect(nip60Store.state.depositStatus).toBe('success')
		expect(nip60Store.state.activeDeposit).toBeNull()
	})

	test('keeps the quote identity so retryDepositConfirmation reconciles the same payment', async () => {
		const deposits = await startMockDeposit()
		const deposit = deposits[0]

		// Simulate the 15s confirmation timeout having lapsed.
		nip60Store.setState((s) => ({
			...s,
			depositStatus: 'awaiting_confirmation_retry',
			error: 'Payment confirmation timed out. Retry confirmation to check the mint again.',
		}))

		// Paid-or-uncertain close.
		nip60Actions.cancelDeposit({ preserveRecovery: true })

		expect(nip60Store.state.activeDeposit).toBe(deposit as never)
		expect(nip60Store.state.depositStatus).toBe('awaiting_confirmation_retry')

		// The same quote is still retryable: retry re-enters pending and the
		// mint finds the payment.
		deposit.checkFindsPayment = true
		nip60Actions.retryDepositConfirmation()
		await Promise.resolve()

		expect(deposit.getCheckCalls()).toBe(1)
		expect(nip60Store.state.depositStatus).toBe('success')
		expect(nip60Store.state.activeDeposit).toBeNull()
	})

	test('resets only the transient error display, not the deposit identity', async () => {
		const deposits = await startMockDeposit()
		const deposit = deposits[0]

		nip60Store.setState((s) => ({ ...s, error: 'transient display noise' }))
		nip60Actions.cancelDeposit({ preserveRecovery: true })

		expect(nip60Store.state.error).toBeNull()
		expect(nip60Store.state.activeDeposit).toBe(deposit as never)
		expect(nip60Store.state.depositInvoice).toBe(BOLT11_INVOICE_2000_SATS)
	})
})

describe('cancelDeposit default (backward compat)', () => {
	test('with no options fully clears the deposit session', async () => {
		const deposits = await startMockDeposit()
		const deposit = deposits[0]
		expect(nip60Store.state.activeDeposit).toBe(deposit as never)

		nip60Actions.cancelDeposit()

		expect(nip60Store.state.activeDeposit).toBeNull()
		expect(nip60Store.state.depositInvoice).toBeNull()
		expect(nip60Store.state.depositStatus).toBe('idle')
		expect(nip60Store.state.error).toBeNull()
	})

	test('with preserveRecovery explicitly false fully clears', async () => {
		const deposits = await startMockDeposit()
		const deposit = deposits[0]
		expect(nip60Store.state.activeDeposit).toBe(deposit as never)

		nip60Actions.cancelDeposit({ preserveRecovery: false })

		expect(nip60Store.state.activeDeposit).toBeNull()
		expect(nip60Store.state.depositInvoice).toBeNull()
		expect(nip60Store.state.depositStatus).toBe('idle')
	})

	test('preserveRecovery on a terminal state has no recoverable quote and fully clears', async () => {
		const deposits = await startMockDeposit()
		const deposit = deposits[0]

		// Terminal success: the success listener already cleared the identity.
		deposit.emitSuccess()
		expect(nip60Store.state.depositStatus).toBe('success')
		expect(nip60Store.state.activeDeposit).toBeNull()

		nip60Actions.cancelDeposit({ preserveRecovery: true })

		expect(nip60Store.state.depositStatus).toBe('idle')
		expect(nip60Store.state.activeDeposit).toBeNull()
		expect(nip60Store.state.depositInvoice).toBeNull()
	})
})

describe('deposit listener identity guard (stale session race)', () => {
	test('a late success/error event from deposit #1 must not corrupt deposit #2 status', async () => {
		const deposits = await startMockDeposit()
		const deposit1 = deposits[0]
		await nip60Actions.startDeposit(2000, TEST_MINT)
		const deposit2 = deposits[1]

		expect(nip60Store.state.activeDeposit).toBe(deposit2 as never)
		expect(nip60Store.state.depositStatus).toBe('pending')

		// Deposit #1's stale listeners fire — the identity guard rejects them.
		deposit1.emitSuccess()
		expect(nip60Store.state.depositStatus).toBe('pending')
		expect(nip60Store.state.activeDeposit).toBe(deposit2 as never)
		expect(nip60Store.state.depositInvoice).toBe(BOLT11_INVOICE_2000_SATS)

		deposit1.emitError('mint exploded')
		expect(nip60Store.state.depositStatus).toBe('pending')
		expect(nip60Store.state.error).toBeNull()
		expect(nip60Store.state.activeDeposit).toBe(deposit2 as never)

		// Deposit #2's own event still reconciles normally.
		deposit2.emitSuccess()
		expect(nip60Store.state.depositStatus).toBe('success')
		expect(nip60Store.state.activeDeposit).toBeNull()
	})

	test('stale deposit events after a default cancelDeposit cannot resurrect the deposit session', async () => {
		const deposits = await startMockDeposit()
		const deposit1 = deposits[0]

		nip60Actions.cancelDeposit()
		expect(nip60Store.state.depositStatus).toBe('idle')

		deposit1.emitSuccess()
		deposit1.emitError('late failure')

		expect(nip60Store.state.depositStatus).toBe('idle')
		expect(nip60Store.state.activeDeposit).toBeNull()
		expect(nip60Store.state.depositInvoice).toBeNull()
		expect(nip60Store.state.error).toBeNull()
	})
})
