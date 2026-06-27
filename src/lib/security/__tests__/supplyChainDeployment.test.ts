import { expect, test, describe } from 'bun:test'
import { join, resolve } from 'node:path'

/**
 * Supply-chain & deployment hardening guards (H5 / H6 / H7 from PR #1074).
 *
 * These are not behavioral tests — they guard the static config that the
 * security fixes rely on, so a future commit that reverts a pinned SHA, re-adds
 * `-y @latest`, or switches deploy back to password auth fails CI immediately.
 *
 * Scope note: the PR pins FIVE workflows (ci-unit, e2e, prettier, deploy,
 * promote-production). Other workflow files (deploy-auctionsdev, deploy-relay,
 * release) are out of scope and intentionally not asserted here.
 */

const REPO_ROOT = resolve(import.meta.dir, '../../../..')
const WORKFLOWS = join(REPO_ROOT, '.github/workflows')
const PINNED_WORKFLOWS = ['ci-unit.yml', 'e2e.yml', 'prettier.yml', 'deploy.yml', 'promote-production.yml']

async function read(p: string): Promise<string> {
	return await Bun.file(p).text()
}

// A SHA-pinned action use looks like:  uses: owner/repo@<40-hex> # vN
const PINNED_USE_RE = /uses:\s+([a-z0-9-]+\/[a-z0-9-]+)@([0-9a-f]{40})\b/i
// A tag/major-version ref looks like:  uses: owner/repo@v4  /  @v1.0.3
const UNPINNED_USE_RE = /uses:\s+[a-z0-9-]+\/[a-z0-9-]+@(?!0x)[a-z0-9._-]*v?[0-9]/i

describe('H5 — GitHub Actions pinned to commit SHAs', () => {
	for (const wf of PINNED_WORKFLOWS) {
		test(`${wf}: every third-party action is SHA-pinned (no floating @vN tags)`, async () => {
			const content = await read(join(WORKFLOWS, wf))
			const usesLines = content
				.split('\n')
				.map((l) => l.trim())
				.filter((l) => l.startsWith('uses:'))

			expect(usesLines.length, `${wf} should reference at least one action`).toBeGreaterThan(0)

			const unpinned = usesLines.filter((line) => !PINNED_USE_RE.test(line))
			expect(unpinned, `${wf} has floating (non-SHA-pinned) action refs:\n${unpinned.join('\n')}`).toEqual([])
		})
	}
})

describe('H6 — MCP package pinned to an explicit version (no @latest)', () => {
	test('.mcp.json pins @nostrBook/mcp to a concrete version', async () => {
		const raw = await read(join(REPO_ROOT, '.mcp.json'))
		const mcp = JSON.parse(raw)

		const nostrBook = mcp.mcpServers?.nostrbook
		expect(nostrBook, 'nostrbook MCP server entry should exist').toBeTruthy()

		const args: unknown[] = nostrBook.args
		expect(Array.isArray(args), 'nostrbook.args should be an array').toBe(true)

		const versionArg = args.find((a) => typeof a === 'string' && a.includes('@nostrBook/mcp@'))
		expect(versionArg, 'an @nostrBook/mcp@<version> arg should be present').toBeTruthy()

		// Must be a concrete version, not the floating "@latest".
		expect(String(versionArg)).not.toMatch(/@latest$/)
		expect(String(versionArg)).toMatch(/@nostrBook\/mcp@\d+\.\d+\.\d+/)
	})
})

describe('H7 — deploy workflow uses SSH key auth (never password)', () => {
	test('deploy.yml never references password-based SSH secrets', async () => {
		const content = await read(join(WORKFLOWS, 'deploy.yml'))

		// The remediation removed sshpass / *_PASSWORD secret usage in favor of SSH keys.
		expect(content).not.toMatch(/password\s*:/i)
		expect(content).not.toMatch(/(STAGING|PROD)_PASSWORD/)
		expect(content).not.toMatch(/sshpass/)
	})

	test('deploy.yml references the SSH key secrets for every appleboy step', async () => {
		const content = await read(join(WORKFLOWS, 'deploy.yml'))
		const appleboySteps = content.split('uses:').filter((s) => /appleboy\/(ssh|scp)-action/.test(s))

		expect(appleboySteps.length, 'deploy.yml should use appleboy ssh/scp actions').toBeGreaterThan(0)

		// Every appleboy step block must carry an SSH `key:` input, and none may
		// fall back to `password:`.
		for (const block of appleboySteps) {
			expect(block).toMatch(/key:\s*\$\{\{\s*secrets\.(STAGING|PROD)_SSH_KEY\s*\}\}/)
			expect(block).not.toMatch(/password\s*:/i)
		}
	})
})
