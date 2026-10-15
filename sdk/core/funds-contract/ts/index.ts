/**
 * funds-contract/ts/index.ts — the contract's entry: the port's types, re-exported.
 *
 * `#d16b28` the port's types ship once, here, as types only. This entry has no value exports and performs
 * nothing; it exists so a wrapper imports the whole vocabulary from one place — `funds-contract/ts`.
 */
export type {
	FundsStep,
	FundsOperations,
	FundsPort,
	FundsAuthorityKind,
	FundsProgress,
	FundsRung,
	FundsWitnessKind,
	FundsIntent,
	FundsQuote,
	FundsRefusal,
	FundsWitness,
	FundsState,
	FundsHandle,
	WrapperRegistration,
} from './types'
