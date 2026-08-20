import { afterEach, describe, expect, test } from 'bun:test'
import {
	getAuctionDepositFeePadding,
	getAuctionDepositMaxMintQuoteFeeSats,
	NIP60_DEPOSIT_CONFIRMATION_TIMEOUT_MS,
	nip60Actions,
	nip60Store,
	validateAuctionDepositInvoiceQuote,
	waitForDepositConfirmation,
} from '@/lib/stores/nip60'

type DepositEventName = 'success' | 'error'

const createMockDeposit = () => {
	const handlers: Partial<Record<DepositEventName, (value?: unknown) => void>> = {}
	let checkCalls = 0

	return {
		on: (event: DepositEventName, handler: (value?: unknown) => void) => {
			handlers[event] = handler
			return undefined
		},
		check: async () => {
			checkCalls += 1
			handlers.success?.()
		},
		emitSuccess: () => handlers.success?.(),
		emitError: (error: string) => handlers.error?.(error),
		getCheckCalls: () => checkCalls,
	}
}

afterEach(() => {
	nip60Store.setState((state) => ({
		...state,
		activeDeposit: null,
		depositInvoice: null,
		depositStatus: 'idle',
		error: null,
	}))
})

describe('getAuctionDepositFeePadding', () => {
	test.each([
		[100, 5],
		[1_000, 5],
		[10_000, 50],
		[20_000, 100],
		[100_000, 100],
	])('%d sat deposit receives %d sats of padding', (depositAmount, expectedPadding) =>
		expect(getAuctionDepositFeePadding(depositAmount)).toBe(expectedPadding),
	)
})

describe('waitForDepositConfirmation', () => {
	test('uses a 15s default confirmation timeout', () => {
		expect(NIP60_DEPOSIT_CONFIRMATION_TIMEOUT_MS).toBe(15_000)
	})

	test('rejects when confirmation times out', async () => {
		const deposit = createMockDeposit()

		await expect(waitForDepositConfirmation(deposit as never, 1)).rejects.toThrow(
			'wallet acknowledgment and mint confirmation timeout after 1ms',
		)
	})

	test('resolves when deposit succeeds before timeout', async () => {
		const deposit = createMockDeposit()
		const confirmationPromise = waitForDepositConfirmation(deposit as never, 50)

		deposit.emitSuccess()

		await expect(confirmationPromise).resolves.toBeUndefined()
	})
})

describe('retryDepositConfirmation', () => {
	test('re-enters pending state and triggers a deposit re-check', async () => {
		const deposit = createMockDeposit()

		nip60Store.setState((state) => ({
			...state,
			activeDeposit: deposit as never,
			depositInvoice: 'lnbc1test',
			depositStatus: 'awaiting_confirmation_retry',
			error: 'Payment confirmation timed out. Retry confirmation to check the mint again.',
		}))

		nip60Actions.retryDepositConfirmation()
		await Promise.resolve()

		expect(nip60Store.state.depositStatus).toBe('pending')
		expect(nip60Store.state.error).toBeNull()
		expect(deposit.getCheckCalls()).toBe(1)
	})
})

describe('estimateDepositQuote', () => {
	test('returns deterministic fallback padding without depending on mint quote side effects', async () => {
		const estimate = await nip60Actions.estimateDepositQuote(10_000, 'https://mint.minibits.cash/Bitcoin')

		expect(estimate.requiredBidFundingAmount).toBe(10_000)
		expect(estimate.totalDepositAmount).toBe(10_100)
		expect(estimate.mintFeePaddingAmount).toBe(50)
		expect(estimate.lightningFeePaddingAmount).toBe(50)
		expect(estimate.feeSource).toBe('fallback')
		expect(estimate.usedFallbackEstimate).toBe(true)
	})
})

describe('mint quote fee bounds', () => {
	test.each([
		[100, 25],
		[10_000, 1_000],
		[50_000, 2_000],
	])('caps mint quote fees for %d sats at %d sats', (requestedAmount, expectedMax) => {
		expect(getAuctionDepositMaxMintQuoteFeeSats(requestedAmount)).toBe(expectedMax)
	})

	test('accepts invoice quote fee within cap', () => {
		expect(() =>
			validateAuctionDepositInvoiceQuote({
				requestedAmount: 10_000,
				depositAmount: 10_050,
				invoiceAmountSats: 10_500,
				mintUrl: 'https://mint.minibits.cash',
			}),
		).not.toThrow()
	})

	test('rejects invoice quote fee that exceeds cap', () => {
		expect(() =>
			validateAuctionDepositInvoiceQuote({
				requestedAmount: 10_000,
				depositAmount: 10_050,
				invoiceAmountSats: 30_000,
				mintUrl: 'https://mint.minibits.cash',
			}),
		).toThrow('unusually high Lightning fee quote')
	})

	test('rejects invoice amount below requested deposit', () => {
		expect(() =>
			validateAuctionDepositInvoiceQuote({
				requestedAmount: 10_000,
				depositAmount: 10_050,
				invoiceAmountSats: 9_000,
				mintUrl: 'https://mint.minibits.cash',
			}),
		).toThrow('invoice below the requested deposit amount')
	})
})

