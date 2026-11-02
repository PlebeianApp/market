import { describe, expect, test } from 'bun:test'
import { demoFridayTerminalExecutorArgs } from './demo-friday-terminal-executor-cli'

const h = (value: string): string => value.repeat(64)
const valid = [
	'execute', '--application', '/etc/plebeian-auctions-friday/application.json',
	'--deployment-id', 'friday-blue-20261023', '--scope', 'auction-a:bid-a',
	'--authority-operation-id', 'funding-a', '--payment-operation-id', 'funding-a',
	'--recipient-actor-id', h('2'),
	'--operation-root', h('a'), '--frost-operation-root', h('f'), '--bundle-digest', h('b'), '--branch', 'winner_payout',
	'--chain-id', 'plebeian-friday-demo-v1', '--execution-binding-digest', h('c'),
	'--prepared-authorization-digest', h('d'), '--selection-root', h('e'), '--outcome-height', '42',
]

describe('Friday exact terminal executor CLI boundary', () => {
	test('parses the full durable queue identity without bearer material', () => {
		expect(demoFridayTerminalExecutorArgs(valid)).toEqual({
			mode: 'execute', application: '/etc/plebeian-auctions-friday/application.json',
			identity: {
				schema: 'PLEBEIAN_FRIDAY_EXECUTOR_IDENTITY_V2', deploymentId: 'friday-blue-20261023',
				scope: 'auction-a:bid-a', authorityOperationId: 'funding-a', paymentOperationId: 'funding-a',
				recipientActorId: h('2'),
				operationRoot: h('a'), frostOperationRoot: h('f'), bundleDigest: h('b'), branch: 'winner_payout',
				chainId: 'plebeian-friday-demo-v1', executionBindingDigest: h('c'),
				preparedAuthorizationDigest: h('d'), selectionRoot: h('e'), outcomeHeight: 42,
			},
		})
	})

	test('rejects argument reordering, secret-like extras, wrong paths and malformed identities', () => {
		const reordered = [...valid]; [reordered[1], reordered[3]] = [reordered[3]!, reordered[1]!]
		expect(() => demoFridayTerminalExecutorArgs(reordered)).toThrow(/usage/)
		expect(() => demoFridayTerminalExecutorArgs([...valid, '--private-key', h('f')])).toThrow(/usage/)
		const wrongPath = [...valid]; wrongPath[2] = '/etc/plebeian-auctions-poc/application.json'
		expect(() => demoFridayTerminalExecutorArgs(wrongPath)).toThrow(/outside/)
		const badDigest = [...valid]; badDigest[12] = 'not-a-digest'
		expect(() => demoFridayTerminalExecutorArgs(badDigest)).toThrow(/not a digest/)
	})
})
