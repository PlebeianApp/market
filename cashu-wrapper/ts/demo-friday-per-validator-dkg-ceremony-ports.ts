/**
 * Public-only ceremony boundaries for a separately reviewed relay/composer.
 *
 * These are interfaces, not a network implementation. No method accepts an
 * identity secret, pairwise key, FROST secret share, or unencrypted round-two
 * payload. The coordinator may relay public evidence and recipient-addressed
 * ciphertext, but it never gains endpoint custody.
 */
import type {
	DemoFridayDkgFinalPublicPackageV1,
	DemoFridayDkgPairwiseConfirmationV1,
	DemoFridayDkgPublicInspectionV1,
	DemoFridayDkgRound1AgreementBundleV1,
	DemoFridayDkgRound1BundleV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import type {
	DemoFridayAuthenticatedDkgCheckpointV2,
	DemoFridayAuthenticatedDkgResultV2,
	DemoFridayDkgFinalAttestationV2,
} from './demo-friday-per-validator-dkg-bootstrap-v2'
import type { DemoFridayDkgHostEnrollmentV1 } from './demo-friday-per-validator-dkg-enrollment-init'
import type { DemoFridayParticipantId } from './demo-friday-per-validator-dkg-plan'

export interface DemoFridayDkgCeremonyIdentityV1 {
	manifestDigest: string
	dkgRunId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
}

/** Exact opaque Rust round-two envelope; plaintext is never a relay input. */
export interface DemoFridayDkgRecipientCiphertextV1 {
	version: 'COCO_DEMO_FROST_PARTICIPANT_3OF4_V1'
	run_id: string
	committee_keyset_id: string
	committee_keyset_version: string
	round1_digest: string
	sender: DemoFridayParticipantId
	recipient: DemoFridayParticipantId
	nonce_hex: string
	ciphertext_hex: string
}

export interface DemoFridayDkgPublicRelayPortV1 {
	publishHostEnrollmentExact(value: DemoFridayDkgHostEnrollmentV1): Promise<void>
	readHostEnrollmentsExact(): Promise<readonly DemoFridayDkgHostEnrollmentV1[]>
	publishPairwiseConfirmationsExact(options: {
		identity: DemoFridayDkgCeremonyIdentityV1
		participantId: DemoFridayParticipantId
		confirmations: readonly DemoFridayDkgPairwiseConfirmationV1[]
	}): Promise<void>
	readPairwiseConfirmationsExact(options: {
		identity: DemoFridayDkgCeremonyIdentityV1
		participantId: DemoFridayParticipantId
	}): Promise<readonly DemoFridayDkgPairwiseConfirmationV1[]>
	publishRound1BundleExact(options: {
		identity: DemoFridayDkgCeremonyIdentityV1
		bundle: DemoFridayDkgRound1BundleV1
	}): Promise<void>
	readRound1BundleExact(identity: DemoFridayDkgCeremonyIdentityV1): Promise<DemoFridayDkgRound1BundleV1>
	publishRound1AgreementBundleExact(options: {
		identity: DemoFridayDkgCeremonyIdentityV1
		bundle: DemoFridayDkgRound1AgreementBundleV1
	}): Promise<void>
	readRound1AgreementBundleExact(
		identity: DemoFridayDkgCeremonyIdentityV1,
	): Promise<DemoFridayDkgRound1AgreementBundleV1>
	publishFinalPublicEvidenceExact(options: {
		identity: DemoFridayDkgCeremonyIdentityV1
		participantId: DemoFridayParticipantId
		publicPackage: DemoFridayDkgFinalPublicPackageV1
		inspection: DemoFridayDkgPublicInspectionV1
		attestation: DemoFridayDkgFinalAttestationV2
	}): Promise<void>
}

export interface DemoFridayDkgRecipientCiphertextRelayPortV1 {
	publishRecipientCiphertextExact(options: {
		identity: DemoFridayDkgCeremonyIdentityV1
		envelope: DemoFridayDkgRecipientCiphertextV1
	}): Promise<void>
	readRecipientCiphertextsExact(options: {
		identity: DemoFridayDkgCeremonyIdentityV1
		recipient: DemoFridayParticipantId
	}): Promise<readonly DemoFridayDkgRecipientCiphertextV1[]>
}

/** Composition stays public-only and must preserve the authenticated V2 result. */
export interface DemoFridayDkgAuthenticatedResultComposerPortV1 {
	assembleAuthenticatedResultExact(
		checkpoint: DemoFridayAuthenticatedDkgCheckpointV2,
	): Promise<DemoFridayAuthenticatedDkgResultV2>
}
