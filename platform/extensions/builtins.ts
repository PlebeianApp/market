import type { AnyExtensionDefinition } from '@sdk/core/extensions'
import { productImageDescriber } from '@sdk/extensions/product-image-describer'
import { routstrListingDrafter } from '@sdk/extensions/routstr-listing-drafter'

/**
 * Extensions compiled into this Platform release (ADR-0023 §7.1). Each still has to be enabled per
 * instance with `EXTENSION_<ID>_ENABLED=true`; none is enabled by default. Order matters: clients use the
 * first enabled extension for a capability, so the real Routstr drafter comes before the mock describer.
 */
export const BUILTIN_EXTENSIONS: readonly AnyExtensionDefinition[] = [routstrListingDrafter, productImageDescriber]
