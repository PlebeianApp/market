/**
 * Regression guard for local install inputs in the AuctionsDev deployment
 * package. The build job installs from the complete checkout, but activation
 * runs `bun install --production` from the partial package assembled by the
 * workflow. Every `file:` dependency and Bun patch must therefore be copied
 * into that package.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const WORKFLOW_PATH = '.github/workflows/deploy-auctionsdev.yml'
const PACKAGE_PATH = 'package.json'

const workflow = readFileSync(join(REPO_ROOT, WORKFLOW_PATH), 'utf8')
const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, PACKAGE_PATH), 'utf8')) as {
	dependencies?: Record<string, string>
	patchedDependencies?: Record<string, string>
}

function createDeploymentPackageStep(): string {
	const start = workflow.indexOf('      - name: Create deployment package\n')
	if (start < 0) throw new Error(`Create deployment package step not found in ${WORKFLOW_PATH}`)
	const rest = workflow.slice(start)
	const next = rest.indexOf('\n      - name:', 1)
	return next < 0 ? rest : rest.slice(0, next)
}

function localInstallInputs(): string[] {
	const fileDependencies = Object.values(packageJson.dependencies ?? {})
		.filter((specifier) => specifier.startsWith('file:'))
		.map((specifier) => specifier.slice('file:'.length))
	return [...fileDependencies, ...Object.values(packageJson.patchedDependencies ?? {})]
}

function copiedDirectories(step: string): Set<string> {
	return new Set([...step.matchAll(/^\s*cp -r ([^\s]+) deploy-package\/$/gm)].map((match) => match[1]))
}

describe('AuctionsDev deployment package local install inputs', () => {
	test('the repository contains every local dependency and patch', () => {
		for (const input of localInstallInputs()) {
			expect(existsSync(join(REPO_ROOT, input))).toBe(true)
		}
	})

	test('the partial deployment package copies every local-input directory', () => {
		const copied = copiedDirectories(createDeploymentPackageStep())
		const requiredRoots = new Set(localInstallInputs().map((input) => input.split('/')[0]))

		expect([...requiredRoots].sort()).toEqual(['patches', 'vendor'])
		for (const root of requiredRoots) expect(copied.has(root)).toBe(true)
	})
})
