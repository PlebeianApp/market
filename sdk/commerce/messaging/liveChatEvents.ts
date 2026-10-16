import type { EventTemplate } from 'nostr-tools/pure'

/** NIP-53 live chat message kind. */
export const LIVE_CHAT_KIND = 1311

export interface CreateLiveChatMessageTemplateInput {
	liveActivityCoord: string
	content: string
	/** Relay hint for the `a` tag; empty string when no connected relay is known. */
	relayHint?: string
	createdAt: number
}

/** Build an unsigned live-chat message template, rooted on the live activity's coordinate. */
export function createLiveChatMessageTemplate(input: CreateLiveChatMessageTemplateInput): EventTemplate {
	const { liveActivityCoord, content, relayHint = '', createdAt } = input
	return {
		kind: LIVE_CHAT_KIND,
		created_at: createdAt,
		content,
		tags: [['a', liveActivityCoord, relayHint, 'root']],
	}
}
