/**
 * `@plebeian/contract` — the overarching contract (spec: `CONTRACT.md`).
 *
 * The only artifact shared between implementations. It defines:
 *   · what a module is handed (`ModuleEnvironment`) — the tool set, grouped by grant;
 *   · the vocabulary every module and host spells the same way (config keys, token names, reason codes);
 *   · the **injectable defaults** a build inlines or a host overrides (`TOKEN_FLOOR`);
 *   · the trust-boundary labels every implementation must state.
 *
 * It contains no I/O, no framework and no host. The two implementations — `@plebeian/web` and
 * `@plebeian/napplet` — depend on this and on nothing else shared. Modules (`@plebeian/product`,
 * `@plebeian/browse`) depend on this and never on an implementation, so no module can tell which one
 * it is running under.
 *
 * Design decision D9 (2026-09-22): **a read failure is a value, not an exception and not an empty
 * list.** The application currently swallows relay failures into `[]` with a `console.warn`
 * (`src/queries/products.tsx:137-139`) and converts a search timeout into `[]` as well
 * (`:1039-1049`), which makes an outage indistinguishable from "nothing found" — a truthfulness defect
 * the browsing spec calls out (§3.4). So `read` returns `ReadResult`, and a caller cannot render
 * "nothing found" for a network failure without deliberately discarding the reason.
 */

/**
 * A Nostr filter, as data. Deliberately structural, not tied to any client's type.
 *
 * Owned by the **contract**, not by a module: it is the shape a module uses to ask the host for
 * anything, so it must be the same shape in every module and every implementation. A module builds
 * these; an implementation executes them.
 */
export interface QueryFilter {
	kinds: number[]
	limit?: number
	ids?: string[]
	authors?: string[]
	until?: number
	since?: number
	search?: string
	'#t'?: string[]
	'#d'?: string[]
	'#a'?: string[]
	'#p'?: string[]
}

/** The contract revision this package implements. See `CONTRACT.md` §5 for the three version tracks. */
export const CONTRACT_VERSION = 'contract/0.1.0-draft' as const

/** Which trust boundary an implementation sits on (`CONTRACT.md` §4). A reader must never infer it. */
export type TrustBoundary = 'cms-component' | 'napplet'

/**
 * An implementation names itself, its boundary and the contract revision it satisfies.
 *
 * This exists because the prototype shipped two implementations and a reader could not tell which
 * boundary either sat on (alignment review, drift D-7). Declaring it makes the property checkable
 * instead of implied.
 */
export interface ImplementationDescriptor {
	readonly id: string
	readonly boundary: TrustBoundary
	readonly contractVersion: string
	/** Capabilities this implementation can grant. A module asks; the host decides. */
	readonly grants: readonly Capability[]
}

/** Capabilities a module may request. Nothing gets `keys:*` (`CONTRACT.md` §2). */
export type Capability = 'outbox:read' | 'outbox:stream' | 'resource' | 'theme' | 'config' | 'link' | 'inc'

/**
 * Why a read did not succeed. **Codes, not prose** — the surface owns the wording (`CONTRACT.md` §3).
 */
export type ReadFailureReason = 'timeout' | 'transport' | 'no-relays'

export type ReadResult =
	| {
			ok: true
			events: readonly RawEvent[]
			/** True when the read returned nothing **and that is trustworthy**. */
			empty: true
	  }
	| { ok: true; events: readonly RawEvent[]; empty: false }
	| { ok: false; reason: ReadFailureReason; detail?: string }

/** The shape a relay gives us. Untrusted: a module's parser decides what it means. */
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
	/** Restrict to these relays. **The host decides; a component never does.** */
	relayUrls?: readonly string[]
}

export interface ThemeTokens {
	background: string
	foreground: string
	primary: string
	[key: string]: string
}

/**
 * What a module may ask of its host.
 *
 * Read-only today, deliberately: this phase needs no signing and no funds. The shape reserves room for
 * them rather than pretending they will never arrive — when signing lands it is another method here and
 * modules written against `read` do not change.
 *
 * Reserved but **ungranted** in this contract: `sign`, `publish`, and value transfer (`CONTRACT.md` §2).
 */
export interface ModuleEnvironment {
	readonly descriptor: ImplementationDescriptor
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

/**
 * The token floor: the values a component falls back to when a host supplies no theme.
 *
 * **This is an injectable default, not a component's own styling.** It lives here so it exists exactly
 * once. A build inlines it (stand-alone artifact) or leaves it external and lets the host override it;
 * either way no component module contains a colour literal (`MODULARIZATION.md` §3, alignment drift
 * D-3).
 */
export const TOKEN_FLOOR: ThemeTokens = {
	background: '#0b0b0f',
	foreground: '#f4f4f5',
	primary: '#f7931a',
	muted: '#a1a1aa',
	border: '#27272a',
	surface: '#141419',
	danger: '#f87171',
	warning: '#fbbf24',
}

/** Config keys the viewer owns. Named once so no host invents its own spelling. */
export const CONFIG_KEYS = {
	showNSFW: 'browse.showNSFW',
	showTestListings: 'browse.showTestListings',
} as const

export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS]

/**
 * The relay set for NIP-50 search — an **injectable default, not a component's decision**.
 *
 * The browsing spec keeps relay choice RUNTIME-ONLY (§4) because a sandbox cannot choose relays at all.
 * It lives here, once, rather than inside the web implementation, so a host overrides a value instead of
 * duplicating one (alignment review drift D-3: the prototype hard-coded this in the binding).
 */
export const DEFAULT_SEARCH_RELAYS = ['wss://relay.nostr.band', 'wss://search.nos.today', 'wss://relay.damus.io'] as const

export { createStaticEnvironment, type StaticEnvironmentOptions } from './testing'
