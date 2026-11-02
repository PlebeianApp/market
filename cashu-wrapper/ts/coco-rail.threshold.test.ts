import { describe, expect, test } from 'bun:test'
import { getEncodedToken } from '@cashu/coco-core'

import {
	createCocoRail, createPinnedMintTransportFetch, verifyThresholdSigAllToken,
	type ThresholdSigAllLockTarget,
} from './coco-rail'

const key = (digit: string, prefix = '02') => `${prefix}${digit.repeat(64)}`
const lock: ThresholdSigAllLockTarget = {
	bidderPubkey: key('1'), committeePubkey: key('2', '03'), refundPubkey: key('3'), locktime: 4_200,
}

function secret(overrides: { bidder?: string; committee?: string; refund?: string; locktime?: number; sigflag?: string } = {}) {
	return JSON.stringify(['P2PK', {
		nonce: 'a'.repeat(64), data: overrides.bidder ?? lock.bidderPubkey,
		tags: [
			['pubkeys', overrides.committee ?? lock.committeePubkey], ['n_sigs', '2'],
			['locktime', String(overrides.locktime ?? lock.locktime)],
			['refund', overrides.refund ?? lock.refundPubkey], ['sigflag', overrides.sigflag ?? 'SIG_ALL'],
		],
	}])
}

function token(secrets: string[]) {
	return getEncodedToken({ mint: 'https://mint.invalid', unit: 'sat', proofs: secrets.map((held, index) => ({
		id: '00deadbeef', amount: index === 0 ? 2 : 1, secret: held, C: key('4'),
	})) } as never)
}

