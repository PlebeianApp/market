import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

const PROOF_Y = /^(?:02|03)[0-9a-f]{64}$/
const STATES = new Set(['UNSPENT', 'PENDING', 'SPENT'])

export interface DemoExactNut07ResultV1 {
	schema: 'COCO_DEMO_EXACT_NUT07_RESULT_V1'
	/** States in the caller's requested order. */
	states: Array<'UNSPENT' | 'PENDING' | 'SPENT'>
	/** Non-bearer audit binding; the individual proof Ys are intentionally omitted. */
	proofSetDigest: string
	exactInputMatch: true
}

/**
 * Bind a NUT-07 response to the exact unique set of requested proof Ys.
 * Count-only/state-only checks are forbidden because a mint could otherwise
 * return states for different proofs while the caller records a false result.
 */
export function exactDemoNut07Result(
	requestedYs: string[],
	response: unknown,
): DemoExactNut07ResultV1 {
	if (!Array.isArray(requestedYs) || requestedYs.length === 0
		|| requestedYs.some((value) => !PROOF_Y.test(value))
		|| new Set(requestedYs).size !== requestedYs.length) {
		throw new Error('DEMO_NUT07_REQUEST: proof Ys must be a non-empty unique canonical set')
	}
	if (response === null || typeof response !== 'object' || Array.isArray(response)
		|| !Array.isArray((response as { states?: unknown }).states)) {
		throw new Error('DEMO_NUT07_RESPONSE: states array is absent')
	}
	const entries = (response as { states: unknown[] }).states.map((raw, index) => {
		if (raw === null || typeof raw !== 'object' || Array.isArray(raw)
			|| JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(['Y', 'state', 'witness'].sort())) {
			throw new Error(`DEMO_NUT07_RESPONSE: states[${index}] has a non-exact shape`)
		}
		const entry = raw as { Y: unknown; state: unknown; witness: unknown }
		const Y = String(entry.Y ?? '').toLowerCase()
		const state = String(entry.state ?? '').toUpperCase()
		if (!PROOF_Y.test(Y) || !STATES.has(state)
			|| (entry.witness !== null && typeof entry.witness !== 'string')
			|| (state !== 'SPENT' && entry.witness !== null)) {
			throw new Error(`DEMO_NUT07_RESPONSE: states[${index}] is malformed`)
		}
		return { Y, state: state as 'UNSPENT' | 'PENDING' | 'SPENT' }
	})
	if (entries.length !== requestedYs.length || new Set(entries.map(({ Y }) => Y)).size !== entries.length) {
		throw new Error('DEMO_NUT07_RESPONSE: response count or uniqueness differs from request')
	}
	const byY = new Map(entries.map((entry) => [entry.Y, entry.state]))
	if (requestedYs.some((Y) => !byY.has(Y))) {
		throw new Error('DEMO_NUT07_RESPONSE: response proof set differs from request')
	}
	const canonical = [...requestedYs].sort()
	return {
		schema: 'COCO_DEMO_EXACT_NUT07_RESULT_V1',
		states: requestedYs.map((Y) => byY.get(Y)!),
		proofSetDigest: bytesToHex(sha256(utf8ToBytes(JSON.stringify([
			'COCO_DEMO_NUT07_PROOF_SET_V1', canonical,
		])))),
		exactInputMatch: true,
	}
}
