import { realpath } from 'node:fs/promises'
import { connect } from 'node:net'
import path from 'node:path'
import {
	createSmokeEnvelopeCommitment,
	parseAuctionsdevSmokeOutput,
	resolveCheckoutContainedReportPath,
	validateBoundAuctionsdevSmokeEvidence,
} from './check-auctionsdev-smoke-result'
import { hashPackageDirectory } from './verify-auctionsdev-package'

const CANONICAL_COMMAND = 'bun run test:e2e:coco-auctionsdev-smoke'
const APP_ORIGIN = 'http://localhost:34567'

const readArg = (name: string): string | undefined => {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

const requiredArg = (name: string): string => {
	const value = readArg(name)
	if (!value) throw new Error(`Missing required argument: ${name}`)
	return value
}

const runText = (command: string[]): string => {
	const result = Bun.spawnSync(command, { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
	if (result.exitCode !== 0) throw new Error(`${command.join(' ')} failed: ${result.stderr.toString()}`)
	return result.stdout.toString().trim()
}

const isPortOpen = async (host: string, port: number): Promise<boolean> =>
	await new Promise<boolean>((resolve) => {
		const socket = connect({ host, port })
		let settled = false
		const finish = (open: boolean): void => {
			if (settled) return
			settled = true
			socket.destroy()
			resolve(open)
		}
		socket.once('connect', () => finish(true))
		socket.once('error', () => finish(false))
		setTimeout(() => finish(false), 750)
	})

const assertSha = (label: string, value: string, length: 40 | 64): void => {
	if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) throw new Error(`${label} must be ${length} lowercase hexadecimal characters`)
}

const main = async (): Promise<void> => {
	const marketGitSha = requiredArg('--market-sha')
	const coreGitSha = requiredArg('--core-git-sha')
	const expectedCoreSha256 = requiredArg('--core-sha256')
	const expectedIndexedDbSha256 = requiredArg('--indexeddb-sha256')
	const outputPath = requiredArg('--output')
	const freshPublicReportOutput = path.resolve(requiredArg('--fresh-public-report-output'))
	assertSha('Market SHA', marketGitSha, 40)
	assertSha('Core Git SHA', coreGitSha, 40)
	assertSha('Core SHA-256', expectedCoreSha256, 64)
	assertSha('IndexedDB SHA-256', expectedIndexedDbSha256, 64)

	const checkoutGitSha = runText(['git', 'rev-parse', 'HEAD'])
	if (checkoutGitSha !== marketGitSha) throw new Error('Smoke checkout does not match the requested Market SHA')
	if (runText(['git', 'status', '--porcelain', '--untracked-files=no']) !== '') {
		throw new Error('Smoke checkout has tracked source changes')
	}
	if (await isPortOpen('127.0.0.1', 34567)) {
		throw new Error('Smoke app port 34567 is already occupied; refusing to reuse an existing server')
	}

	const [coreDirectory, indexedDbDirectory] = await Promise.all([
		realpath(path.join(process.cwd(), 'node_modules/@cashu/coco-core')),
		realpath(path.join(process.cwd(), 'node_modules/@cashu/coco-indexeddb')),
	])
	const [coreSha256, indexedDbSha256] = await Promise.all([hashPackageDirectory(coreDirectory), hashPackageDirectory(indexedDbDirectory)])
	if (coreSha256 !== expectedCoreSha256) throw new Error(`Smoke Core installed-content SHA-256 mismatch: got ${coreSha256}`)
	if (indexedDbSha256 !== expectedIndexedDbSha256) {
		throw new Error(`Smoke IndexedDB installed-content SHA-256 mismatch: got ${indexedDbSha256}`)
	}

	const child = Bun.spawn(['bun', 'run', 'test:e2e:coco-auctionsdev-smoke'], {
		cwd: process.cwd(),
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			...process.env,
			CI: '',
			BUN_PUBLIC_COCO_ENVIRONMENT_ID: 'test',
			BUN_PUBLIC_COCO_MONETARY_MODE: 'fake',
			BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST: 'http://localhost:3338',
			APP_RELAY_URL: 'ws://localhost:10547',
		},
	})
	const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
	process.stdout.write(stdout)
	process.stderr.write(stderr)
	if (exitCode !== 0) throw new Error(`Canonical smoke command failed with exit code ${exitCode}`)
	const smoke = parseAuctionsdevSmokeOutput(stdout)
	const producedReportPath = await resolveCheckoutContainedReportPath(process.cwd(), smoke.preflightReportPath)
	await Bun.write(freshPublicReportOutput, await Bun.file(producedReportPath).arrayBuffer())

	const payload = {
		schemaVersion: 1 as const,
		profile: 'COCO_AUCTIONSDEV_SMOKE_BOUND_V1' as const,
		marketGitSha,
		coreGitSha,
		coreSha256,
		indexedDbSha256,
		checkout: {
			gitSha: checkoutGitSha,
			cleanBeforeStart: true as const,
			appServerColdStarted: true as const,
			origin: APP_ORIGIN as 'http://localhost:34567',
			canonicalCommand: CANONICAL_COMMAND as 'bun run test:e2e:coco-auctionsdev-smoke',
		},
		smoke,
	}
	const evidence = { ...payload, envelopeCommitment: createSmokeEnvelopeCommitment(payload) }
	validateBoundAuctionsdevSmokeEvidence(evidence, { marketGitSha, coreGitSha, coreSha256, indexedDbSha256 })
	await Bun.write(outputPath, `${JSON.stringify(evidence)}\n`)
}

if (import.meta.main) {
	void main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
