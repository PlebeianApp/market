/**
 * End-to-end composition for one certified demo disposition.
 *
 * This bidder-wallet-local module owns no secret or bearer persistence, but it transiently receives
 * bearer Cashu inputs through the immutable contract. It must never run in a public coordinator,
 * browser UI or seller service, and none of its public ports expose proof secrets. A separately
 * constructed participant transport may disclose exact locked proof tuples only to the four
 * authenticated validators under the fake-Testnut approval. It first asks an injected authenticated
 * auction boundary to certify the exact public disposition. It then uses `executeDemoSigAllSwap`, replacing
 * its mint port with the durable exact-request state machine. Finally it delivers the blinded mint
 * response to the recipient-private importer. On a terminal replay the durable mint adapter performs
 * only read-only exact-response restoration; it never submits the swap again.
 *
 * The committee service is also a restart boundary. Recovery identity excludes the Schnorr witness
 * because a fresh FROST run can produce a different valid witness for the same immutable package and
 * Cashu SIG_ALL digest; all bearer inputs, outputs, locktime, and recipient bindings remain exact.
 */
import {
	demoCashuSigAllDigest,
	demoDenominationKeyDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	demoSigAllRefundPublicKey,
	demoSigAllPackageDigest,
	DemoSigAllRefusedError,
	executeDemoSigAllSwap,
	type DemoFourOfFourCommitteePort,
	type DemoOperationRootGate,
	type DemoSigAllContract,
	type DemoSigAllMintPort,
} from './demo-sigall-settlement'
import {
	demoSigAllResponseDigest,
	readDemoSigAllTerminal,
	restoreDemoSigAllTerminalByIdentity,
	restoreDemoSigAllTerminalResponse,
	submitDemoSigAllSwap,
	type DemoSigAllRecoveryStore,
	type DemoSigAllTerminalMetadata,
	type DemoSigAllTerminalResponsePort,
} from './demo-sigall-recovery'
import {
	acceptDemoSigAllRecipientResponse,
	type DemoRecipientImportReceipt,
	type DemoRecipientIntent,
	type DemoRecipientKeyset,
	type DemoRecipientPrivateJournalPort,
	type DemoRecipientProofVerifierPort,
	type DemoRecipientRoleBinding,
	type DemoRecipientRoleBindingPort,
	type DemoRecipientUnblindingPort,
	type DemoRecipientWalletPort,
} from './demo-sigall-recipient'
import { bytesToHex } from '@noble/hashes/utils.js'
import { parseP2PKSecret, proofPoint } from './nut-client'

export interface DemoCertifiedDispositionAssertion {
	schema: 'COCO_DEMO_CERTIFIED_DISPOSITION_ASSERTION_V1'
	network: string
	chainId: string
	auctionId: string
	operationId: string
	bidId: string
	bidEventId: string
	bidderActorId: string
	role: DemoSigAllContract['role']
	outcomeHeight: number
	appStateHash: string
	amount: number
	locktime: number
	proofStateRefs: string[]
	recipientPublicKey: string
	bidderPublicKey: string
	refundPublicKey: string
	sellerP2pkXpub: string
	packageDigest: string
	cashuSigAllDigest: string
	recipientCapabilityDigest: string
	outputsDigest: string
}

/**
 * Authenticated closure boundary. A live implementation must verify the consensus certificate,
 * complete committed-bid history, final height/end-time rules, and winner/loser disposition.
 */
export interface DemoCertifiedDispositionAssertionPort {
	assertCertifiedDisposition(assertion: DemoCertifiedDispositionAssertion): Promise<void>
}

export interface DemoSigAllDispositionResult {
	schema: 'COCO_DEMO_SIGALL_DISPOSITION_RESULT_V1'
	deliverySource: 'submitted' | 'terminal_restore' | 'gate_replay'
	terminal: DemoSigAllTerminalMetadata
	recipient: DemoRecipientImportReceipt
}

export class DemoSigAllDispositionRefusedError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoSigAllDispositionRefusedError'
		this.code = code
	}
}

function refuse(code: string, message: string): never {
	throw new DemoSigAllDispositionRefusedError(code, message)
}

function scopeFor(contract: DemoSigAllContract): string {
	return `${contract.network}\u0000${contract.chainId}\u0000${contract.auctionId}\u0000${contract.operationId}`
}

