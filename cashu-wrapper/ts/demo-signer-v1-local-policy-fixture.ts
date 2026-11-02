import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { HDKey } from '@scure/bip32'
import { demoIntegratedFundingBundleDigest, prepareDemoIntegratedFundingReceipt, type DemoIntegratedFundingReceiptTerms } from './demo-integrated-funding-receipt'
import { demoMaintainerExactTemplateDigest, demoMaintainerTemplateBundleDigest, type DemoMaintainerExactBranchTemplate, type DemoMaintainerExactTemplateBundle } from './demo-maintainer-offline'
import { buildDemoSigAllSecret, demoCashuSigAllDigest, demoOutputsDigest, demoRecipientCapabilityDigest } from './demo-sigall-settlement'
import { proofPoint, type BlindedMessage, type CashuProof } from './nut-client'
const scalar = (value: number): string => value.toString(16).padStart(64, '0')
const publicKey = (value: number): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(scalar(value)), true))
const sign = (digest: string, value: number): string => bytesToHex(schnorr.sign(hexToBytes(digest), hexToBytes(scalar(value))))
const digest = (value: string): string => value.repeat(64)

function branch(role: 'winner_settlement' | 'refund'): DemoMaintainerExactBranchTemplate {
	const bidderPublicKey = publicKey(1), committeePublicKey = publicKey(3), refundPublicKey = publicKey(4)
	const inputs: CashuProof[] = [4, 8].map((amount, index) => ({
		amount, id: 'keyset-1', C: publicKey(30 + index),
		secret: buildDemoSigAllSecret({ nonce: `${index + 1}`.padStart(64, '0'), bidderPublicKey, committeePublicKey, refundPublicKey, locktime: 2_700 }),
	}))
	const outputs: BlindedMessage[] = role === 'refund'
		? [{ amount: 12, id: 'keyset-1', B_: publicKey(42) }]
		: [{ amount: 4, id: 'keyset-1', B_: publicKey(40) }, { amount: 8, id: 'keyset-1', B_: publicKey(41) }]
	const seller = HDKey.fromMasterSeed(new Uint8Array(32).fill(0x42))
	const path = 'm/1/2/3/4/5'
	const sellerPrivate = bytesToHex(seller.derive(path).privateKey!)
	const exactRecipientPublicKey = role === 'refund'
		? refundPublicKey
		: bytesToHex(secp256k1.getPublicKey(hexToBytes(sellerPrivate), true))
	const recipientSecret = role === 'refund' ? 4 : null
	const capabilityBase = {
		schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const, network: digest('a'), chainId: 'demo-chain', auctionId: 'auction-1',
		operationId: digest('f'), role, mintUrl: 'http://127.0.0.1:3338', unit: 'sat' as const,
		recipientPublicKey: exactRecipientPublicKey, outputsDigest: demoOutputsDigest(outputs), signature: '00'.repeat(64),
	}
	const recipientSignature = recipientSecret === null
		? bytesToHex(schnorr.sign(hexToBytes(demoRecipientCapabilityDigest(capabilityBase)), hexToBytes(sellerPrivate)))
		: sign(demoRecipientCapabilityDigest(capabilityBase), recipientSecret)
	const cashuSigAllDigest = demoCashuSigAllDigest(inputs, outputs)
	const value: DemoMaintainerExactBranchTemplate = {
		schema: 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V1', role, network: capabilityBase.network, chainId: capabilityBase.chainId,
		// Exact spend branches are prepared before the final Nostr event exists.
		// These two legacy-named slots carry the stable pre-commit funding intent;
		// authenticated Comet history later binds it to the concrete event id.
		auctionId: capabilityBase.auctionId, operationId: capabilityBase.operationId,
		bidId: capabilityBase.operationId, bidEventId: capabilityBase.operationId,
		bidderActorId: publicKey(2).slice(2), amount: 12, inputFee: 0, mintUrl: capabilityBase.mintUrl, unit: 'sat',
		locktime: 2_700, validUntil: 2_000, closeTime: 1_900, settlementWindowSeconds: 500,
		sellerP2pkXpub: seller.publicExtendedKey, bidderDerivationPath: path, recipientPublicKey: exactRecipientPublicKey,
		bidderPublicKey, refundPublicKey, committeePublicKey, committeeKeysetId: 'committee-1', committeeKeysetVersion: '1',
		threshold: 3, participants: [1, 2, 3, 4].map((identifier) => ({ identifier: identifier as 1 | 2 | 3 | 4, verifyingShare: publicKey(10 + identifier) })),
		mintSeal: { mintUrl: capabilityBase.mintUrl, mintPublicKey: publicKey(80), serverVersion: 'Nutshell/0.19.2', activeSatKeysetId: 'keyset-1', denominationKeyDigest: digest('c'), denominationAmounts: [1, 2, 4, 8, 12], inputFeePpk: 0, nuts: [4, 7, 9, 10, 11] },
		inputs, outputs, recipientCapability: { ...capabilityBase, signature: recipientSignature }, templateDigest: digest('0'),
		cashuSigAllDigest, bidderMainSignature: sign(cashuSigAllDigest, 1),
		...(role === 'refund' ? { refundSignature: sign(cashuSigAllDigest, 4) } : {}),
	}
	value.templateDigest = demoMaintainerExactTemplateDigest(value)
	return value
}

