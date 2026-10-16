import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProfileAvatarView, ProfileNameView } from './ProfileViews'

describe('profile views', () => {
	test('name links to the profile and truncates long names', () => {
		const markup = renderToStaticMarkup(<ProfileNameView pubkey="abc" name={'x'.repeat(30)} fallbackLabel="npub1..." />)
		expect(markup).toContain('href="/profile/abc"')
		expect(markup).toContain(`>${'x'.repeat(20)}<`)
	})

	test('name falls back to the host label, can render without a link, and shows a skeleton while loading', () => {
		expect(renderToStaticMarkup(<ProfileNameView pubkey="abc" fallbackLabel="npub1abc...wxyz" disableLink />)).toBe(
			'<span class="break-all">npub1abc...wxyz</span>',
		)
		expect(renderToStaticMarkup(<ProfileNameView pubkey="abc" fallbackLabel="x" isLoading />)).toContain('data-slot="skeleton"')
	})

	test('avatar shows the initial when no picture is set', () => {
		expect(renderToStaticMarkup(<ProfileAvatarView name="alice" />)).toContain('>A</span>')
		expect(renderToStaticMarkup(<ProfileAvatarView />)).toContain('>N</span>')
	})
})