describe('checkDepositNow', () => {
	test('while pending resolves on success via deposit check', async () => {
		const deposit = createMockDeposit()

		// Simulate the success handler that startDeposit attaches to the deposit
		deposit.on('success', () => {
			nip60Store.setState((s) => ({
				...s,
				depositStatus: 'success',
				activeDeposit: null,
				depositInvoice: null,
			}))
		})

		nip60Store.setState((state) => ({
			...state,
			activeDeposit: deposit as never,
			depositInvoice: 'lnbc1test',
			depositStatus: 'pending',
			error: null,
		}))

		await nip60Actions.checkDepositNow()

		expect(nip60Store.state.depositStatus).toBe('success')
		expect(deposit.getCheckCalls()).toBe(1)
	})

	test('while pending with check error stays pending (error is caught, not fatal)', async () => {
		const handlers: Partial<Record<DepositEventName, (value?: unknown) => void>> = {}
		const failingDeposit = {
			on: (event: DepositEventName, handler: (value?: unknown) => void) => {
				handlers[event] = handler
				return undefined
			},
			check: async () => {
				throw new Error('mint unreachable')
			},
			emitSuccess: () => handlers.success?.(),
			emitError: (error: string) => handlers.error?.(error),
		}

		nip60Store.setState((state) => ({
			...state,
			activeDeposit: failingDeposit as never,
			depositInvoice: 'lnbc1test',
			depositStatus: 'pending',
			error: null,
		}))

		await nip60Actions.checkDepositNow()

		// checkDepositNow catches the check error; depositStatus stays pending
		expect(nip60Store.state.depositStatus).toBe('pending')
	})

	test('while awaiting_confirmation_retry delegates to retryDepositConfirmation', async () => {
		const deposit = createMockDeposit()

		nip60Store.setState((state) => ({
			...state,
			activeDeposit: deposit as never,
			depositInvoice: 'lnbc1test',
			depositStatus: 'awaiting_confirmation_retry',
			error: 'Payment confirmation timed out. Retry confirmation to check the mint again.',
		}))

		await nip60Actions.checkDepositNow()

		// retryDepositConfirmation sets status to pending and triggers a re-check
		expect(nip60Store.state.depositStatus).toBe('pending')
		expect(nip60Store.state.error).toBeNull()
		expect(deposit.getCheckCalls()).toBe(1)
	})

	test('while idle is a no-op (no active deposit)', async () => {
		await nip60Actions.checkDepositNow()
		expect(nip60Store.state.depositStatus).toBe('idle')
	})

	test('while success is a no-op (does not re-check a completed deposit)', async () => {
		const deposit = createMockDeposit()

		nip60Store.setState((state) => ({
			...state,
			activeDeposit: deposit as never,
			depositStatus: 'success',
		}))

		await nip60Actions.checkDepositNow()

		expect(deposit.getCheckCalls()).toBe(0)
		expect(nip60Store.state.depositStatus).toBe('success')
	})
})

describe('deposit timeout error detection', () => {
	test('waitForDepositConfirmation timeout error message includes timeout duration', async () => {
		const deposit = createMockDeposit()

		// The error message format is what monitorDepositConfirmation uses to
		// distinguish a timeout from other errors (isDepositConfirmationTimeoutError).
		await expect(waitForDepositConfirmation(deposit as never, 50)).rejects.toThrow(/timeout after 50ms/)
	})

	test('waitForDepositConfirmation error event is distinct from timeout (not mistaken for timeout)', async () => {
		const deposit = createMockDeposit()

		const promise = waitForDepositConfirmation(deposit as never, 5000)
		deposit.emitError('mint connection refused')

		await expect(promise).rejects.toThrow('mint connection refused')
	})

	test('waitForDepositConfirmation resolves before timeout when success arrives first', async () => {
		const deposit = createMockDeposit()

		const promise = waitForDepositConfirmation(deposit as never, 5000)
		deposit.emitSuccess()

		await expect(promise).resolves.toBeUndefined()
	})
})
