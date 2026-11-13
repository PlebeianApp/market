import { describe, expect, test } from 'bun:test'
import { ExtensionActionError } from '@sdk/core/extensions'
import { extensionErrorMessage, selectExtensionDescriptors } from './extensions'

describe('extension queries', () => {
	test('selects parsed descriptors and tolerates missing or malformed config', () => {
		expect(selectExtensionDescriptors(undefined)).toEqual([])
		expect(selectExtensionDescriptors({ extensions: 'nope' as never })).toEqual([])
		const descriptors = selectExtensionDescriptors({
			extensions: [
				{ id: 'ok', version: '1.0.0', displayName: 'OK', capabilities: ['a.b'], config: {}, actions: [] },
				{ id: 'Bad Id', version: '1.0.0', displayName: 'Bad', capabilities: [], config: {}, actions: [] },
			],
		})
		expect(descriptors.map((descriptor) => descriptor.id)).toEqual(['ok'])
	})

	test('maps action errors to user copy without provider detail', () => {
		expect(extensionErrorMessage(new ExtensionActionError('rate_limited'))).toContain('Too many requests')
		expect(extensionErrorMessage(new ExtensionActionError('extension_misconfigured', 'Provider rejected sk-secret'))).toBe(
			'The extension is temporarily unavailable.',
		)
	})
})
