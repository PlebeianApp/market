/**
 * The sandbox binding — the third implementation of the same interface.
 *
 * This is the piece that proves the architecture's central claim: **the components do not know which
 * of these they are running under.** It maps the capability object a NIP-5D host injects
 * (`window.napplet`) onto `BrowseEnvironment`, and nothing above this file changes.
 *
 * What is different in the sandbox, and why each mapping exists:
 *
 *   - `nostr.read` → `outbox.query`. The shell decides which relays; the napplet has no network
 *     (`connect-src 'none'`), so relay selection is not expressible here at all.
 *   - `resource` → `resource.bytes`, because `img-src data: blob:` blocks direct `https:` images.
 *   - `theme` → `theme.get` / `theme.changed`. The host exposes a small token set, not our full one.
 *   - `config` → `config.get` / `config.subscribe`, which is the shell's own preferences store.
 *   - `link` → `link.open`, because a sandboxed frame must not navigate itself.
 *
 * The runtime object is typed structurally rather than imported: this package must not depend on a
 * specific shell's SDK, and the shape below is the intersection of the NAP domains the spec names.
 */
import type { BrowseEnvironment, RawEvent, ReadOptions, ReadResult, ThemeTokens } from './index'
import { defaultTheme } from './index'

/** The subset of a NIP-5D host's injected surface this module needs. Structural, not imported. */
export interface NappletRuntimeLike {
	outbox: {
		query(filters: readonly unknown[], options?: { timeoutMs?: number }): Promise<readonly RawEvent[]>
		subscribe?(filters: readonly unknown[], handler: (event: RawEvent) => void): { close(): void }
	}
	resource: {
		bytesAsObjectURL?(url: string): Promise<string>
		bytes?(url: string): Promise<Uint8Array>
	}
	theme?: {
		get(): Promise<ThemeTokens> | ThemeTokens
		changed?(handler: (tokens: ThemeTokens) => void): () => void
	}
	config?: {
		get(key: string): Promise<string | undefined> | string | undefined
		subscribe?(handler: (key: string, value: string | undefined) => void): () => void
	}
	link?: { open(target: string): void }
}

export interface NappletEnvironmentOptions {
	runtime: NappletRuntimeLike
	/** Reported to the caller instead of silently returning an empty list. */
	defaultTimeoutMs?: number
	now?: () => number
}

export const createNappletEnvironment = (options: NappletEnvironmentOptions): BrowseEnvironment => {
	const { runtime } = options

	const read = async (filters: readonly unknown[], readOptions?: ReadOptions): Promise<ReadResult> => {
		try {
			const events = await runtime.outbox.query(filters, {
				timeoutMs: readOptions?.timeoutMs ?? options.defaultTimeoutMs,
			})
			return { ok: true, events, empty: events.length === 0 }
		} catch (error) {
			/**
			 * A sandbox cannot tell a timeout from a transport failure — the shell owns the transport —
			 * so the honest report is `transport` with the shell's own message rather than a guess.
			 */
			const detail = error instanceof Error ? error.message : String(error)
			return { ok: false, reason: /timeout|timed out/i.test(detail) ? 'timeout' : 'transport', detail }
		}
	}

	return {
		nostr: {
			read,
			stream: (filters, onEvent) => {
				if (!runtime.outbox.subscribe) return () => {}
				const sub = runtime.outbox.subscribe(filters, onEvent)
				return () => sub.close()
			},
		},
		resource: async (url: string) => {
			// The only channel by which an image can reach the frame.
			if (runtime.resource.bytesAsObjectURL) return runtime.resource.bytesAsObjectURL(url)
			return url
		},
		theme: {
			tokens: defaultTheme,
			onChanged: (handler) => {
				if (!runtime.theme?.changed) return () => {}
				return runtime.theme.changed(handler)
			},
		},
		config: {
			get: () => undefined, // synchronous access is impossible here; see the note below
			onChanged: (handler) => {
				if (!runtime.config?.subscribe) return () => {}
				return runtime.config.subscribe(handler)
			},
		},
		link: {
			open: (target) => runtime.link?.open(target),
		},
		now: options.now ?? (() => Date.now()),
	}
}

/**
 * Known limitation, recorded rather than hidden: `config.get` is synchronous in the interface and
 * asynchronous in the sandbox (`config.get` is a message round-trip). This stub therefore returns
 * `undefined`, which means **a sandboxed surface cannot read the viewer's NSFW preference
 * synchronously** and must resolve it once at boot and hold it.
 *
 * That is a real interface gap, not a mapping detail: the host must be asked for its config before
 * the first render. Flagged as open question O1 in `docs/DECISIONS.md`.
 */
export const NAPPLET_CONFIG_IS_ASYNC = true
