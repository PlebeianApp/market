import type { AnyExtensionDefinition } from '@sdk/core/extensions'

/**
 * Extensions compiled into this Platform release (ADR-0023 §7.1). Each still has to be enabled per
 * instance with `EXTENSION_<ID>_ENABLED=true`; none is enabled by default.
 */
export const BUILTIN_EXTENSIONS: readonly AnyExtensionDefinition[] = []
