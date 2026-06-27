import { expect, test, describe } from 'bun:test'
import { join, resolve } from 'node:path'

/**
 * Deploy-script hardening guards (H3 / H4 from PR #1074).
 *
 * Static guards over deploy-simple/deploy.sh and deploy-simple/control.sh so
 * that a future commit re-introducing SSH password auth (sshpass /
 * SSH_PASSWORD) or weakening host-key verification (StrictHostKeyChecking=no,
 * UserKnownHostsFile=/dev/null) fails CI immediately.
 *
 * Comment-stripping rationale: both scripts contain explanatory *comments*
 * mentioning the forbidden tokens (e.g. "SSH_PASSWORD support removed" /
 * "sshpass support removed"). Those are documentation, not executable code, so
 * we strip full-line shell comments before asserting. The guard then fires
 * only when a forbidden token reappears in actual code — a genuine regression.
 */

const REPO_ROOT = resolve(import.meta.dir, '../../../..')
const DEPLOY_DIR = join(REPO_ROOT, 'deploy-simple')
const SCRIPTS = ['deploy.sh', 'control.sh'] as const

async function read(p: string): Promise<string> {
	return await Bun.file(p).text()
}

// Drop full-line shell comments (lines whose first non-whitespace char is '#').
// Inline comments after code are intentionally left in.
function stripComments(src: string): string {
	return src
		.split('\n')
		.filter((line) => !/^\s*#/.test(line))
		.join('\n')
}

describe('H3 — deploy scripts use key-based SSH auth (no password auth)', () => {
	for (const script of SCRIPTS) {
		test(`${script}: contains no sshpass and no SSH_PASSWORD in executable code`, async () => {
			const code = stripComments(await read(join(DEPLOY_DIR, script)))
			// Password-based SSH was removed in favor of SSH keys / ssh-agent.
			expect(code).not.toMatch(/sshpass/)
			expect(code).not.toMatch(/SSH_PASSWORD/)
		})
	}
})

describe('H4 — deploy scripts enforce StrictHostKeyChecking=accept-new', () => {
	for (const script of SCRIPTS) {
		test(`${script}: uses accept-new and never disables host-key verification`, async () => {
			const code = stripComments(await read(join(DEPLOY_DIR, script)))
			// accept-new trusts the first-seen host key and FAILS on a later key
			// change (MITM detection), recording keys to a real known_hosts file.
			expect(code).toMatch(/StrictHostKeyChecking=accept-new/)
			// Must NOT neutralize host-key checking or discard the known_hosts DB.
			expect(code).not.toMatch(/StrictHostKeyChecking=no/)
			expect(code).not.toMatch(/UserKnownHostsFile=\/dev\/null/)
		})
	}
})
