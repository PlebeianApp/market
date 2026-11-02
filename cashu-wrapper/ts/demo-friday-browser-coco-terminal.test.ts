import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import type { DemoFridayBrowserCocoWallet } from './demo-friday-browser-coco-wallet'
import {
	exactDemoFridayCocoTerminalNotice,
	importDemoFridayCocoTerminal,
} from './demo-friday-browser-coco-terminal'
import {
	prepareDemoSigAllRecipientOutputs,
	type DemoRecipientPrivateJournalPort,
	type DemoRecipientPrivateRecord,
} from './demo-sigall-recipient'
import { demoRecipientCapabilityDigest } from './demo-sigall-settlement'
import type { CashuProof } from './nut-client'

type Opening = { secret: string }
const privateKey = (digit: string) => digit.repeat(64)
const compressed = (digit: string) => bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey(digit)), true))
const actor = bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey('1'))))
const recipientPrivate = privateKey('2')
const mintUrl = 'https://172.105.64.142'

class MemoryJournal implements DemoRecipientPrivateJournalPort<Opening> {
	record: DemoRecipientPrivateRecord<Opening> | null = null
	async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() }
	async load(): Promise<DemoRecipientPrivateRecord<Opening> | null> { return structuredClone(this.record) }
	async savePrepared(_scope: string, record: DemoRecipientPrivateRecord<Opening>): Promise<void> { this.record = structuredClone(record) }
	async markImported(_scope: string, _request: string, response: string): Promise<void> {
		if (this.record === null) throw new Error('absent')
		this.record.importedResponseDigest = response
	}
}

describe('Friday browser Coco terminal protocol', () => {
	test('imports exact verified terminal value through Coco and never exposes proofs in the notice', async () => {
		const journal = new MemoryJournal()
		const intent = {
			schema: 'COCO_DEMO_RECIPIENT_INTENT_V1' as const, network: 'friday-demo', chainId: 'friday-demo',
			auctionId: 'auction-1', operationId: 'funding-1', role: 'refund' as const,
			mintUrl, unit: 'sat', recipientPublicKey: compressed('2'), amounts: [2, 1],
		}
		const keyset = { id: '00deadbeef', unit: 'sat', keys: { 1: compressed('3'), 2: compressed('4') } }
		const request = await prepareDemoSigAllRecipientOutputs({
			intent, keyset,
			roleBinding: { async assertWinnerRecipient() { throw new Error('wrong role') }, async assertRefundRecipient() {} },
			signer: { async signCapability(value) { return bytesToHex(schnorr.sign(hexToBytes(value.digest), hexToBytes(recipientPrivate))) } },
			outputFactory: { async createRecipientOwnedOutput(value) {
				return { message: { amount: value.amount, id: value.keysetId, B_: compressed(String(5 + value.index)) }, privateOpeningRef: { secret: `opening-${value.index}` } }
			} }, journal,
		})
		const notice = {
			schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1', actor, network: intent.network,
			chainId: intent.chainId, auctionId: intent.auctionId, operationId: intent.operationId,
			role: intent.role, mintUrl, amount: 3,
			recipientCapabilityDigest: demoRecipientCapabilityDigest(request.capability),
			signatures: request.outputs.map((output, index) => ({ amount: output.amount, id: output.id, C_: compressed(String(7 + index)) })),
		}
		const imports: Array<{ operationId: string; token: string }> = []
		const wallet = {
			actor, mintUrl, seedLocation: 'indexeddb',
			async importTerminalToken(input: { operationId: string; token: string }) { imports.push(input); return { operationId: input.operationId, state: 'finalized' as const } },
		} as DemoFridayBrowserCocoWallet
		const proofs: CashuProof[] = [
			{ amount: 2, id: keyset.id, secret: 'proof-secret-2', C: compressed('9') },
			{ amount: 1, id: keyset.id, secret: 'proof-secret-1', C: compressed('8') },
		]
		const receipt = await importDemoFridayCocoTerminal({
			notice, expectedActor: actor, intent, keyset, journal, wallet,
			roleBinding: { async assertWinnerRecipient() { throw new Error('wrong role') }, async assertRefundRecipient() {} },
			unblinder: { async unblindExact(value) { expect(value.privateOpeningRefs).toEqual([{ secret: 'opening-0' }, { secret: 'opening-1' }]); return proofs } },
			verifier: { async verifyExact(value) { return value.unblindedRef } },
		})
		expect(receipt).toMatchObject({ imported: true, role: 'refund', amount: 3, proofCount: 2 })
		expect(imports).toHaveLength(1)
		expect(imports[0]!.operationId).toMatch(/^[0-9a-f]{64}$/)
		expect(imports[0]!.token).toMatch(/^cashuB/)
		const publicJson = JSON.stringify(exactDemoFridayCocoTerminalNotice(notice))
		expect(publicJson).not.toContain('proof-secret')
		expect(publicJson).not.toContain('opening-')
		expect(publicJson).not.toContain('cashuB')
	})

	test('rejects cross-actor, bearer-field, and amount substitutions before wallet import', () => {
		const base = {
			schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1', actor, network: 'friday-demo', chainId: 'friday-demo',
			auctionId: 'auction-1', operationId: 'funding-1', role: 'refund', mintUrl, amount: 1,
			recipientCapabilityDigest: 'a'.repeat(64), signatures: [{ amount: 1, id: '00deadbeef', C_: compressed('7') }],
		}
		expect(() => exactDemoFridayCocoTerminalNotice({ ...base, token: 'cashuBsecret' })).toThrow(/unexpected fields/)
		expect(() => exactDemoFridayCocoTerminalNotice({ ...base, amount: 2 })).toThrow(/differs from notice amount/)
		expect(() => exactDemoFridayCocoTerminalNotice({ ...base, actor: 'b'.repeat(63) })).toThrow(/identity/)
	})
})
