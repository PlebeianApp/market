/**
 * Isolated local admission-policy worker used only by the Friday fake-money
 * interoperability harness.  Each process owns its own mint check, loopback
 * Comet reader, and proof-use database.  It never receives a positive policy
 * boolean from the coordinator.
 *
 * This is deliberately not the four-host RPC transport.  A later FIPS lab
 * must replace stdin/stdout with the separately reviewed authenticated mesh.
 */
import { Database } from 'bun:sqlite'
import { hasValidDleq } from '@cashu/cashu-ts'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { serveDemoAdmissionParticipant } from './demo-admission-participant-process'
import { authenticatedDemoCometState, createLoopbackCometReader } from './demo-comet-displacement-verifier'
import { createInProcessDemoAdmissionParticipant } from './demo-integrated-admission-service'
import type { DemoIntegratedAdmissionMintEvidenceV1 } from './demo-integrated-admission-policy'
import { CashuMintClient, proofPoint, type CashuProof } from './nut-client'

const participantId = Number(process.env.FRIDAY_PARTICIPANT_ID)
const rpc = process.env.FRIDAY_COMET_RPC ?? ''
const validatorsHash = process.env.FRIDAY_COMET_VALIDATORS_HASH ?? ''
const chainId = process.env.FRIDAY_CHAIN_ID ?? ''
const proofUsePath = process.env.FRIDAY_PROOF_USE_DB ?? ''
if (![1, 2, 3, 4].includes(participantId) || rpc.length === 0 || !/^[0-9a-f]{64}$/.test(validatorsHash)
	|| chainId.length === 0 || !proofUsePath.startsWith('/')) {
	throw new Error('DEMO_ADMISSION_WORKER_CONFIG: exact participant, Comet, chain, roster, and proof-use pins are required')
}

function digest(value: unknown): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))))
}

async function checkStates(mintUrl: string, ys: string[]): Promise<Array<{ Y: string; state: string }>> {
	const response = await fetch(`${mintUrl}/v1/checkstate`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Ys: ys }),
	})
	if (!response.ok) throw new Error(`DEMO_ADMISSION_WORKER_MINT: NUT-07 returned HTTP ${response.status}`)
	const value = await response.json() as { states?: Array<{ Y?: unknown; state?: unknown }> }
	if (!Array.isArray(value.states)) throw new Error('DEMO_ADMISSION_WORKER_MINT: NUT-07 response is malformed')
	return value.states.map((entry) => ({ Y: String(entry.Y ?? '').toLowerCase(), state: String(entry.state ?? '').toUpperCase() }))
}

const reader = createLoopbackCometReader(rpc)
const proofUseDb = new Database(proofUsePath, { create: true, strict: true })
proofUseDb.exec(`
	PRAGMA journal_mode=WAL;
	PRAGMA synchronous=FULL;
	CREATE TABLE IF NOT EXISTS proof_claims (
		proof_ref TEXT PRIMARY KEY,
		network TEXT NOT NULL,
		chain_id TEXT NOT NULL,
		auction_id TEXT NOT NULL,
		funding_operation_id TEXT NOT NULL
	) STRICT;
`)

