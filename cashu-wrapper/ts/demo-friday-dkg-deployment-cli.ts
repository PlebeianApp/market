#!/usr/bin/env bun
import { loadSeparatedApplication } from './demo-friday-separated-service'
import { SEPARATED_DEPLOYMENT_ID, SEPARATED_APPLICATION_RUN_ID, SEPARATED_DKG_RUN_ID } from './demo-friday-separated-constants'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import {
	initializeDemoFridayCoordinatorIdentity,
	recoverDemoFridayCoordinatorIdentity,
	recoverDemoFridayInitialDkgManifest,
	writeDemoFridayInitialDkgManifest,
} from './demo-friday-dkg-deployment-tools'

function usage(): never {
	throw new Error('usage: plebeian-friday-dkg-deployment init-coordinator|recover-coordinator --deployment ID --application-run ID --dkg-run ID --keyset ID --keyset-version VERSION | compose-manifest|recover-manifest --output ABS --receipt ABS --expected-host-pin-digests D1,D2,D3,D4 COORDINATOR_PUBLIC ENROLLMENT_1 ENROLLMENT_2 ENROLLMENT_3 ENROLLMENT_4')
}

async function json(path: string): Promise<unknown> {
	const before = await lstat(path)
	if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || await realpath(path) !== path) {
		throw new Error('deployment input is not a real single-link file')
	}
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | 0o2000000)
	try {
		const opened = await handle.stat()
		if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) {
			throw new Error('deployment input changed while opened')
		}
		const bytes = await handle.readFile()
		if (bytes.length < 2 || bytes.length > 1024 * 1024) throw new Error('deployment input has an invalid size')
		return JSON.parse(bytes.toString('utf8')) as unknown
	} finally { await handle.close() }
}

export async function runDemoFridayDkgDeploymentCli(argv = process.argv.slice(2)): Promise<unknown> {
	if(argv.length===1 && ['separated-init-coordinator','separated-recover-coordinator'].includes(argv[0]!)) {
 const app=await loadSeparatedApplication();if(app.role!=='APPLICATION')throw new Error('SEPARATED_COORDINATOR: application role required')
 const input={deploymentId:SEPARATED_DEPLOYMENT_ID,applicationRunId:SEPARATED_APPLICATION_RUN_ID,dkgRunId:SEPARATED_DKG_RUN_ID,committeeKeysetId:'friday-demo-frost-keyset-separated-v1',committeeKeysetVersion:'3'}
 return argv[0]==='separated-init-coordinator'?initializeDemoFridayCoordinatorIdentity(input):recoverDemoFridayCoordinatorIdentity(input)
 }
 if (argv[0] === 'init-coordinator' || argv[0] === 'recover-coordinator') {
		if (argv.length !== 11 || argv[1] !== '--deployment' || argv[3] !== '--application-run'
			|| argv[5] !== '--dkg-run' || argv[7] !== '--keyset' || argv[9] !== '--keyset-version') usage()
		if(argv[2]===SEPARATED_DEPLOYMENT_ID)throw new Error('use fixed separated app-host coordinator command')
		const input = {
			deploymentId: argv[2]!, applicationRunId: argv[4]!, dkgRunId: argv[6]!,
			committeeKeysetId: argv[8]!, committeeKeysetVersion: argv[10]!,
		}
		return argv[0] === 'recover-coordinator'
			? recoverDemoFridayCoordinatorIdentity(input)
			: initializeDemoFridayCoordinatorIdentity(input)
	}
	if (argv[0] === 'compose-manifest' || argv[0] === 'recover-manifest') {
		if (argv.length !== 12 || argv[1] !== '--output' || argv[3] !== '--receipt'
			|| argv[5] !== '--expected-host-pin-digests') usage()
		const expectedHostPinDigests = argv[6]!.split(',')
		const options = {
			outputPath: argv[2]!, receiptPath: argv[4]!, expectedHostPinDigests,
			coordinator: await json(argv[7]!), enrollments: await Promise.all(argv.slice(8).map(json)),
		}
		return argv[0] === 'recover-manifest'
			? recoverDemoFridayInitialDkgManifest(options)
			: writeDemoFridayInitialDkgManifest(options)
	}
	usage()
}

if (import.meta.main) {
	try { process.stdout.write(`${JSON.stringify(await runDemoFridayDkgDeploymentCli())}\n`) }
	catch { process.stderr.write('Friday DKG deployment command rejected\n'); process.exitCode = 1 }
}
