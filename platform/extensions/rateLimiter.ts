import type { ExtensionActionRateLimit } from '@sdk/core/extensions'

export interface RateLimitDecision {
	allowed: boolean
	remaining: number
	retryAfterSeconds: number
}

/**
 * Sliding-window limiter keyed by extension, action, and caller pubkey. The key deliberately omits the
 * transport, so HTTP and ContextVM share one budget. In-memory: limits reset on restart (ADR-0023 open question).
 */
export class ExtensionRateLimiter {
	private readonly hits = new Map<string, number[]>()

	constructor(private readonly maxKeys = 50_000) {}

	consume(params: {
		extensionId: string
		actionName: string
		pubkey: string
		limit: ExtensionActionRateLimit
		nowMs: number
	}): RateLimitDecision {
		const { limit, nowMs } = params
		const key = `${params.extensionId}\u0000${params.actionName}\u0000${params.pubkey}`
		const windowStart = nowMs - limit.windowSeconds * 1000
		const recent = (this.hits.get(key) ?? []).filter((time) => time > windowStart)

		if (recent.length >= limit.perPubkey) {
			this.hits.set(key, recent)
			const retryAfterMs = recent[0] + limit.windowSeconds * 1000 - nowMs
			return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
		}

		recent.push(nowMs)
		this.hits.delete(key)
		this.hits.set(key, recent)
		this.evictOverflow()
		return { allowed: true, remaining: limit.perPubkey - recent.length, retryAfterSeconds: 0 }
	}

	get trackedKeys(): number {
		return this.hits.size
	}

	// Map iteration order is insertion order, and keys are re-inserted on use, so this drops least-recent keys.
	private evictOverflow() {
		while (this.hits.size > this.maxKeys) {
			const oldest = this.hits.keys().next().value
			if (oldest === undefined) return
			this.hits.delete(oldest)
		}
	}
}
