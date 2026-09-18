import { describe, expect, test } from 'bun:test'
import { getSpendableProofsForMint } from './proofs'

describe('getSpendableProofsForMint', () => {
	test('requests only spendable proofs from wallet state and returns them', () => {
		const availableProof = { amount: 100, secret: 'available' } as never
		const spentProof = { amount: 200, secret: 'spent' } as never
		const calls: Array<{ mint?: string; includeDeleted?: boolean; onlyAvailable?: boolean }> = []

		const wallet = {
			state: {
				getProofs: (options: { mint?: string; includeDeleted?: boolean; onlyAvailable?: boolean }) => {
					calls.push(options)
					if (options.onlyAvailable) return [availableProof]
					return [availableProof, spentProof]
				},
			},
		} as never

		const result = getSpendableProofsForMint(wallet, 'https://mint.example')

		expect(calls).toEqual([
			{
				mint: 'https://mint.example',
				includeDeleted: false,
				onlyAvailable: true,
			},
		])
		expect(result).toEqual([availableProof])
	})
})