describe('Coco Friday threshold token reader', () => {
	test('maps one canonical HTTPS mint identity to one fixed FIPS transport', async () => {
		const observed: Array<{ url: string; encoding: string | null }> = []
		const transport = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input)
			observed.push({ url, encoding: new Headers(init?.headers).get('accept-encoding') })
			const response = new Response('{"ok":true}', { status: 200 })
			Object.defineProperty(response, 'url', { value: url })
			return response
		}) as typeof fetch
		const mapped = createPinnedMintTransportFetch('https://172.105.64.142', 'http://[fd42::1]:3438', transport)
		expect((await mapped('https://172.105.64.142/v1/info?unit=sat')).status).toBe(200)
		expect(observed).toEqual([{ url: 'http://[fd42::1]:3438/v1/info?unit=sat', encoding: 'identity' }])
		await expect(mapped('https://evil.invalid/v1/info')).rejects.toThrow(/transport-origin/)
		await expect(mapped('https://172.105.64.142/v1/info#fragment')).rejects.toThrow(/transport-origin/)
	})

	test('accepts exact mint token terms and totals proof value', () => {
		expect(verifyThresholdSigAllToken(token([secret(), secret()]), '00deadbeef', lock)).toEqual({ proofCount: 2, amount: 3 })
	})

	test('rejects key, deadline, SIG_ALL, duplicate-tag, and amount substitution', () => {
		expect(() => verifyThresholdSigAllToken(token([secret({ bidder: key('5') })]), '00deadbeef', lock)).toThrow(/bidder key/)
		expect(() => verifyThresholdSigAllToken(token([secret({ committee: key('5') })]), '00deadbeef', lock)).toThrow(/exact 2-of-2/)
		expect(() => verifyThresholdSigAllToken(token([secret({ locktime: 4_201 })]), '00deadbeef', lock)).toThrow(/exact 2-of-2/)
		expect(() => verifyThresholdSigAllToken(token([secret({ sigflag: 'SIG_INPUTS' })]), '00deadbeef', lock)).toThrow(/exact 2-of-2/)
		const duplicate = JSON.stringify(['P2PK', { nonce: 'b'.repeat(64), data: lock.bidderPubkey, tags: [
			['pubkeys', lock.committeePubkey], ['pubkeys', lock.committeePubkey], ['n_sigs', '2'],
			['locktime', '4200'], ['refund', lock.refundPubkey], ['sigflag', 'SIG_ALL'],
		] }])
		expect(() => verifyThresholdSigAllToken(token([duplicate]), '00deadbeef', lock)).toThrow(/exact 2-of-2/)
	})

	test('uses the configured origin-bound transport for active-keyset verification', async () => {
		const held = token([secret()])
		const target = { type: 'p2pk', options: {
			kind: 'P2PK', data: lock.bidderPubkey, pubkeys: [lock.committeePubkey], requiredSignatures: 2,
			locktime: lock.locktime, refundKeys: [lock.refundPubkey], requiredRefundSignatures: 1, sigFlag: 'SIG_ALL',
		} }
		const prepared = { id: 'threshold-operation', mintUrl: 'https://mint.invalid', unit: 'sat', amount: 2,
			method: 'default', target, state: 'prepared' }
		const operation = { ...prepared, state: 'pending', token: held }
		let current: typeof prepared | typeof operation | null = null
		const manager = { quotes: { mint: {}, melt: {} }, ops: {
			mint: {}, melt: {}, receive: {}, send: {
				async prepare() { current = prepared; return prepared },
				async execute() { current = operation; return { operation, token: held } },
				async get() { return current },
			},
		} } as never
		let calls = 0
		const redirecting = (async (input: Parameters<typeof fetch>[0]) => {
			calls++
			const response = new Response('', { status: 302 })
			Object.defineProperty(response, 'url', { value: String(input) })
			return response
		}) as typeof fetch
		const rail = createCocoRail(manager, { fetchImpl: redirecting })
		await expect(rail.sendThresholdSigAll({
			mintUrl: 'https://mint.invalid', amount: 2, operationId: operation.id, lock,
		})).rejects.toThrow(/refused-mint-transport-redirect/)
		expect(calls).toBe(1)
	})

	test('resumes the exact durable threshold operation without preparing or executing another send', async () => {
		const held = token([secret(), secret()])
		const target = { type: 'p2pk', options: {
			kind: 'P2PK', data: lock.bidderPubkey, pubkeys: [lock.committeePubkey], requiredSignatures: 2,
			locktime: lock.locktime, refundKeys: [lock.refundPubkey], requiredRefundSignatures: 1, sigFlag: 'SIG_ALL',
		} }
		const operation = { id: 'threshold-resume', mintUrl: 'https://mint.invalid', unit: 'sat', amount: 3,
			method: 'default', target, state: 'pending', token: held }
		let prepared = 0, executed = 0, recovered = 0
		const manager = { quotes: { mint: {}, melt: {} }, ops: {
			mint: {}, melt: {}, receive: {}, send: {
				async get() { return operation }, async prepare() { prepared += 1; return operation },
				async execute() { executed += 1; return { operation, token: held } },
				recovery: { async run() { recovered += 1 }, inProgress() { return false } },
			},
		} } as never
		const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
			const url = String(input)
			const response = new Response(JSON.stringify({ keysets: [{ id: '00deadbeef', unit: 'sat', active: true, input_fee_ppk: 0 }] }), {
				status: 200, headers: { 'content-type': 'application/json' },
			})
			Object.defineProperty(response, 'url', { value: url })
			return response
		}) as typeof fetch
		const rail = createCocoRail(manager, { fetchImpl })
		expect(await rail.resumeThresholdSigAll({ mintUrl: operation.mintUrl, amount: 3, operationId: operation.id, lock }))
			.toMatchObject({ operationId: operation.id, state: 'pending', token: held })
		expect({ prepared, executed, recovered }).toEqual({ prepared: 0, executed: 0, recovered: 0 })
		await expect(rail.resumeThresholdSigAll({ mintUrl: operation.mintUrl, amount: 3, operationId: operation.id,
			lock: { ...lock, locktime: lock.locktime + 1 } })).rejects.toThrow(/intent-conflict/)
		expect({ prepared, executed, recovered }).toEqual({ prepared: 0, executed: 0, recovered: 0 })
		expect(await rail.ensureThresholdSigAll({ mintUrl: operation.mintUrl, amount: 3,
			operationId: operation.id, lock })).toMatchObject({ operationId: operation.id, state: 'pending' })
		expect({ prepared, executed, recovered }).toEqual({ prepared: 0, executed: 0, recovered: 0 })
	})

	test('prepares before the app marker and never prepares while resuming an absent marked operation', async () => {
		const target = { type: 'p2pk', options: {
			kind: 'P2PK', data: lock.bidderPubkey, pubkeys: [lock.committeePubkey], requiredSignatures: 2,
			locktime: lock.locktime, refundKeys: [lock.refundPubkey], requiredRefundSignatures: 1, sigFlag: 'SIG_ALL',
		} }
		let current: unknown = null, prepared = 0, executed = 0
		const manager = { quotes: { mint: {}, melt: {} }, ops: {
			mint: {}, melt: {}, receive: {}, send: {
				async get() { return current },
				async prepare(input: Record<string, unknown>) {
					prepared += 1
					current = { ...input, id: input.operationId, unit: 'sat', method: 'default', state: 'prepared' }
					return current
				},
				async execute() { executed += 1; throw new Error('must not execute during prepare') },
				recovery: { async run() {}, inProgress() { return false } },
			},
		} } as never
		const rail = createCocoRail(manager)
		const input = { mintUrl: 'https://mint.invalid', amount: 3, operationId: 'threshold-prepare', lock }
		expect(await rail.prepareThresholdSigAll(input)).toEqual({ operationId: input.operationId, state: 'prepared' })
		expect(await rail.prepareThresholdSigAll(input)).toEqual({ operationId: input.operationId, state: 'prepared' })
		expect({ prepared, executed }).toEqual({ prepared: 1, executed: 0 })
		current = null
		await expect(rail.resumeThresholdSigAll(input)).rejects.toThrow(/operation-absent/)
		expect({ prepared, executed, target }).toEqual({ prepared: 1, executed: 0, target })
	})
})
