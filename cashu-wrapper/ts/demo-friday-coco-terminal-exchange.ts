/** Durable public terminal notice / recipient acknowledgement exchange. */
import { Database } from 'bun:sqlite'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	exactDemoFridayCocoTerminalNotice,
	type DemoFridayCocoTerminalNoticeV1,
} from './demo-friday-browser-coco-terminal'
import {
	DemoMaintainerRecipientPendingError,
	type DemoMaintainerExactBranchTemplate,
	type DemoMaintainerRecipientDeliveryPort,
} from './demo-maintainer-offline'
import type { DemoRecipientImportReceipt } from './demo-sigall-recipient'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const ACK_CONTEXT = utf8ToBytes('PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1')

export interface DemoFridayCocoTerminalPublicReceiptV1 {
	schema: 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1'
	operationId: string
	role: 'winner_settlement' | 'refund'
	recipientPublicKey: string
	amount: number
	proofCount: number
	imported: true
}

export interface DemoFridayCocoTerminalAckV1 {
	schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1'
	actor: string
	fundingOperationId: string
	noticeDigest: string
	importReceipt: DemoFridayCocoTerminalPublicReceiptV1
	recipientAckSignature: string
}

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_COCO_TERMINAL_EXCHANGE: ${message}`) }
function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') { if (!Number.isSafeInteger(value)) fail('non-safe integer'); return JSON.stringify(value) }
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') fail('unsupported canonical value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}
function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(canonical(value)))) }

export function demoFridayCocoTerminalNoticeDigest(value: unknown): string {
	return digest(exactDemoFridayCocoTerminalNotice(value))
}

export function demoFridayCocoTerminalAckDigest(noticeDigest: string, receipt: DemoFridayCocoTerminalPublicReceiptV1): string {
	if (!HEX_32.test(noticeDigest)) fail('notice digest is malformed')
	return bytesToHex(sha256(concatBytes(ACK_CONTEXT, hexToBytes(noticeDigest), utf8ToBytes(canonical(receipt)))))
}

function publicReceipt(value: unknown): DemoFridayCocoTerminalPublicReceiptV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('import receipt is not an object')
	const raw = value as Record<string, unknown>
	if (canonical(Object.keys(raw).sort()) !== canonical(['amount', 'imported', 'operationId', 'proofCount', 'recipientPublicKey', 'role', 'schema'])
		|| raw.schema !== 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1' || raw.imported !== true
		|| !ID.test(String(raw.operationId)) || !['winner_settlement', 'refund'].includes(String(raw.role))
		|| !/^(?:02|03)[0-9a-f]{64}$/.test(String(raw.recipientPublicKey))
		|| !Number.isSafeInteger(raw.amount) || Number(raw.amount) < 1
		|| !Number.isSafeInteger(raw.proofCount) || Number(raw.proofCount) < 1) fail('import receipt is malformed')
	return structuredClone(value) as DemoFridayCocoTerminalPublicReceiptV1
}

function exactAck(value: unknown): DemoFridayCocoTerminalAckV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('acknowledgement is not an object')
	const raw = value as Record<string, unknown>
	if (canonical(Object.keys(raw).sort()) !== canonical(['actor', 'fundingOperationId', 'importReceipt', 'noticeDigest', 'recipientAckSignature', 'schema'])
		|| raw.schema !== 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1' || !HEX_32.test(String(raw.actor))
		|| !ID.test(String(raw.fundingOperationId)) || !HEX_32.test(String(raw.noticeDigest))
		|| !HEX_64.test(String(raw.recipientAckSignature))) fail('acknowledgement identity is malformed')
	return { schema: raw.schema, actor: String(raw.actor), fundingOperationId: String(raw.fundingOperationId),
		noticeDigest: String(raw.noticeDigest), importReceipt: publicReceipt(raw.importReceipt),
		recipientAckSignature: String(raw.recipientAckSignature) }
}

export class DemoFridayCocoTerminalExchangeSqlite {
	constructor(private readonly database: Database, readonly deploymentId: string) {
		if (!ID.test(deploymentId)) fail('deployment identity is invalid')
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_coco_terminal_exchange (
				operation_id TEXT PRIMARY KEY NOT NULL, deployment_id TEXT NOT NULL,
				actor TEXT NOT NULL, recipient_public_key TEXT NOT NULL,
				notice_digest TEXT UNIQUE NOT NULL, notice_json TEXT NOT NULL,
				ack_json TEXT, revision INTEGER NOT NULL
			) STRICT`)
	}

	publishExact(noticeValue: DemoFridayCocoTerminalNoticeV1, recipientPublicKey: string): DemoFridayCocoTerminalNoticeV1 {
		const notice = exactDemoFridayCocoTerminalNotice(noticeValue)
		if (!/^(?:02|03)[0-9a-f]{64}$/.test(recipientPublicKey)) fail('recipient public key is malformed')
		const noticeDigest = demoFridayCocoTerminalNoticeDigest(notice)
		return this.database.transaction(() => {
			const prior = this.database.query<{ deployment_id: string; actor: string; recipient_public_key: string; notice_digest: string; notice_json: string }, [string]>(
				'SELECT deployment_id,actor,recipient_public_key,notice_digest,notice_json FROM friday_coco_terminal_exchange WHERE operation_id = ?',
			).get(notice.operationId)
			if (prior !== null) {
				if (prior.deployment_id !== this.deploymentId || prior.actor !== notice.actor
					|| prior.recipient_public_key !== recipientPublicKey
					|| prior.notice_digest !== noticeDigest || prior.notice_json !== canonical(notice)) fail('operation already owns another terminal notice')
				return notice
			}
			this.database.query(`INSERT INTO friday_coco_terminal_exchange
				(operation_id,deployment_id,actor,recipient_public_key,notice_digest,notice_json,revision) VALUES (?,?,?,?,?,?,0)`)
				.run(notice.operationId, this.deploymentId, notice.actor, recipientPublicKey, noticeDigest, canonical(notice))
			return notice
		}).immediate()
	}

	readExact(request: { actor: string; fundingOperationId: string }): DemoFridayCocoTerminalNoticeV1 | null {
		if (!HEX_32.test(request.actor) || !ID.test(request.fundingOperationId)) fail('notice read identity is malformed')
		const row = this.database.query<{ deployment_id: string; actor: string; notice_json: string }, [string]>(
			'SELECT deployment_id,actor,notice_json FROM friday_coco_terminal_exchange WHERE operation_id = ?',
		).get(request.fundingOperationId)
		if (row === null) return null
		if (row.deployment_id !== this.deploymentId || row.actor !== request.actor) fail('notice belongs to another actor or deployment')
		return exactDemoFridayCocoTerminalNotice(JSON.parse(row.notice_json) as unknown)
	}

	acknowledgeExact(value: unknown): DemoFridayCocoTerminalAckV1 {
		const ack = exactAck(value)
		return this.database.transaction(() => {
			const row = this.database.query<{ deployment_id: string; actor: string; recipient_public_key: string; notice_digest: string; notice_json: string; ack_json: string | null; revision: number }, [string]>(
				'SELECT deployment_id,actor,recipient_public_key,notice_digest,notice_json,ack_json,revision FROM friday_coco_terminal_exchange WHERE operation_id = ?',
			).get(ack.fundingOperationId)
			if (row === null || row.deployment_id !== this.deploymentId || row.actor !== ack.actor || row.notice_digest !== ack.noticeDigest) {
				fail('acknowledgement has no exact terminal notice')
			}
			const notice = exactDemoFridayCocoTerminalNotice(JSON.parse(row.notice_json) as unknown)
			if (ack.importReceipt.operationId !== notice.operationId || ack.importReceipt.role !== notice.role
				|| ack.importReceipt.recipientPublicKey !== row.recipient_public_key
				|| ack.importReceipt.amount !== notice.amount || ack.importReceipt.proofCount !== notice.signatures.length) {
				fail('acknowledgement receipt differs from notice')
			}
			const message = demoFridayCocoTerminalAckDigest(ack.noticeDigest, ack.importReceipt)
			const xonly = ack.importReceipt.recipientPublicKey.slice(2)
			if (!schnorr.verify(hexToBytes(ack.recipientAckSignature), hexToBytes(message), hexToBytes(xonly))) {
				fail('recipient acknowledgement signature is invalid')
			}
			const encoded = canonical(ack)
			if (row.ack_json !== null) {
				if (row.ack_json !== encoded) fail('terminal acknowledgement changed after acceptance')
				return ack
			}
			if (this.database.query(`UPDATE friday_coco_terminal_exchange SET ack_json=?,revision=revision+1
				WHERE operation_id=? AND revision=? AND ack_json IS NULL`).run(encoded, notice.operationId, row.revision).changes !== 1) {
				fail('terminal acknowledgement changed concurrently')
			}
			return ack
		}).immediate()
	}

	hasAck(operationId: string): boolean {
		if (!ID.test(operationId)) fail('operation identity is invalid')
		return this.database.query<{ present: number }, [string, string]>(
			'SELECT CASE WHEN ack_json IS NULL THEN 0 ELSE 1 END AS present FROM friday_coco_terminal_exchange WHERE operation_id=? AND deployment_id=?',
		).get(operationId, this.deploymentId)?.present === 1
	}

	readAckDigestExact(operationId: string): string | null {
		if (!ID.test(operationId)) fail('operation identity is invalid')
		const row = this.database.query<{ deployment_id: string; ack_json: string | null }, [string]>(
			'SELECT deployment_id,ack_json FROM friday_coco_terminal_exchange WHERE operation_id=?',
		).get(operationId)
		if (row === null || row.ack_json === null) return null
		if (row.deployment_id !== this.deploymentId) fail('acknowledgement belongs to another deployment')
		const ack = exactAck(JSON.parse(row.ack_json) as unknown)
		return demoFridayCocoTerminalAckDigest(ack.noticeDigest, ack.importReceipt)
	}

	recipientFor(template: DemoMaintainerExactBranchTemplate, recipientActorId: string): DemoMaintainerRecipientDeliveryPort {
		if (!HEX_32.test(recipientActorId)) fail('recipient actor is malformed')
		return {
			deliverExact: async (request) => {
				const notice = this.publishExact({
					schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1', actor: recipientActorId,
					network: template.network, chainId: template.chainId, auctionId: template.auctionId,
					operationId: template.operationId, role: template.role, mintUrl: template.mintUrl,
					amount: template.amount, recipientCapabilityDigest: request.recipientCapabilityDigest,
					signatures: structuredClone(request.signatures),
				}, template.recipientPublicKey)
				if (!this.hasAck(notice.operationId)) throw new DemoMaintainerRecipientPendingError()
				return { imported: true, alreadyImported: true }
			},
		}
	}
}

export function demoFridayPublicImportReceipt(receipt: DemoRecipientImportReceipt): DemoFridayCocoTerminalPublicReceiptV1 {
	return publicReceipt({ schema: receipt.schema, operationId: receipt.operationId, role: receipt.role,
		recipientPublicKey: receipt.recipientPublicKey, amount: receipt.amount,
		proofCount: receipt.proofCount, imported: true })
}
