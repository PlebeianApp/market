import { describe, expect, test } from 'bun:test'
import { getEncodedToken } from '@cashu/cashu-ts'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { z } from 'zod'
import { defineExtension, ExtensionActionError, EXTENSION_PAYMENT_HEADER } from '@sdk/core/extensions'
import { buildHttpAuthTemplate, encodeHttpAuthHeader } from '@sdk/core/nostr/nip98'
import { failure, success } from '@sdk/core/result'
import { createExtensionActionHandler, type CollectedPaymentEvent } from '../actionRoute'
import { HttpAuthReplayCache } from '../nip98'
import { buildExtensionHost } from '../ports/host'
import { createMemoryKeyValueStorage } from '../ports/storage'
import { ExtensionRateLimiter } from '../rateLimiter'
import { ExtensionRegistry } from '../registry'
import { checkCollectorToken, createRoutstrdCollector, type CashuCollector } from './collector'
import { createPaymentCollectorRuntime } from './runtime'

const ORIGIN = 'https://market.example'
const NOW_MS = 1_700_000_000_000
const MINT = 'https://mint.minibits.cash/Bitcoin'
const PRICE = 100
const sellerKey = generateSecretKey()

function token(amount: number, mint = MINT, unit = 'sat'): string {
	const proofs = [64, 32, 16, 8, 4, 2, 1].reduce<{ left: number; amounts: number[] }>(
		(acc, value) => {
			while (acc.left >= value) {
				acc.amounts.push(value)
				acc.left -= value
			}
			return acc
		},
		{ left: amount, amounts: [] },
	).amounts
	return getEncodedToken({
		mint,
		unit,
		proofs: proofs.map((value, index) => ({
			id: '00ad268c4d1f5826',
			amount: value,
			secret: `${index}`.padEnd(64, 'a'),
			C: `02${'b'.repeat(64)}`,
		})),
	})
}

const paid = defineExtension({
	manifest: {
		id: 'example.paid',
		version: '0.1.0',
		displayName: 'Paid',
		capabilities: ['example.paid'],
		runtimes: ['server'],
		publicConfig: z.object({ fail: z.boolean().default(false) }),
	},
	actions: {
		draft: {
			input: z.object({ text: z.string().max(20) }),
			output: z.object({ echoed: z.string(), paidSats: z.number() }),
			auth: 'user',
			rateLimit: { perPubkey: 50, windowSeconds: 60 },
			payment: () => ({ method: 'cashu', collectedBy: 'marketplace', amountSats: PRICE, mints: [], refundsChange: true }),
			handler: async (ctx, input: { text: string }, caller) =>
				(ctx.publicConfig as { fail: boolean }).fail
					? failure(new ExtensionActionError('extension_unavailable'))
					: success({ echoed: input.text, paidSats: caller.payment?.collectedSats ?? 0 }),
		},
	},
})

function fakeCollector(options: { receiveFails?: boolean; sendFails?: boolean; mints?: string[] } = {}) {
	const calls: string[] = []
	const collector: CashuCollector = {
		acceptedMints: async () => options.mints ?? [MINT],
		receive: async (value) => {
			calls.push(`receive ${value.slice(0, 6)}`)
			if (options.receiveFails) throw new Error('Token already spent')
		},
		send: async (amount, mint) => {
			calls.push(`send ${amount} ${mint}`)
			if (options.sendFails) throw new Error('wallet down')
			return `cashuBrefund${amount}`
		},
	}
	return { collector, calls }
}

