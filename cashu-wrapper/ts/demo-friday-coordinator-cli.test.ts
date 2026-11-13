import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdtemp, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	acquireDemoFridayProcessLease, demoFridayCoordinatorArgs, demoFridayExecutorIdentity,
	demoFridayManifestDigestPin, exactDemoFridayExecutorResult, exactSeparatedCoordinatorRuntimeExecutor,
} from './demo-friday-coordinator-cli'
import {
	SEPARATED_R10_EXECUTOR_BINARY, SEPARATED_R33_EXECUTOR_BINARY, SEPARATED_R34_EXECUTOR_BINARY, SEPARATED_R35_EXECUTOR_BINARY,
	SEPARATED_R36_EXECUTOR_BINARY, SEPARATED_R38_EXECUTOR_BINARY,
	SEPARATED_RECOVERY_EXECUTOR_BINARY,
	SEPARATED_FRESH_E2E_R2_EXECUTOR_BINARY,
	SEPARATED_APP_RESTORATION_R48_EXECUTOR_BINARY,
	SEPARATED_APP_RESTORATION_R49_EXECUTOR_BINARY,
	SEPARATED_APP_RESTORATION_R50_EXECUTOR_BINARY,
	SEPARATED_APP_RESTORATION_R51_EXECUTOR_BINARY,
	SEPARATED_SUCCESSOR_EXECUTOR_BINARY,
} from './demo-friday-separated-constants'
import type { DemoFridayCoordinatorRecordV2 } from './demo-friday-coordinator-runtime'

const h = (value: string): string => value.repeat(64)
const record: DemoFridayCoordinatorRecordV2 = {
	schema: 'PLEBEIAN_FRIDAY_COORDINATOR_RECORD_V2', deploymentId: 'friday-blue-20261023',
	scope: 'auction-a:bid-a', authorityOperationId: 'funding-a', paymentOperationId: 'funding-a',
	recipientActorId: h('2'),
	operationRoot: h('a'), frostOperationRoot: h('1'), bundleDigest: h('b'), branch: 'outbid_return',
	chainId: 'plebeian-friday-demo-v1', executionBindingDigest: h('f'),
	preparedAuthorizationDigest: h('e'), selectionRoot: h('d'), outcomeHeight: 42,
	phase: 'mint_unknown', revision: 1, attempts: 1,
}
const identity = demoFridayExecutorIdentity(record)
const envelope = (outcome: object, nextIdentity: object = identity) => ({
	schema: 'PLEBEIAN_FRIDAY_EXECUTOR_RESULT_V1', identity: nextIdentity, outcome,
})

