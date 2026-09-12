/**
 * Tests for the E2E workflow artifact-upload path consistency
 * (`.github/workflows/e2e.yml`).
 *
 * Playwright's default `outputDir` resolves to `<packageJsonDir>/test-results`
 * (the repo root) when the config sets no `outputDir` — see
 * `node_modules/playwright/lib/common/index.js`:
 *   outputDir: takeFirst(..., path.join(packageJsonDir, "test-results"))
 * `packageJsonDir` is the nearest `package.json` walking up from the config
 * dir (`e2e/`), i.e. the repo root. So both the `e2e-grep` and `e2e-full`
 * jobs must upload `test-results/` (repo root), never `e2e/test-results/`.
 *
 * This guard reads the workflow YAML and asserts the two `test-results`
 * upload steps agree on the path, so a future edit cannot silently break
 * failure-artifact capture for the per-PR gate. It also asserts the
 * config still sets no `outputDir` (the root-cause precondition), so a
 * later `outputDir` override that would move artifacts away from the repo
 * root is caught.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const WORKFLOW_PATH = join(import.meta.dir, '..', '..', '..', '.github', 'workflows', 'e2e.yml')
const PLAYWRIGHT_CONFIG_PATH = join(import.meta.dir, '..', '..', '..', 'e2e', 'playwright.config.ts')

/** Extract the `path:` value of every `actions/upload-artifact@v4` step. */
async function uploadPaths(): Promise<{ name: string; path: string }[]> {
	const yaml = await readFile(WORKFLOW_PATH, 'utf8')
	const lines = yaml.split('\n')
	const uploads: { name: string; path: string }[] = []
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes('actions/upload-artifact@v4')) {
			// The step's upload `name:` and `path:` live under `with:`.
			let stepName = ''
			let path = ''
			for (let j = i + 1; j < lines.length; j++) {
				const line = lines[j]
				if (/^\s{2,}\S/.test(line) === false && line.trim() !== '') break // left the step block
				const nameMatch = line.match(/^\s+name:\s*(.+)$/)
				if (nameMatch) stepName = nameMatch[1].trim()
				const pathMatch = line.match(/^\s+path:\s*(.+)$/)
				if (pathMatch) {
					path = pathMatch[1].trim()
					break
				}
			}
			uploads.push({ name: stepName, path })
		}
	}
	return uploads
}

describe('e2e.yml artifact upload paths', () => {
	test('e2e-grep uploads the repo-root test-results/ dir (Playwright default outputDir)', async () => {
		const uploads = await uploadPaths()
		const grepUpload = uploads.find((u) => u.name === 'test-results')
		expect(grepUpload).toBeDefined()
		expect(grepUpload!.path).toBe('test-results/')
	})

	test('e2e-grep and e2e-full test-results uploads use the same repo-root path (no drift)', async () => {
		const uploads = await uploadPaths()
		// Scope to the test-results artifacts only (the e2e-grep job names its
		// artifact 'test-results' and e2e-full names its 'test-results-full').
		// Unrelated future uploads (e.g. playwright-report) must not fail this guard.
		const testResults = uploads.filter((u) => u.name.startsWith('test-results'))
		expect(testResults.length).toBeGreaterThanOrEqual(2)
		const paths = testResults.map((u) => u.path)
		expect(new Set(paths).size).toBe(1)
		expect(paths[0]).toBe('test-results/')
	})

	test('e2e/playwright.config.ts still sets no outputDir (root cause of the repo-root default)', async () => {
		const config = await readFile(PLAYWRIGHT_CONFIG_PATH, 'utf8')
		expect(config).not.toMatch(/outputDir\s*:/)
	})
})
