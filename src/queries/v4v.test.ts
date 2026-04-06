import { describe, expect, test } from 'bun:test'
import { resolveV4VConfigurationState } from '@/queries/v4v'

describe('resolveV4VConfigurationState', () => {
	test('resolves no V4V event to never-configured', () => {
		expect(resolveV4VConfigurationState(null)).toBe('never-configured')
	})

	test('resolves empty V4V event content to configured-zero', () => {
		expect(resolveV4VConfigurationState({ content: '[]' } as any)).toBe('configured-zero')
	})

	test('resolves non-empty V4V event content to configured-nonzero', () => {
		expect(resolveV4VConfigurationState({ content: '[["zap","abc","0.05"]]' } as any)).toBe('configured-nonzero')
	})
})
