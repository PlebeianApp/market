/**
 * Concrete composition of the R7 maintainer federation with four authenticated process transports
 * and the separate threshold-three Rust participant/aggregator executable.
 */
import {
	createDemoMaintainerProcessFederationParticipantPort,
	createDemoThreeOfFourMaintainerFederationPort,
	type DemoMaintainerFederationPort,
	type DemoMaintainerFederationRequest,
} from './demo-maintainer-federation'
import type {
	DemoIntegratedAuthorityClaim,
	DemoIntegratedAuthorityStore,
	DemoIntegratedExecutionRootBindingV1,
} from './demo-integrated-authority'
import {
	demoIntegratedExecutionRootBindingDigest,
	demoIntegratedProofPoolDigest,
} from './demo-integrated-authority'
import { demoFrostProcessRosterDigest, type DemoFrostProcessParticipant, type DemoFrostProcessRoundOneRequest } from './demo-frost-process-boundary'
import { demoFrostParticipantPolicyDigest, type DemoFrostParticipantPolicyPackage } from './demo-frost-participant-policy'
import { createDemoThreshold3SeparatedProcessPorts } from './demo-frost-threshold3-process-boundary'
import { createDemoFrostThreshold3RustAggregatePort } from './demo-frost-threshold3-rust-aggregate'
import { demoFrostThreshold3AuthorizationForRequest } from './demo-frost-threshold3-rust-participant-worker'
import { demoOutputsDigest } from './demo-sigall-settlement'

type Four<T> = [T, T, T, T]

export interface DemoMaintainerThreshold3ProcessOptions {
	request: DemoMaintainerFederationRequest
	policy: DemoFrostParticipantPolicyPackage
	authorityClaim: DemoIntegratedAuthorityClaim
	authorityStore: DemoIntegratedAuthorityStore
	participants: Four<DemoFrostProcessParticipant>
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	binaryPath: string
	publicKeyPackagePath: string
	scratchParent: string
	processTimeoutMs: number
	federationTimeoutMs?: number
	/** Test seam only. Production must omit this and invoke the pinned Rust executable. */
	aggregateRunCommand?: (command: string[]) => Promise<void>
}

export interface DemoMaintainerThreshold3ProcessComposition {
	federation: DemoMaintainerFederationPort
	executionBinding: DemoIntegratedExecutionRootBindingV1
}

