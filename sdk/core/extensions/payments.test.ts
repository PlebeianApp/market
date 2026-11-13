import { describe, expect, test } from 'bun:test'
import { ExtensionActionError } from './actions'
import { parsePublicExtensionAction } from './descriptors'
import {
	advancePaidCall,
	createPaidCallRecord,
	createPayeeFetch,
	PaidCallError,
	paidCallSpentSats,
	parseExtensionPaymentRequirement,
	runPaidExtensionCall,
	type ExtensionPaymentRequirement,
	type PaidCallRecord,
	type PaidCallWallet,
	type PaidClientExecutor,
} from './payments'

const requirement: ExtensionPaymentRequirement = {
	method: 'cashu',
	payee: 'https://node.example',
	amountSats: 50,
	mints: ['https://mint.a', 'https://mint.b'],
	refundsChange: true,
}

function fakeWallet(
	balances: Record<string, number>,
	options: { reclaimable?: boolean; sendThrows?: boolean; receiveThrows?: boolean } = {},
) {
	const calls: string[] = []
	const wallet: PaidCallWallet = {
		balanceAt: (mint) => balances[mint] ?? 0,
		send: async (mint, amount) => {
			calls.push(`send ${mint} ${amount}`)
			if (options.sendThrows) throw new Error('wallet locked')
			return `cashuA-token-${amount}`
		},
		receive: async (token) => {
			calls.push(`receive ${token}`)
			if (options.receiveThrows) throw new Error('mint down')
			return 12
		},
		reclaim: async (token) => {
			calls.push(`reclaim ${token}`)
			return options.reclaimable ?? true
		},
	}
	return { wallet, calls }
}

async function run(
	executor: PaidClientExecutor<{ q: string }, string>,
	wallet: PaidCallWallet,
	approve = async () => true,
): Promise<{ output?: string; error?: PaidCallError; states: string[] }> {
	const states: string[] = []
	try {
		const { output } = await runPaidExtensionCall({
			requirement,
			executor,
			input: { q: 'x' },
			config: {},
			wallet,
			approve,
			onState: (record) => states.push(record.state),
		})
		return { output, states }
	} catch (error) {
		return { error: error as PaidCallError, states }
	}
}

describe('parseExtensionPaymentRequirement', () => {
	test('accepts https payee and mints, normalizes and dedupes mints', () => {
		const parsed = parseExtensionPaymentRequirement({ ...requirement, mints: ['https://mint.a/', 'https://mint.a'], extra: 1 })
		expect(parsed).toEqual({ ok: true, value: { ...requirement, mints: ['https://mint.a'] } })
	})

	test('rejects non-https payees and mints, bad amounts, and unknown methods', () => {
		expect(parseExtensionPaymentRequirement({ ...requirement, payee: 'http://node.example' }).ok).toBe(false)
		expect(parseExtensionPaymentRequirement({ ...requirement, payee: 'http://127.0.0.1:8080', mints: ['http://localhost:3338'] }).ok).toBe(
			true,
		)
		expect(parseExtensionPaymentRequirement({ ...requirement, payee: 'https://node.example/v1' }).ok).toBe(false)
		expect(parseExtensionPaymentRequirement({ ...requirement, mints: ['http://mint.a'] }).ok).toBe(false)
		expect(parseExtensionPaymentRequirement({ ...requirement, mints: [] }).ok).toBe(false)
		expect(parseExtensionPaymentRequirement({ ...requirement, amountSats: 0 }).ok).toBe(false)
		expect(parseExtensionPaymentRequirement({ ...requirement, amountSats: 1.5 }).ok).toBe(false)
		expect(parseExtensionPaymentRequirement({ ...requirement, method: 'lightning' }).ok).toBe(false)
	})

	test('an action descriptor with an unreadable price is dropped entirely', () => {
		const base = { name: 'draft-listing', auth: 'user', rateLimit: { perPubkey: 1, windowSeconds: 60 } }
		expect(parsePublicExtensionAction({ ...base, payment: requirement })?.payment).toEqual(requirement)
		expect(parsePublicExtensionAction({ ...base, payment: { ...requirement, payee: 'javascript:x' } })).toBeUndefined()
	})
})

describe('paid call states', () => {
	test('only listed transitions are allowed', () => {
		const record = createPaidCallRecord(requirement, 1)
		expect(advancePaidCall(record, 'token_created').ok).toBe(false)
		const approved = advancePaidCall(record, 'approved', {}, 2)
		expect(approved.ok && approved.value.history.map((entry) => entry.state)).toEqual(['awaiting_approval', 'approved'])
	})

	test('spent sats are known only once the call has finished', () => {
		const record: PaidCallRecord = { ...createPaidCallRecord(requirement), state: 'request_sent' }
		expect(paidCallSpentSats(record)).toBeUndefined()
		expect(paidCallSpentSats({ ...record, state: 'change_received', returnedSats: 12 })).toBe(38)
		expect(paidCallSpentSats({ ...record, state: 'declined' })).toBe(0)
	})
})