describe('Friday coordinator child protocol', () => {
	test('accepts only one exact externally rendered DKG manifest pin', () => {
		expect(demoFridayManifestDigestPin(h('a'))).toBe(h('a'))
		for (const value of [undefined, '', h('A'), h('a').slice(2), `${h('a')}00`]) {
			expect(() => demoFridayManifestDigestPin(value)).toThrow('FRIDAY_DKG_MANIFEST_DIGEST')
		}
	})

	test('holds one process lease and refuses a second owner before recovery', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-process-lease.'))
		const path = join(root, 'active')
		try {
			const first = await acquireDemoFridayProcessLease(path)
			await expect(acquireDemoFridayProcessLease(path)).rejects.toThrow(/another process owns/)
			await first.releaseExact()
			const replacement = await acquireDemoFridayProcessLease(path)
			await replacement.releaseExact()
		} finally { await rmdir(root) }
	})

	test('separates one-time rollback-anchor enrollment from the serving command', () => {
		const common = [
			'--application', '/etc/plebeian-auctions-friday/application.json',
			'--database', '/var/lib/plebeian-auctions-friday/coordinator/operations.sqlite3',
			'--rollback-anchor-database', '/var/lib/plebeian-auctions-friday-anchor/coordinator.sqlite3',
		]
		expect(demoFridayCoordinatorArgs(['init-anchor', ...common])).toMatchObject({ mode: 'init-anchor' })
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common,
			'--executor-binary', '/opt/plebeian-auctions-friday/bin/plebeian-friday-terminal-executor',
		])).toMatchObject({ mode: 'serve' })
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary',
			'/opt/plebeian-auctions-friday/releases/r20-deploy-v1/bin/plebeian-friday-terminal-executor',
		])).toMatchObject({ mode: 'serve' })
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', SEPARATED_SUCCESSOR_EXECUTOR_BINARY,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_SUCCESSOR_EXECUTOR_BINARY })
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', SEPARATED_R10_EXECUTOR_BINARY,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_R10_EXECUTOR_BINARY })
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', SEPARATED_R33_EXECUTOR_BINARY,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_R33_EXECUTOR_BINARY })
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', SEPARATED_R34_EXECUTOR_BINARY,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_R34_EXECUTOR_BINARY })
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', SEPARATED_R35_EXECUTOR_BINARY,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_R35_EXECUTOR_BINARY })
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', SEPARATED_R36_EXECUTOR_BINARY,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_R36_EXECUTOR_BINARY })
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', SEPARATED_R38_EXECUTOR_BINARY,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_R38_EXECUTOR_BINARY })
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', SEPARATED_FRESH_E2E_R2_EXECUTOR_BINARY,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_FRESH_E2E_R2_EXECUTOR_BINARY })
		const r48Unit = readFileSync(new URL(
			'../../deploy/sidequest-mvp/plebeian-friday-coordinator-app-restoration-r48-20261109.service', import.meta.url,
		), 'utf8')
		const r48ExecStart = r48Unit.split('\n').find((line) => line.startsWith('ExecStart='))
		expect(r48ExecStart).toBeDefined()
		const r48Argv = r48ExecStart!.slice('ExecStart='.length).split(/\s+/)
		const r48Executor = r48Argv[r48Argv.indexOf('--executor-binary') + 1]
		expect(r48Executor).toBe(SEPARATED_APP_RESTORATION_R48_EXECUTOR_BINARY)
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', r48Executor!,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_APP_RESTORATION_R48_EXECUTOR_BINARY })
		const recoveryUnit = readFileSync(new URL(
			'../../deploy/sidequest-mvp/plebeian-friday-coordinator-recovery.service', import.meta.url,
		), 'utf8')
		const recoveryExecStart = recoveryUnit.split('\n').find((line) => line.startsWith('ExecStart='))
		expect(recoveryExecStart).toBeDefined()
		const recoveryArgv = recoveryExecStart!.slice('ExecStart='.length).split(/\s+/)
		const recoveryExecutor = recoveryArgv[recoveryArgv.indexOf('--executor-binary') + 1]
		expect(recoveryExecutor).toBe(SEPARATED_RECOVERY_EXECUTOR_BINARY)
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', recoveryExecutor!,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_RECOVERY_EXECUTOR_BINARY })
		for (const path of [
			`${SEPARATED_SUCCESSOR_EXECUTOR_BINARY}-near`,
			`${SEPARATED_R10_EXECUTOR_BINARY}-near`,
			`${SEPARATED_R33_EXECUTOR_BINARY}-near`,
			`${SEPARATED_R34_EXECUTOR_BINARY}-near`,
			`${SEPARATED_R35_EXECUTOR_BINARY}-near`,
			`${SEPARATED_R36_EXECUTOR_BINARY}-near`,
			`${SEPARATED_R38_EXECUTOR_BINARY}-near`,
			`${SEPARATED_FRESH_E2E_R2_EXECUTOR_BINARY}-near`,
			`${SEPARATED_APP_RESTORATION_R48_EXECUTOR_BINARY}-near`,
			`${SEPARATED_RECOVERY_EXECUTOR_BINARY}-near`,
			'/opt/plebeian-auctions-friday/releases/r20-deploy-v1/bin/plebeian-friday-terminal-executor-near',
			'/opt/plebeian-auctions-friday/releases/r20-deploy-v1/bin/../bin/plebeian-friday-terminal-executor',
			'/opt/plebeian-auctions-friday/releases/r20-deploy-v2/bin/plebeian-friday-terminal-executor',
			'/opt/plebeian-auctions-friday/releases/r20-deploy-v1//bin/plebeian-friday-terminal-executor',
			'/opt/plebeian-auctions-friday/releases/r20-deploy-v1/bin/plebeian-friday-acceptance-operator',
		]) expect(() => demoFridayCoordinatorArgs(['serve', ...common, '--executor-binary', path])).toThrow()
		expect(() => demoFridayCoordinatorArgs(['serve', ...common])).toThrow(/usage/)
	})

	test('the separated runtime gate admits the exact R2 executor and rejects every near miss', () => {
		expect(exactSeparatedCoordinatorRuntimeExecutor(SEPARATED_FRESH_E2E_R2_EXECUTOR_BINARY))
			.toBe(SEPARATED_FRESH_E2E_R2_EXECUTOR_BINARY)
		for (const value of [
			`${SEPARATED_FRESH_E2E_R2_EXECUTOR_BINARY}-near`,
			SEPARATED_FRESH_E2E_R2_EXECUTOR_BINARY.replace('/bin/', '/bin/../bin/'),
			SEPARATED_FRESH_E2E_R2_EXECUTOR_BINARY.replace('r2-20261108', 'r3-20261108'),
		]) expect(() => exactSeparatedCoordinatorRuntimeExecutor(value)).toThrow(
			'SEPARATED_COORDINATOR: exact approved executor required')
	})

	test('the separated runtime gate admits only the exact R48 executor path', () => {
		expect(exactSeparatedCoordinatorRuntimeExecutor(SEPARATED_APP_RESTORATION_R48_EXECUTOR_BINARY))
			.toBe(SEPARATED_APP_RESTORATION_R48_EXECUTOR_BINARY)
		for (const value of [
			`${SEPARATED_APP_RESTORATION_R48_EXECUTOR_BINARY}-near`,
			SEPARATED_APP_RESTORATION_R48_EXECUTOR_BINARY.replace('/bin/', '/bin/../bin/'),
			SEPARATED_APP_RESTORATION_R48_EXECUTOR_BINARY.replace('r48-20261109', 'r52-20261109'),
		]) expect(() => exactSeparatedCoordinatorRuntimeExecutor(value)).toThrow(
			'SEPARATED_COORDINATOR: exact approved executor required')
	})

	test('the separated runtime gate admits only the exact R49 executor path', () => {
		const common = [
			'--application', '/etc/plebeian-auctions-friday/application.json',
			'--database', '/var/lib/plebeian-auctions-friday/coordinator/operations.sqlite3',
			'--rollback-anchor-database', '/var/lib/plebeian-auctions-friday-anchor/coordinator.sqlite3',
		]
		const r49Unit = readFileSync(new URL(
			'../../deploy/sidequest-mvp/plebeian-friday-coordinator-app-restoration-r49-20261109.service', import.meta.url,
		), 'utf8')
		const execStart = r49Unit.split('\n').find((line) => line.startsWith('ExecStart='))
		expect(execStart).toBeDefined()
		const argv = execStart!.slice('ExecStart='.length).split(/\s+/)
		const executor = argv[argv.indexOf('--executor-binary') + 1]
		expect(executor).toBe(SEPARATED_APP_RESTORATION_R49_EXECUTOR_BINARY)
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', executor!,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_APP_RESTORATION_R49_EXECUTOR_BINARY })
		for (const rejected of [
			`${SEPARATED_APP_RESTORATION_R49_EXECUTOR_BINARY}-near`,
			SEPARATED_APP_RESTORATION_R49_EXECUTOR_BINARY.replace('/bin/', '/bin/../bin/'),
			SEPARATED_APP_RESTORATION_R49_EXECUTOR_BINARY.replace('r49-20261109', 'r52-20261109'),
		]) expect(() => exactSeparatedCoordinatorRuntimeExecutor(rejected)).toThrow()
	})

	test('the separated runtime gate admits only the exact R50 executor path', () => {
		const common = [
			'--application', '/etc/plebeian-auctions-friday/application.json',
			'--database', '/var/lib/plebeian-auctions-friday/coordinator/operations.sqlite3',
			'--rollback-anchor-database', '/var/lib/plebeian-auctions-friday-anchor/coordinator.sqlite3',
		]
		const unit = readFileSync(new URL(
			'../../deploy/sidequest-mvp/plebeian-friday-coordinator-app-restoration-r50-20261109.service', import.meta.url,
		), 'utf8')
		const execStart = unit.split('\n').find((line) => line.startsWith('ExecStart='))
		expect(execStart).toBeDefined()
		const argv = execStart!.slice('ExecStart='.length).split(/\s+/)
		const executor = argv[argv.indexOf('--executor-binary') + 1]
		expect(executor).toBe(SEPARATED_APP_RESTORATION_R50_EXECUTOR_BINARY)
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', executor!,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_APP_RESTORATION_R50_EXECUTOR_BINARY })
		for (const rejected of [
			`${SEPARATED_APP_RESTORATION_R50_EXECUTOR_BINARY}-near`,
			SEPARATED_APP_RESTORATION_R50_EXECUTOR_BINARY.replace('/bin/', '/bin/../bin/'),
			SEPARATED_APP_RESTORATION_R50_EXECUTOR_BINARY.replace('r50-20261109', 'r52-20261109'),
		]) expect(() => exactSeparatedCoordinatorRuntimeExecutor(rejected)).toThrow()
	})

	test('the separated runtime gate admits only the exact R51 executor path', () => {
		const common = [
			'--application', '/etc/plebeian-auctions-friday/application.json',
			'--database', '/var/lib/plebeian-auctions-friday/coordinator/operations.sqlite3',
			'--rollback-anchor-database', '/var/lib/plebeian-auctions-friday-anchor/coordinator.sqlite3',
		]
		const unit = readFileSync(new URL(
			'../../deploy/sidequest-mvp/plebeian-friday-coordinator-app-restoration-r51-20261109.service', import.meta.url,
		), 'utf8')
		const execStart = unit.split('\n').find((line) => line.startsWith('ExecStart='))
		expect(execStart).toBeDefined()
		const argv = execStart!.slice('ExecStart='.length).split(/\s+/)
		const executor = argv[argv.indexOf('--executor-binary') + 1]
		expect(executor).toBe(SEPARATED_APP_RESTORATION_R51_EXECUTOR_BINARY)
		expect(demoFridayCoordinatorArgs([
			's' + 'erve', ...common, '--executor-binary', executor!,
		])).toMatchObject({ mode: 'serve', executor: SEPARATED_APP_RESTORATION_R51_EXECUTOR_BINARY })
		for (const rejected of [
			`${SEPARATED_APP_RESTORATION_R51_EXECUTOR_BINARY}-near`,
			SEPARATED_APP_RESTORATION_R51_EXECUTOR_BINARY.replace('/bin/', '/bin/../bin/'),
			SEPARATED_APP_RESTORATION_R51_EXECUTOR_BINARY.replace('r51-20261109', 'r52-20261109'),
		]) expect(() => exactSeparatedCoordinatorRuntimeExecutor(rejected)).toThrow()
	})

	test('accepts only exact identity-bound non-bearer terminal outcomes', () => {
		expect(exactDemoFridayExecutorResult('execute', envelope({ status: 'mint_unknown', requestDigest: h('c') }), identity))
			.toEqual({ status: 'mint_unknown', requestDigest: h('c') })
		expect(exactDemoFridayExecutorResult('recover', envelope({ status: 'retry_ready' }), identity)).toEqual({ status: 'retry_ready' })
		expect(exactDemoFridayExecutorResult('recover', envelope({ status: 'recipient_pending', terminalResponseDigest: h('d') }), identity))
			.toEqual({ status: 'recipient_pending', terminalResponseDigest: h('d') })
		expect(exactDemoFridayExecutorResult('import', envelope({ status: 'recipient_pending' }), identity))
			.toEqual({ status: 'recipient_pending' })
		expect(exactDemoFridayExecutorResult('import', envelope({ status: 'completed', recipientImportDigest: h('e') }), identity))
			.toEqual({ status: 'completed', recipientImportDigest: h('e') })
		const reorderedIdentity = Object.fromEntries(Object.entries(identity).reverse())
		expect(exactDemoFridayExecutorResult('recover', envelope({ status: 'indeterminate' }, reorderedIdentity), identity))
			.toEqual({ status: 'indeterminate' })
	})

	test('rejects secrets, ambiguous status, extra fields and identity substitution', () => {
		expect(() => exactDemoFridayExecutorResult('execute', envelope({ status: 'mint_unknown', requestDigest: h('a'), token: 'bearer' }), identity)).toThrow()
		expect(() => exactDemoFridayExecutorResult('recover', envelope({ status: 'completed', terminalResponseDigest: h('b') }), identity)).toThrow()
		expect(() => exactDemoFridayExecutorResult('import', envelope({ status: 'completed', recipientImportDigest: h('c'), proofs: [] }), identity)).toThrow()
		expect(() => exactDemoFridayExecutorResult('execute', envelope({ status: 'mint_unknown', requestDigest: h('c') }, { ...identity, bundleDigest: h('d') }), identity)).toThrow(/identity differs/)
		expect(() => exactDemoFridayExecutorResult('execute', envelope({ status: 'mint_unknown', requestDigest: 'not-a-digest' }), identity)).toThrow()
	})
})
