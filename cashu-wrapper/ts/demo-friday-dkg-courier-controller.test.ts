import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import { demoFridayDkgManifestDigest, demoFridayDkgRosterDigest, type DemoFridayDkgPublicManifestV1 } from './demo-friday-per-validator-dkg-bootstrap'
import {
	assembleFridayR18Phase,
	captureFridayR18Artifact,
	captureFridayR18HostReceipt,
	claimFridayR18HostStage,
	initializeFridayR18Courier,
	type FridayR18CourierProfile,
} from './demo-friday-dkg-courier-controller'
import {
	createDemoFridayDkgAuthenticatedHostReceiptV2,
	type DemoFridayDkgReceiptStage,
	type DemoFridayDkgReceiptStatus,
} from './demo-friday-dkg-host-receipt'

const IDS = [1, 2, 3, 4] as const
const dkgPrivate = IDS.map((participant) => new Uint8Array(32).fill(participant))

function manifest(): DemoFridayDkgPublicManifestV1 {
	const npubFill = ['q', 'p', 'z', 'r'] as const
	const participants = IDS.map((participantId) => ({
		participantId, hostId: `linode-${100000 + participantId}`, underlayIpv4: `198.18.242.${participantId}`,
		fipsNpub: `npub1${npubFill[participantId - 1]!.repeat(58)}`, fipsUla: `fd42::${participantId}`,
		dkgIdentity: bytesToHex(schnorr.getPublicKey(dkgPrivate[participantId - 1]!)), signerIdentity: `${participantId + 4}`.repeat(64),
		kexPublicKey: `${participantId + 5}`.repeat(64), signerEndpoint: `http://[fd42::${participantId}]:39101/v1/frost`,
		participantBinarySha256: 'a'.repeat(64), inspectorBinarySha256: 'b'.repeat(64),
		configPath: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json',
		stateDirectory: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/state',
	})) as unknown as DemoFridayDkgPublicManifestV1['participants']
	return {
		schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1', valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: 'friday-r18', applicationRunId: 'friday-run-r18', dkgRunId: 'friday-dkg-r18',
		committeeKeysetId: 'friday-keyset-r18', committeeKeysetVersion: '1', roster: IDS,
		rosterDigest: demoFridayDkgRosterDigest(participants), coordinatorParticipantId: 1,
		coordinatorIdentity: 'e'.repeat(64), participants,
	}
}

