import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Guards scripts/check-typecheck-baseline.sh, the ratchet that keeps the
// TypeScript diagnostic set from growing (see scripts/typecheck-baseline.txt).
// The script reads a ledger and a checker output; both are injected here so the
// cases run in milliseconds without invoking tsc.
const SCRIPT = join(import.meta.dir, '..', '..', '..', 'scripts', 'check-typecheck-baseline.sh')

const diagnostic = (file: string, code: string, message = 'boom'): string => `${file}(12,3): error ${code}: ${message}`

interface GuardRun {
	status: number | null
	out: string
}

const runGuard = (files: Record<string, string>): GuardRun => {
	const dir = mkdtempSync(join(tmpdir(), 'typecheck-baseline-guard-'))
	try {
		for (const [name, body] of Object.entries(files)) {
			writeFileSync(join(dir, name), body)
		}
		const result = spawnSync('bash', [SCRIPT], {
			encoding: 'utf8',
			env: {
				...process.env,
				TYPECHECK_BASELINE_FILE: join(dir, 'baseline.txt'),
				TYPECHECK_DIAGNOSTICS_FILE: join(dir, 'diagnostics.txt'),
			},
		})
		return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

const HEADER = '# ledger header\n#\n'

describe('check-typecheck-baseline.sh', () => {
	test('passes when the checker output matches the ledger exactly', () => {
		const run = runGuard({
			'baseline.txt': `${HEADER}src/a.ts|TS2322|2\nsrc/b.ts|TS7006|1\n`,
			'diagnostics.txt': `${diagnostic('src/a.ts', 'TS2322')}\n${diagnostic('src/a.ts', 'TS2322')}\n${diagnostic('src/b.ts', 'TS7006')}\n`,
		})

		expect(run.status).toBe(0)
		expect(run.out).toContain('TypeScript diagnostics: 3 occurrence(s) (baseline: 3)')
		expect(run.out).toContain('OK')
	})

	test('fails and names a diagnostic the ledger does not carry', () => {
		const run = runGuard({
			'baseline.txt': `${HEADER}src/a.ts|TS2322|1\n`,
			'diagnostics.txt': `${diagnostic('src/a.ts', 'TS2322')}\n${diagnostic('src/extra.ts', 'TS7006')}\n`,
		})

		expect(run.status).toBe(1)
		expect(run.out).toContain('::error::TypeScript diagnostics increased')
		expect(run.out).toContain('src/extra.ts|TS7006|0|1')
	})

	test('fails when an existing key gains an occurrence', () => {
		const run = runGuard({
			'baseline.txt': `${HEADER}src/a.ts|TS2322|1\n`,
			'diagnostics.txt': `${diagnostic('src/a.ts', 'TS2322')}\n${diagnostic('src/a.ts', 'TS2322')}\n`,
		})

		expect(run.status).toBe(1)
		expect(run.out).toContain('src/a.ts|TS2322|1|2')
	})

	// The original script compared with `NR == FNR`: with an empty first file
	// every record of the second file looked like a record of the first, so the
	// comparison block never ran and the gate passed with unlimited new errors.
	test('fails closed when the ledger carries no data lines', () => {
		const run = runGuard({
			'baseline.txt': `${HEADER}\n`,
			'diagnostics.txt': `${diagnostic('src/anything.ts', 'TS7006', 'new error')}\n`,
		})

		expect(run.status).toBe(1)
		expect(run.out).toContain('has no data lines')
		expect(run.out).not.toContain('OK')
	})

	test('fails closed when the ledger is missing', () => {
		const run = runGuard({
			'diagnostics.txt': `${diagnostic('src/anything.ts', 'TS7006')}\n`,
		})

		expect(run.status).toBe(1)
		expect(run.out).toContain('no TypeScript diagnostic baseline')
		expect(run.out).not.toContain('OK')
	})

	test('ignores diagnostics whose file path is inside node_modules', () => {
		const run = runGuard({
			'baseline.txt': `${HEADER}src/a.ts|TS2322|1\n`,
			'diagnostics.txt': `${diagnostic('src/a.ts', 'TS2322')}\n${diagnostic('node_modules/some-dep/dist/index.d.ts', 'TS2322', 'upstream noise')}\n${diagnostic('node_modules/dep/file.ts(1,1): odd', 'TS9999')}\n`,
		})

		expect(run.status).toBe(0)
		expect(run.out).toContain('TypeScript diagnostics: 1 occurrence(s) (baseline: 1)')
	})

	test('reports the decrease notice without failing', () => {
		const run = runGuard({
			'baseline.txt': `${HEADER}src/a.ts|TS2322|2\n`,
			'diagnostics.txt': `${diagnostic('src/a.ts', 'TS2322')}\n`,
		})

		expect(run.status).toBe(0)
		expect(run.out).toContain('::notice::TypeScript diagnostics decreased')
	})
})
