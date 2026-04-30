import { describe, expect, test } from 'bun:test'
import { syncMintSelection } from '../auctionMintSync'

const EMPTY = new Set<string>()

describe('syncMintSelection', () => {
	test('adds newly available mints', () => {
		const result = syncMintSelection(['mint-a', 'mint-b'], ['mint-a', 'mint-b', 'mint-c'], ['mint-a', 'mint-b'], EMPTY)
		expect(result).toEqual(['mint-a', 'mint-b', 'mint-c'])
	})

	test('does not auto-remove mints that leave availableMints', () => {
		const result = syncMintSelection(['mint-a', 'mint-b', 'mint-c'], ['mint-a', 'mint-c'], ['mint-a', 'mint-b', 'mint-c'], EMPTY)
		expect(result).toEqual(['mint-a', 'mint-b', 'mint-c'])
	})

	test('preserves user explicit removals when available is unchanged', () => {
		const result = syncMintSelection(['mint-a', 'mint-b', 'mint-c'], ['mint-a', 'mint-b', 'mint-c'], ['mint-a'], EMPTY)
		expect(result).toEqual(['mint-a'])
	})

	test('handles add and keep simultaneously', () => {
		const result = syncMintSelection(['mint-a', 'mint-b'], ['mint-a', 'mint-c', 'mint-d'], ['mint-a', 'mint-b'], EMPTY)
		expect(result).toEqual(['mint-a', 'mint-b', 'mint-c', 'mint-d'])
	})

	test('empty selection with new available mints', () => {
		const result = syncMintSelection([], ['mint-a', 'mint-b'], [], EMPTY)
		expect(result).toEqual(['mint-a', 'mint-b'])
	})

	test('all mints removed from available but kept in selection', () => {
		const result = syncMintSelection(['mint-a', 'mint-b'], [], ['mint-a'], EMPTY)
		expect(result).toEqual(['mint-a'])
	})

	test('no change when available is identical reference', () => {
		const available = ['mint-a', 'mint-b']
		const result = syncMintSelection(available, available, ['mint-a'], EMPTY)
		expect(result).toEqual(['mint-a'])
	})

	test('returning mint is not re-added when user explicitly removed it', () => {
		const removed = new Set(['mint-b'])
		const result = syncMintSelection(['mint-a', 'mint-b'], ['mint-a', 'mint-b', 'mint-c'], ['mint-a'], removed)
		expect(result).toEqual(['mint-a', 'mint-c'])
	})

	test('returning mint IS re-added when user did not remove it', () => {
		const result = syncMintSelection(['mint-a'], ['mint-a', 'mint-b'], ['mint-a'], EMPTY)
		expect(result).toEqual(['mint-a', 'mint-b'])
	})

	test('custom mint not in availableMints is preserved in selection', () => {
		const result = syncMintSelection(['mint-a'], ['mint-a'], ['mint-a', 'https://custom.mint.example'], EMPTY)
		expect(result).toEqual(['mint-a', 'https://custom.mint.example'])
	})

	test('does not duplicate mints already in selection', () => {
		const result = syncMintSelection(['mint-a'], ['mint-a', 'mint-b'], ['mint-a', 'mint-b'], EMPTY)
		expect(result).toEqual(['mint-a', 'mint-b'])
	})
})
