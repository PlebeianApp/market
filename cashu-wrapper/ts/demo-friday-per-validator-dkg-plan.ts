/**
 * DEMO-ONLY, inert per-validator DKG command plan.
 *
 * This module deliberately performs no filesystem, process, or network I/O.
 * It describes the exact existing Rust participant commands that one validator
 * may run after its local transport credentials have been provisioned through
 * a separately reviewed, genuinely peer-to-peer ceremony.  In particular it
 * never creates, accepts, or distributes identity signing keys or pairwise
 * round-two keys.
 */

export const DEMO_FRIDAY_PER_VALIDATOR_DKG_PLAN_SCHEMA =
	'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_PLAN_V1' as const
export const DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION =
	'COCO_DEMO_FROST_PARTICIPANT_3OF4_V1' as const
export const DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT =
	'/var/lib/plebeian-auctions-friday/frost/keyset-v1' as const
export const DEMO_FRIDAY_PER_VALIDATOR_BINARY =
	'/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant' as const

export type DemoFridayParticipantId = 1 | 2 | 3 | 4
export type DemoFridayDkgStage = 'round1' | 'round1-agree' | 'round2' | 'finalize'

export interface DemoFridayPerValidatorDkgPlan {
	schema: typeof DEMO_FRIDAY_PER_VALIDATOR_DKG_PLAN_SCHEMA
	valueProfile: 'FAKE_MONEY_ONLY'
	custody: 'PER_VALIDATOR_ONLY'
	participantVersion: typeof DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION
	runId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	participantId: DemoFridayParticipantId
	roster: readonly [1, 2, 3, 4]
	requiredLocalInputs: {
		participantBinary: typeof DEMO_FRIDAY_PER_VALIDATOR_BINARY
		configPath: string
		transportSecretsPath: string
		stateDirectory: string
	}
	exchange: {
		directory: string
		publishPublic: readonly string[]
		publishRecipientEncrypted: ReadonlyArray<{
			recipientId: DemoFridayParticipantId
			path: string
		}>
		receivePublic: readonly string[]
		receiveRecipientEncrypted: string
	}
	commands: Readonly<Record<DemoFridayDkgStage, readonly string[]>>
	finalPublicOutput: string
	blockedPrerequisites: readonly [
		'PREPROVISIONED_LOCAL_TRANSPORT_CREDENTIALS',
		'AUTHENTICATED_FINAL_PACKAGE_ATTESTATION',
		'PUBLIC_ROSTER_AND_RELAY',
	]
}

export interface DemoFridayPerValidatorDkgPlanInput {
	participantId: DemoFridayParticipantId
	runId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
}

function exactIdentifier(value: string, label: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
		throw new Error(`DEMO_FRIDAY_PER_VALIDATOR_DKG: ${label} is not an exact bounded identifier`)
	}
	return value
}

function exactParticipant(value: number): DemoFridayParticipantId {
	if (!Number.isInteger(value) || value < 1 || value > 4) {
		throw new Error('DEMO_FRIDAY_PER_VALIDATOR_DKG: participantId must be 1..4')
	}
	return value as DemoFridayParticipantId
}

function deepFreeze<T>(value: T): Readonly<T> {
	if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value)
		for (const child of Object.values(value)) deepFreeze(child)
	}
	return value
}

/**
 * Build one immutable, public-only plan.  Every command addresses only this
 * participant's local state.  Round-two files named for peers are encrypted by
 * the Rust participant for that one recipient and are the only non-public
 * artifacts this plan permits a relay to carry.
 */
export function demoFridayPerValidatorDkgPlan(
	input: DemoFridayPerValidatorDkgPlanInput,
): Readonly<DemoFridayPerValidatorDkgPlan> {
	const participantId = exactParticipant(input.participantId)
	const runId = exactIdentifier(input.runId, 'runId')
	const committeeKeysetId = exactIdentifier(input.committeeKeysetId, 'committeeKeysetId')
	const committeeKeysetVersion = exactIdentifier(input.committeeKeysetVersion, 'committeeKeysetVersion')
	const localRoot = DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT
	const exchangeDirectory = `${localRoot}/exchange/${runId}`
	const configPath = `${localRoot}/participant.config.json`
	const transportSecretsPath = `${localRoot}/transport-secrets.json`
	const stateDirectory = `${localRoot}/state`
	const round1Output = `${exchangeDirectory}/participant-${participantId}.round1.json`
	const round1Bundle = `${exchangeDirectory}/round1.bundle.json`
	const agreementOutput = `${exchangeDirectory}/participant-${participantId}.agreement.json`
	const agreementBundle = `${exchangeDirectory}/agreement.bundle.json`
	const round2OutputDirectory = `${exchangeDirectory}/participant-${participantId}.round2-out`
	const recipientRound2Bundle = `${exchangeDirectory}/participant-${participantId}.round2.bundle.json`
	const finalPublicOutput = `${exchangeDirectory}/participant-${participantId}.public.json`
	const recipients = ([1, 2, 3, 4] as const).filter((value) => value !== participantId)

	return deepFreeze({
		schema: DEMO_FRIDAY_PER_VALIDATOR_DKG_PLAN_SCHEMA,
		valueProfile: 'FAKE_MONEY_ONLY',
		custody: 'PER_VALIDATOR_ONLY',
		participantVersion: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
		runId,
		committeeKeysetId,
		committeeKeysetVersion,
		participantId,
		roster: [1, 2, 3, 4],
		requiredLocalInputs: {
			participantBinary: DEMO_FRIDAY_PER_VALIDATOR_BINARY,
			configPath,
			transportSecretsPath,
			stateDirectory,
		},
		exchange: {
			directory: exchangeDirectory,
			publishPublic: [round1Output, agreementOutput, finalPublicOutput],
			publishRecipientEncrypted: recipients.map((recipientId) => ({
				recipientId,
				path: `${round2OutputDirectory}/to-${recipientId}.private.json`,
			})),
			receivePublic: [round1Bundle, agreementBundle],
			receiveRecipientEncrypted: recipientRound2Bundle,
		},
		commands: {
			round1: [
				DEMO_FRIDAY_PER_VALIDATOR_BINARY, 'dkg-round1', configPath, stateDirectory,
				transportSecretsPath, round1Output,
			],
			'round1-agree': [
				DEMO_FRIDAY_PER_VALIDATOR_BINARY, 'dkg-round1-agree', configPath, stateDirectory,
				transportSecretsPath, round1Bundle, agreementOutput,
			],
			round2: [
				DEMO_FRIDAY_PER_VALIDATOR_BINARY, 'dkg-round2', configPath, stateDirectory,
				transportSecretsPath, round1Bundle, agreementBundle, round2OutputDirectory,
			],
			finalize: [
				DEMO_FRIDAY_PER_VALIDATOR_BINARY, 'dkg-finalize', configPath, stateDirectory,
				transportSecretsPath, round1Bundle, agreementBundle, recipientRound2Bundle,
				finalPublicOutput,
			],
		},
		finalPublicOutput,
		blockedPrerequisites: [
			'PREPROVISIONED_LOCAL_TRANSPORT_CREDENTIALS',
			'AUTHENTICATED_FINAL_PACKAGE_ATTESTATION',
			'PUBLIC_ROSTER_AND_RELAY',
		],
	}) as Readonly<DemoFridayPerValidatorDkgPlan>
}