function roleBindingFor(contract: DemoSigAllContract): DemoRecipientRoleBinding {
	return {
		network: contract.network,
		chainId: contract.chainId,
		auctionId: contract.auctionId,
		operationId: contract.operationId,
		role: contract.role,
		recipientPublicKey: contract.recipientPublicKey,
	}
}

async function assertRecipientRole(port: DemoRecipientRoleBindingPort, contract: DemoSigAllContract): Promise<void> {
	const binding = roleBindingFor(contract)
	if (contract.role === 'winner_settlement') await port.assertWinnerRecipient(binding)
	else await port.assertRefundRecipient(binding)
}

function assertRecipientIntent(contract: DemoSigAllContract, intent: DemoRecipientIntent, keyset: DemoRecipientKeyset): void {
	if (contract.unit !== 'sat' || intent.unit !== 'sat' || keyset.unit !== 'sat') {
		refuse('DEMO_DISPOSITION_RECIPIENT_UNIT', 'contract, recipient intent, and recipient keyset must use sat')
	}
	const exactFields = ['network', 'chainId', 'auctionId', 'operationId', 'role', 'mintUrl', 'unit', 'recipientPublicKey'] as const
	for (const field of exactFields) {
		if (intent[field] !== contract[field]) refuse('DEMO_DISPOSITION_RECIPIENT_SCOPE', `recipient intent ${field} differs from the certified contract`)
	}
	if (keyset.id !== contract.mintSeal.activeSatKeysetId || keyset.unit !== contract.unit) {
		refuse('DEMO_DISPOSITION_RECIPIENT_KEYSET', 'recipient keyset differs from the bidder-approved active keyset')
	}
	const keyAmounts = Object.keys(keyset.keys).map(Number).sort((left, right) => left - right)
	if (
		demoDenominationKeyDigest(keyset.keys) !== contract.mintSeal.denominationKeyDigest
		|| JSON.stringify(keyAmounts) !== JSON.stringify(contract.mintSeal.denominationAmounts)
	) {
		refuse('DEMO_DISPOSITION_RECIPIENT_KEYSET', 'recipient denomination keys differ from the bidder-approved mint seal')
	}
	const amounts = contract.outputs.map((output) => output.amount)
	if (JSON.stringify(intent.amounts) !== JSON.stringify(amounts)) {
		refuse('DEMO_DISPOSITION_RECIPIENT_AMOUNTS', 'recipient denominations differ from the exact contract outputs')
	}
	if (contract.outputs.some((output) => output.id !== keyset.id)) {
		refuse('DEMO_DISPOSITION_RECIPIENT_KEYSET', 'contract output keyset differs from the recipient keyset')
	}
}

async function assertPreparedRecipient<OpeningRef>(
	contract: DemoSigAllContract,
	journal: DemoRecipientPrivateJournalPort<OpeningRef>,
): Promise<void> {
	const record = await journal.load(scopeFor(contract))
	if (record === null) refuse('DEMO_DISPOSITION_RECIPIENT_NOT_PREPARED', 'recipient-private outputs must be durably prepared before authorization')
	if (
		JSON.stringify(record.coordinatorRequest.capability) !== JSON.stringify(contract.recipientCapability) ||
		JSON.stringify(record.coordinatorRequest.outputs) !== JSON.stringify(contract.outputs)
	) refuse('DEMO_DISPOSITION_RECIPIENT_CONFLICT', 'recipient-private public request differs from the certified contract')
	if (record.privateOpeningRefs.length !== contract.outputs.length) {
		refuse('DEMO_DISPOSITION_RECIPIENT_CONFLICT', 'recipient-private opening count differs from the exact outputs')
	}
}

