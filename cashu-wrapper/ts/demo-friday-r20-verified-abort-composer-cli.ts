#!/usr/bin/env bun
/** Fixed-path, public-only R18 verified-abort-bundle composer. */
import {
	composeDemoFridayVerifiedAbortBundleFromProfile,
	DEMO_FRIDAY_VERIFIED_ABORT_PRODUCTION_PROFILE,
} from './demo-friday-r20-verified-abort-composer'

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_VERIFIED_ABORT_COMPOSER_CLI: ${message}`) }
async function main(): Promise<void> {
	const args = process.argv.slice(2)
	if (args.length !== 5 || args[0] !== 'compose' || args[1] !== '--expected-manifest-digest'
		|| args[3] !== '--expected-abort-digest') {
		fail('usage: compose --expected-manifest-digest <sha256> --expected-abort-digest <sha256>')
	}
	const bundle = await composeDemoFridayVerifiedAbortBundleFromProfile({
		profile: DEMO_FRIDAY_VERIFIED_ABORT_PRODUCTION_PROFILE,
		expectedManifestDigest: args[2]!, expectedAbortDigest: args[4]!,
	})
	process.stdout.write(`${JSON.stringify({
		schema: bundle.schema, status: 'VERIFIED_ABORT_BUNDLE_CREATED',
		participantCount: bundle.acknowledgements.length,
	})}\n`)
}

if (import.meta.main) main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : 'DEMO_FRIDAY_VERIFIED_ABORT_COMPOSER_CLI: unknown failure'}\n`)
	process.exitCode = 1
})
