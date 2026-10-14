export type { Signer, SignedEventLike } from './ports/signer'
export type { EncryptingSigner, SignableRumorLike } from './ports/encryptingSigner'
export { UnsupportedSignerOperationError } from './ports/encryptingSigner'
export type { KeyValueStoragePort } from './ports/storage'
export type { WalletPort, WalletRecoveryPort } from './ports/wallet'
export { createWorkflowError, SdkError, ValidationError, WorkflowError } from './errors'
export type { SdkErrorCode, WorkflowErrorStatus } from './errors'
export { failure, success } from './result'
export type { Result } from './result'
export { validateWithSchema } from './composition/ts/index'
export type { RuntimeSchema } from './composition/ts/index'
// `./validation` now reaches the MODULE DIRECTORY: the shadowing file `sdk/core/validation.ts` was
// removed (design.md §5), so there is no file for `./validation` to win against. The module's entry
// is `./validation/ts/index` — the same `./<module>/ts/index` shape every core module takes (neither
// `validation/` nor `event-access/` carries a root index.ts) — and its own `ValidationError` is
// ALIASED: the SDK's `ValidationError` (`./errors`, above) and the module's
// (`validation/ts/errors.ts`) are two distinct classes (the module may not import the SDK's,
// `#8e6079`), so a verbatim re-export would shadow one. This is a barrel decision, not an engine
// change.
export { createValidator, PASS_THROUGH, ValidationError as ValidationModuleError } from './validation/ts/index'
export type {
	ValidationPreset,
	ValidationCheck,
	ValidationOutcome,
	ValidationRefusal,
	ValidationPort,
	ValidatorOptions,
	Validator,
} from './validation/ts/index'
export { parseMarketConfig } from './marketConfig'
export type { MarketConfig } from './marketConfig'
