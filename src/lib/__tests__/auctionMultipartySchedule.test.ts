import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
	AuctionMultipartyScheduleError,
	compileSourceSchedule,
	parseCanonicalSchedule,
	validateScheduleCommitment,
	type AuctionMultipartyCanonicalScheduleEntry,
	type AuctionMultipartySourceScheduleEntry,
} from '../auction/multipartySchedule'

type ValidFixtureCase = {
	id: string
	source_variants: AuctionMultipartySourceScheduleEntry[][]
	normalized_entries: AuctionMultipartyCanonicalScheduleEntry[]
	auxiliary_allocation_bps: number
	seller_remainder_bps: number
	canonical_utf8: string
	canonical_hex: string
	canonical_byte_length?: number
	commitment_preimage_hex: string
	schedule_commitment_sha256: string
}

type ValidFixtureDocument = {
	cases: ValidFixtureCase[]
}

type InvalidFixtureCase = {
	id: string
	stage: 'compile_source_schedule' | 'parse_canonical_schedule' | 'validate_schedule_commitment'
	input?: unknown[]
	canonical_hex?: string
	claimed_schedule_commitment_sha256?: string
	expected_error: string
}

type InvalidFixtureDocument = {
	cases: InvalidFixtureCase[]
	coverage_summary: {
		total_negative_vectors: number
		vectors_by_stage: Record<string, number>
		distinct_failure_codes_represented: number
		compound_precedence_vectors: number
	}
}

const loadJsonFixture = <T>(relativePath: string): T => JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as T

const validFixtures = loadJsonFixture<ValidFixtureDocument>('../../../docs/protocol/fixtures/auction-multiparty-v1-valid.json')

const invalidFixtures = loadJsonFixture<InvalidFixtureDocument>('../../../docs/protocol/fixtures/auction-multiparty-v1-invalid.json')

const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

const hexToBytes = (hex: string): Uint8Array => {
	if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) {
		throw new Error('Fixture hex is malformed')
	}

	const result = new Uint8Array(hex.length / 2)
	for (let index = 0; index < result.length; index++) {
		result[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
	}

	return result
}

const expectScheduleError = (expectedCode: string, operation: () => unknown): void => {
	try {
		operation()
		throw new Error(`Expected ${expectedCode}, but operation succeeded`)
	} catch (error) {
		expect(error).toBeInstanceOf(AuctionMultipartyScheduleError)
		expect((error as AuctionMultipartyScheduleError).code).toBe(expectedCode)
	}
}

beforeAll(() => {
	expect(validFixtures.cases).toHaveLength(6)
	expect(invalidFixtures.cases).toHaveLength(72)
	expect(invalidFixtures.coverage_summary.total_negative_vectors).toBe(72)
	expect(invalidFixtures.coverage_summary.vectors_by_stage.compile_source_schedule).toBe(22)
	expect(invalidFixtures.coverage_summary.vectors_by_stage.parse_canonical_schedule).toBe(49)
	expect(invalidFixtures.coverage_summary.vectors_by_stage.validate_schedule_commitment).toBe(1)
	expect(new Set(invalidFixtures.cases.map((fixture) => fixture.expected_error)).size).toBe(
		invalidFixtures.coverage_summary.distinct_failure_codes_represented,
	)
	expect(invalidFixtures.cases.filter((fixture) => fixture.id.startsWith('precedence-'))).toHaveLength(
		invalidFixtures.coverage_summary.compound_precedence_vectors,
	)
})

describe('Auction Multiparty Schedule V1 positive conformance', () => {
	for (const fixture of validFixtures.cases) {
		test(fixture.id, () => {
			for (const sourceVariant of fixture.source_variants) {
				const compiled = compileSourceSchedule(sourceVariant)

				expect(compiled.entries).toEqual(fixture.normalized_entries)
				expect(compiled.auxiliary_allocation_bps).toBe(fixture.auxiliary_allocation_bps)
				expect(compiled.seller_remainder_bps).toBe(fixture.seller_remainder_bps)
				expect(new TextDecoder().decode(compiled.canonical_bytes)).toBe(fixture.canonical_utf8)
				expect(bytesToHex(compiled.canonical_bytes)).toBe(fixture.canonical_hex)
				expect(bytesToHex(compiled.commitment_preimage)).toBe(fixture.commitment_preimage_hex)
				expect(compiled.schedule_commitment).toBe(fixture.schedule_commitment_sha256)

				if (fixture.canonical_byte_length !== undefined) {
					expect(compiled.canonical_bytes.length).toBe(fixture.canonical_byte_length)
				}

				const parsed = parseCanonicalSchedule(compiled.canonical_bytes)

				expect(parsed.entries).toEqual(fixture.normalized_entries)
				expect(parsed.auxiliary_allocation_bps).toBe(fixture.auxiliary_allocation_bps)
				expect(parsed.seller_remainder_bps).toBe(fixture.seller_remainder_bps)
				expect(bytesToHex(parsed.canonical_bytes)).toBe(fixture.canonical_hex)
				expect(bytesToHex(parsed.commitment_preimage)).toBe(fixture.commitment_preimage_hex)
				expect(parsed.schedule_commitment).toBe(fixture.schedule_commitment_sha256)

				expect(validateScheduleCommitment(parsed.canonical_bytes, fixture.schedule_commitment_sha256)).toBe(
					fixture.schedule_commitment_sha256,
				)
			}

			const fixtureBytes = hexToBytes(fixture.canonical_hex)
			const parsedFixtureBytes = parseCanonicalSchedule(fixtureBytes)

			expect(parsedFixtureBytes.entries).toEqual(fixture.normalized_entries)
			expect(parsedFixtureBytes.schedule_commitment).toBe(fixture.schedule_commitment_sha256)
		})
	}
})

describe('Auction Multiparty Schedule V1 negative conformance', () => {
	for (const fixture of invalidFixtures.cases) {
		test(fixture.id, () => {
			switch (fixture.stage) {
				case 'compile_source_schedule':
					expectScheduleError(fixture.expected_error, () => compileSourceSchedule(fixture.input as AuctionMultipartySourceScheduleEntry[]))
					break

				case 'parse_canonical_schedule':
					if (!fixture.canonical_hex) {
						throw new Error(`${fixture.id} is missing canonical_hex`)
					}

					expectScheduleError(fixture.expected_error, () => parseCanonicalSchedule(hexToBytes(fixture.canonical_hex as string)))
					break

				case 'validate_schedule_commitment':
					if (!fixture.canonical_hex || !fixture.claimed_schedule_commitment_sha256) {
						throw new Error(`${fixture.id} is missing commitment fixture fields`)
					}

					expectScheduleError(fixture.expected_error, () =>
						validateScheduleCommitment(hexToBytes(fixture.canonical_hex as string), fixture.claimed_schedule_commitment_sha256 as string),
					)
					break
			}
		})
	}
})