const worker = createInProcessDemoAdmissionParticipant({
	participantId: participantId as 1 | 2 | 3 | 4,
	consensus: {
		async readCommittedLeader(request) {
			if (request.network !== chainId || request.chainId !== chainId) {
				throw new Error('DEMO_ADMISSION_WORKER_CONSENSUS: network or chain differs from the enrolled worker')
			}
			const authenticated = await authenticatedDemoCometState(reader, validatorsHash, 1)
			const auction = authenticated.observation.state.auctions?.[request.auctionId]
			const sellerActor = auction?.seller
			const sellerPaymentPublicKey = auction?.seller_coco_payment_public_key ?? ''
			if ((sellerActor !== undefined && !/^[0-9a-f]{64}$/.test(sellerActor))
				|| !/^(?:02|03)[0-9a-f]{64}$/.test(sellerPaymentPublicKey)) {
				throw new Error('DEMO_ADMISSION_WORKER_CONSENSUS: committed auction lacks the seller actor or direct Coco seller key')
			}
			return {
				leaderBidId: auction?.leader_bid_id ?? '',
				...(sellerActor === undefined ? {} : { sellerActor }), sellerPaymentPublicKey,
				height: authenticated.observation.queryHeight,
				evidenceDigest: digest({
					chainId, validatorsHash, participantId, auctionId: request.auctionId,
					height: authenticated.observation.queryHeight, appHash: authenticated.observation.appHash,
					leaderBidId: auction?.leader_bid_id ?? '', sellerActor: sellerActor ?? '', sellerPaymentPublicKey,
				}),
			}
		},
	},
	proofUse: {
		async assertAvailable(request) {
			const transaction = proofUseDb.transaction(() => {
				for (const proof of request.proofStateRefs) {
					const row = proofUseDb.query<{ network: string; chain_id: string; auction_id: string; funding_operation_id: string }, [string]>(
						'SELECT network,chain_id,auction_id,funding_operation_id FROM proof_claims WHERE proof_ref = ?',
					).get(proof)
					if (row !== null && (row.network !== request.network || row.chain_id !== request.chainId
						|| row.auction_id !== request.auctionId || row.funding_operation_id !== request.fundingOperationId)) {
						throw new Error('DEMO_ADMISSION_WORKER_PROOF_USE: proof is already proposed for another operation')
					}
				}
				for (const proof of request.proofStateRefs) {
					proofUseDb.query('INSERT OR IGNORE INTO proof_claims(proof_ref,network,chain_id,auction_id,funding_operation_id) VALUES(?,?,?,?,?)')
						.run(proof, request.network, request.chainId, request.auctionId, request.fundingOperationId)
				}
			})
			transaction()
			return { evidenceDigest: digest({ ...request, participantId }) }
		},
	},
	mintVerifier: {
		async verifyAndDerive(request): Promise<DemoIntegratedAdmissionMintEvidenceV1> {
			if (request.mintUrl !== 'http://127.0.0.1:3338') {
				throw new Error('DEMO_ADMISSION_WORKER_MINT: only the isolated fixed loopback mint is allowed')
			}
			const client = new CashuMintClient({ mintUrl: request.mintUrl })
			const keysets = (await client.keysets()).keysets.filter((entry) => entry.unit === 'sat' && entry.active)
			if (keysets.length !== 1 || keysets[0]!.id !== request.activeKeysetId || (keysets[0]!.input_fee_ppk ?? 0) !== 0) {
				throw new Error('DEMO_ADMISSION_WORKER_MINT: active zero-fee keyset differs from the receipt')
			}
			const keyset = (await client.keys(request.activeKeysetId)).keysets.find((entry) => entry.id === request.activeKeysetId && entry.unit === 'sat')
			if (keyset === undefined) throw new Error('DEMO_ADMISSION_WORKER_MINT: exact keyset keys are absent')
			for (const proof of request.inputs) {
				if (proof.id !== request.activeKeysetId || !hasValidDleq(proof as never, keyset as never, { require: true })) {
					throw new Error('DEMO_ADMISSION_WORKER_MINT: proof DLEQ or keyset binding is invalid')
				}
			}
			const refs = request.inputs.map((proof: CashuProof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
			const states = await checkStates(request.mintUrl, refs)
			const byY = new Map(states.map((state) => [state.Y, state.state]))
			if (byY.size !== refs.length || refs.some((ref) => byY.get(ref) !== 'UNSPENT')) {
				throw new Error('DEMO_ADMISSION_WORKER_MINT: full pool is not uniquely UNSPENT')
			}
			const inputTotal = request.inputs.reduce((sum, proof) => sum + proof.amount, 0)
			return {
				schema: 'COCO_DEMO_INTEGRATED_ADMISSION_MINT_EVIDENCE_V1',
				evidenceDigest: digest({ participantId, request: { mintUrl: request.mintUrl, activeKeysetId: request.activeKeysetId, refs }, states }),
				mintUrl: request.mintUrl, activeKeysetId: request.activeKeysetId, inputFeePpk: 0, inputTotal,
				proofStates: refs.map((proofStateRef) => ({ proofStateRef, state: 'UNSPENT' as const })),
			}
		},
	},
})

try { await serveDemoAdmissionParticipant(worker) }
finally { proofUseDb.close(false) }
