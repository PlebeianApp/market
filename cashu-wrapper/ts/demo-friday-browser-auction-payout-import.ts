/** Seller-browser import for a terminal payout selected from an auction-scoped catalog. */
import { getEncodedToken } from '@cashu/coco-core'
import { hasValidDleq } from '@cashu/cashu-ts'

import type { DemoFridayBrowserCocoWallet } from './demo-friday-browser-coco-wallet'
import { exactDemoFridayCocoTerminalNotice } from './demo-friday-browser-coco-terminal'
import type { DemoFridayCocoTerminalPort } from './demo-friday-browser-coco-client'
import type { DemoFridayBrowserPaymentStatePort } from './demo-friday-browser-payment-state'
import {
	demoFridayCocoTerminalAckDigest,
	demoFridayCocoTerminalNoticeDigest,
} from './demo-friday-coco-terminal-exchange'
import {
	withDemoFridayAuctionPayoutOpenings,
	type DemoFridayAuctionPayoutWinnerClaimV1,
} from './demo-friday-auction-payout-runtime'
import {
	verifyDemoFridayAuctionPayoutSelectionStatic,
	type DemoFridayAuctionPayoutAuthorizationEnvelopeV1,
} from './demo-friday-auction-payout-authorization'
import type { DemoRecipientKeyset, DemoRecipientImportReceipt } from './demo-sigall-recipient'
import { demoRecipientCapabilityDigest } from './demo-sigall-settlement'
import {
	keysetPublicKey,
	unblindBlindedSignature,
	type BlindedSignature,
	type BlindingData,
	type CashuProof,
} from './nut-client'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_AUCTION_PAYOUT_IMPORT: ${message}`) }

export async function importDemoFridayAuctionPayoutWinner(options: {
	actor: string
	environmentId: string
	authorization: DemoFridayAuctionPayoutAuthorizationEnvelopeV1
	winner: DemoFridayAuctionPayoutWinnerClaimV1
	keyset: DemoRecipientKeyset
	state: DemoFridayBrowserPaymentStatePort
	wallet: DemoFridayBrowserCocoWallet
	terminal: DemoFridayCocoTerminalPort
}): Promise<DemoRecipientImportReceipt | null> {
	if (!HEX_32.test(options.actor) || options.wallet.actor !== options.actor
		|| options.wallet.mintUrl !== options.authorization.authorization.canonicalMintUrl
		|| options.authorization.authorization.sellerActor !== options.actor
		|| options.winner.auctionId !== options.authorization.authorization.auctionId
		|| options.winner.authorizationDigest !== options.authorization.authorizationDigest
		|| options.winner.selectionDigest !== options.winner.selection.selectionDigest) {
		refuse('seller, wallet, authorization, or winner identity differs')
	}
	const selection = verifyDemoFridayAuctionPayoutSelectionStatic(options.winner.selection, {
		authorization: options.authorization, keyset: options.keyset, observedAt: options.winner.closedAt,
	})
	const identity = { actor: options.actor, environmentId: options.environmentId,
		fundingOperationId: selection.fundingOperationId }
	const prior = await options.state.loadSellerTerminalAck(identity)
	if (prior !== null) {
		if (prior.auctionId !== selection.auctionId
			|| prior.ack.importReceipt.recipientPublicKey !== selection.recipientPublicKey) {
			refuse('persisted auction-payout acknowledgement belongs to another winner')
		}
		await options.terminal.acknowledgeExact(structuredClone(prior.ack))
		return { ...structuredClone(prior.ack.importReceipt), alreadyImported: true }
	}
	const raw = await options.terminal.readNoticeExact({ actor: options.actor,
		fundingOperationId: selection.fundingOperationId })
	if (raw === null) return null
	const notice = exactDemoFridayCocoTerminalNotice(raw)
	const capability = options.authorization.authorization.recipientCatalog.capability
	if (notice.role !== 'winner_settlement' || notice.network !== options.authorization.authorization.authNetworkId
		|| notice.chainId !== options.authorization.authorization.chainId || notice.auctionId !== selection.auctionId
		|| notice.operationId !== selection.fundingOperationId
		|| notice.mintUrl !== options.authorization.authorization.canonicalMintUrl
		|| notice.amount !== selection.bidAmount
		|| notice.recipientCapabilityDigest !== demoRecipientCapabilityDigest(capability)
		|| notice.signatures.length !== selection.outputs.length) {
		refuse('terminal notice differs from the exact catalog winner')
	}
	const proofs = await withDemoFridayAuctionPayoutOpenings({
		authorization: options.authorization, selection, keyset: options.keyset,
		observedAt: options.winner.closedAt, journal: options.state,
		async useExact(selected) {
			const values: CashuProof[] = notice.signatures.map((signature, index) => {
				const held = selected[index]
				if (held === undefined || held.output.amount !== signature.amount || held.output.id !== signature.id) {
					refuse('terminal signature order or keyset differs from the catalog selection')
				}
				const blinding: BlindingData = { secret: held.opening.secret,
					r: BigInt(`0x${held.opening.r}`), B_: held.opening.B_ }
				return unblindBlindedSignature(signature as BlindedSignature, blinding,
					keysetPublicKey(options.keyset, signature.amount))
			})
			if (values.some((proof) => !hasValidDleq(proof as never, options.keyset as never, { require: true }))) {
				refuse('catalog payout proofs failed exact mint DLEQ verification')
			}
			return values
		},
	})
	const token = getEncodedToken({ mint: notice.mintUrl, proofs, unit: 'sat' } as never)
	await options.wallet.importTerminalToken({ operationId: notice.operationId, token })
	const catalogScope = `${options.authorization.authorization.authNetworkId}\u0000${options.authorization.authorization.chainId}\u0000${selection.auctionId}\u0000${options.authorization.authorization.catalogOperationId}`
	const catalogRecord = await options.state.load(catalogScope)
	if (catalogRecord === null) refuse('catalog journal disappeared after verified import')
	await options.state.markImported(catalogScope, catalogRecord.requestDigest,
		demoFridayCocoTerminalNoticeDigest(notice))
	const receipt = {
		schema: 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1' as const,
		operationId: notice.operationId, role: 'winner_settlement' as const,
		recipientPublicKey: selection.recipientPublicKey, amount: notice.amount,
		proofCount: proofs.length, imported: true as const,
	}
	const noticeDigest = demoFridayCocoTerminalNoticeDigest(notice)
	const ackDigest = demoFridayCocoTerminalAckDigest(noticeDigest, receipt)
	const signature = await options.wallet.sellerRecipientKey.signTerminalAck({ digest: ackDigest,
		recipientPublicKey: selection.recipientPublicKey, operationId: notice.operationId, role: 'winner_settlement' })
	if (!HEX_64.test(signature)) refuse('recipient acknowledgement signature is malformed')
	const ack = { schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1' as const,
		actor: options.actor, fundingOperationId: notice.operationId, noticeDigest,
		importReceipt: receipt, recipientAckSignature: signature }
	await options.state.saveSellerTerminalAck({
		schema: 'PLEBEIAN_FRIDAY_SELLER_TERMINAL_ACK_RECORD_V1', actor: options.actor,
		environmentId: options.environmentId, auctionId: selection.auctionId,
		fundingOperationId: notice.operationId, ack,
	})
	await options.terminal.acknowledgeExact(ack)
	return { ...receipt, alreadyImported: false }
}
