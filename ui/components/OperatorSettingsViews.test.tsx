import { describe, expect, test } from 'bun:test'
import { Shield, Trash2 } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AddTeamMemberCard, RoleActionButtons, SettingsAccessDenied, TeamPermissionsCard, TeamRoleSection } from './OperatorSettingsViews'

describe('operator settings views', () => {
	test('access denied shows the page header and host message', () => {
		const markup = renderToStaticMarkup(
			<SettingsAccessDenied header={{ icon: Shield, title: 'Team', description: 'Manage your team settings' }} message="No access." />,
		)
		expect(markup).toContain('Team')
		expect(markup).toContain('Access Denied')
		expect(markup).toContain('No access.')
	})

	test('role section renders host rows or an empty state', () => {
		expect(renderToStaticMarkup(<TeamRoleSection role="admin" members={[]} />)).toContain('No administrators found')
		expect(renderToStaticMarkup(<TeamRoleSection role="editor" members={[{ key: 'a', content: <span>alice</span> }]} />)).toContain(
			'<span>alice</span>',
		)
	})

	test('role action buttons render only host-provided actions with labels', () => {
		expect(renderToStaticMarkup(<RoleActionButtons actions={[]} disabled={false} />)).toBe('')
		const markup = renderToStaticMarkup(
			<RoleActionButtons actions={[{ label: 'Remove All Roles', icon: Trash2, tone: 'text-red-600', onSelect: () => {} }]} disabled />,
		)
		expect(markup).toContain('aria-label="Remove All Roles"')
		expect(markup).toContain('disabled=""')
	})

	test('add-member and permissions cards reflect role copy', () => {
		expect(renderToStaticMarkup(<AddTeamMemberCard role="admin" search={<input />} />)).toContain('Add Administrator')
		expect(renderToStaticMarkup(<TeamPermissionsCard isOwner={false} />)).toContain('cannot add/remove administrators')
	})
})
