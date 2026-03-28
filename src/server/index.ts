// Main EventHandler export
export { EventHandler, getEventHandler } from './EventHandler'

// Component exports
export { AdminManagerImpl } from './AdminManager'
export { EditorManagerImpl } from './EditorManager'
export { BootstrapManagerImpl } from './BootstrapManager'
export { VanityManagerImpl, VANITY_PRICING, type VanityEntry } from './VanityManager'
export {
	ZapPurchaseManager,
	ZapInvoiceError,
	type PricingTier,
	type ZapPurchaseEntry,
	type ZapPurchaseConfig,
	type ZapPurchaseInvoiceRequestBody,
	type ZapInvoiceResult,
	type LnurlResolver,
} from './ZapPurchaseManager'
export { EventValidator } from './EventValidator'
export { EventSigner } from './EventSigner'
export { NDKService } from './NDKService'

// Type exports
export type { EventHandlerConfig, EventValidationResult, ProcessedEvent, AdminManager, EditorManager, BootstrapManager } from './types'