describe('runPaidExtensionCall', () => {
	test('declining sends nothing', async () => {
		const { wallet, calls } = fakeWallet({ 'https://mint.a': 100 })
		const result = await run(
			async () => ({ outcome: 'accepted', output: 'x' }),
			wallet,
			async () => false,
		)
		expect(result.error?.reason).toBe('declined')
		expect(result.states).toEqual(['awaiting_approval', 'declined'])
		expect(calls).toEqual([])
	})

	test('blocks when no accepted mint has enough balance', async () => {
		const { wallet, calls } = fakeWallet({ 'https://mint.a': 10, 'https://other.mint': 1000 })
		const result = await run(async () => ({ outcome: 'accepted', output: 'x' }), wallet)
		expect(result.error?.reason).toBe('insufficient_funds')
		expect(calls).toEqual([])
	})

	test('pays from the first accepted mint with balance and receives change', async () => {
		const { wallet, calls } = fakeWallet({ 'https://mint.a': 10, 'https://mint.b': 100 })
		const result = await run(async ({ token }) => ({ outcome: 'accepted', output: `ok:${token}`, changeToken: 'cashuA-change' }), wallet)
		expect(result.output).toBe('ok:cashuA-token-50')
		expect(calls).toEqual(['send https://mint.b 50', 'receive cashuA-change'])
		expect(result.states).toEqual([
			'awaiting_approval',
			'approved',
			'token_created',
			'request_sent',
			'provider_accepted',
			'change_received',
		])
	})

	test('keeps a change token the wallet could not receive', async () => {
		const states: PaidCallRecord[] = []
		const { wallet } = fakeWallet({ 'https://mint.a': 100 }, { receiveThrows: true })
		await runPaidExtensionCall({
			requirement,
			executor: async () => ({ outcome: 'accepted', output: 'x', changeToken: 'cashuA-change' }),
			input: {},
			config: {},
			wallet,
			approve: async () => true,
			onState: (record) => states.push(record),
		})
		expect(states.at(-1)).toMatchObject({ state: 'change_unclaimed', unclaimedChangeToken: 'cashuA-change' })
	})

	test('on rejection without change, reclaims the untouched token', async () => {
		const { wallet, calls } = fakeWallet({ 'https://mint.a': 100 })
		const result = await run(async () => ({ outcome: 'rejected', error: new ExtensionActionError('extension_unavailable') }), wallet)
		expect(result.error?.reason).toBe('provider_rejected')
		expect(result.error?.providerError?.reason).toBe('extension_unavailable')
		expect(result.error?.record).toMatchObject({ state: 'reclaimed', returnedSats: 50 })
		expect(calls).toEqual(['send https://mint.a 50', 'reclaim cashuA-token-50'])
	})

	test('records a failed reclaim when the payee already claimed the token', async () => {
		const { wallet } = fakeWallet({ 'https://mint.a': 100 }, { reclaimable: false })
		const result = await run(async () => {
			throw new Error('CORS')
		}, wallet)
		expect(result.error?.record.state).toBe('reclaim_failed')
		expect(result.error?.providerError?.reason).toBe('network_error')
	})

	test('a wallet failure stops before any request', async () => {
		let executed = false
		const { wallet } = fakeWallet({ 'https://mint.a': 100 }, { sendThrows: true })
		const result = await run(async () => {
			executed = true
			return { outcome: 'accepted', output: 'x' }
		}, wallet)
		expect(result.error?.reason).toBe('wallet_failed')
		expect(executed).toBe(false)
	})
})

describe('createPayeeFetch', () => {
	test('only reaches the payee origin, never follows redirects, and sends no cookies', async () => {
		const seen: { url: string; init?: RequestInit }[] = []
		const fetchImpl = (async (url: string, init?: RequestInit) => {
			seen.push({ url, init })
			return new Response('{"ok":true}', { status: 200 })
		}) as unknown as typeof fetch
		const payeeFetch = createPayeeFetch('https://node.example', fetchImpl)
		expect(await payeeFetch('/v1/chat/completions', { method: 'POST', body: '{}' })).toEqual({ status: 200, body: '{"ok":true}' })
		expect(seen[0].url).toBe('https://node.example/v1/chat/completions')
		expect(seen[0].init).toMatchObject({ redirect: 'error', credentials: 'omit' })
		await expect(payeeFetch('//evil.example/x', { method: 'GET' })).rejects.toThrow()
		await expect(payeeFetch('https://evil.example/x', { method: 'GET' })).rejects.toThrow()
		expect(seen).toHaveLength(1)
	})
})