async function setup(options: { fail?: boolean; collector?: CashuCollector } = {}) {
	const registry = new ExtensionRegistry('market').register(paid)
	registry.configure([{ id: 'example.paid', enabled: true, publicConfig: { fail: options.fail ?? false } }])
	await registry.start('server', {
		createHost: (definition, privateConfig, signal) =>
			buildExtensionHost(
				definition.manifest,
				privateConfig,
				{
					relayUrls: [],
					getRelayPort: () => {
						throw new Error('unused')
					},
					storage: createMemoryKeyValueStorage(),
					allowLocalhostEgress: false,
					logSink: () => undefined,
				},
				signal,
			).host,
	})
	const events: CollectedPaymentEvent[] = []
	const handler = createExtensionActionHandler({
		getRegistry: () => registry,
		isAdmin: () => false,
		replayCache: new HttpAuthReplayCache(),
		rateLimiter: new ExtensionRateLimiter(),
		acceptedOrigins: () => [ORIGIN],
		nowMs: () => NOW_MS,
		collector: options.collector,
		onPayment: (event) => events.push(event),
	})
	return { handler, events }
}

let createdAt = NOW_MS / 1000
async function call(handler: Awaited<ReturnType<typeof setup>>['handler'], body: unknown, paymentToken?: string) {
	const url = `${ORIGIN}/api/extensions/example.paid/actions/draft`
	const text = JSON.stringify(body)
	// Each request gets a fresh NIP-98 event so the replay cache does not reject it.
	const auth = encodeHttpAuthHeader(
		finalizeEvent(buildHttpAuthTemplate({ url, method: 'POST', body: text, createdAt: createdAt-- }), sellerKey),
	)
	const request = new Request(url, {
		method: 'POST',
		body: text,
		headers: {
			authorization: auth,
			'content-type': 'application/json',
			...(paymentToken ? { [EXTENSION_PAYMENT_HEADER]: paymentToken } : {}),
		},
	})
	const response = await handler(Object.assign(request, { params: { id: 'example.paid', action: 'draft' } }))
	return { status: response.status, body: (await response.json()) as Record<string, any> }
}

describe('marketplace-collected action payments', () => {
	test('redeems the token before running the action, then returns the result', async () => {
		const { collector, calls } = fakeCollector()
		const { handler, events } = await setup({ collector })
		const result = await call(handler, { text: 'hi' }, token(PRICE))
		expect(result).toMatchObject({ status: 200, body: { ok: true, value: { echoed: 'hi', paidSats: PRICE } } })
		expect(result.body).not.toHaveProperty('change')
		expect(calls).toEqual(['receive cashuB'])
		expect(events.map((event) => event.outcome)).toEqual(['collected'])
		expect(JSON.stringify(events)).not.toContain('cashuB')
	})

	test('returns overpayment as change', async () => {
		const { collector, calls } = fakeCollector()
		const { handler } = await setup({ collector })
		const result = await call(handler, { text: 'hi' }, token(130))
		expect(result.body.change).toEqual({ token: 'cashuBrefund30' })
		expect(calls).toEqual(['receive cashuB', `send 30 ${MINT}`])
	})

	test('refunds the full payment when the action fails', async () => {
		const { collector, calls } = fakeCollector()
		const { handler, events } = await setup({ collector, fail: true })
		const result = await call(handler, { text: 'hi' }, token(PRICE))
		expect(result).toMatchObject({
			status: 503,
			body: { ok: false, error: { code: 'extension_unavailable' }, refund: { token: 'cashuBrefund100' } },
		})
		expect(calls).toEqual(['receive cashuB', `send 100 ${MINT}`])
		expect(events.map((event) => event.outcome)).toEqual(['collected', 'refunded'])
	})

	test('records a failed refund as owed, without inventing a token', async () => {
		const { collector } = fakeCollector({ sendFails: true })
		const { handler, events } = await setup({ collector, fail: true })
		const result = await call(handler, { text: 'hi' }, token(PRICE))
		expect(result.body).not.toHaveProperty('refund')
		expect(events.at(-1)).toMatchObject({ outcome: 'refund_failed', sats: PRICE, mint: MINT })
	})

	test('never runs the action or redeems the token when the payment is missing or wrong', async () => {
		for (const [paymentToken, reason] of [
			[undefined, undefined],
			['not-a-token', 'malformed'],
			[token(PRICE, 'https://evil-mint.example'), 'mint'],
			[token(PRICE, MINT, 'usd'), 'unit'],
			[token(PRICE - 1), 'underpaid'],
		] as const) {
			const { collector, calls } = fakeCollector()
			const { handler, events } = await setup({ collector })
			const result = await call(handler, { text: 'hi' }, paymentToken)
			expect(result).toMatchObject({ status: 402, body: { ok: false, error: { code: 'payment_required' } } })
			expect(calls).toEqual([])
			if (reason) expect(events[0]).toMatchObject({ outcome: 'rejected', reason })
		}
	})

	test('an already-spent token is rejected and the action does not run', async () => {
		const { collector } = fakeCollector({ receiveFails: true })
		const { handler, events } = await setup({ collector })
		const result = await call(handler, { text: 'hi' }, token(PRICE))
		expect(result.status).toBe(402)
		expect(events[0]).toMatchObject({ outcome: 'rejected', reason: 'redeem_failed' })
	})

	test('invalid input is rejected before anything is collected', async () => {
		const { collector, calls } = fakeCollector()
		const { handler } = await setup({ collector })
		const result = await call(handler, { text: 'x'.repeat(50) }, token(PRICE))
		expect(result.status).toBe(400)
		expect(calls).toEqual([])
	})

	test('without a collector the paid action is unavailable', async () => {
		const { handler } = await setup()
		expect((await call(handler, { text: 'hi' }, token(PRICE))).status).toBe(503)
	})
})