function certifiedAssertion(contract: DemoSigAllContract, proofStateRefs: string[]): DemoCertifiedDispositionAssertion {
	const parsed = parseP2PKSecret(contract.inputs[0]?.secret ?? '')
	const locktime = Number(parsed?.tags.find(([name]) => name === 'locktime')?.[1])
	if (!Number.isSafeInteger(locktime) || locktime <= 0) {
		refuse('DEMO_DISPOSITION_LOCKTIME', 'contract inputs must bind a positive bidder-refund locktime')
	}
	return {
		schema: 'COCO_DEMO_CERTIFIED_DISPOSITION_ASSERTION_V1',
		network: contract.network,
		chainId: contract.chainId,
		auctionId: contract.auctionId,
		operationId: contract.operationId,
		bidId: contract.bidId,
		bidEventId: contract.bidEventId,
		bidderActorId: contract.bidderActorId,
		role: contract.role,
		outcomeHeight: contract.outcomeHeight,
		appStateHash: contract.appStateHash,
		amount: contract.amount,
		locktime,
		proofStateRefs: [...proofStateRefs].sort(),
		recipientPublicKey: contract.recipientPublicKey,
		bidderPublicKey: contract.bidderPublicKey,
		refundPublicKey: demoSigAllRefundPublicKey(contract),
		sellerP2pkXpub: contract.sellerP2pkXpub,
		packageDigest: demoSigAllPackageDigest(contract),
		cashuSigAllDigest: demoCashuSigAllDigest(contract.inputs, contract.outputs),
		recipientCapabilityDigest: demoRecipientCapabilityDigest(contract.recipientCapability),
		outputsDigest: demoOutputsDigest(contract.outputs),
	}
}

/**
 * Execute and import one disposition. All generic values remain behind recipient-private ports;
 * this function returns only a sanitized import receipt and terminal metadata.
 */
