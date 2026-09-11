/**
 * First-party seam over the NDK store singleton (`@/lib/stores/ndk`).
 *
 * The store is a module-global singleton imported by many files. Under bun's
 * frozen module namespaces, `mock.module` of a store singleton permanently
 * flips its live bindings for every later file in the shared test process
 * (cross-file test pollution — see AGENTS.md Test Isolation). So test files
 * must never `mock.module('@/lib/stores/ndk')`; instead they mock this
 * first-party seam, which only the modules that route through it import
 * (smaller blast radius, no namespace freeze of the shared store).
 */
export { getWriteRelays, getWriteRelaySet, getAppRelaySet, ndkActions, ndkStore } from '@/lib/stores/ndk'
export type { AppEventFilter, NDKState } from '@/lib/stores/ndk'
