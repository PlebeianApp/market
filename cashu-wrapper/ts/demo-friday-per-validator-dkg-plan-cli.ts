/** Print an inert, public-only per-validator DKG plan.  Never executes it. */
import { demoFridayPerValidatorDkgPlan, type DemoFridayParticipantId } from './demo-friday-per-validator-dkg-plan'

function parseArguments(argv: string[]): {
	participantId: DemoFridayParticipantId
	runId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
} {
	if (argv.length !== 8 || argv[0] !== '--participant' || argv[2] !== '--run-id'
		|| argv[4] !== '--committee-keyset-id' || argv[6] !== '--committee-keyset-version') {
		throw new Error('usage: bun demo-friday-per-validator-dkg-plan-cli.ts --participant 1..4 --run-id ID --committee-keyset-id ID --committee-keyset-version VERSION')
	}
	return {
		participantId: Number(argv[1]) as DemoFridayParticipantId,
		runId: argv[3]!,
		committeeKeysetId: argv[5]!,
		committeeKeysetVersion: argv[7]!,
	}
}

if (import.meta.main) {
	const plan = demoFridayPerValidatorDkgPlan(parseArguments(process.argv.slice(2)))
	process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
}
