/**
 * scripts/mutation-comment.ts — Render the mutation-score PR comment.
 *
 * Reads the Stryker JSON report + the generated runtime config (for the mutated
 * file list) and prints a markdown comment body (starting with the marker tag
 * `<!-- pr-mutation-report -->`) to stdout. The CI workflow captures this and
 * posts it as an idempotent PR comment (update-or-create via the marker).
 *
 * Pure rendering: reuses the tested `parseMutationReport` +
 * `formatMutationComment` from stryker-changed-files.ts — no inline logic here.
 *
 * Env:
 *   MUTATION_REPORT       path to mutation.json   (default: reports/mutation/mutation.json)
 *   MUTATION_RUN_CONFIG   path to stryker.run.json (default: stryker.run.json)
 *   MUTATION_SHA          commit sha for the comment
 *   MUTATION_RUN_URL      actions run URL for the "Full report" link
 *
 * Usage:
 *   bun run scripts/mutation-comment.ts            # prints comment body to stdout
 */
import { parseMutationReport, formatMutationComment } from './stryker-changed-files'
import type { MutationReportJson, MutationScore } from './stryker-changed-files'

const reportPath = process.env.MUTATION_REPORT ?? 'reports/mutation/mutation.json'
const runConfigPath = process.env.MUTATION_RUN_CONFIG ?? 'stryker.run.json'
const sha = process.env.MUTATION_SHA ?? process.env.GITHUB_SHA ?? 'unknown'
const runUrl = process.env.MUTATION_RUN_URL ?? ''

// Mutated file list comes from the runtime config my script generated.
let files: string[] = []
try {
	const cfg = JSON.parse(await Bun.file(runConfigPath).text())
	files = Array.isArray(cfg.mutate) ? cfg.mutate.map(String) : []
} catch {
	// no runtime config (e.g. nothing was mutated) -> empty list
}

let score: MutationScore
try {
	const report = JSON.parse(await Bun.file(reportPath).text()) as MutationReportJson
	score = parseMutationReport(report)
} catch {
	// No report (e.g. no mutable files changed, or Stryker didn't write one) ->
	// emit a null-score comment so the reviewer sees a clean "no mutants" note.
	score = {
		score: null,
		killed: 0,
		survived: 0,
		noCoverage: 0,
		timeout: 0,
		runtimeErrors: 0,
		total: 0,
		thresholds: { high: 80, low: 60, break: 50 },
	}
}

console.log(formatMutationComment(score, { sha, runUrl, files }))
