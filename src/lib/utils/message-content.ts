/**
 * Shared utilities for message content extraction and validation
 */

/** Check if content looks like JSON */
export const looksLikeJSON = (content: string): boolean => {
	if (!content) return false
	const trimmed = content.trim()
	return (trimmed.startsWith('{') || trimmed.startsWith('[')) && (trimmed.endsWith('}') || trimmed.endsWith(']'))
}

/** Extract actual content from JSON-wrapped messages (for Kind 14) */
export const extractActualContent = (content: string): string | null => {
	if (!content || !content.trim()) return null

	const trimmed = content.trim()
	if (!looksLikeJSON(trimmed)) return content

	try {
		const parsed = JSON.parse(content)
		if (parsed && typeof parsed === 'object' && 'content' in parsed) {
			const innerContent = parsed.content
			if (typeof innerContent === 'string') {
				return innerContent
			}
		}
	} catch {
		// Malformed JSON, return null to fall back to raw content
	}

	return null
}

/** Validate that a URL uses a safe scheme for display */
export const isSafeImageUrl = (url: string): boolean => {
	try {
		const parsed = new URL(url)
		// Only allow http and https
		return parsed.protocol === 'http:' || parsed.protocol === 'https:'
	} catch {
		// If URL parsing fails, reject it
		return false
	}
}
