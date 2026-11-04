import { describe, expect, test } from 'bun:test'

import { demoFipsAdmissionAggregateDiagnostic } from './demo-fips-admission-coordinator'

describe('sanitized FIPS admission aggregate diagnostics', () => {
	test.each([
		['public key package hash mismatch', 'PUBLIC_PACKAGE_HASH'],
		['unable to deserialize PublicKeyPackage', 'PUBLIC_PACKAGE_DECODE'],
		['admission aggregate request authorization mismatch', 'AUTHORIZATION'],
		['invalid signature share from participant', 'SHARE_SET'],
		['signature verification failed', 'AGGREGATE_VERIFY'],
		['Permission denied (os error 13)', 'FILESYSTEM'],
		['unclassified child failure', 'OTHER'],
	] as const)('%s maps to %s', (stderr, category) => {
		const diagnostic = demoFipsAdmissionAggregateDiagnostic(stderr)
		expect(diagnostic).toMatchObject({
			schema: 'DEMO_FIPS_ADMISSION_AGGREGATE_DIAGNOSTIC_V1', category,
			stderrBytes: new TextEncoder().encode(stderr).length,
		})
		expect(diagnostic.stderrSha256).toMatch(/^[0-9a-f]{64}$/)
	})

	test('never returns raw stderr or a secret-shaped substring', () => {
		const secret = 'proof-secret-0123456789abcdef'
		const diagnostic = demoFipsAdmissionAggregateDiagnostic(`failure at /private/path: ${secret}`)
		const serialized = JSON.stringify(diagnostic)
		expect(serialized).not.toContain(secret)
		expect(serialized).not.toContain('/private/path')
		expect(Object.keys(diagnostic).sort()).toEqual(['category', 'schema', 'stderrBytes', 'stderrSha256'])
	})
})
