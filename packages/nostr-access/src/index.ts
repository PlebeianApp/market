/**
 * `@plebeian/nostr-access` — the environment layer (L2).
 *
 * This is the only layer that touches the world. Everything above it receives an environment and
 * never reaches past it; everything below it is a binding.
 *
 * Design decision D9 (2026-09-22): **a read failure is a value, not an exception and not an empty
 * list.** The application currently swallows relay failures into `[]` with a `console.warn`
 * (`src/queries/products.tsx:137-139`) and converts a search timeout into `[]` as well
 * (`:1039-1049`), which makes an outage indistinguishable from "no results" — a truthfulness defect
 * the browsing spec calls out (§3.4). So `read` returns `ReadResult`, and a caller cannot render
 * "nothing found" for a network failure without deliberately ignoring the reason.
 */
import type { QueryFilter } from '@plebeian/product-query'

/** Why a read did not succeed. Codes, not prose — the surface owns the wording. */
export type ReadFailureReason = 'timeout' | 'transport' | 'no-relays'

export type ReadResult =
	| { ok: true; events: readonly RawEvent[]; /** True when the read returned nothing and that is trustworthy. */ empty: true }
	| { ok: true; events: readonly RawEvent[]; empty: false }
	| { ok: false; reason: ReadFailureReason; detail?: string }

/** The shape a relay gives us. Untrusted: `parseListing` decides what it means. */
export interface RawEvent {
	id: string
	pubkey: string
	created_at: number
	kind: number
	tags: string[][]
	content: string
	sig?: string
}

export interface ReadOptions {
	timeoutMs?: number
	/** Restrict to these relays. The host decides; a component never does. */
	relayUrls?: readonly string[]
}

export interface ThemeTokens {
	background: string
	foreground: string
	primary: string
	[key: string]: string
}

/**
 * What a component may ask of its host.
 *
 * Read-only, deliberately: this phase needs no signing and no funds, and the shape reserves room for
 * them rather than pretending they will never arrive. When signing lands it is another method here —
 * components written against `read` do not change (architecture overview §4).
 */
export interface BrowseEnvironment {
	nostr: {
		read(filters: readonly QueryFilter[], options?: ReadOptions): Promise<ReadResult>
		stream(filters: readonly QueryFilter[], onEvent: (event: RawEvent) => void, options?: ReadOptions): () => void
	}
	/** Resolve a URL to something renderable. In a sandbox this is the only way an image can load. */
	resource(url: string): Promise<string>
	theme: {
		tokens: ThemeTokens
		onChanged(handler: (tokens: ThemeTokens) => void): () => void
	}
	config: {
		get(key: string): string | undefined
		onChanged(handler: (key: string, value: string | undefined) => void): () => void
	}
	link: { open(target: string): void }
	/** Injectable clock — keeps rendering deterministic in tests. */
	now(): number
}

export const defaultTheme: ThemeTokens = {
	background: '#0b0b0f',
	foreground: '#f4f4f5',
	primary: '#f7931a',
	muted: '#a1a1aa',
	border: '#27272a',
	surface: '#141419',
	danger: '#f87171',
	warning: '#fbbf24',
}

/** Config keys the viewer owns. Named here so a host cannot invent its own spelling. */
export const CONFIG_KEYS = {
	showNSFW: 'browse.showNSFW',
	showTestListings: 'browse.showTestListings',
} as const

export { createNostrToolsEnvironment } from './nostrToolsEnvironment'
export { createStaticEnvironment, type StaticEnvironmentOptions } from './staticEnvironment'
export { createNappletEnvironment, type NappletRuntimeLike } from './nappletEnvironment'