export function demoSignerV1PolicyFixture(directSeller = false) {
	const winner = branch('winner_settlement'), refund = branch('refund')
	const bundle: DemoMaintainerExactTemplateBundle = {
		schema: 'COCO_DEMO_MAINTAINER_TEMPLATE_BUNDLE_V1', preparedAt: 1_000, winner, refund,
		actorWinnerAuthorization: {
			actorId: winner.bidderActorId, packageDigest: winner.templateDigest,
			signature: sign(winner.templateDigest, 2),
		},
		actorReturnAuthorization: {
			actorId: winner.bidderActorId, packageDigest: refund.templateDigest,
			signature: sign(refund.templateDigest, 2),
		},
		bundleDigest: digest('0'), actorBundleSignature: '00'.repeat(64), bidderBundleSignature: '00'.repeat(64),
	}
	bundle.bundleDigest = demoMaintainerTemplateBundleDigest(bundle)
	bundle.actorBundleSignature = sign(bundle.bundleDigest, 2)
	bundle.bidderBundleSignature = sign(bundle.bundleDigest, 1)
	if (directSeller) {
		const sellerPaymentPublicKey = winner.recipientPublicKey
		for (const template of [bundle.winner, bundle.refund]) {
			template.schema = 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V2'
			delete template.sellerP2pkXpub
			delete template.bidderDerivationPath
			template.sellerPaymentPublicKey = sellerPaymentPublicKey
			template.templateDigest = demoMaintainerExactTemplateDigest(template)
		}
		bundle.actorWinnerAuthorization = {
			schema: 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1',
			paymentPublicKey: winner.bidderPublicKey, packageDigest: winner.templateDigest,
			signature: sign(winner.templateDigest, 1),
		}
		bundle.actorReturnAuthorization = {
			schema: 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1',
			paymentPublicKey: winner.bidderPublicKey, packageDigest: refund.templateDigest,
			signature: sign(refund.templateDigest, 1),
		}
		bundle.bundleDigest = demoMaintainerTemplateBundleDigest(bundle)
		bundle.actorBundleSignature = sign(bundle.bundleDigest, 1)
		bundle.bidderBundleSignature = sign(bundle.bundleDigest, 1)
	}
	const refs = winner.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
	const terms: DemoIntegratedFundingReceiptTerms = {
		schema: 'PlebeianAuctionsPOCIntegratedFundingV3', auth_network_id: winner.network, chain_id: winner.chainId,
		mint_url: winner.mintUrl, auction_id: winner.auctionId,
		bidder: winner.bidderActorId, bid_amount: 12, pool_amount: 12, replaces_bid_id: '', funding_operation_id: winner.operationId,
		attested_at: 1_001, expires_at: 1_201, proof_state_refs: refs, active_keyset_id: 'keyset-1', input_fee_ppk: 0,
		locktime: winner.locktime, bidder_public_key: winner.bidderPublicKey, refund_public_key: winner.refundPublicKey,
		committee_public_key: winner.committeePublicKey, committee_keyset_id: winner.committeeKeysetId,
		committee_keyset_version: winner.committeeKeysetVersion, dkg_run_id: 'dkg-run-1',
		public_key_package_sha256: digest('d'), signer_roster_digest: digest('e'), winner_package_digest: winner.templateDigest,
		return_package_digest: refund.templateDigest, return_cashu_sigall_digest: refund.cashuSigAllDigest,
		bidder_return_signature: refund.bidderMainSignature,
	}
	const receipt = prepareDemoIntegratedFundingReceipt(terms, sign(demoIntegratedFundingBundleDigest(terms), 2))
	return { bundle, receipt, refs }
}