function receipt(
	profile: FridayR18CourierProfile,
	participantId: 1 | 2 | 3 | 4,
	stage: DemoFridayDkgReceiptStage = 'enroll',
	status: DemoFridayDkgReceiptStatus = 'completed',
): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(createDemoFridayDkgAuthenticatedHostReceiptV2({
		manifestDigest: profile.expectedManifestDigest, participantId, stage, status,
		evidenceDigest: `${participantId}`.repeat(64), dkgIdentityPrivateKey: dkgPrivate[participantId - 1]!,
	}))}\n`)
}

async function setup(): Promise<{ base: string; profile: FridayR18CourierProfile; manifestBytes: string }> {
	const base = await mkdtemp(join(tmpdir(), 'friday-r18-courier-'))
	await chmod(base, 0o700)
	const value = manifest(); const manifestBytes = `${JSON.stringify(value)}\n`
	const expectedManifestDigest = demoFridayDkgManifestDigest(value)
	const manifestPath = join(base, 'manifest.json'); const manifestPinPath = join(base, 'manifest-digest.txt')
	const relayPath = join(base, 'relay')
	await writeFile(manifestPath, manifestBytes, { mode: 0o600 })
	await writeFile(manifestPinPath, `${expectedManifestDigest}\n`, { mode: 0o600 })
	await writeFile(relayPath, '#!/bin/false\n', { mode: 0o700 }); await chmod(relayPath, 0o700)
	const relayBytes = new Uint8Array(await readFile(relayPath))
	const { sha256 } = await import('@noble/hashes/sha2.js')
	const { bytesToHex } = await import('@noble/hashes/utils.js')
	return {
		base, manifestBytes,
		profile: {
			root: join(base, 'operator', 'friday-r18-dkg-ceremony'), manifestPath, manifestPinPath, relayPath,
			relaySha256: bytesToHex(sha256(relayBytes)), expectedManifestDigest,
			expectedUid: process.geteuid!(), expectedGid: process.getegid!(),
		},
	}
}

describe('R18 DKG courier controller', () => {
	test('enforces all-four barriers, create-exclusive outputs, and one host invocation claim', async () => {
		const fixture = await setup()
		try {
			await initializeFridayR18Courier(fixture.profile)
			await expect(claimFridayR18HostStage(fixture.profile, 'confirm-transport', 1)).rejects.toThrow()
			await claimFridayR18HostStage(fixture.profile, 'enroll', 1)
			await expect(claimFridayR18HostStage(fixture.profile, 'enroll', 1)).rejects.toThrow()
			await captureFridayR18HostReceipt(fixture.profile, 'enroll', 1, receipt(fixture.profile, 1))
			await captureFridayR18Artifact(fixture.profile, 'enroll', 1, new TextEncoder().encode('{"participant":1}\n'))
			await expect(assembleFridayR18Phase(fixture.profile, 'enrollment', async () => ({}))).rejects.toThrow()

			for (const participant of [2, 3, 4] as const) {
				await claimFridayR18HostStage(fixture.profile, 'enroll', participant)
				await captureFridayR18HostReceipt(fixture.profile, 'enroll', participant, receipt(fixture.profile, participant))
				await captureFridayR18Artifact(fixture.profile, 'enroll', participant, new TextEncoder().encode(`${JSON.stringify({ participant })}\n`))
			}
			let requests = 0
			await assembleFridayR18Phase(fixture.profile, 'enrollment', async (request) => {
				requests += 1
				const exact = request as { action?: unknown; entries?: unknown[] }
				expect(exact.action).toBe('enrollment_bundle'); expect(exact.entries).toHaveLength(4)
				return { schema: 'fixture-enrollment-bundle', entries: exact.entries }
			})
			expect(requests).toBe(1)
			await expect(assembleFridayR18Phase(fixture.profile, 'enrollment', async () => ({}))).rejects.toThrow()
			await claimFridayR18HostStage(fixture.profile, 'confirm-transport', 1)
			expect(await readFile(fixture.profile.manifestPath, 'utf8')).toBe(fixture.manifestBytes)
			expect(JSON.parse(await readFile(join(fixture.profile.root, 'file-receipts', 'outputs__enrollments.bundle.json.json'), 'utf8')))
				.toMatchObject({ schema: 'PLEBEIAN_FRIDAY_R18_COURIER_FILE_RECEIPT_V1' })
		} finally { await rm(fixture.base, { recursive: true, force: true }) }
	})

	test('rejects a non-completed or mismatched host receipt before artifact capture', async () => {
		const fixture = await setup()
		try {
			await initializeFridayR18Courier(fixture.profile)
			await claimFridayR18HostStage(fixture.profile, 'enroll', 1)
			await expect(captureFridayR18HostReceipt(
				fixture.profile, 'enroll', 1, receipt(fixture.profile, 1, 'enroll', 'already_completed'),
			)).rejects.toThrow('does not match the pinned host, manifest or stage')
			await expect(captureFridayR18Artifact(fixture.profile, 'enroll', 1, new TextEncoder().encode('{}\n'))).rejects.toThrow()
		} finally { await rm(fixture.base, { recursive: true, force: true }) }
	})

	test('rejects spoofed host, wrong manifest, wrong stage and duplicate authenticated receipts', async () => {
		const fixture = await setup()
		try {
			await initializeFridayR18Courier(fixture.profile)
			await claimFridayR18HostStage(fixture.profile, 'enroll', 1)
			await expect(captureFridayR18HostReceipt(fixture.profile, 'enroll', 1, receipt(fixture.profile, 2)))
				.rejects.toThrow('does not match the pinned host')
			const wrongManifest = { ...fixture.profile, expectedManifestDigest: 'f'.repeat(64) }
			await expect(captureFridayR18HostReceipt(fixture.profile, 'enroll', 1, receipt(wrongManifest, 1)))
				.rejects.toThrow('does not match the pinned host')
			await expect(captureFridayR18HostReceipt(fixture.profile, 'enroll', 1,
				receipt(fixture.profile, 1, 'confirm-transport'))).rejects.toThrow('does not match the pinned host')
			const valid = receipt(fixture.profile, 1)
			await captureFridayR18HostReceipt(fixture.profile, 'enroll', 1, valid)
			await expect(captureFridayR18HostReceipt(fixture.profile, 'enroll', 1, valid)).rejects.toThrow()
		} finally { await rm(fixture.base, { recursive: true, force: true }) }
	})
})

