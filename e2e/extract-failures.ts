import fs from 'node:fs'
import path from 'node:path'

const RESULTS_DIR = path.resolve(import.meta.dirname, '..', 'test-results')
const RESULTS_FILE = path.join(RESULTS_DIR, 'results.json')
const FAILURES_FILE = path.resolve(import.meta.dirname, '..', 'failed-tests.txt')

interface TestResult {
	status: string
	duration: number
	error?: string
	attachments?: Array<{ contentType: string; path?: string }>
}

interface TestEntry {
	projectName: string
	results: TestResult[]
}

interface Spec {
	title: string
	file: string
	line?: number
	column?: number
	tests: TestEntry[]
}

interface Suite {
	title: string
	specs: Spec[]
	suites: Suite[]
}

interface Results {
	suites: Suite[]
}

function collectFailedTests(suite: Suite, ancestors: string[] = []): string[] {
	const lines: string[] = []
	const suitePath = [...ancestors, suite.title].filter(Boolean)

	for (const spec of suite.specs) {
		const hasFailure = spec.tests.some((t) => t.results.some((r) => ['failed', 'timedOut', 'interrupted'].includes(r.status)))
		if (hasFailure) {
			const parts = [spec.file, ...suitePath, spec.title].filter(Boolean)
			lines.push(parts.join(' › '))
		}
	}

	for (const child of suite.suites) {
		lines.push(...collectFailedTests(child, suitePath))
	}

	return lines
}

function collectStats(suite: Suite): { passed: number; failed: number; duration: number } {
	let passed = 0
	let failed = 0
	let duration = 0

	for (const spec of suite.specs) {
		for (const test of spec.tests) {
			for (const result of test.results) {
				if (result.status === 'passed') passed++
				else if (['failed', 'timedOut', 'interrupted'].includes(result.status)) failed++
				duration += result.duration || 0
			}
		}
	}

	for (const child of suite.suites) {
		const childStats = collectStats(child)
		passed += childStats.passed
		failed += childStats.failed
		duration += childStats.duration
	}

	return { passed, failed, duration }
}

if (!fs.existsSync(RESULTS_FILE)) {
	console.error(`No results.json found at ${RESULTS_FILE}`)
	process.exit(1)
}

const data: Results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'))

let allPassed = 0
let allFailed = 0
let allDuration = 0
const allFailureLines: string[] = []

for (const suite of data.suites) {
	const stats = collectStats(suite)
	allPassed += stats.passed
	allFailed += stats.failed
	allDuration += stats.duration
	allFailureLines.push(...collectFailedTests(suite))
}

const hasFailures = allFailed > 0

if (hasFailures) {
	fs.writeFileSync(FAILURES_FILE, allFailureLines.join('\n') + '\n')
	console.log(`Found ${allFailureLines.length} failed test(s):`)
	for (const line of allFailureLines) {
		console.log(`  ${line}`)
	}
} else {
	console.log('All tests passed!')
}

const ghOutput = process.env.GITHUB_OUTPUT
if (ghOutput) {
	const lines = [
		`has_failures=${hasFailures}`,
		`count=${allFailed}`,
		`passed=${allPassed}`,
		`failed=${allFailed}`,
		`duration=${allDuration}`,
	]
	fs.appendFileSync(ghOutput, lines.join('\n') + '\n')
}
