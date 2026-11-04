/** Pure topology and path binding shared by all three concrete signer policies. */
import { join } from 'node:path'
import { lstat, mkdir } from 'node:fs/promises'
import { exactDemoFridayApplication, exactDemoFridayStatePath, demoFridayLoopbackRpc, isSeparatedApplication,
	demoFridayMintIdentityUrl, demoFridayMintUrl, demoFridayNodeRoot } from './demo-friday-runtime-config'

const issued = new WeakSet<object>()
export function resolveDemoFridaySignerContract(input: unknown, slot: 1 | 2 | 3 | 4) {
	const application = exactDemoFridayApplication(structuredClone(input))
	if (![1, 2, 3, 4].includes(slot)) throw new Error('DEMO_SIGNER_CONTRACT_SLOT')
	const nodeRoot = exactDemoFridayStatePath(application, demoFridayNodeRoot(application, slot), 'signer auxiliary root')
	const path = (name: string) => exactDemoFridayStatePath(application, join(nodeRoot, name), name)
	const contract = Object.freeze({ schema: application.schema, runId: application.run_id, slot,
		deploymentId: application.schema === 'PLEBEIAN_FRIDAY_FIPS_LAB_APPLICATION_V2' ? null : application.deployment_id,
		networkRoot: application.network_root,
		cometRpc: demoFridayLoopbackRpc(application), mintUrl: demoFridayMintIdentityUrl(application),
		mintTransportUrl: demoFridayMintUrl(application), nodeRoot, keysetRoot: application.dkg_root,
		paths: Object.freeze({ identityPath: isSeparatedApplication(application) ? join(application.dkg_root, 'signer-rpc-identity.key') : path('signer-rpc-identity.key'), scratchParent: path('scratch'),
			proofUsePath: path('terminal-proof-use.sqlite3'), anchorPath: path('signer-safety-anchor.sqlite3'),
			admissionSafetyPath: path('admission-safety.sqlite3'), enrollmentPermit: path('terminal-enrollment-permit.json'),
			signerJournalPath: path('signer-rpc.sqlite3'), publicEnrollmentPath: path('signer-enrollment-public.json'),
			leasePath: path('signer-service-v2.lock'), quarantinePath: path('signer-service-v2.quarantine') }),
	})
	issued.add(contract); return contract
}
export type DemoFridaySignerContract = ReturnType<typeof resolveDemoFridaySignerContract>

/** Create the private invocation-scratch parent before the service accepts RPCs.
 *
 * Effectful signer paths use mkdtemp(3) below this directory.  Leaving the
 * parent implicit lets a request pass pure policy checks and enter the durable
 * pending state before failing with ENOENT.  The signer therefore provisions
 * this one directory at startup and refuses files, links, foreign ownership or
 * permissive modes instead of discovering a bad path during a signing round.
 */
export async function ensureDemoFridaySignerScratch(contract: DemoFridaySignerContract): Promise<string> {
	if (!issued.has(contract)) throw new Error('DEMO_SIGNER_SCRATCH: unissued contract')
	const path = contract.paths.scratchParent
	try { await mkdir(path, { mode: 0o700 }) }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
	}
	const metadata = await lstat(path)
	const runtimeUid = process.geteuid?.()
	if (!metadata.isDirectory() || metadata.isSymbolicLink()
		|| runtimeUid === undefined || metadata.uid !== runtimeUid
		|| (metadata.mode & 0o777) !== 0o700) {
		throw new Error('DEMO_SIGNER_SCRATCH: path must be a runtime-owned 0700 directory')
	}
	return path
}
export function assertDemoFridaySignerContract(contract: DemoFridaySignerContract, pins: {
	cometRpc: string; mintUrl: string; mintTransportUrl: string; participantId?: number
}): void {
	if (!issued.has(contract) || pins.cometRpc !== contract.cometRpc || pins.mintUrl !== contract.mintUrl
		|| pins.mintTransportUrl !== contract.mintTransportUrl
		|| pins.participantId !== undefined && pins.participantId !== contract.slot) {
		throw new Error('DEMO_SIGNER_CONTRACT: policy differs from the exact selected application/slot')
	}
}
/** Manual redirects never follow another endpoint; a redirect is integrity
 * failure, not a branded transport outage. No alternate port is attempted. */
export function demoFridaySignerCometFetch(contract: DemoFridaySignerContract, fetchImpl: typeof fetch): typeof fetch {
	if (!issued.has(contract)) throw new Error('DEMO_SIGNER_CONTRACT: unissued topology')
	return (async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input))
		if (url.origin !== contract.cometRpc || url.username || url.password) throw new Error('DEMO_SIGNER_COMET_ORIGIN')
		const response = await fetchImpl(input, { ...init, redirect: 'manual' })
		if (response.redirected || response.status >= 300 && response.status < 400
			|| response.url && new URL(response.url).origin !== contract.cometRpc) throw new Error('DEMO_SIGNER_COMET_REDIRECT')
		return response
	}) as typeof fetch
}


/** Shared startup pin composition. Validators are the three pure concrete
 * factory validators; no store, claim or Rust capability is accepted. */
export function preflightDemoFridaySignerPolicyComposition(options: {
	application: unknown; slot: 1 | 2 | 3 | 4
	facts: { chain_id: string; genesis_sha256: string; validators_hash: string; validator_roster_version: string }
	dkg: { committeePublicKey: string; committeeKeysetId: string; committeeKeysetVersion: string;
		dkgRunId: string; publicKeyPackageSha256: string; signerRosterDigest: string }
	validate: {
		admission(contract: DemoFridaySignerContract, pins: import('./demo-fips-admission-policy').DemoFipsAdmissionTrustPinsV1): void
		fundingAbort(contract: DemoFridaySignerContract, pins: Omit<import('./demo-fips-funding-abort-policy').DemoFipsFundingAbortTrustPinsV1, 'activeKeysetId'>): void
		terminal(contract: DemoFridaySignerContract, pins: import('./demo-fips-terminal-policy').DemoFipsTerminalTrustPinsV1): void
	}
}) {
	const contract = resolveDemoFridaySignerContract(options.application, options.slot)
	const { facts, dkg } = options
	const common = { cometRpc: contract.cometRpc, mintUrl: contract.mintUrl,
		mintTransportUrl: contract.mintTransportUrl, chainId: facts.chain_id, validatorsHash: facts.validators_hash }
	const admissionPins = Object.freeze({ ...common, participantId: options.slot, network: facts.chain_id })
	const abortPins = Object.freeze({ ...common, participantId: options.slot, authNetworkId: facts.chain_id,
		genesisSha256: facts.genesis_sha256, committeePublicKey: dkg.committeePublicKey,
		committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
		dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256, signerRosterDigest: dkg.signerRosterDigest })
	const terminalPins = Object.freeze({ ...common, network: facts.chain_id, genesisHash: facts.genesis_sha256,
		validatorRosterVersion: facts.validator_roster_version, committeeKeysetId: dkg.committeeKeysetId,
		committeeKeysetVersion: dkg.committeeKeysetVersion, dkgRunId: dkg.dkgRunId,
		publicKeyPackageSha256: dkg.publicKeyPackageSha256, signerRosterDigest: dkg.signerRosterDigest })
	options.validate.admission(contract, admissionPins)
	options.validate.fundingAbort(contract, abortPins)
	options.validate.terminal(contract, terminalPins)
	return Object.freeze({ contract, admissionPins, abortPins, terminalPins })
}
