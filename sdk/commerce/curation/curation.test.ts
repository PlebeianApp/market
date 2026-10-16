import { describe, expect, test } from 'bun:test'
import { createTestPublishContext } from '../../core/testing/publishContext'
import { buildBlacklistEventData, buildCurationListEventData, planRoleChange, readCurationListItems } from './curationLists'
import { publishBlacklistWorkflow, publishCurationListWorkflow, publishRoleChangeWorkflow } from './curationPublish'

const pk = (char: string) => char.repeat(64)
const productCoord = `30402:${pk('a')}:mug`

describe('curation list events', () => {
	test('featured products carry title and content; other lists are bare', () => {
		expect(buildCurationListEventData('featuredProducts', [productCoord])).toEqual({
			kind: 30405,
			content: 'Featured products collection',
			tags: [
				['d', 'featured_products'],
				['title', 'Featured Products'],
				['a', productCoord],
			],
		})
		expect(buildCurationListEventData('featuredUsers', [pk('b')])).toEqual({
			kind: 30000,
			content: '',
			tags: [
				['d', 'featured_users'],
				['p', pk('b')],
			],
		})
	})

	test('blacklist is a NIP-51 mute list with p then a tags', () => {
		const data = buildBlacklistEventData({
			blacklistedPubkeys: [pk('c')],
			blacklistedProducts: [productCoord],
			blacklistedCollections: ['30405:x:y'],
		})
		expect(data).toEqual({
			kind: 10000,
			content: '',
			tags: [
				['p', pk('c')],
				['a', productCoord],
				['a', '30405:x:y'],
			],
		})
	})

	test('reads list items by the list item tag', () => {
		expect(
			readCurationListItems('admins', [
				['d', 'admins'],
				['p', pk('a')],
				['a', productCoord],
				['p', ''],
			]),
		).toEqual([pk('a')])
	})
})

describe('curation publish workflows', () => {
	test('rejects items of the wrong kind or shape before signing', async () => {
		const { context, published } = createTestPublishContext()
		expect(await publishCurationListWorkflow(context, 'featuredAuctions', [productCoord])).toEqual({
			ok: false,
			issue: 'invalid-item',
			item: productCoord,
		})
		expect(
			await publishBlacklistWorkflow(context, { blacklistedPubkeys: ['nope'], blacklistedProducts: [], blacklistedCollections: [] }),
		).toEqual({
			ok: false,
			issue: 'invalid-item',
			item: 'nope',
		})
		expect(published).toHaveLength(0)
	})

	test('refuses an empty admin list but allows an empty editor list', async () => {
		const { context, published } = createTestPublishContext()
		expect(await publishCurationListWorkflow(context, 'admins', [])).toEqual({ ok: false, issue: 'admins-required' })
		expect((await publishCurationListWorkflow(context, 'editors', [])).ok).toBe(true)
		expect(published).toHaveLength(1)
	})

	test('role changes publish admins before editors', async () => {
		const { context, published } = createTestPublishContext()
		const outcome = await publishRoleChangeWorkflow(context, { admins: [pk('a'), pk('b')], editors: [] })

		expect(outcome.ok).toBe(true)
		expect(published.map((event) => event.tags[0])).toEqual([
			['d', 'admins'],
			['d', 'editors'],
		])
	})
})

describe('planRoleChange', () => {
	const owner = pk('o')
	const admin = pk('a')
	const editor = pk('e')
	const state = { admins: [owner, admin], editors: [editor], owner }

	test('promotes an editor to admin and removes them from editors', () => {
		expect(planRoleChange('promoteEditorToAdmin', state, editor)).toEqual({
			ok: true,
			value: { admins: [owner, admin, editor], editors: [] },
		})
		expect(planRoleChange('promoteEditorToAdmin', state, pk('z'))).toEqual({ ok: false, error: 'not-editor' })
	})

	test('protects the owner and the last admin', () => {
		expect(planRoleChange('demoteAdminToEditor', state, owner)).toEqual({ ok: false, error: 'owner-protected' })
		expect(planRoleChange('removeAdmin', { admins: [admin], editors: null }, admin)).toEqual({ ok: false, error: 'last-admin' })
		expect(planRoleChange('removeFromAllRoles', state, owner)).toEqual({ ok: false, error: 'owner-protected' })
	})

	test('demoting an admin adds them to editors once', () => {
		expect(planRoleChange('demoteAdminToEditor', state, admin)).toEqual({ ok: true, value: { admins: [owner], editors: [editor, admin] } })
	})

	test('reports missing lists and users without roles', () => {
		expect(planRoleChange('removeEditor', { admins: null, editors: null }, editor)).toEqual({ ok: false, error: 'no-editor-list' })
		expect(planRoleChange('removeFromAllRoles', state, pk('z'))).toEqual({ ok: false, error: 'no-roles' })
		expect(planRoleChange('promoteUserToEditor', state, admin)).toEqual({ ok: false, error: 'already-admin' })
	})
})
