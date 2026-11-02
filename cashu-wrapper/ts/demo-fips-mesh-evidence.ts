/**
 * Canonical, non-secret evidence record for the isolated jmcorgan/fips lab.
 *
 * This codec does not create namespaces or infer transport from an IPv6 label.
 * A reviewed harness must populate it from owned process/socket/netns records,
 * interface counters and an underlay capture. Validation requires both the
 * positive FIPS-path observations and negative direct-underlay probes.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

const HEX_32 = /^[0-9a-f]{64}$/
const LAB_NAMESPACE = /^poc-friday-fips-n[1-4]$/
const UNDERLAY = /^198\.18\.242\.[1-4]$/
const ULA = /^(?:fc|fd)[0-9a-f:]+$/i

export interface DemoFipsOwnedProcessV1 {
	role: 'fips' | 'validator' | 'signer'
	pid: number
	procStartTicks: number
	uid: number
	gid: number
	executableSha256: string
	namespaceInode: number
}

export interface DemoFipsInterfaceCountersV1 {
	underlayRxBytesBefore: number
	underlayRxBytesAfter: number
	underlayTxBytesBefore: number
	underlayTxBytesAfter: number
	fipsRxBytesBefore: number
	fipsRxBytesAfter: number
	fipsTxBytesBefore: number
	fipsTxBytesAfter: number
}

export interface DemoFipsNodeEvidenceV1 {
	participantId: 1 | 2 | 3 | 4
	namespace: string
	underlayAddress: string
	fipsUla: string
	processes: [DemoFipsOwnedProcessV1, DemoFipsOwnedProcessV1, DemoFipsOwnedProcessV1]
	counters: DemoFipsInterfaceCountersV1
	cometFipsSocketOwned: true
	signerFipsSocketOwned: true
	directUnderlayCometRefused: true
	directUnderlaySignerRefused: true
	underlayEncryptedUdpPackets: number
	underlayEncryptedUdpBytes: number
	underlayPlaintextMarkerMatches: 0
}

export interface DemoFipsMeshEvidenceV1 {
	schema: 'COCO_DEMO_FIPS_MESH_EVIDENCE_V1'
	runId: string
	harnessSha256: string
	fipsBinarySha256: string
	fipsctlBinarySha256: string
	startedAt: number
	finishedAt: number
	operationRoot: string
	cometTransactionDigest: string
	signerRequestDigest: string
	hostRulesetSha256Before: string
	hostRulesetSha256After: string
	nodes: [DemoFipsNodeEvidenceV1, DemoFipsNodeEvidenceV1, DemoFipsNodeEvidenceV1, DemoFipsNodeEvidenceV1]
}

export interface DemoFipsMeshEvidencePinsV1 {
	harnessSha256: string
	fipsBinarySha256: string
	fipsctlBinarySha256: string
	validatorBinarySha256: string
	signerBinarySha256: string
	unprivilegedUid: number
	unprivilegedGid: number
}

export class DemoFipsMeshEvidenceError extends Error {
	constructor(readonly code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoFipsMeshEvidenceError'
	}
}

function refuse(code: string, message: string): never { throw new DemoFipsMeshEvidenceError(code, message) }

function exactKeys(value: object, expected: string[], field: string): void {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		refuse('DEMO_FIPS_EVIDENCE_SHAPE', `${field} must be an object`)
	}
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
		refuse('DEMO_FIPS_EVIDENCE_SHAPE', `${field} contains missing or unexpected fields`)
	}
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('DEMO_FIPS_EVIDENCE_CANONICAL', 'numbers must be safe integers')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (typeof value !== 'object') refuse('DEMO_FIPS_EVIDENCE_CANONICAL', 'unsupported value')
	const object = value as Record<string, unknown>
	return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

function increasing(before: number, after: number): boolean {
	return Number.isSafeInteger(before) && before >= 0 && Number.isSafeInteger(after) && after > before
}

function validateProcess(process: DemoFipsOwnedProcessV1, pins: DemoFipsMeshEvidencePinsV1): DemoFipsOwnedProcessV1 {
	exactKeys(process, ['role', 'pid', 'procStartTicks', 'uid', 'gid', 'executableSha256', 'namespaceInode'], 'process')
	const expectedExecutable = process.role === 'fips' ? pins.fipsBinarySha256
		: process.role === 'validator' ? pins.validatorBinarySha256 : pins.signerBinarySha256
	if (!['fips', 'validator', 'signer'].includes(process.role)
		|| !Number.isSafeInteger(process.pid) || process.pid < 1
		|| !Number.isSafeInteger(process.procStartTicks) || process.procStartTicks < 1
		|| process.uid !== pins.unprivilegedUid || process.gid !== pins.unprivilegedGid
		|| process.executableSha256 !== expectedExecutable
		|| !Number.isSafeInteger(process.namespaceInode) || process.namespaceInode < 1) {
		refuse('DEMO_FIPS_EVIDENCE_PROCESS', 'owned process attribution is malformed or not privilege-dropped')
	}
	return structuredClone(process)
}

function validateNode(node: DemoFipsNodeEvidenceV1, index: number, pins: DemoFipsMeshEvidencePinsV1): DemoFipsNodeEvidenceV1 {
	exactKeys(node, [
		'participantId', 'namespace', 'underlayAddress', 'fipsUla', 'processes', 'counters',
		'cometFipsSocketOwned', 'signerFipsSocketOwned', 'directUnderlayCometRefused',
		'directUnderlaySignerRefused', 'underlayEncryptedUdpPackets', 'underlayEncryptedUdpBytes',
		'underlayPlaintextMarkerMatches',
	], `nodes[${index}]`)
	if (node.counters === null || typeof node.counters !== 'object' || Array.isArray(node.counters)) {
		refuse('DEMO_FIPS_EVIDENCE_SHAPE', `nodes[${index}].counters must be an object`)
	}
	exactKeys(node.counters, [
		'underlayRxBytesBefore', 'underlayRxBytesAfter', 'underlayTxBytesBefore', 'underlayTxBytesAfter',
		'fipsRxBytesBefore', 'fipsRxBytesAfter', 'fipsTxBytesBefore', 'fipsTxBytesAfter',
	], `nodes[${index}].counters`)
	if (node.participantId !== index + 1 || !LAB_NAMESPACE.test(node.namespace)
		|| node.namespace !== `poc-friday-fips-n${node.participantId}`
		|| !UNDERLAY.test(node.underlayAddress) || node.underlayAddress !== `198.18.242.${node.participantId}`
		|| !ULA.test(node.fipsUla) || node.cometFipsSocketOwned !== true || node.signerFipsSocketOwned !== true
		|| node.directUnderlayCometRefused !== true || node.directUnderlaySignerRefused !== true
		|| !Number.isSafeInteger(node.underlayEncryptedUdpPackets) || node.underlayEncryptedUdpPackets < 1
		|| !Number.isSafeInteger(node.underlayEncryptedUdpBytes) || node.underlayEncryptedUdpBytes < 1
		|| node.underlayPlaintextMarkerMatches !== 0 || !Array.isArray(node.processes) || node.processes.length !== 3) {
		refuse('DEMO_FIPS_EVIDENCE_NODE', `node ${index + 1} lacks exact FIPS traversal or direct-underlay refusal evidence`)
	}
	const processes = node.processes.map((process) => validateProcess(process, pins)) as DemoFipsNodeEvidenceV1['processes']
	if (JSON.stringify(processes.map(({ role }) => role).sort()) !== JSON.stringify(['fips', 'signer', 'validator'])
		|| new Set(processes.map(({ pid, procStartTicks }) => `${pid}:${procStartTicks}`)).size !== 3
		|| new Set(processes.map(({ namespaceInode }) => namespaceInode)).size !== 1) {
		refuse('DEMO_FIPS_EVIDENCE_PROCESS', `node ${index + 1} process roles or namespace attribution conflict`)
	}
	const counters = node.counters
	if (!increasing(counters.underlayRxBytesBefore, counters.underlayRxBytesAfter)
		|| !increasing(counters.underlayTxBytesBefore, counters.underlayTxBytesAfter)
		|| !increasing(counters.fipsRxBytesBefore, counters.fipsRxBytesAfter)
		|| !increasing(counters.fipsTxBytesBefore, counters.fipsTxBytesAfter)) {
		refuse('DEMO_FIPS_EVIDENCE_COUNTER', `node ${index + 1} interface counters did not advance on both layers`)
	}
	return { ...structuredClone(node), processes }
}

function validatePins(pins: DemoFipsMeshEvidencePinsV1): DemoFipsMeshEvidencePinsV1 {
	if (pins === null || typeof pins !== 'object' || Array.isArray(pins)) {
		refuse('DEMO_FIPS_EVIDENCE_PINS', 'evidence pins must be an object')
	}
	exactKeys(pins, [
		'harnessSha256', 'fipsBinarySha256', 'fipsctlBinarySha256', 'validatorBinarySha256',
		'signerBinarySha256', 'unprivilegedUid', 'unprivilegedGid',
	], 'evidence pins')
	if ([pins.harnessSha256, pins.fipsBinarySha256, pins.fipsctlBinarySha256,
		pins.validatorBinarySha256, pins.signerBinarySha256].some((digest) => !HEX_32.test(digest))
		|| !Number.isSafeInteger(pins.unprivilegedUid) || pins.unprivilegedUid < 1
		|| !Number.isSafeInteger(pins.unprivilegedGid) || pins.unprivilegedGid < 1) {
		refuse('DEMO_FIPS_EVIDENCE_PINS', 'evidence pins are malformed')
	}
	return structuredClone(pins)
}

export function validateDemoFipsMeshEvidence(
	value: DemoFipsMeshEvidenceV1,
	pinsValue: DemoFipsMeshEvidencePinsV1,
): DemoFipsMeshEvidenceV1 {
	const exact = structuredClone(value)
	const pins = validatePins(pinsValue)
	exactKeys(exact, [
		'schema', 'runId', 'harnessSha256', 'fipsBinarySha256', 'fipsctlBinarySha256',
		'startedAt', 'finishedAt', 'operationRoot', 'cometTransactionDigest', 'signerRequestDigest',
		'hostRulesetSha256Before', 'hostRulesetSha256After', 'nodes',
	], 'mesh evidence')
	if (exact.schema !== 'COCO_DEMO_FIPS_MESH_EVIDENCE_V1'
		|| !/^[A-Za-z0-9_-]{1,160}$/.test(exact.runId)
		|| [exact.harnessSha256, exact.fipsBinarySha256, exact.fipsctlBinarySha256, exact.operationRoot,
			exact.cometTransactionDigest, exact.signerRequestDigest, exact.hostRulesetSha256Before,
			exact.hostRulesetSha256After].some((digest) => !HEX_32.test(digest))
		|| exact.harnessSha256 !== pins.harnessSha256 || exact.fipsBinarySha256 !== pins.fipsBinarySha256
		|| exact.fipsctlBinarySha256 !== pins.fipsctlBinarySha256
		|| exact.hostRulesetSha256Before !== exact.hostRulesetSha256After
		|| !Number.isSafeInteger(exact.startedAt) || exact.startedAt < 1
		|| !Number.isSafeInteger(exact.finishedAt) || exact.finishedAt < exact.startedAt
		|| exact.finishedAt - exact.startedAt > 3_600
		|| !Array.isArray(exact.nodes) || exact.nodes.length !== 4) {
		refuse('DEMO_FIPS_EVIDENCE_SHAPE', 'mesh evidence identity, lifetime, or host invariance is malformed')
	}
	exact.nodes = exact.nodes.map((node, index) => validateNode(node, index, pins)) as DemoFipsMeshEvidenceV1['nodes']
	if (new Set(exact.nodes.map(({ fipsUla }) => fipsUla.toLowerCase())).size !== 4
		|| new Set(exact.nodes.flatMap(({ processes }) => processes.map(({ pid, procStartTicks }) => `${pid}:${procStartTicks}`))).size !== 12) {
		refuse('DEMO_FIPS_EVIDENCE_IDENTITY', 'node ULAs or owned process identities are not globally distinct')
	}
	return exact
}

export function demoFipsMeshEvidenceDigest(value: DemoFipsMeshEvidenceV1, pins: DemoFipsMeshEvidencePinsV1): string {
	return bytesToHex(sha256(utf8ToBytes(canonicalJson(validateDemoFipsMeshEvidence(value, pins)))))
}
