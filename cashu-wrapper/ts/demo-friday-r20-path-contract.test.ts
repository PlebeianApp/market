import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'

import { demoFridayAuthorityParticipantBinary } from './demo-friday-authority-cli'
import { demoFridayCoordinatorArgs } from './demo-friday-coordinator-cli'
import { FRIDAY_R20_COURIER_INPUT_ROOT, FRIDAY_R20_COURIER_ROOT } from './demo-friday-r20-courier-cli'
import {
	DEMO_FRIDAY_R20_ACCEPTANCE_OPERATOR_BINARY, DEMO_FRIDAY_R20_COMET_PROBE_BINARY,
	DEMO_FRIDAY_R20_COURIER_INPUT_ROOT, DEMO_FRIDAY_R20_COURIER_OPERATOR_ROOT,
	DEMO_FRIDAY_R20_INSPECTOR_BINARY, DEMO_FRIDAY_R20_PARTICIPANT_BINARY,
	DEMO_FRIDAY_R20_PERMISSION_SEAL_BINARY, DEMO_FRIDAY_R20_RELEASE_ROOT,
	DEMO_FRIDAY_R20_TERMINAL_EXECUTOR_BINARY,
} from './demo-friday-r20-path-contract'

const LEGACY_PARTICIPANT = '/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant-3of4'

