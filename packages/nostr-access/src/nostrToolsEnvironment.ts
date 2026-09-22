/**
 * The in-process binding: the environment implemented over `nostr-tools`.
 *
 * This is the "regular web app" adapter. It is deliberately *not* the application's own port
 * (`src/lib/nostr/io.ts`) — a package must not import from `src/`, and the explorer has to prove it
 * can run without the app. In production this binding would wrap the port instead, so the ADR-0002
 * migration is preserved rather than forked (recorded as decision D10).
 *
 * Failure mapping is the interesting part: a timeout, a transport error and "no relays configured"
 * are three different codes, and none of them is an empty list.
 */
import { SimplePool } from 'nostr-tools/pool'

import type { BrowseEnvironment, RawEvent, ReadOptions, ReadResult, ThemeTokens } from './index'
import { CONFIG_KEYS, defaultTheme } from './index'

export interface NostrToolsEnvironmentOptions {
	relays: readonly string[]
	timeoutMs?: number
	theme?: ThemeTokens
	config?: Record<string, string | undefined>
	/** Overridable so tests and the explorer can render deterministically. */
	now?: () => number
	/** Only used by the browser: resolves a URL to an object URL. Omitted in Node. */
	resolveResource?: (url: string) => Promise<string>
}

const DEFAULT_TIMEOUT_MS = 8000

/**
 * The relay set for NIP-50 search. Host policy, not a component's decision — the browsing spec keeps
 * this RUNTIME-ONLY (§4) because a sandbox cannot choose relays at all.
 */
export const SEARCH_RELAYS = ['wss://relay.nostr.band', 'wss://search.nos.today', 'wss://relay.damus.io'] as const

export const createNostrToolsEnvironment = (options: NostrToolsEnvironmentOptions): BrowseEnvironment => {
	const pool = new SimplePool()
	const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
	const listeners = new Set<(key: string, value: string | undefined) => void>()
	const config = { ...options.config }

	const relaysFor = (requested?: readonly string[]): readonly string[] => (requested?.length ? requested : options.relays)

	const read = async (filters: readonly unknown[], readOptions?: ReadOptions): Promise<ReadResult> => {
		const relays = relaysFor(readOptions?.relayUrls)
		if (relays.length === 0) return { ok: false, reason: 'no-relays' }

		const timeoutMs = readOptions?.timeoutMs ?? defaultTimeout
		try {
			/**
			 * `querySync` takes **one** filter per relay request, while our interface takes a list of
			 * filters that are OR-ed. So each filter is queried and the results merged — passing the array
			 * straight through produces a malformed REQ that relays ignore, which surfaces as a truthful
			 * "no results" and hides the bug (found the hard way while building the explorer).
			 */
			const perFilter = await Promise.race([
				Promise.all(
					filters.map((filter) => pool.querySync([...relays], filter as never, { maxWait: timeoutMs }) as unknown as Promise<RawEvent[]>),
				),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
			])

			// Dedupe by id: a filter may overlap, and the same event may arrive from several relays.
			const unique = [...new Map(perFilter.flat().map((event) => [event.id, event])).values()]
			return { ok: true, events: unique, empty: unique.length === 0 }
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error)
			return { ok: false, reason: detail === 'timeout' ? 'timeout' : 'transport', detail }
		}
	}

	const stream = (filters: readonly unknown[], onEvent: (event: RawEvent) => void, readOptions?: ReadOptions): (() => void) => {
		const relays = relaysFor(readOptions?.relayUrls)
		if (relays.length === 0) return () => {}
		const sub = pool.subscribeMany([...relays], filters as never, {
			onevent: (event) => onEvent(event as unknown as RawEvent),
		})
		return () => sub.close()
	}

	return {
		nostr: { read, stream },
		resource:
			options.resolveResource ??
			(async (url: string) => {
				// In a non-browser context there is nothing to resolve to; the caller renders a placeholder.
				return url
			}),
		theme: {
			tokens: options.theme ?? defaultTheme,
			onChanged: () => () => {},
		},
		config: {
			get: (key) => config[key],
			onChanged: (handler) => {
				listeners.add(handler)
				return () => listeners.delete(handler)
			},
		},
		link: {
			open: (target) => {
				if (typeof window !== 'undefined') window.open(target, '_blank', 'noopener,noreferrer')
			},
		},
		now: options.now ?? (() => Date.now()),
	}
}

/** The viewer's NSFW preference, read through the environment. */
export const showNSFW = (env: BrowseEnvironment): boolean => env.config.get(CONFIG_KEYS.showNSFW) === 'true'
