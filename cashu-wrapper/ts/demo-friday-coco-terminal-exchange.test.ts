import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	DemoFridayCocoTerminalExchangeSqlite,
	demoFridayCocoTerminalAckDigest,
	demoFridayCocoTerminalNoticeDigest,
} from './demo-friday-coco-terminal-exchange'
import { DemoMaintainerRecipientPendingError } from './demo-maintainer-offline'

const KEY = hexToBytes('7'.padStart(64, '0'))
const RECIPIENT = bytesToHex(secp256k1.getPublicKey(KEY, true))
const H = (value: string) => value.repeat(64).slice(0, 64)
const notice = {
	schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1' as const, actor: H('1'),
	network: 'friday', chainId: 'friday', auctionId: 'auction-1', operationId: 'operation-1',
	role: 'refund' as const, mintUrl: 'https://172.105.64.142', amount: 12,
	recipientCapabilityDigest: H('2'),
	signatures: [{ amount: 4, id: 'keyset', C_: bytesToHex(secp256k1.getPublicKey(hexToBytes('8'.padStart(64, '0')), true)) },
		{ amount: 8, id: 'keyset', C_: bytesToHex(secp256k1.getPublicKey(hexToBytes('9'.padStart(64, '0')), true)) }],
}

describe('Friday Coco terminal exchange', () => {
	test('persists one notice and accepts one exact recipient-key acknowledgement', () => {
		const exchange = new DemoFridayCocoTerminalExchangeSqlite(new Database(':memory:'), 'friday-blue')
		expect(exchange.publishExact(notice, RECIPIENT)).toEqual(notice)
		expect(exchange.readExact({ actor: notice.actor, fundingOperationId: notice.operationId })).toEqual(notice)
		const noticeDigest = demoFridayCocoTerminalNoticeDigest(notice)
		const receipt = { schema: 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1' as const, operationId: notice.operationId,
			role: 'refund' as const, recipientPublicKey: RECIPIENT, amount: 12, proofCount: 2, imported: true as const }
		const ack = { schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1' as const, actor: notice.actor,
			fundingOperationId: notice.operationId, noticeDigest, importReceipt: receipt,
			recipientAckSignature: bytesToHex(schnorr.sign(hexToBytes(
				demoFridayCocoTerminalAckDigest(noticeDigest, receipt),
			), KEY)),
		}
		expect(exchange.acknowledgeExact(ack)).toEqual(ack)
		expect(exchange.acknowledgeExact(ack)).toEqual(ack)
		expect(exchange.hasAck(notice.operationId)).toBe(true)
	})

	test('hides another actor notice and rejects receipt or acknowledgement-key substitution', () => {
		const exchange = new DemoFridayCocoTerminalExchangeSqlite(new Database(':memory:'), 'friday-blue')
		exchange.publishExact(notice, RECIPIENT)
		expect(exchange.readExact({ actor: H('3'), fundingOperationId: notice.operationId })).toBeNull()
		const noticeDigest = demoFridayCocoTerminalNoticeDigest(notice)
		const receipt = { schema: 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1' as const, operationId: notice.operationId,
			role: 'refund' as const, recipientPublicKey: RECIPIENT, amount: 12, proofCount: 2, imported: true as const }
		expect(() => exchange.acknowledgeExact({ schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1', actor: notice.actor,
			fundingOperationId: notice.operationId, noticeDigest, importReceipt: receipt,
			recipientAckSignature: '0'.repeat(128) })).toThrow(/signature/)
	})

	test('routes winner delivery to the committed seller actor without changing the exact recipient key', async () => {
		const exchange = new DemoFridayCocoTerminalExchangeSqlite(new Database(':memory:'), 'friday-blue')
		const sellerActor = H('4')
		const winnerTemplate = {
			role: 'winner_settlement', network: notice.network, chainId: notice.chainId,
			auctionId: notice.auctionId, operationId: notice.operationId, mintUrl: notice.mintUrl,
			amount: notice.amount, bidderActorId: H('5'), recipientPublicKey: RECIPIENT,
		} as never
		const delivery = exchange.recipientFor(winnerTemplate, sellerActor)
		await expect(delivery.deliverExact({
			selectionRoot: H('6'), templateDigest: H('7'), role: 'winner_settlement',
			operationId: notice.operationId, recipientCapabilityDigest: notice.recipientCapabilityDigest,
			signatures: notice.signatures,
		})).rejects.toBeInstanceOf(DemoMaintainerRecipientPendingError)
		const persisted = exchange.readExact({ actor: sellerActor, fundingOperationId: notice.operationId })
		expect(persisted?.role).toBe('winner_settlement')
		expect(persisted?.actor).toBe(sellerActor)
		expect(persisted?.actor).not.toBe(winnerTemplate.bidderActorId)
	})
})
