import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'

import {
	demoFridayTerminalDescriptorDigest,
	DemoFridayTerminalDescriptorSqlite,
	type DemoFridayTerminalDescriptorV1,
} from './demo-friday-fixed-terminal-resolver'

const databases: Database[] = []
afterEach(() => { for (const database of databases.splice(0)) database.close(false) })

function descriptor(): DemoFridayTerminalDescriptorV1 {
	return {
		schema: 'PLEBEIAN_FRIDAY_TERMINAL_DESCRIPTOR_V1', reference: 'terminal-1', branch: 'outbid_return',
		auctionId: 'auction-1', fundingOperationId: 'operation-1', scope: 'a'.repeat(64),
		bundleDigest: 'b'.repeat(64), eventHeight: 42, eventId: 'c'.repeat(64),
	}
}

describe('fixed terminal descriptor journal', () => {
	test('binds every resolver input and reopens exactly after restart', async () => {
		const database = new Database(':memory:', { strict: true }); databases.push(database)
		const first = new DemoFridayTerminalDescriptorSqlite(database)
		const value = descriptor()
		const reference = first.persistAuthenticatedExact(value)
		expect(reference.identityDigest).toBe(demoFridayTerminalDescriptorDigest(value))
		const reopened = new DemoFridayTerminalDescriptorSqlite(database)
		expect(await reopened.readExact(reference.reference)).toEqual(value)
	})

	test('rejects replay under another branch, height, or operation', () => {
		const database = new Database(':memory:', { strict: true }); databases.push(database)
		const journal = new DemoFridayTerminalDescriptorSqlite(database)
		journal.persistAuthenticatedExact(descriptor())
		for (const mutation of [
			{ branch: 'winner_payout' as const }, { eventHeight: 43 }, { fundingOperationId: 'operation-2' },
		]) {
			expect(() => journal.persistAuthenticatedExact({ ...descriptor(), ...mutation })).toThrow(/changed/)
		}
	})

	test('durably pages terminal history beyond the former 5000-block limit', async () => {
		const database = new Database(':memory:', { strict: true }); databases.push(database)
		const request = {
			fundingOperationId: 'operation-long', admissionEventId: 'd'.repeat(64),
			kind: 'event' as const, targetId: 'e'.repeat(64), startHeight: 1, observedEndHeight: 5_200,
		}
		let reads = 0
		const block = async (height: number) => {
			reads++
			return { height, transactions: height === 5_101 ? [new TextEncoder().encode('target')] : [] }
		}
		const first = new DemoFridayTerminalDescriptorSqlite(database)
		expect(await first.scanHistoryPageExact({
			request, maxBlocks: 256, readBlock: block,
			matches: (raw) => new TextDecoder().decode(raw) === 'target',
		})).toEqual({ complete: false, scannedBlocks: 256 })
		const reopened = new DemoFridayTerminalDescriptorSqlite(database)
		let result = { complete: false, scannedBlocks: 0 } as Awaited<ReturnType<typeof reopened.scanHistoryPageExact>>
		while (!result.complete) {
			result = await reopened.scanHistoryPageExact({
				request: { ...request, observedEndHeight: 5_400 }, maxBlocks: 256, readBlock: block,
				matches: (raw) => new TextDecoder().decode(raw) === 'target',
			})
		}
		expect(result.foundHeight).toBe(5_101)
		expect(reads).toBe(5_200)
		await expect(reopened.scanHistoryPageExact({
			request: { ...request, targetId: 'f'.repeat(64) }, maxBlocks: 1, readBlock: block,
			matches: () => false,
		})).rejects.toThrow(/identity changed/)
	})

	test('fails closed if one terminal identity appears twice across restart pages', async () => {
		const database = new Database(':memory:', { strict: true }); databases.push(database)
		const journal = new DemoFridayTerminalDescriptorSqlite(database)
		const request = {
			fundingOperationId: 'operation-duplicate', admissionEventId: '1'.repeat(64),
			kind: 'close' as const, targetId: 'auction-duplicate', startHeight: 10, observedEndHeight: 20,
		}
		const readBlock = async (height: number) => ({
			height, transactions: [14, 18].includes(height) ? [new TextEncoder().encode('close')] : [],
		})
		expect(await journal.scanHistoryPageExact({
			request, maxBlocks: 6, readBlock, matches: () => true,
		})).toEqual({ complete: false, scannedBlocks: 6 })
		const reopened = new DemoFridayTerminalDescriptorSqlite(database)
		await expect(reopened.scanHistoryPageExact({
			request, maxBlocks: 5, readBlock, matches: () => true,
		})).rejects.toThrow(/more than one/)
	})
})