describe('collector helpers', () => {
	test('checkCollectorToken matches mints regardless of trailing slash', () => {
		expect(checkCollectorToken(token(PRICE), [`${MINT}/`], PRICE)).toMatchObject({ ok: true, amount: PRICE })
	})

	test('the routstrd collector only talks to loopback and maps its wallet routes', async () => {
		expect(() => createRoutstrdCollector('http://wallet.example:8008')).toThrow()
		const requests: { url: string; body?: string }[] = []
		const collector = createRoutstrdCollector('http://127.0.0.1:8008', async (url, init) => {
			requests.push({ url, body: init?.body })
			if (url.endsWith('/wallet/mints')) return Response.json({ output: { mints: [MINT], defaultMint: MINT } })
			if (url.endsWith('/wallet/send/cashu')) return Response.json({ output: { token: 'cashuBchange', amount: 5, mintUrl: MINT } })
			if (url.endsWith('/wallet/receive/cashu')) return Response.json({ error: 'Token already spent: cashuB…' }, { status: 400 })
			return new Response('', { status: 404 })
		})
		expect(await collector.acceptedMints()).toEqual([MINT])
		expect(await collector.send(5, MINT)).toBe('cashuBchange')
		const error = await collector.receive('cashuBsecret').catch((cause: Error) => cause)
		expect(error).toBeInstanceOf(Error)
		expect((error as Error).message).not.toContain('cashuB')
		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			'/wallet/mints',
			'/wallet/send/cashu',
			'/wallet/receive/cashu',
		])
	})

	test('the runtime publishes marketplace prices only with known mints', async () => {
		const { collector } = fakeCollector()
		const runtime = createPaymentCollectorRuntime({}, { collector, log: () => undefined })!
		const requirement = { method: 'cashu', collectedBy: 'marketplace', amountSats: PRICE, mints: [], refundsChange: true } as const
		await Bun.sleep(0)
		expect(runtime.resolve(requirement)?.mints).toEqual([MINT])
		runtime.stop()
		const empty = createPaymentCollectorRuntime({}, { collector: fakeCollector({ mints: [] }).collector, log: () => undefined })!
		await Bun.sleep(0)
		expect(empty.resolve(requirement)).toBeUndefined()
		empty.stop()
		expect(createPaymentCollectorRuntime({})).toBeUndefined()
	})
})
