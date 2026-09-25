import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import {
	createFreshEnvelopeCommitment,
	parseFreshWalletPreflightOutput,
	validateBoundFreshWalletPreflightEvidence,
} from './check-auctionsdev-fresh-wallet-result'
import { hashPackageDirectory } from './verify-auctionsdev-package'

const PRODUCER_COMMAND = 'bun run test:e2e:coco-auctionsdev-smoke'
const CANONICAL_VERIFIER_COMMAND = 'bun run preflight:auctionsdev:fresh-wallet <public-report.json>'

const readArg = (name: string): string | undefined => {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

const requiredArg = (name: string): string => {
	const value = readArg(name)
	if (!value) throw new Error(`Missing required argument: ${name}`)
	return value
}

const assertSha = (label: string, value: string, length: 40 | 64): void => {
	if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) throw new Error(`${label} must be ${length} lowercase hexadecimal characters`)
}

const runText = (command: string[]): string => {
	const result = Bun.spawnSync(command, { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
	if (result.exitCode !== 0) throw new Error(`${command.join(' ')} failed`)
	return result.stdout.toString().trim()
}

const runPrivate = async (command: string[], env: Record<string, string>): Promise<string> => {
	const child = Bun.spawn(command, {
		cwd: process.cwd(),
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env, ...env },
	})
	const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
	if (exitCode !== 0) throw new Error(`Required fresh-wallet command failed: ${command.slice(0, 3).join(' ')}`)
	return stdout
}

const main = async (): Promise<void> => {
	const marketGitSha = requiredArg('--market-sha')
	const coreGitSha = requiredArg('--core-git-sha')
	const expectedCoreSha256 = requiredArg('--core-sha256')
	const expectedIndexedDbSha256 = requiredArg('--indexeddb-sha256')
	const accountPubkey = requiredArg('--account-pubkey')
	const rawReportPath = path.resolve(requiredArg('--raw-report'))
	const outputPath = path.resolve(requiredArg('--output'))
	assertSha('Market SHA', marketGitSha, 40)
	assertSha('Core Git SHA', coreGitSha, 40)
	assertSha('Core SHA-256', expectedCoreSha256, 64)
	assertSha('IndexedDB SHA-256', expectedIndexedDbSha256, 64)
	assertSha('Fresh-wallet account public key', accountPubkey, 64)

	const checkoutGitSha = runText(['git', 'rev-parse', 'HEAD'])
	if (checkoutGitSha !== marketGitSha) throw new Error('Fresh-wallet checkout does not match the requested Market SHA')
	if (runText(['git', 'status', '--porcelain', '--untracked-files=no']) !== '') {
		throw new Error('Fresh-wallet checkout has tracked source changes')
	}

	const [coreDirectory, indexedDbDirectory] = await Promise.all([
		realpath(path.join(process.cwd(), 'node_modules/@cashu/coco-core')),
		realpath(path.join(process.cwd(), 'node_modules/@cashu/coco-indexeddb')),
	])
	const [coreSha256, indexedDbSha256] = await Promise.all([hashPackageDirectory(coreDirectory), hashPackageDirectory(indexedDbDirectory)])
	if (coreSha256 !== expectedCoreSha256) throw new Error(`Fresh-wallet Core installed-content SHA-256 mismatch: got ${coreSha256}`)
	if (indexedDbSha256 !== expectedIndexedDbSha256) {
		throw new Error(`Fresh-wallet IndexedDB installed-content SHA-256 mismatch: got ${indexedDbSha256}`)
	}

	const verifierEnv = {
		AUCTIONSDEV_MARKET_COMMIT_SHA: marketGitSha,
		AUCTIONSDEV_COCO_ENVIRONMENT_ID: 'test',
		AUCTIONSDEV_ACCOUNT_PUBKEY: accountPubkey,
	}
	if (!(await Bun.file(rawReportPath).exists())) {
		throw new Error('Canonical browser smoke did not provide its fresh-wallet public report')
	}

	const verifierOutput = await runPrivate(['bun', 'run', 'preflight:auctionsdev:fresh-wallet', rawReportPath], verifierEnv)
	const result = parseFreshWalletPreflightOutput(verifierOutput, marketGitSha)
	const rawPublicReportSha256 = createHash('sha256')
		.update(new Uint8Array(await Bun.file(rawReportPath).arrayBuffer()))
		.digest('hex')
	const payload = {
		schemaVersion: 1 as const,
		profile: 'FRESH_AUCTIONSDEV_TEST_BOUND_V1' as const,
		marketGitSha,
		coreGitSha,
		coreSha256,
		indexedDbSha256,
		checkout: {
			gitSha: checkoutGitSha,
			cleanBeforeStart: true as const,
			producerCommand: PRODUCER_COMMAND as 'bun run test:e2e:coco-auctionsdev-smoke',
			canonicalVerifierCommand: CANONICAL_VERIFIER_COMMAND as 'bun run preflight:auctionsdev:fresh-wallet <public-report.json>',
		},
		rawPublicReportSha256,
		result,
	}
	const evidence = { ...payload, envelopeCommitment: createFreshEnvelopeCommitment(payload) }
	validateBoundFreshWalletPreflightEvidence(evidence, { marketGitSha, coreGitSha, coreSha256, indexedDbSha256 })
	await Bun.write(outputPath, `${JSON.stringify(evidence)}\n`)
}

if (import.meta.main) {
	void main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
