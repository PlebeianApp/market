import { describe, expect, test } from 'bun:test'
import { syncMintSelection } from '../auctionMintSync'

describe('syncMintSelection', () => {
	test('adds newly available mints', () => {
		const result = syncMintSelection(['mint-a', 'mint-b'], ['mint-a', 'mint-b', 'mint-c'], ['mint-a', 'mint-b'])
		expect(result).toEqual(['mint-a', 'mint-b', 'mint-c'])
	})

	test('removes mints that are no longer available', () => {
		const result = syncMintSelection(['mint-a', 'mint-b', 'mint-c'], ['mint-a', 'mint-c'], ['mint-a', 'mint-b', 'mint-c'])
		expect(result).toEqual(['mint-a', 'mint-c'])
	})

	test('preserves user explicit removals when available is unchanged', () => {
		const result = syncMintSelection(['mint-a', 'mint-b', 'mint-c'], ['mint-a', 'mint-b', 'mint-c'], ['mint-a'])
		expect(result).toEqual(['mint-a'])
	})

	test('handles add and remove simultaneously', () => {
		const result = syncMintSelection(['mint-a', 'mint-b'], ['mint-a', 'mint-c', 'mint-d'], ['mint-a', 'mint-b'])
		expect(result).toEqual(['mint-a', 'mint-c', 'mint-d'])
	})

	test('empty selection with new available mints', () => {
		const result = syncMintSelection([], ['mint-a', 'mint-b'], [])
		expect(result).toEqual(['mint-a', 'mint-b'])
	})

	test('all mints removed from available', () => {
		const result = syncMintSelection(['mint-a', 'mint-b'], [], ['mint-a'])
		expect(result).toEqual([])
	})

	test('no change when available is identical reference', () => {
		const available = ['mint-a', 'mint-b']
		const result = syncMintSelection(available, available, ['mint-a'])
		expect(result).toEqual(['mint-a'])
	})
})
