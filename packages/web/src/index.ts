/**
 * `@plebeian/web` — the regular-web implementation of the contract.
 *
 * In-process, over `nostr-tools`. This is the higher-trust boundary: it runs with the platform's own
 * capabilities, which is what the web app and the CMS both need (CONTRACT.md §4).
 *
 * It is deliberately *not* the application's own port (`src/lib/nostr/io.ts`) — a package must not import
 * from `src/`, and the explorer has to prove it can run without the app. In production this would wrap
 * the port instead, so the ADR-0002 migration is preserved rather than forked (decision D10).
 *
 * Failure mapping is the interesting part: a timeout, a transport error and "no relays configured" are
 * three different codes, and none of them is an empty list.
 *
 * It depends on `@plebeian/contract` and nothing else shared. Implementations do not share code with each
 * other, only the contract (spec: `packages/CONTRACT.md`).
 */
import { SimplePool } from 'nostr-tools/pool'

import type { ModuleEnvironment, QueryFilter, RawEvent, ReadOptions, ReadResult, ThemeTokens } from '@plebeian/contract'
import { CONTRACT_VERSION, DEFAULT_SEARCH_RELAYS, TOKEN_FLOOR } from '@plebeian/contract'

export interface NostrToolsEnvironmentOptions {
	/** The host's relay set. Relay choice is RUNTIME-ONLY (browsing spec §4): a sandbox cannot make it. */
	relays: readonly string[]
	/** NIP-50 search relays. Injectable — the default lives in the contract, not in this file. */
	searchRelays?: readonly string[]
	timeoutMs?: number
	/** Overrides the contract's token floor. A host supplies its theme instead of copying values. */
	theme?: ThemeTokens
	config?: Record<string, string | undefined>
	/** Overridable so tests and the explorer can render deterministically. */
	now?: () => number
	/** Only used by the browser: resolves a URL to an object URL. Omitted in Node. */
	resolveResource?: (url: string) => Promise<string>
}

const DEFAULT_TIMEOUT_MS = 8000

/** The search relay set this implementation will use: the host's, or the contract's injectable default. */
export const resolveSearchRelays = (options: Pick<NostrToolsEnvironmentOptions, 'searchRelays'>): readonly string[] =>
	options.searchRelays?.length ? options.searchRelays : DEFAULT_SEARCH_RELAYS

export const createNostrToolsEnvironment = (options: NostrToolsEnvironmentOptions): ModuleEnvironment => {
	const pool = new SimplePool()
	const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
	const listeners = new Set<(key: string, value: string | undefined) => void>()
	const config = { ...options.config }

	const relaysFor = (requested?: readonly string[]): readonly string[] => (requested?.length ? requested : options.relays)

	const read = async (filters: readonly QueryFilter[], readOptions?: ReadOptions): Promise<ReadResult> => {
		const relays = relaysFor(readOptions?.relayUrls)
		if (relays.length === 0) return { ok: false, reason: 'no-relays' }

		const timeoutMs = readOptions?.timeoutMs ?? defaultTimeout
		try {
			/**
			 * `querySync` takes **one** filter per relay request, while the contract's interface takes a list
			 * of filters that are OR-ed. So each filter is queried and the results merged — passing the array
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

	const stream = (filters: readonly QueryFilter[], onEvent: (event: RawEvent) => void, readOptions?: ReadOptions): (() => void) => {
		const relays = relaysFor(readOptions?.relayUrls)
		if (relays.length === 0) return () => {}
		const sub = pool.subscribeMany([...relays], filters as never, {
			onevent: (event) => onEvent(event as unknown as RawEvent),
		})
		return () => sub.close()
	}

	return {
		descriptor: {
			id: '@plebeian/web',
			boundary: 'in-process',
			contractVersion: CONTRACT_VERSION,
			grants: ['outbox:read', 'outbox:stream', 'resource', 'theme', 'config', 'link'],
		},
		nostr: { read, stream },
		resource:
			options.resolveResource ??
			(async (url: string) => {
				// In a non-browser context there is nothing to resolve to; the caller renders a placeholder.
				return url
			}),
		theme: {
			tokens: options.theme ?? TOKEN_FLOOR,
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
export const showNSFW = (env: ModuleEnvironment): boolean => env.config.get(CONFIG_KEYS.showNSFW) === 'true'
