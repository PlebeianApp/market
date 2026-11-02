/**
 * Independent recovery capsule for a Coco pool that was locked before a full
 * auction bid envelope could be constructed.
 *
 * This is deliberately not a synthetic winner/refund bundle.  It contains one
 * exact refund branch, its payment-key authorization, and the locked bearer
 * inputs needed by the encrypted authority store.  Consensus FundingAbortV1
 * remains the mutually-exclusive admit/abort decision; this capsule is only
 * the post-finality return package.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	validateDemoMaintainerExactBranchTemplate,
	type DemoMaintainerOfflineIdentity,
	type DemoMaintainerPreparedAuthorizationV1,
	type DemoMaintainerExactBranchTemplate,
	type DemoMaintainerPackageAuthorization,
} from './demo-maintainer-offline'
import type { DemoMaintainerFederationAuthorization } from './demo-maintainer-federation'

const HEX_32 = /^[0-9a-f]{64}$/

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_ABORT_CAPSULE: ${message}`) }

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('canonical value contains a non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') refuse('canonical value contains an unsupported type')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

export interface DemoFridayFundingAbortRecoveryCapsuleV1 {
	schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_RECOVERY_CAPSULE_V1'
	createdAt: number
	/** Exact payment-key-authorized refund branch; includes the bearer proofs. */
	refund: DemoMaintainerExactBranchTemplate
	actorReturnAuthorization: DemoMaintainerPackageAuthorization
	/** Hash of the exact capsule body below.  Also identifies pre-bid authorization in FundingAbortV1. */
	capsuleDigest: string
}

function capsuleBody(value: Omit<DemoFridayFundingAbortRecoveryCapsuleV1, 'capsuleDigest'>): unknown {
	return {
		schema: value.schema,
		createdAt: value.createdAt,
		refund: value.refund,
		actorReturnAuthorization: value.actorReturnAuthorization,
	}
}

export function demoFridayFundingAbortCapsuleDigest(
	value: Omit<DemoFridayFundingAbortRecoveryCapsuleV1, 'capsuleDigest'>,
): string {
	return bytesToHex(sha256(utf8ToBytes(canonical(capsuleBody(value)))))
}

export function validateDemoFridayFundingAbortRecoveryCapsule(
	value: DemoFridayFundingAbortRecoveryCapsuleV1,
): DemoFridayFundingAbortRecoveryCapsuleV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
			'schema', 'createdAt', 'refund', 'actorReturnAuthorization', 'capsuleDigest',
		].sort())
		|| value.schema !== 'PLEBEIAN_FRIDAY_FUNDING_ABORT_RECOVERY_CAPSULE_V1'
		|| !Number.isSafeInteger(value.createdAt) || value.createdAt < 1 || !HEX_32.test(value.capsuleDigest)) {
		refuse('capsule shape, time, or digest is malformed')
	}
	const refund = validateDemoMaintainerExactBranchTemplate(value.refund, 'refund')
	const authorization = value.actorReturnAuthorization
	if (!('schema' in authorization)
		|| authorization.schema !== 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1'
		|| authorization.paymentPublicKey !== refund.bidderPublicKey
		|| authorization.packageDigest !== refund.templateDigest
		|| !schnorr.verify(hexToBytes(authorization.signature), hexToBytes(refund.templateDigest),
			hexToBytes(refund.bidderPublicKey.slice(2)))) {
		refuse('capsule lacks the exact payment-key refund authorization')
	}
	const expected = demoFridayFundingAbortCapsuleDigest({
		schema: value.schema, createdAt: value.createdAt, refund,
		actorReturnAuthorization: structuredClone(authorization),
	})
	if (value.capsuleDigest !== expected) refuse('capsule digest is not canonical')
	return { ...structuredClone(value), refund }
}

export interface DemoFridayFundingAbortCapsuleStore {
	persistExact(capsule: DemoFridayFundingAbortRecoveryCapsuleV1): Promise<DemoFridayFundingAbortRecoveryCapsuleV1>
	readByOperationExact(operationId: string): Promise<DemoFridayFundingAbortRecoveryCapsuleV1>
}

/**
 * Durable post-consensus authority for the capsule's only branch.  This is
 * separate from both the pre-consensus capsule and the two-branch admitted-bid
 * store: a cancellation must never fabricate a winner branch.
 */
export interface DemoFridayFundingAbortCapsuleTerminalV1 {
	schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_CAPSULE_TERMINAL_V1'
	operationId: string
	capsuleDigest: string
	scope: string
	selectionRoot: string
	authorization: DemoMaintainerFederationAuthorization
	prepared: DemoMaintainerPreparedAuthorizationV1
}

export interface DemoFridayFundingAbortCapsuleTerminalStore {
	persistTerminalExact(value: DemoFridayFundingAbortCapsuleTerminalV1): Promise<DemoFridayFundingAbortCapsuleTerminalV1>
	readTerminalExact(identity: DemoMaintainerOfflineIdentity): Promise<DemoFridayFundingAbortCapsuleTerminalV1 | null>
}
