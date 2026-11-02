import { describe, expect, test } from 'bun:test'

import {
	createDemoFridayBrowserAuthorityFundingHttp,
	createDemoFridayBrowserAuthorityFundingAbortHttp,
	createDemoFridayBrowserAuthorityTerminalHttp,
} from './demo-friday-browser-authority-http'

const H = (value: string) => value.repeat(64).slice(0, 64)

describe('Friday browser authority HTTP adapter', () => {
	test('maps prepare, finalize and read-only recovery without changing identity', async () => {
		const calls: Array<{ path: string; body: unknown }> = []
		const event = { pubkey: H('1'), created_at: 10, kind: 28_641, tags: [], content: '{}' }
		const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const path = new URL(String(input)).pathname
			const body = JSON.parse(String(init?.body)) as unknown
			calls.push({ path, body })
			const base = {
				preparationId: H('2'), fundingAuthorizationEventId: H('2'), fundingOperationId: 'operation-1',
				bidAmount: 2_500, reservedPoolAmount: 2_500, canonicalMintUrl: 'https://172.105.64.142',
			}
			const response = path === '/api/friday/funding'
				? { schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_CHALLENGE_V1', status: 'signature_required', ...base,
					receiptDigest: H('3'), unsignedEvent: event }
				: path === '/api/friday/funding/confirm'
					? { schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_RESULT_V1', status: 'admitted',
						fundingAuthorizationEventId: H('2'), fundingOperationId: 'operation-1', bidEventId: H('4'),
						transactionHash: H('5'), committedHeight: 42, receiptDigest: H('3'),
						bidAmount: 2_500, reservedPoolAmount: 2_500, canonicalMintUrl: 'https://172.105.64.142' }
					: { schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_STATUS_V1', status: 'admitted', ...base,
						signedBidEventId: H('4'), transactionHash: H('5'), committedHeight: 42, receiptDigest: H('3') }
			return new Response(JSON.stringify(response), { status: path.endsWith('funding') ? 202 : 200,
				headers: { 'content-type': 'application/json' } })
		}) as unknown as typeof fetch
		const adapter = createDemoFridayBrowserAuthorityFundingHttp({ origin: 'https://172.105.64.142', fetchImpl })
		const prepared = await adapter.prepareExact({ exact: true })
		expect(prepared).toMatchObject({ preparationId: H('2'), bidAmount: 2_500, unsignedBid: event })
		const identity = { preparationId: H('2'), fundingAuthorizationEventId: H('2'), fundingOperationId: 'operation-1' }
		expect(await adapter.finalizeExact({ ...identity, signedBid: { ...event, id: H('4'), sig: '6'.repeat(128) } }))
			.toMatchObject({ status: 'admitted', signedBidEventId: H('4'), committedHeight: 42 })
		expect(await adapter.readExact(identity)).toMatchObject({ status: 'admitted', receiptDigest: H('3') })
		expect(calls.map(({ path }) => path)).toEqual([
			'/api/friday/funding', '/api/friday/funding/confirm', '/api/friday/funding/status',
		])
	})

	test('rejects a cross-operation finalize response', async () => {
		const adapter = createDemoFridayBrowserAuthorityFundingHttp({ origin: 'https://172.105.64.142', fetchImpl: (async () =>
			new Response(JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_RESULT_V1', status: 'admitted',
				fundingAuthorizationEventId: H('2'), fundingOperationId: 'other' }), {
				status: 200, headers: { 'content-type': 'application/json' },
			})) as unknown as typeof fetch })
		await expect(adapter.finalizeExact({ preparationId: H('2'), fundingAuthorizationEventId: H('2'),
			fundingOperationId: 'operation-1', signedBid: { pubkey: H('1'), created_at: 10, kind: 28_641,
				tags: [], content: '{}', id: H('4'), sig: '6'.repeat(128) } })).rejects.toThrow(/missing|differs/)
	})

	test('returns one exact deterministic rejection so the browser waits for certified refund import', async () => {
		const response = {
			schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_STATUS_V1', status: 'rejected_return', preparationId: H('2'),
			fundingAuthorizationEventId: H('2'), fundingOperationId: 'operation-1', bidAmount: 2_500,
			reservedPoolAmount: 2_500, canonicalMintUrl: 'https://172.105.64.142', signedBidEventId: H('4'),
			transactionHash: H('5'), committedHeight: 42, receiptDigest: H('3'), rejectionReason: 'late',
		} as const
		const adapter = createDemoFridayBrowserAuthorityFundingHttp({ origin: 'https://172.105.64.142', fetchImpl: (async () =>
			new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch })
		await expect(adapter.readExact({ preparationId: H('2'), fundingAuthorizationEventId: H('2'),
			fundingOperationId: 'operation-1' })).resolves.toEqual(response)
	})

	test('reads one terminal notice and posts only the exact canonical recipient acknowledgement', async () => {
		const calls: Array<{ path: string; body: unknown }> = []
		const ack = {
			schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1' as const, actor: H('1'),
			fundingOperationId: 'operation-1', noticeDigest: H('2'),
			importReceipt: { schema: 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1' as const,
				operationId: 'operation-1', role: 'refund' as const, recipientPublicKey: `02${H('3')}`,
				amount: 2_500, proofCount: 3, imported: true as const },
			recipientAckSignature: '4'.repeat(128),
		}
		const notice = { schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1', operationId: 'operation-1' }
		const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const path = new URL(String(input)).pathname
			const body = JSON.parse(String(init?.body)) as unknown
			calls.push({ path, body })
			return new Response(JSON.stringify(path.endsWith('/read') ? notice : ack), {
				status: 200, headers: { 'content-type': 'application/json' },
			})
		}) as unknown as typeof fetch
		const terminal = createDemoFridayBrowserAuthorityTerminalHttp({ origin: 'https://172.105.64.142', fetchImpl })
		expect(await terminal.readNoticeExact({ actor: H('1'), fundingOperationId: 'operation-1' })).toEqual(notice)
		await terminal.acknowledgeExact(ack)
		expect(calls).toEqual([
			{ path: '/api/friday/terminal/read', body: { actor: H('1'), fundingOperationId: 'operation-1' } },
			{ path: '/api/friday/terminal/ack', body: ack },
		])
	})

	test('maps cancellation prepare, request and read without treating transport as authority', async () => {
		const calls: Array<{ path: string; body: unknown }> = []
		const preparation = { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_PREPARATION_V1',
			preparationId: H('7'), terms: { exact: true } }
		const pending = { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_STATUS_V1', status: 'PENDING',
			preparationId: H('7'), actor: H('1'), fundingOperationId: 'operation-1' }
		const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const path = new URL(String(input)).pathname, body = JSON.parse(String(init?.body)) as unknown
			calls.push({ path, body })
			return new Response(JSON.stringify(path.endsWith('/prepare') ? preparation : pending), {
				status: 200, headers: { 'content-type': 'application/json' },
			})
		}) as unknown as typeof fetch
		const abort = createDemoFridayBrowserAuthorityFundingAbortHttp({ origin: 'https://172.105.64.142', fetchImpl })
		await expect(abort.prepareExact({ actor: H('1'), environmentId: 'friday-live', fundingOperationId: 'operation-1',
			reason: 'prebroadcast_client_abandonment' })).resolves.toEqual(preparation as never)
		const event = { id: H('8'), pubkey: H('1'), created_at: 10, kind: 28_650 as const,
			tags: [], content: '{}', sig: '9'.repeat(128) }
		await expect(abort.requestAbortExact({ preparationId: H('7'), actorAbortEvent: event })).resolves.toEqual(pending as never)
		await expect(abort.readExact({ preparationId: H('7'), actor: H('1'), fundingOperationId: 'operation-1' }))
			.resolves.toEqual(pending as never)
		expect(calls.map(({ path }) => path)).toEqual(['/api/friday/funding-abort/prepare',
			'/api/friday/funding-abort/request', '/api/friday/funding-abort/status'])
	})

	test('rejects a claimed committed cancellation without its certificate and finality', async () => {
		const abort = createDemoFridayBrowserAuthorityFundingAbortHttp({ origin: 'https://172.105.64.142', fetchImpl: (async () =>
			new Response(JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_STATUS_V1',
				status: 'COMMITTED_ABORT', preparationId: H('7'), actor: H('1'), fundingOperationId: 'operation-1',
				certificate: {}, finality: {} }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch })
		await expect(abort.readExact({ preparationId: H('7'), actor: H('1'), fundingOperationId: 'operation-1' }))
			.rejects.toThrow(/missing or unexpected fields|malformed/)
	})
})
