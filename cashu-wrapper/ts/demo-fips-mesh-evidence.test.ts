import { describe, expect, test } from 'bun:test'

import {
	demoFipsMeshEvidenceDigest,
	validateDemoFipsMeshEvidence,
	type DemoFipsMeshEvidenceV1,
	type DemoFipsMeshEvidencePinsV1,
	type DemoFipsOwnedProcessV1,
} from './demo-fips-mesh-evidence'

const hash = (digit: string): string => digit.repeat(64)

const pins: DemoFipsMeshEvidencePinsV1 = {
	harnessSha256: hash('1'), fipsBinarySha256: hash('2'), fipsctlBinarySha256: hash('3'),
	validatorBinarySha256: hash('8'), signerBinarySha256: hash('9'), unprivilegedUid: 1_000, unprivilegedGid: 1_000,
}

function process(participantId: number, role: DemoFipsOwnedProcessV1['role'], roleIndex: number): DemoFipsOwnedProcessV1 {
	const executableSha256 = role === 'fips' ? pins.fipsBinarySha256
		: role === 'validator' ? pins.validatorBinarySha256 : pins.signerBinarySha256
	return {
		role, pid: participantId * 100 + roleIndex, procStartTicks: 1_000 + roleIndex,
		uid: pins.unprivilegedUid, gid: pins.unprivilegedGid, executableSha256,
		namespaceInode: 10_000 + participantId,
	}
}

function fixture(): DemoFipsMeshEvidenceV1 {
	return {
		schema: 'COCO_DEMO_FIPS_MESH_EVIDENCE_V1', runId: 'run-1', harnessSha256: hash('1'),
		fipsBinarySha256: hash('2'), fipsctlBinarySha256: hash('3'), startedAt: 1_000, finishedAt: 1_100,
		operationRoot: hash('4'), cometTransactionDigest: hash('5'), signerRequestDigest: hash('6'),
		hostRulesetSha256Before: hash('7'), hostRulesetSha256After: hash('7'),
		nodes: [1, 2, 3, 4].map((participantId) => ({
			participantId: participantId as 1 | 2 | 3 | 4, namespace: `poc-friday-fips-n${participantId}`,
			underlayAddress: `198.18.242.${participantId}`, fipsUla: `fd00::${participantId}`,
			processes: [process(participantId, 'fips', 0), process(participantId, 'validator', 1), process(participantId, 'signer', 2)],
			counters: {
				underlayRxBytesBefore: 0, underlayRxBytesAfter: 10, underlayTxBytesBefore: 0, underlayTxBytesAfter: 10,
				fipsRxBytesBefore: 0, fipsRxBytesAfter: 10, fipsTxBytesBefore: 0, fipsTxBytesAfter: 10,
			},
			cometFipsSocketOwned: true as const, signerFipsSocketOwned: true as const,
			directUnderlayCometRefused: true as const, directUnderlaySignerRefused: true as const,
			underlayEncryptedUdpPackets: 2, underlayEncryptedUdpBytes: 200, underlayPlaintextMarkerMatches: 0 as const,
		})) as DemoFipsMeshEvidenceV1['nodes'],
	}
}

describe('FIPS mesh evidence codec', () => {
	test('binds real path/refusal/counter/process observations into a canonical digest', () => {
		const value = fixture()
		expect(validateDemoFipsMeshEvidence(value, pins).nodes).toHaveLength(4)
		expect(demoFipsMeshEvidenceDigest(value, pins)).toMatch(/^[0-9a-f]{64}$/)
	})

	test('does not accept a ULA label without actual traversal evidence', () => {
		const value = fixture()
		value.nodes[0].underlayEncryptedUdpPackets = 0
		expect(() => validateDemoFipsMeshEvidence(value, pins)).toThrow(/lacks exact FIPS traversal/)
	})
})
