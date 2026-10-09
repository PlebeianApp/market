#!/usr/bin/env bun
/**
 * Generate the validator's payout seed — once, by hand.
 *
 * Why a script and not "generate it at startup": an automatic generator has exactly one bad
 * failure mode and it is silent. If the generated value does not survive (a redeploy that
 * replaces the file, a wiped volume), the validator comes back with a *different* key while its
 * published xpub still points at the old one — and every leg locked to that xpub becomes
 * unredeemable. A deliberate, one-shot, refuse-to-overwrite step removes that failure mode
 * entirely; the runtime refuses to start without the seed, and refuses to accept a seed that
 * contradicts what it has already announced.
 *
 * Usage:
 *   bun run scripts/generate-validator-payout-seed.ts                 # write to .env (self-host)
 *   bun run scripts/generate-validator-payout-seed.ts --print         # print, for a CI secret
 *   bun run scripts/generate-validator-payout-seed.ts --env-file X    # write to another .env
 *
 * Refuses to run when a seed already exists in the environment or in the target file.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { HDKey } from '@scure/bip32'
import { PAYOUT_SEED_ENV, payoutKeyFingerprint } from '../src/server/auction-validator/payoutKey'

const args = process.argv.slice(2)
const printOnly = args.includes('--print')
const envFileFlag = args.indexOf('--env-file')
const envFile = envFileFlag >= 0 ? (args[envFileFlag + 1] ?? '.env') : '.env'

const fail = (message: string): never => {
	console.error(`\n  ✗ ${message}\n`)
	process.exit(1)
}

const existingInEnv = (process.env[PAYOUT_SEED_ENV] ?? '').trim()
if (existingInEnv.length > 0) {
	fail(
		`${PAYOUT_SEED_ENV} is already set in this environment. Refusing to overwrite: rotating a payout key ` +
			'while funds remain locked to the old xpub strands them.',
	)
}

let existingInFile = ''
if (existsSync(envFile)) {
	const contents = readFileSync(envFile, 'utf8')
	const match = contents.match(new RegExp(`^${PAYOUT_SEED_ENV}=(.*)$`, 'm'))
	existingInFile = (match?.[1] ?? '').trim()
}
if (existingInFile.length > 0) {
	// Describe the existing value if it parses; refuse either way. A malformed value must not
	// turn "refuse to overwrite" into a stack trace.
	let described = 'value present, not parseable as a seed'
	try {
		const existingXpub = HDKey.fromMasterSeed(Buffer.from(existingInFile, 'hex')).publicExtendedKey
		if (existingXpub) described = `fingerprint ${payoutKeyFingerprint(existingXpub)}`
	} catch {
		/* keep the fallback description */
	}
	fail(
		`${envFile} already contains ${PAYOUT_SEED_ENV} (${described}). Refusing to overwrite: rotating a payout key ` +
			'while funds remain locked to the old xpub strands them.',
	)
}

// 32 bytes from the OS CSPRNG. No passphrase, no machine-derived default, no shared constant.
const seed = randomBytes(32)
const hex = seed.toString('hex')
const master = HDKey.fromMasterSeed(seed)
const xpub = master.publicExtendedKey
if (!xpub) fail('Failed to derive an xpub from the generated seed.')
const fingerprint = payoutKeyFingerprint(xpub)

if (!printOnly) {
	const line = `${PAYOUT_SEED_ENV}=${hex}`
	const contents = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
	const next = contents.length === 0 || contents.endsWith('\n') ? `${contents}${line}\n` : `${contents}\n${line}\n`
	writeFileSync(envFile, next, { mode: 0o600 })
	chmodSync(envFile, 0o600)
}

console.log(`
  Payout seed ${printOnly ? 'generated' : `written to ${envFile} (mode 0600)`}.

    xpub         ${xpub}
    fingerprint  ${fingerprint}

  Keep this seed. It is the only way to redeem fees paid to this validator. Losing it strands
  every leg locked to the xpub above; the fingerprint is what you compare against the key shown
  on the validator's profile to confirm it is the one receiving funds.
`)

if (printOnly) {
	console.log(`  CI-deployed instance (add as a secret, then discard this output):

    ${PAYOUT_SEED_ENV}=${hex}

  CI rewrites .env on every deploy, so a value written on the host does not survive — the
  secret is the source of truth. Add it under Settings → Secrets → Actions, then delete this
  output from your shell history.
`)
} else {
	console.log(`  Self-hosted instance: nothing more to do — this ${envFile} is the source of truth.
  For a CI-deployed instance instead, re-run with --print and add the value as a secret.
  Back the file up; rotation is additive (publish a new xpub, keep the old seed until nothing
  remains locked under it).
`)
}
