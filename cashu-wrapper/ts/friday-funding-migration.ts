import type { FridayFundingRecord } from "./friday-funding";

export type FridayCoordinatorCheckpointSchema =
	| "PlebeianAuctionsPOCCoordinatorStateV1"
	| "PlebeianAuctionsPOCCoordinatorStateV2"
	| "PlebeianAuctionsPOCCoordinatorStateV3";

export interface FridayFundingCheckpointInput {
	readonly schema: FridayCoordinatorCheckpointSchema;
	readonly faucetActors: readonly string[];
	readonly faucetGrants?: Readonly<Record<string, number>>;
	readonly quarantinedFundingActors?: readonly string[];
	readonly funding?: readonly FridayFundingRecord[];
}

/**
 * Pure, bearer-free funding migration shared by coordinator startup and the
 * two-process restart regression. V2's historical 50k sentinel never becomes
 * issuance: only finalized records survive as grants and every excess actor is
 * quarantined.
 */
export function migrateFridayFundingCheckpoint(input: FridayFundingCheckpointInput, faucetAmount: number): {
	grants: Record<string, number>;
	quarantinedActors: string[];
} {
	const grants = { ...(input.faucetGrants ?? {}) };
	const quarantine = new Set(input.quarantinedFundingActors ?? []);
	if (input.schema === "PlebeianAuctionsPOCCoordinatorStateV1") {
		for (const actor of input.faucetActors) if (grants[actor] === undefined) grants[actor] = faucetAmount;
	}
	if (input.schema === "PlebeianAuctionsPOCCoordinatorStateV2") {
		for (const [actor, amount] of Object.entries(grants)) {
			const proven = (input.funding ?? []).filter((record) => record.actor === actor && record.status === "finalized")
				.reduce((sum, record) => sum+record.amount, 0);
			if (amount > proven) {
				quarantine.add(actor);
				if (proven === 0) delete grants[actor]; else grants[actor] = proven;
			}
		}
	}
	return { grants, quarantinedActors: [...quarantine].sort() };
}
