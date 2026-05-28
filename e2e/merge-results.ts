import fs from 'node:fs'
import path from 'node:path'

const RESULTS_DIR = path.resolve(import.meta.dirname, '..', 'test-results')
const FIRST_PASS = '/tmp/first-pass-results.json'
const RERUN = path.join(RESULTS_DIR, 'rerun-results.json')
const OUTPUT = path.join(RESULTS_DIR, 'results.json')

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

function specKey(spec: Spec): string {
	return `${spec.file}::${spec.title}`
}

function buildRerunMap(suite: Suite, map: Map<string, Spec>): void {
	for (const spec of suite.specs) {
		map.set(specKey(spec), spec)
	}
	for (const child of suite.suites) {
		buildRerunMap(child, map)
	}
}

function mergeSuite(suite: Suite, rerunMap: Map<string, Spec>): Suite {
	const mergedSpecs = suite.specs.map((spec) => {
		const rerunSpec = rerunMap.get(specKey(spec))
		if (rerunSpec) {
			return rerunSpec
		}
		return spec
	})

	const mergedSuites = suite.suites.map((child) => mergeSuite(child, rerunMap))

	return { ...suite, specs: mergedSpecs, suites: mergedSuites }
}

if (!fs.existsSync(FIRST_PASS)) {
	console.error(`No first-pass results at ${FIRST_PASS}`)
	process.exit(1)
}

if (!fs.existsSync(RERUN)) {
	console.log('No re-run results found, keeping first-pass results as-is.')
	process.exit(0)
}

const firstPass: Results = JSON.parse(fs.readFileSync(FIRST_PASS, 'utf-8'))
const rerun: Results = JSON.parse(fs.readFileSync(RERUN, 'utf-8'))

const rerunMap = new Map<string, Spec>()
for (const suite of rerun.suites) {
	buildRerunMap(suite, rerunMap)
}

console.log(`Re-run contained ${rerunMap.size} test(s)`)

const merged: Results = {
	suites: firstPass.suites.map((suite) => mergeSuite(suite, rerunMap)),
}

fs.writeFileSync(OUTPUT, JSON.stringify(merged, null, 2))
console.log(`Merged results written to ${OUTPUT}`)
