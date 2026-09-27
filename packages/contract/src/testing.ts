/**
 * A fixture binding — the same interface, no network.
 *
 * Used by the tests and by the projections demo, so that "the component is environment-agnostic" can
 * be demonstrated without a relay. It can also be told to *fail*, which is how the failure-vs-empty
 * distinction gets exercised.
 */
import type { ModuleEnvironment, RawEvent, ReadResult, ThemeTokens } from './index'
import { CONTRACT_VERSION, TOKEN_FLOOR } from './index'

export interface StaticEnvironmentOptions {
	events: readonly RawEvent[]
	/** Force every read to fail, to prove a surface distinguishes an outage from an empty result. */
	failWith?: ReadResult & { ok: false }
	/** Simulated latency, in ms. */
	latencyMs?: number
	theme?: ThemeTokens
	config?: Record<string, string | undefined>
}

export const createStaticEnvironment = (options: StaticEnvironmentOptions): ModuleEnvironment => {
	const wait = async () => {
		if (options.latencyMs) await new Promise((resolve) => setTimeout(resolve, options.latencyMs))
	}

	const read = async (filters: readonly unknown[]): Promise<ReadResult> => {
		await wait()
		if (options.failWith) return options.failWith

		/**
		 * Several filters in one request are **OR-ed**, not AND-ed (NIP-01). Each filter is applied
		 * independently to the whole set, then the results are unioned and deduped.
		 *
		 * An earlier version mutated a running `matched` set and kept the previous value when a filter
		 * matched nothing — which silently turned "no collections exist" into "here are all the
		 * listings". A test caught it; worth recording because the failure mode is exactly the one the
		 * architecture is trying to prevent.
		 */
		const matchOne = (filter: Record<string, unknown>): RawEvent[] => {
			const kinds = filter.kinds as number[] | undefined
			const ids = filter.ids as string[] | undefined
			const authors = filter.authors as string[] | undefined
			const dTags = filter['#d'] as string[] | undefined
			const tTags = filter['#t'] as string[] | undefined
			const limit = filter.limit as number | undefined

			const subset = options.events.filter((event) => {
				if (kinds && !kinds.includes(event.kind)) return false
				if (ids && !ids.includes(event.id)) return false
				if (authors && !authors.includes(event.pubkey)) return false
				if (dTags && !event.tags.some((t) => t[0] === 'd' && dTags.includes(t[1] ?? ''))) return false
				if (tTags && !event.tags.some((t) => t[0] === 't' && tTags.includes(t[1] ?? ''))) return false
				return true
			})
			return limit !== undefined ? subset.slice(0, limit) : subset
		}

		const unioned = (filters as Array<Record<string, unknown>>).flatMap(matchOne)
		const unique = [...new Map(unioned.map((event) => [event.id, event])).values()]
		return { ok: true, events: unique, empty: unique.length === 0 }
	}

	return {
		descriptor: {
			id: '@plebeian/contract/testing',
			boundary: 'in-process',
			contractVersion: CONTRACT_VERSION,
			grants: ['outbox:read', 'outbox:stream', 'resource', 'theme', 'config', 'link'],
		},
		nostr: {
			read,
			stream: (_filters, onEvent) => {
				// Fixtures arrive on a microtask, so streaming code paths are still exercised.
				void wait().then(() => options.events.forEach(onEvent))
				return () => {}
			},
		},
		resource: async (url: string) => url,
		theme: { tokens: options.theme ?? TOKEN_FLOOR, onChanged: () => () => {} },
		config: {
			get: (key) => options.config?.[key],
			onChanged: () => () => {},
		},
		link: { open: () => {} },
		now: () => 1_700_000_000_000,
	}
}
