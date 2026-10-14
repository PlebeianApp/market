/**
 * wallet/ts/index.ts — the entry: the aggregator, the derived-state function and the gate.
 *
 * `#d91675` the aggregator cites only the funds contract and takes each wrapper as an injected port; the set
 * state is derived from what is proven, and the acceptance gate refuses a malformed registration fail-closed.
 * The contract's port vocabulary itself is obtained from the ancestor and never restated here.
 */
export { PayAggregator, deriveSetState } from './aggregator'
export { FundsRegistrationGate } from './gate'
export { MemorySetStore } from './memory'
export { FundsRegistrationError, FundsDuplicateRefundError, PayAggregatorError } from './errors'
export type {
	AggregatorOptions,
	AggregatorWrapper,
	LegEntry,
	LegHandle,
	LegIntent,
	LegPartition,
	RefundRequest,
	SetDirection,
	SetHandle,
	SetIntent,
	SetRecord,
	SetState,
	SetStore,
	WitnessVerifier,
	SettlingWitnessKind,
} from './types'
export type { FundsField, FundsReason, RefundReason } from './errors'