export async function executeDemoSigAllDisposition<OpeningRef, UnblindedRef, VerifiedRef>(options: {
	contract: DemoSigAllContract
	certifiedDisposition: DemoCertifiedDispositionAssertionPort
	committee: DemoFourOfFourCommitteePort
	operationGate: DemoOperationRootGate
	mint: DemoSigAllMintPort
	recoveryStore: DemoSigAllRecoveryStore
	terminalResponse: DemoSigAllTerminalResponsePort
	proofStateRefs: string[]
	recipient: {
		intent: DemoRecipientIntent
		keyset: DemoRecipientKeyset
		roleBinding: DemoRecipientRoleBindingPort
		unblinder: DemoRecipientUnblindingPort<OpeningRef, UnblindedRef>
		verifier: DemoRecipientProofVerifierPort<UnblindedRef, VerifiedRef>
		wallet: DemoRecipientWalletPort<VerifiedRef>
		journal: DemoRecipientPrivateJournalPort<OpeningRef>
	}
	now?: () => number
	nowSeconds?: () => number
}): Promise<DemoSigAllDispositionResult> {
	let contract: DemoSigAllContract
	let recipientIntent: DemoRecipientIntent
	let recipientKeyset: DemoRecipientKeyset
	try {
		contract = structuredClone(options.contract)
		recipientIntent = structuredClone(options.recipient.intent)
		recipientKeyset = structuredClone(options.recipient.keyset)
	} catch {
		return refuse('DEMO_DISPOSITION_NOT_CLONEABLE', 'contract and recipient public values must be immutable cloneable data')
	}
	// Snapshot every port reference and public recovery identifier before the first await. A caller
	// cannot swap contract B or a different recipient journal while closure certificate A is checked.
	const certifiedDisposition = options.certifiedDisposition
	const committee = options.committee
	const operationGate = options.operationGate
	const mint = options.mint
	const recoveryStore = options.recoveryStore
	const terminalResponse = options.terminalResponse
	const proofStateRefs = [...options.proofStateRefs]
	let expectedProofStateRefs: string[]
	try {
		expectedProofStateRefs = contract.inputs.map((input) => bytesToHex(proofPoint(input).toBytes(true)))
	} catch {
		return refuse('DEMO_DISPOSITION_PROOF_STATE_REFS', 'contract inputs cannot produce exact NUT-07 proof references')
	}
	if (JSON.stringify(proofStateRefs) !== JSON.stringify(expectedProofStateRefs)) {
		refuse('DEMO_DISPOSITION_PROOF_STATE_REFS', 'proof-state references do not identify the exact contract inputs in order')
	}
	const recipientPorts = {
		intent: recipientIntent,
		keyset: recipientKeyset,
		roleBinding: options.recipient.roleBinding,
		unblinder: options.recipient.unblinder,
		verifier: options.recipient.verifier,
		wallet: options.recipient.wallet,
		journal: options.recipient.journal,
	}
	assertRecipientIntent(contract, recipientIntent, recipientKeyset)
	const assertion = certifiedAssertion(contract, proofStateRefs)
	// This is intentionally the first authorization call. Committee/FROST must not run unless the
	// authenticated auction boundary accepts this exact disposition.
	await certifiedDisposition.assertCertifiedDisposition(structuredClone(assertion))
	await assertRecipientRole(recipientPorts.roleBinding, contract)
	await assertPreparedRecipient(contract, recipientPorts.journal)

	const scope = scopeFor(contract)
	let durableResult: {
		deliverySource: DemoSigAllDispositionResult['deliverySource']
		terminal: DemoSigAllTerminalMetadata
	} | undefined
	const durableMint: DemoSigAllMintPort = {
		async swapExact(request) {
			const value = {
				scope,
				operationRoot: request.packageDigest,
				request,
				proofStateRefs,
			}
			const submitted = await submitDemoSigAllSwap({
				store: recoveryStore,
				mint,
				value,
				now: options.now,
				nowSeconds: options.nowSeconds,
			})
			if (submitted.status === 'submitted') {
				durableResult = { deliverySource: 'submitted', terminal: submitted.terminal }
				return { signatures: submitted.signatures }
			}
			const signatures = await restoreDemoSigAllTerminalResponse({
				store: recoveryStore,
				recovery: terminalResponse,
				value,
				now: options.now,
			})
			durableResult = { deliverySource: 'terminal_restore', terminal: submitted.terminal }
			return { signatures }
		},
	}

	let swap: { signatures: Awaited<ReturnType<DemoSigAllMintPort['swapExact']>>['signatures'] }
	const alreadyTerminal = await readDemoSigAllTerminal({
		store: recoveryStore,
		scope,
		operationRoot: assertion.packageDigest,
	})
	if (alreadyTerminal !== null) {
		const restored = await restoreDemoSigAllTerminalByIdentity({
			store: recoveryStore,
			recovery: terminalResponse,
			scope,
			operationRoot: assertion.packageDigest,
		})
		swap = { signatures: restored.signatures }
		durableResult = { deliverySource: 'terminal_restore', terminal: restored.terminal }
	} else {
		try {
			swap = await executeDemoSigAllSwap({
				contract,
				committee,
				mint: durableMint,
				operationGate,
				nowSeconds: options.nowSeconds,
			})
		} catch (error) {
			// A concurrent pre-cutoff submit may have terminalized immediately before this wallet
			// observed the settlement cutoff. Permit only the same read-only exact terminal restore.
			if (!(error instanceof DemoSigAllRefusedError) || error.code !== 'DEMO_SIGALL_SETTLEMENT_CUTOFF') throw error
			const restored = await restoreDemoSigAllTerminalByIdentity({
				store: recoveryStore,
				recovery: terminalResponse,
				scope,
				operationRoot: assertion.packageDigest,
			})
			swap = { signatures: restored.signatures }
			durableResult = { deliverySource: 'terminal_restore', terminal: restored.terminal }
		}
	}
	if (durableResult === undefined) {
		// A conforming operation gate may replay its prior successful result without invoking the
		// callback. Accept that only when the durable recovery authority independently has the same
		// succeeded root and exact blinded-response digest.
		const terminal = await readDemoSigAllTerminal({
			store: recoveryStore,
			scope,
			operationRoot: assertion.packageDigest,
		})
		if (terminal === null || demoSigAllResponseDigest(swap.signatures) !== terminal.responseDigest) {
			refuse('DEMO_DISPOSITION_DURABLE_MINT_BYPASSED', 'operation gate replay is not backed by the exact durable terminal response')
		}
		durableResult = { deliverySource: 'gate_replay', terminal }
	}
	const recipientReceipt = await acceptDemoSigAllRecipientResponse({
		intent: recipientIntent,
		keyset: recipientKeyset,
		response: {
			schema: 'COCO_DEMO_RECIPIENT_RESPONSE_V1',
			operationId: contract.operationId,
			recipientCapabilityDigest: assertion.recipientCapabilityDigest,
			signatures: swap.signatures.map((signature) => ({
				amount: signature.amount,
				id: signature.id,
				C_: signature.C_,
				dleq: signature.dleq === undefined ? undefined : { e: signature.dleq.e, s: signature.dleq.s },
			})),
		},
		roleBinding: recipientPorts.roleBinding,
		unblinder: recipientPorts.unblinder,
		verifier: recipientPorts.verifier,
		wallet: recipientPorts.wallet,
		journal: recipientPorts.journal,
	})
	return {
		schema: 'COCO_DEMO_SIGALL_DISPOSITION_RESULT_V1',
		deliverySource: durableResult.deliverySource,
		terminal: durableResult.terminal,
		recipient: recipientReceipt,
	}
}