export async function createDemoMaintainerThreshold3ProcessComposition(
	options: DemoMaintainerThreshold3ProcessOptions,
): Promise<DemoMaintainerThreshold3ProcessComposition> {
	const request = structuredClone(options.request)
	const policy = structuredClone(options.policy)
	const claim = structuredClone(options.authorityClaim)
	const policyPackageDigest = demoFrostParticipantPolicyDigest(policy)
	if (request.threshold !== 3 || request.packageDigest !== policy.packageDigest
		|| request.cashuSigAllDigest !== policy.cashuSigAllDigest || request.policyPackageDigest !== policyPackageDigest) {
		throw new Error('DEMO_MAINTAINER_T3_COMPOSITION: request differs from exact participant policy')
	}
	if (claim.operationId !== policy.operationId || claim.admissionOperationId !== policy.operationId
		|| claim.operationRoot !== claim.templateDigest || claim.templateDigest !== request.packageDigest
		|| policy.role !== 'refund' || claim.network !== policy.network || claim.chainId !== policy.chainId
		|| claim.auctionId !== policy.auctionId || claim.displacedBidId !== policy.bidId
		|| claim.poolAmount !== policy.amount || claim.outputsDigest !== demoOutputsDigest(policy.outputs)
		|| JSON.stringify(claim.proofStateRefs) !== JSON.stringify(policy.deposits.map(({ proofStateRef }) => proofStateRef).sort())
		|| claim.cashuSigAllDigest !== request.cashuSigAllDigest
		|| claim.committeeKeysetId !== request.committeeKeysetId
		|| claim.committeeKeysetVersion !== request.committeeKeysetVersion
		|| claim.dkgRunId !== options.dkgRunId
		|| claim.publicKeyPackageSha256 !== options.publicKeyPackageSha256
		|| claim.signerRosterDigest !== options.signerRosterDigest) {
		throw new Error('DEMO_MAINTAINER_T3_AUTHORITY: process request differs from durable admission authority')
	}
	const processPorts = createDemoThreshold3SeparatedProcessPorts({
		committeeKeysetId: request.committeeKeysetId,
		committeeKeysetVersion: request.committeeKeysetVersion,
		requestTimeoutMs: options.processTimeoutMs,
		policy,
		participants: options.participants,
	})
	const federationParticipants = processPorts.map(createDemoMaintainerProcessFederationParticipantPort)
	const first = options.participants[0].enrollment
	const processRosterDigest = demoFrostProcessRosterDigest(options.participants.map((value) => value.enrollment))
	const processRequest: DemoFrostProcessRoundOneRequest = {
		schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_REQUEST_V1',
		binding: {
			schema: 'COCO_DEMO_FROST_PROCESS_BINDING_V1',
			participantId: first.participantId,
			processIdentity: first.processIdentity,
			committeeKeysetId: request.committeeKeysetId,
			committeeKeysetVersion: request.committeeKeysetVersion,
			rosterDigest: processRosterDigest,
			policyPackageDigest,
			sessionId: request.sessionId,
			packageDigest: request.packageDigest,
			digest: request.cashuSigAllDigest,
		},
		policy,
	}
	const authorization = demoFrostThreshold3AuthorizationForRequest({
		dkgRunId: options.dkgRunId,
		publicKeyPackageSha256: options.publicKeyPackageSha256,
	}, processRequest)
	const aggregate = createDemoFrostThreshold3RustAggregatePort({
		binaryPath: options.binaryPath,
		publicKeyPackagePath: options.publicKeyPackagePath,
		scratchParent: options.scratchParent,
		authorization,
		...(options.aggregateRunCommand === undefined ? {} : { runCommand: options.aggregateRunCommand }),
	})
	const stableBinding: Omit<DemoIntegratedExecutionRootBindingV1, 'bindingDigest'> = {
		schema: 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V1', operationId: claim.operationId,
		authorityOperationRoot: claim.operationRoot, frostOperationRoot: authorization.operation_root,
		network: claim.network, chainId: claim.chainId, auctionId: claim.auctionId,
		displacedBidId: claim.displacedBidId, replacementBidId: claim.replacementBidId,
		displacementHeight: claim.displacementHeight,
		templateDigest: claim.templateDigest, cashuSigAllDigest: claim.cashuSigAllDigest,
		outputsDigest: claim.outputsDigest, proofPoolDigest: demoIntegratedProofPoolDigest(claim.proofStateRefs),
		poolAmount: claim.poolAmount, admissionReceiptDigest: claim.admissionReceiptDigest,
		committeeKeysetId: claim.committeeKeysetId, committeeKeysetVersion: claim.committeeKeysetVersion,
		dkgRunId: claim.dkgRunId,
		publicKeyPackageSha256: claim.publicKeyPackageSha256, signerRosterDigest: claim.signerRosterDigest,
		processRosterDigest, policyPackageDigest,
	}
	const executionBinding: DemoIntegratedExecutionRootBindingV1 = {
		...stableBinding, bindingDigest: demoIntegratedExecutionRootBindingDigest(stableBinding),
	}
	const stored = await options.authorityStore.bindExecutionRoot(executionBinding)
	if (JSON.stringify(stored.binding) !== JSON.stringify(executionBinding)) {
		throw new Error('DEMO_MAINTAINER_T3_AUTHORITY: durable execution-root mapping conflicts')
	}
	const baseFederation = createDemoThreeOfFourMaintainerFederationPort(
		federationParticipants,
		aggregate,
		{ roundTimeoutMs: options.federationTimeoutMs },
	)
	const authorize: DemoMaintainerFederationPort['authorize'] = async (request, callOptions) => {
		const result = callOptions === undefined
			? await baseFederation.authorize(request)
			: await baseFederation.authorize(request, callOptions)
		return { ...result, frostOperationRoot: authorization.operation_root }
	}
	const federation: DemoMaintainerFederationPort = Object.freeze({ authorize })
	return { federation, executionBinding }
}

export async function createDemoMaintainerThreshold3ProcessPort(
	options: DemoMaintainerThreshold3ProcessOptions,
): Promise<DemoMaintainerFederationPort> {
	return (await createDemoMaintainerThreshold3ProcessComposition(options)).federation
}
