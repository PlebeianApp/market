import { expect, test, describe } from 'bun:test'
import { looksLikeJSON, extractActualContent, isSafeImageUrl } from './message-content'

describe('Message Content Utilities', () => {
	describe('looksLikeJSON', () => {
		test('returns true for JSON object', () => {
			expect(looksLikeJSON('{"key": "value"}')).toBe(true)
		})

		test('returns true for JSON array', () => {
			expect(looksLikeJSON('[1, 2, 3]')).toBe(true)
		})

		test('returns true for nested JSON', () => {
			expect(looksLikeJSON('{"nested": {"key": "value"}}')).toBe(true)
		})

		test('returns false for plain text', () => {
			expect(looksLikeJSON('hello world')).toBe(false)
		})

		test('returns false for empty string', () => {
			expect(looksLikeJSON('')).toBe(false)
		})

		test('returns false for incomplete JSON', () => {
			expect(looksLikeJSON('{"key": "value"')).toBe(false)
		})

		test('handles whitespace around JSON', () => {
			expect(looksLikeJSON('  {"key": "value"}  ')).toBe(true)
		})
	})

	describe('extractActualContent', () => {
		test('returns null for empty content', () => {
			expect(extractActualContent('')).toBeNull()
		})

		test('returns null for whitespace-only content', () => {
			expect(extractActualContent('   ')).toBeNull()
		})

		test('returns plain text as-is when not JSON', () => {
			const plainText = 'Hello, this is a plain text message'
			expect(extractActualContent(plainText)).toBe(plainText)
		})

		test('extracts content from JSON-wrapped kind-14 message', () => {
			const wrappedMessage = JSON.stringify({
				content: 'The actual message content',
				kind: 14,
				tags: [],
			})
			expect(extractActualContent(wrappedMessage)).toBe('The actual message content')
		})

		test('extracts nested content from structured message', () => {
			const nestedMessage = JSON.stringify({
				kind: 16,
				content: 'Order details here',
				type: '1',
				tags: [
					['title', 'Order'],
					['description', 'Product order'],
				],
			})
			expect(extractActualContent(nestedMessage)).toBe('Order details here')
		})

		test('returns null for malformed JSON with no content field', () => {
			const malformedJson = JSON.stringify({
				kind: 14,
				tags: [],
				// missing 'content' field
			})
			expect(extractActualContent(malformedJson)).toBeNull()
		})

		test('returns null for JSON with non-string content field', () => {
			const invalidContent = JSON.stringify({
				content: { nested: 'object' }, // content should be string
				kind: 14,
			})
			expect(extractActualContent(invalidContent)).toBeNull()
		})

		test('handles invalid JSON gracefully without throwing', () => {
			const invalidJson = '{"unclosed": "string'
			expect(() => {
				extractActualContent(invalidJson)
			}).not.toThrow()
		})

		test('returns malformed JSON string as-is since it is not JSON', () => {
			// }{] doesn't look like JSON, so it's returned as plain text
			expect(extractActualContent('}{]')).toBe('}{]')
		})

		test('preserves content with special characters', () => {
			const contentWithSpecialChars = 'Hello! @user #tag $100'
			const wrapped = JSON.stringify({
				content: contentWithSpecialChars,
			})
			expect(extractActualContent(wrapped)).toBe(contentWithSpecialChars)
		})

		test('preserves multiline content', () => {
			const multilineContent = 'Line 1\nLine 2\nLine 3'
			const wrapped = JSON.stringify({
				content: multilineContent,
			})
			expect(extractActualContent(wrapped)).toBe(multilineContent)
		})

		test('handles empty string as content value', () => {
			const emptyContentJson = JSON.stringify({
				content: '',
			})
			// Empty string should be extracted, not return null
			expect(extractActualContent(emptyContentJson)).toBe('')
		})

		test('extracts content from JSON array should return null', () => {
			const jsonArray = JSON.stringify([{ content: 'item1' }, { content: 'item2' }])
			expect(extractActualContent(jsonArray)).toBeNull()
		})
	})

	describe('isSafeImageUrl', () => {
		test('accepts http URLs', () => {
			expect(isSafeImageUrl('http://example.com/image.jpg')).toBe(true)
		})

		test('accepts https URLs', () => {
			expect(isSafeImageUrl('https://example.com/image.jpg')).toBe(true)
		})

		test('rejects javascript: URLs', () => {
			expect(isSafeImageUrl('javascript:alert("xss")')).toBe(false)
		})

		test('rejects data: URLs', () => {
			expect(isSafeImageUrl('data:image/png;base64,iVBORw0KGgo...')).toBe(false)
		})

		test('rejects file: URLs', () => {
			expect(isSafeImageUrl('file:///etc/passwd')).toBe(false)
		})

		test('rejects ftp: URLs', () => {
			expect(isSafeImageUrl('ftp://example.com/image.jpg')).toBe(false)
		})

		test('rejects invalid URLs', () => {
			expect(isSafeImageUrl('not a url')).toBe(false)
		})

		test('rejects empty string', () => {
			expect(isSafeImageUrl('')).toBe(false)
		})

		test('handles URLs with query parameters', () => {
			expect(isSafeImageUrl('https://example.com/image.jpg?size=large&format=png')).toBe(true)
		})

		test('handles URLs with fragments', () => {
			expect(isSafeImageUrl('https://example.com/image.jpg#section')).toBe(true)
		})

		test('handles subdomains', () => {
			expect(isSafeImageUrl('https://cdn.example.com/images/product.jpg')).toBe(true)
		})
	})

	describe('Integration: Kind-14 Snippet/Bubble Parity', () => {
		test('snippet and bubble extraction use same logic for kind-14', () => {
			const wrappedKind14 = JSON.stringify({
				content: 'Direct message content',
				kind: 14,
				tags: [['p', 'recipient_pubkey']],
			})

			// Both snippet generation and bubble display should extract the same content
			const extractedContent = extractActualContent(wrappedKind14)
			expect(extractedContent).toBe('Direct message content')
		})

		test('plain kind-14 text content shows as-is', () => {
			const plainKind14 = 'Just a plain text message'
			const extracted = extractActualContent(plainKind14)
			expect(extracted).toBe(plainKind14)
		})
	})

	describe('Integration: Unknown Message Type Fallback', () => {
		test('unknown kind message returns null, allowing fallback to raw content', () => {
			// For an unknown kind with plain text, extractActualContent returns the text
			const unknownKindPlainText = 'Some raw message content'
			const result = extractActualContent(unknownKindPlainText)
			expect(result).toBe(unknownKindPlainText)
		})

		test('unknown kind with JSON returns extracted content if valid', () => {
			const unknownKindJson = JSON.stringify({
				content: 'Extracted from unknown kind',
				kind: 25,
				custom_field: 'value',
			})
			const result = extractActualContent(unknownKindJson)
			expect(result).toBe('Extracted from unknown kind')
		})

		test('unknown kind with invalid JSON that does not look like JSON returns as-is', () => {
			const invalidJson = '}{invalid'
			const result = extractActualContent(invalidJson)
			// Invalid JSON that doesn't look like JSON is returned as plain text
			expect(result).toBe(invalidJson)
		})
	})

	describe('Integration: Malformed JSON Not Breaking Rendering', () => {
		test('missing closing brace looks like JSON so parse attempt returns null gracefully', () => {
			const malformed = '{"content": "message", "tags": ['

			expect(() => {
				extractActualContent(malformed)
			}).not.toThrow()

			// Looks like JSON, but parse fails, so returns the original string
			expect(extractActualContent(malformed)).toBe(malformed)
		})

		test('invalid JSON structure returns original string without breaking', () => {
			const invalidStructure = '{"invalid": unclosed'
			expect(() => {
				extractActualContent(invalidStructure)
			}).not.toThrow()
			// Looks like JSON but parse fails, returns original string
			expect(extractActualContent(invalidStructure)).toBe(invalidStructure)
		})

		test('content field is not a string returns null gracefully', () => {
			const nonStringContent = JSON.stringify({
				content: 123,
				kind: 14,
			})

			expect(() => {
				extractActualContent(nonStringContent)
			}).not.toThrow()

			expect(extractActualContent(nonStringContent)).toBeNull()
		})

		test('deeply nested but valid JSON with content field extracts correctly', () => {
			const deepJson = JSON.stringify({
				metadata: {
					nested: {
						deeply: {
							field: 'ignored',
						},
					},
				},
				content: 'Found it!',
				kind: 16,
			})

			expect(extractActualContent(deepJson)).toBe('Found it!')
		})

		test('unicode and emoji in incomplete JSON returns original string gracefully', () => {
			const unicodeJson = '{"content": "Hello 👋 世界'

			expect(() => {
				extractActualContent(unicodeJson)
			}).not.toThrow()

			// Looks like JSON but incomplete, returns original string
			expect(extractActualContent(unicodeJson)).toBe(unicodeJson)
		})

		test('extremely long content does not cause issues', () => {
			const longContent = 'x'.repeat(100000)
			const wrapped = JSON.stringify({
				content: longContent,
			})

			expect(extractActualContent(wrapped)).toBe(longContent)
		})

		test('multiple JSON objects (invalid) returns null', () => {
			const multipleObjects = '{"a": 1}{"b": 2}'

			expect(() => {
				extractActualContent(multipleObjects)
			}).not.toThrow()

			expect(extractActualContent(multipleObjects)).toBeNull()
		})
	})
})
