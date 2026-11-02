/**
 * Browser-owned terminal delivery for the Friday fake-money path.
 *
 * The server returns only mint blinded signatures plus public auction and
 * operation bindings.  Recipient openings and final Cashu proofs never cross
 * that boundary.  After the existing recipient-private verifier accepts the
 * unblinded proofs, this adapter imports one encoded token through Coco v2;
 * there is no parallel JSON wallet.
 */
import { getEncodedToken } from '@cashu/coco-core'

import type { DemoFridayBrowserCocoWallet } from './demo-friday-browser-coco-wallet'
import {
	acceptDemoSigAllRecipientResponse,
	type DemoRecipientBlindedSignature,
	type DemoRecipientIntent,
	type DemoRecipientKeyset,
	type DemoRecipientPrivateJournalPort,
	type DemoRecipientProofVerifierPort,
	type DemoRecipientRoleBindingPort,
	type DemoRecipientUnblindingPort,
} from './demo-sigall-recipient'
import type { DemoDispositionRole } from './demo-sigall-settlement'
import type { CashuProof } from './nut-client'

const HEX_32 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/

export interface DemoFridayCocoTerminalNoticeV1 {
	schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1'
	actor: string
	network: string
	chainId: string
	auctionId: string
	operationId: string
	role: DemoDispositionRole
	mintUrl: string
	amount: number
	recipientCapabilityDigest: string
	signatures: DemoRecipientBlindedSignature[]
}

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_COCO_TERMINAL: ${message}`) }

function exactOrigin(value: unknown): string {
	if (typeof value !== 'string') refuse('mint origin is absent')
	let url: URL
	try { url = new URL(value) } catch { return refuse('mint origin is invalid') }
	if (value !== url.origin || url.protocol !== 'https:' || url.port !== '' || url.username !== ''
		|| url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
		refuse('mint must be one exact HTTPS origin')
	}
	return url.origin
}

function exactText(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) refuse(`${label} is invalid`)
	return value
}

/** Strict public response parser. Bearer proofs/tokens/openings are impossible fields. */
export function exactDemoFridayCocoTerminalNotice(value: unknown): DemoFridayCocoTerminalNoticeV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('notice is not an object')
	const raw = value as Record<string, unknown>
	const keys = ['schema', 'actor', 'network', 'chainId', 'auctionId', 'operationId', 'role', 'mintUrl',
		'amount', 'recipientCapabilityDigest', 'signatures'].sort()
	if (JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(keys)) refuse('notice has missing or unexpected fields')
	if (raw.schema !== 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1' || !HEX_32.test(String(raw.actor))
		|| !HEX_32.test(String(raw.recipientCapabilityDigest))
		|| !['winner_settlement', 'refund'].includes(String(raw.role))
		|| !Number.isSafeInteger(raw.amount) || Number(raw.amount) < 1 || Number(raw.amount) > 50_000
		|| !Array.isArray(raw.signatures) || raw.signatures.length < 1 || raw.signatures.length > 64) {
		refuse('notice identity, role, amount, or signature list is invalid')
	}
	const signatures = raw.signatures.map((entry, index) => {
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) refuse(`signature ${index} is invalid`)
		const signature = entry as Record<string, unknown>
		const signatureKeys = signature.dleq === undefined ? ['amount', 'id', 'C_'] : ['amount', 'id', 'C_', 'dleq']
		if (JSON.stringify(Object.keys(signature).sort()) !== JSON.stringify(signatureKeys.sort())
			|| !Number.isSafeInteger(signature.amount) || Number(signature.amount) < 1
			|| typeof signature.id !== 'string' || signature.id.length < 1
			|| typeof signature.C_ !== 'string' || !/^(?:02|03)[0-9a-f]{64}$/.test(signature.C_)) {
			refuse(`signature ${index} has invalid public fields`)
		}
		let dleq: { e: string; s: string } | undefined
		if (signature.dleq !== undefined) {
			if (signature.dleq === null || typeof signature.dleq !== 'object' || Array.isArray(signature.dleq)
				|| JSON.stringify(Object.keys(signature.dleq as object).sort()) !== JSON.stringify(['e', 's'])
				|| !HEX_32.test(String((signature.dleq as Record<string, unknown>).e))
				|| !HEX_32.test(String((signature.dleq as Record<string, unknown>).s))) refuse(`signature ${index} DLEQ is invalid`)
			dleq = { e: String((signature.dleq as Record<string, unknown>).e), s: String((signature.dleq as Record<string, unknown>).s) }
		}
		return { amount: Number(signature.amount), id: signature.id, C_: signature.C_, ...(dleq === undefined ? {} : { dleq }) }
	})
	if (signatures.reduce((sum, signature) => sum + signature.amount, 0) !== Number(raw.amount)) {
		refuse('signature value differs from notice amount')
	}
	return {
		schema: raw.schema, actor: String(raw.actor), network: exactText(raw.network, 'network'),
		chainId: exactText(raw.chainId, 'chain'), auctionId: exactText(raw.auctionId, 'auction'),
		operationId: exactText(raw.operationId, 'operation'), role: raw.role as DemoDispositionRole,
		mintUrl: exactOrigin(raw.mintUrl), amount: Number(raw.amount),
		recipientCapabilityDigest: String(raw.recipientCapabilityDigest), signatures,
	}
}

export async function importDemoFridayCocoTerminal<OpeningRef, UnblindedRef>(options: {
	notice: unknown
	expectedActor: string
	intent: DemoRecipientIntent
	keyset: DemoRecipientKeyset
	roleBinding: DemoRecipientRoleBindingPort
	unblinder: DemoRecipientUnblindingPort<OpeningRef, UnblindedRef>
	verifier: DemoRecipientProofVerifierPort<UnblindedRef, CashuProof[]>
	journal: DemoRecipientPrivateJournalPort<OpeningRef>
	wallet: DemoFridayBrowserCocoWallet
}) {
	const notice = exactDemoFridayCocoTerminalNotice(options.notice)
	const intent = structuredClone(options.intent)
	if (notice.actor !== options.expectedActor || notice.actor !== options.wallet.actor
		|| notice.network !== intent.network || notice.chainId !== intent.chainId
		|| notice.auctionId !== intent.auctionId || notice.operationId !== intent.operationId
		|| notice.role !== intent.role || notice.mintUrl !== intent.mintUrl || notice.mintUrl !== options.wallet.mintUrl
		|| notice.amount !== intent.amounts.reduce((sum, amount) => sum + amount, 0)) {
		refuse('notice differs from the Nostr actor, recipient intent, or Coco wallet')
	}
	return acceptDemoSigAllRecipientResponse({
		intent, keyset: options.keyset, roleBinding: options.roleBinding,
		response: {
			schema: 'COCO_DEMO_RECIPIENT_RESPONSE_V1', operationId: notice.operationId,
			recipientCapabilityDigest: notice.recipientCapabilityDigest, signatures: notice.signatures,
		},
		unblinder: options.unblinder, verifier: options.verifier, journal: options.journal,
		wallet: {
			async importVerified(request) {
				if (!Array.isArray(request.verifiedRef) || request.verifiedRef.length < 1
					|| request.verifiedRef.reduce((sum, proof) => sum + proof.amount, 0) !== notice.amount
					|| request.verifiedRef.some((proof) => proof.id !== options.keyset.id)) {
					refuse('verified proofs differ from the exact terminal value or keyset')
				}
				const token = getEncodedToken({ mint: notice.mintUrl, proofs: request.verifiedRef, unit: 'sat' } as never)
				await options.wallet.importTerminalToken({ operationId: request.idempotencyKey, token })
			},
		},
	})
}
