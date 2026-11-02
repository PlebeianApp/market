export { CocoWalletHost, defineWalletApplicationAdapter } from './host'
export { CocoRuntimeStateError, engineOverManager, openCocoRuntime, runtimeOverManager } from './coco-runtime'
export type { CocoPlugin, CocoRepositories, CocoRuntimeOptions } from './coco-runtime'
export { createCocoRail, createOriginBoundMintFetch, RailRefusedError } from './coco-rail'
export type { CocoRailPort, LockKeypair, RailResult, AuctionLockTarget, CocoMintSnapshot, CocoMintQuoteRef, CocoMintOperationRef } from './coco-rail'
export { lockedMaterialFromToken } from './locked-material'
export type { LockedMaterial } from './locked-material'
export { createDemoLockEvidenceReader } from './demo-lock-evidence'
export type { DemoLockEvidence, DemoEvidenceKeyset, DemoLockEvidencePorts, DemoEvidenceProof, DemoLockEvidenceRequest } from './demo-lock-evidence'
export {
	buildDemoSigAllSecret,
	createCashuMintSigAllPort,
	createFourOfFourCommitteePort,
	demoCashuSigAllDigest,
	demoCashuSigAllSource,
	demoDenominationKeyDigest,
	demoFrostTranscriptHash,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	demoSigAllRefundPublicKey,
	demoSigAllPackageDigest,
	executeDemoSigAllSwap,
	DemoSigAllRefusedError,
} from './demo-sigall-settlement'
export type {
	DemoBidderApproval,
	DemoCommitteeAuthorization,
	DemoCommitteeAuthorizationRequest,
	DemoCommitteeParticipant,
	DemoCommitteePort,
	DemoDispositionRole,
	DemoFrostAggregatePort,
	DemoFrostParticipantPort,
	DemoFourOfFourCommitteePort,
	DemoMintCapabilitySeal,
	DemoOperationRootGate,
	DemoParticipantId,
	DemoRecipientCapability,
	DemoRoundOneCommitment,
	DemoRoundOneRequest,
	DemoRoundTwoRequest,
	DemoSigAllContract,
	DemoSigAllMintPort,
	DemoSigAllSwapRequest,
	DemoSignatureShare,
} from './demo-sigall-settlement'
export * from './demo-sigall-funding'
export * from './demo-sigall-recipient'
export * from './demo-sigall-recovery'
export * from './demo-sigall-disposition'
export * from './demo-sigall-refund'
export * from './demo-frost-participant-policy'
export * from './demo-frost-process-boundary'
export {
	buildAuctionLockSecret,
	parseAuctionLockSecret,
	readAuctionLock,
	AuctionLockRefusedError,
} from './auction-lock'
export type { AuctionLockParse, AuctionLockConstraints, ParsedAuctionLock, SigFlag } from './auction-lock'
export {
	deriveSellerChildPubkey,
	generateBidDerivationPath,
	normalizeBidPath,
	parseExtendedPublicKey,
	deriveChildPublicKey,
	SellerChildRefusedError,
	AUCTION_PATH_LEVELS,
	AUCTION_PATH_MAX_INDEX,
} from './seller-child'
export {
	createBrowserLockAuthorityStore,
	createMemoryLockAuthorityStore,
	parseLockExport,
	LOCK_EXPORT_PREFIX,
} from './lock-authority-store'
export type { LockAuthorityRecord, LockAuthorityStore } from './lock-authority-store'
export { CocoWalletPortAdapter, CocoPortAdapterError } from './port'
export { MemoryWalletOperationStore } from './memory'
export {
	createBrowserWalletOperationStore,
	type OperationStoreLocation,
} from './operation-store'
export { openMemoryWalletDomain, openProjectedWalletDomain, openWalletDomain } from './open-wallet'
export type { OpenProjectedWalletDomainOptions, OpenWalletDomainOptions, ProjectedWalletDomain, WalletDomain, WalletProofProjection } from './open-wallet'
export {
	createBrowserSeedStore,
	createMemorySeedStore,
	parseSeedExport,
	seedGetterFor,
	SEED_BYTES,
	SEED_EXPORT_PREFIX,
} from './seed-store'
export type { IndexedDbFactoryLike, KeyValueAreaLike, SeedLocation, SeedStore } from './seed-store'
export {
	WalletHostError,
	WalletConfigurationError,
	WalletAdapterNotFoundError,
	WalletCommandConflictError,
	WalletInvalidTransitionError,
	WalletStaleWriterError,
	WalletRecoveryRequiredError,
	WalletStepExecutionError,
	RefusedError,
	refusalCode,
} from './errors'
export type {
	WalletStep,
	WalletOperationState,
	WalletAccount,
	WalletMoney,
	WalletOperationCommand,
	WalletOperationRecord,
	WalletOperationSnapshot,
	WalletBalance,
	WalletBalanceQuery,
	WalletStepResult,
	WalletRecoveryResult,
	CocoEngineOperationState,
	CocoEngineOperation,
	CocoOperationPort,
	CocoReconcilerStatus,
	CocoWalletRuntime,
	CocoWalletRuntimeFactory,
	WalletAdapterContext,
	WalletApplicationAdapter,
	WalletOperationStore,
	WalletHostOptions,
	WalletRunOptions,
} from './types'
export type {
	CocoLegKind,
	CocoLegOperationsDeclaration,
	CocoLegKey,
	CocoLegCommand,
	CocoMeltQuote,
	CocoMeltResult,
	CocoMeltRail,
	CocoLegRecord,
	CocoLegStore,
	CocoPortAdapterOptions,
} from './port'

/** Narrow signer primitives for the separately approved DEMO_AUTH_V1 browser signer; no key generation. */
import { schnorr } from '@noble/curves/secp256k1.js'
const demoAuthHexBytes = (value: string): Uint8Array => {
	if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('demo-auth-signer-hex')
	return Uint8Array.from(value.match(/../g)!.map((part) => Number.parseInt(part, 16)))
}
const demoAuthBytesHex = (value: Uint8Array): string => Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
const demoAuthSignatureBytes = (value: string): Uint8Array => {
	if (!/^[0-9a-f]{128}$/.test(value)) throw new Error('demo-auth-signer-signature')
	return Uint8Array.from(value.match(/../g)!.map((part) => Number.parseInt(part, 16)))
}
export const demoAuthSignerPublicKey = (secretKeyHex: string): string => demoAuthBytesHex(schnorr.getPublicKey(demoAuthHexBytes(secretKeyHex)))
export const signDemoAuthEventId = (eventIdHex: string, secretKeyHex: string): string => demoAuthBytesHex(schnorr.sign(demoAuthHexBytes(eventIdHex), demoAuthHexBytes(secretKeyHex)))
export const verifyDemoAuthEventId = (signatureHex: string, eventIdHex: string, publicKeyHex: string): boolean => schnorr.verify(demoAuthSignatureBytes(signatureHex), demoAuthHexBytes(eventIdHex), demoAuthHexBytes(publicKeyHex))
