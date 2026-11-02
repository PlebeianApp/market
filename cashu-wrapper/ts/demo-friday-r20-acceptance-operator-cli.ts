#!/usr/bin/env bun
import { DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID } from './demo-friday-browser-acceptance-adapters'
import { runDemoFridayAcceptanceOperatorCli } from './demo-friday-acceptance-operator-cli'

type OperatorDependencies = NonNullable<Parameters<typeof runDemoFridayAcceptanceOperatorCli>[1]>

export async function runDemoFridayR20AcceptanceOperatorCli(argv = process.argv.slice(2),
	dependencies: Omit<OperatorDependencies, 'expectedDeploymentId'> = {}): Promise<unknown> {
	return runDemoFridayAcceptanceOperatorCli(argv, {
		...dependencies,
		expectedDeploymentId: DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID,
	})
}

if (import.meta.main) {
	try { process.stdout.write(`${JSON.stringify(await runDemoFridayR20AcceptanceOperatorCli())}\n`) }
	catch { process.stderr.write('Friday R20 acceptance operator command rejected\n'); process.exitCode = 1 }
}