describe('immutable R20 path contract', () => {
	test('binds every active R20 executable to the reviewed release root', () => {
		expect(DEMO_FRIDAY_R20_RELEASE_ROOT).toBe('/opt/plebeian-auctions-friday/releases/r20-deploy-v1')
		for (const path of [DEMO_FRIDAY_R20_PERMISSION_SEAL_BINARY, DEMO_FRIDAY_R20_PARTICIPANT_BINARY,
			DEMO_FRIDAY_R20_INSPECTOR_BINARY, DEMO_FRIDAY_R20_COMET_PROBE_BINARY,
			DEMO_FRIDAY_R20_TERMINAL_EXECUTOR_BINARY, DEMO_FRIDAY_R20_ACCEPTANCE_OPERATOR_BINARY]) {
			expect(path.startsWith(`${DEMO_FRIDAY_R20_RELEASE_ROOT}/bin/`)).toBeTrue()
			expect(path).not.toContain('r20-r7-abort-integrationfix')
		}
	})

	test('preserves the V2 participant while selecting the R20 path only for V3', () => {
		expect(demoFridayAuthorityParticipantBinary('PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2')).toBe(LEGACY_PARTICIPANT)
		expect(demoFridayAuthorityParticipantBinary('PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3'))
			.toBe(DEMO_FRIDAY_R20_PARTICIPANT_BINARY)
	})

	test('allows only the legacy prefix or exact R20 terminal executor', () => {
		const common = ['serve', '--application', '/etc/plebeian-auctions-friday/application.json',
			'--database', '/var/lib/plebeian-auctions-friday/coordinator/operations.sqlite3',
			'--rollback-anchor-database', '/var/lib/plebeian-auctions-friday-anchor/coordinator.sqlite3',
			'--executor-binary']
		expect(demoFridayCoordinatorArgs([...common, DEMO_FRIDAY_R20_TERMINAL_EXECUTOR_BINARY]))
			.toMatchObject({ executor: DEMO_FRIDAY_R20_TERMINAL_EXECUTOR_BINARY })
		for (const path of [`${DEMO_FRIDAY_R20_TERMINAL_EXECUTOR_BINARY}-other`,
			`${DEMO_FRIDAY_R20_RELEASE_ROOT}/bin/../bin/plebeian-friday-terminal-executor`,
			'/opt/plebeian-auctions-friday/releases/r20-deploy-v2/bin/plebeian-friday-terminal-executor',
			'/opt/plebeian-auctions-friday/releases/r20-deploy-v1//bin/plebeian-friday-terminal-executor',
			`${DEMO_FRIDAY_R20_RELEASE_ROOT}/bin/plebeian-friday-acceptance-operator`,
			`${DEMO_FRIDAY_R20_RELEASE_ROOT}/bin/`]) {
			expect(() => demoFridayCoordinatorArgs([...common, path])).toThrow(/canonical Friday binary path/)
		}
	})

	test('uses the owner-approved stable courier roots without creating them', () => {
		expect(DEMO_FRIDAY_R20_COURIER_INPUT_ROOT)
			.toBe('/home/maximoto/.local/state/plebeian-auctions-friday/r20-courier/inputs')
		expect(DEMO_FRIDAY_R20_COURIER_OPERATOR_ROOT)
			.toBe('/home/maximoto/.local/state/plebeian-auctions-friday/r20-courier/operator')
		expect(FRIDAY_R20_COURIER_INPUT_ROOT).toBe(DEMO_FRIDAY_R20_COURIER_INPUT_ROOT)
		expect(FRIDAY_R20_COURIER_ROOT).toBe(DEMO_FRIDAY_R20_COURIER_OPERATOR_ROOT)
	})

	test('leaves historical generic path contracts unchanged', async () => {
		const generic = await readFile(new URL('./demo-friday-per-validator-dkg-plan.ts', import.meta.url), 'utf8')
		expect(generic).toContain("'/var/lib/plebeian-auctions-friday/frost/keyset-v1'")
		expect(generic).toContain("'/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant'")
		const predecessor = await readFile(new URL('./demo-friday-r20-r18-permission-seal.ts', import.meta.url), 'utf8')
		expect(predecessor).toContain("'/opt/plebeian-auctions-friday/bin/plebeian-friday-dkg-host'")
	})

	test('allows only the enumerated historical production binary paths', async () => {
		const expected: Array<readonly [string, string]> = [
			['demo-friday-authority-cli.ts', '/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant-3of4'],
			['demo-friday-browser-acceptance-adapters.ts', '/opt/plebeian-auctions-friday/bin/plebeian-friday-comet-probe'],
			['demo-friday-coordinator-cli.ts', '/opt/plebeian-auctions-friday/bin/'],
			['demo-friday-per-validator-dkg-host-cli.ts', '/opt/plebeian-auctions-friday/bin/coco-demo-frost-public-inspect'],
			['demo-friday-per-validator-dkg-plan.ts', '/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant'],
			['demo-friday-r20-r18-permission-seal.ts', '/opt/plebeian-auctions-friday/bin/plebeian-friday-dkg-host'],
			['demo-friday-r20-r18-permission-seal.ts', '/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant'],
		]
		const actual: Array<readonly [string, string]> = []
		for (const name of (await readdir(new URL('.', import.meta.url))).filter((value) => value.endsWith('.ts') && !value.endsWith('.test.ts')).sort()) {
			const source = await readFile(new URL(`./${name}`, import.meta.url), 'utf8')
			for (const match of source.matchAll(/\/opt\/plebeian-auctions-friday\/bin\/[A-Za-z0-9._/-]*/g)) {
				actual.push([name, match[0]])
			}
		}
		expect(actual).toEqual(expected)
	})

	test('matches the installed R20 unit, environment, and verifier path chain', async () => {
		const env = await readFile(new URL('../../deploy/friday/r20/friday.env.example', import.meta.url), 'utf8')
		const coordinator = await readFile(new URL('../../deploy/friday/r20/plebeian-friday-coordinator.service', import.meta.url), 'utf8')
		const verifier = await readFile(new URL('../../deploy/friday/verify-friday-runtime-target.py', import.meta.url), 'utf8')
		expect(env).toContain(`FRIDAY_PARTICIPANT_BIN=${DEMO_FRIDAY_R20_PARTICIPANT_BINARY}`)
		expect(env).toContain(`FRIDAY_TERMINAL_EXECUTOR_BIN=${DEMO_FRIDAY_R20_TERMINAL_EXECUTOR_BINARY}`)
		expect(coordinator).toContain(`ExecStart=${DEMO_FRIDAY_R20_RELEASE_ROOT}/bin/plebeian-friday-coordinator`)
		expect(coordinator).toContain('--executor-binary ${FRIDAY_TERMINAL_EXECUTOR_BIN}')
		expect(verifier).toContain('R20_RELEASE_ROOT = CODE_ROOT / "releases/r20-deploy-v1"')
		expect(verifier).toContain('"FRIDAY_PARTICIPANT_BIN": str(R20_RELEASE_ROOT / "bin/coco-demo-frost-participant-3of4")')
		expect(verifier).toContain('"FRIDAY_TERMINAL_EXECUTOR_BIN": str(R20_RELEASE_ROOT / "bin/plebeian-friday-terminal-executor")')
	})

	test('retains the fixed courier identity and immutable-file checks without creating roots', async () => {
		const courier = await readFile(new URL('./demo-friday-r20-courier-cli.ts', import.meta.url), 'utf8')
		expect(courier).toContain('uid !== 1000 || gid !== 1000')
		expect(courier).toContain('before.nlink !== 1')
		expect(courier).toContain('(before.mode & 0o777) !== 0o600')
		expect(courier).toContain('open(path, constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC)')
		expect(courier).toContain('opened.dev !== before.dev || opened.ino !== before.ino')
		expect(courier).toContain('after.dev !== opened.dev || after.ino !== opened.ino')
		expect(courier).not.toMatch(/\bmkdir(?:Sync)?\s*\(/)
	})
})
