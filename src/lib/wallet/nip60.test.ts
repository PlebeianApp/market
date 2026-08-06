import { afterEach, describe, expect, test } from 'bun:test'
import { getAuctionDepositFeePadding, nip60Actions, nip60Store, waitForDepositConfirmation } from '@/lib/stores/nip60'

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
