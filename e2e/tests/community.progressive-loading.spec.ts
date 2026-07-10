import { test, expect, type Page } from '@playwright/test'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import {
	COMMUNITY_QUERY_FIXTURE_CALLS_STORAGE_KEY_PREFIX,
	COMMUNITY_QUERY_FIXTURE_STORAGE_KEY,
	type CommunityQueryFixtureStep,
} from '../../src/lib/tests/communityQueryFixtures'

type CollectionFixtureEvent = {
	id: string
	pubkey: string
	created_at: number
	kind: number
	tags: string[][]
	content: string
	sig: string
}

type CommunityQueryFixtures = {
	collections?: CommunityQueryFixtureStep<CollectionFixtureEvent[]> | CommunityQueryFixtureStep<CollectionFixtureEvent[]>[]
	merchants?: CommunityQueryFixtureStep<string[]> | CommunityQueryFixtureStep<string[]>[]
}

function collectionFixture({
	dTag,
	title,
	summary,
	pubkey = devUser1.pk,
}: {
	dTag: string
	title: string
	summary: string
	pubkey?: string
}): CollectionFixtureEvent {
	return {
		id: `fixture-${dTag}`,
		pubkey,
		created_at: 1_700_000_000,
		kind: 30405,
		tags: [
			['d', dTag],
			['title', title],
			['summary', summary],
			['image', 'https://placehold.co/600x600/png'],
		],
		content: summary,
		sig: 'fixture',
	}
}

async function useCommunityQueryFixtures(page: Page, fixtures: CommunityQueryFixtures) {
	await page.addInitScript(
		({ callsStorageKeyPrefix, fixtures, storageKey }) => {
			if (!window.localStorage.getItem(storageKey)) {
				window.localStorage.setItem(storageKey, JSON.stringify(fixtures))
				window.sessionStorage.removeItem(`${callsStorageKeyPrefix}collections`)
				window.sessionStorage.removeItem(`${callsStorageKeyPrefix}merchants`)
			}
		},
		{
			callsStorageKeyPrefix: COMMUNITY_QUERY_FIXTURE_CALLS_STORAGE_KEY_PREFIX,
			fixtures,
			storageKey: COMMUNITY_QUERY_FIXTURE_STORAGE_KEY,
		},
	)
}

async function setCommunityQueryFixtures(page: Page, fixtures: CommunityQueryFixtures) {
	await page.evaluate(
		({ callsStorageKeyPrefix, fixtures, storageKey }) => {
			window.localStorage.setItem(storageKey, JSON.stringify(fixtures))
			window.sessionStorage.removeItem(`${callsStorageKeyPrefix}collections`)
			window.sessionStorage.removeItem(`${callsStorageKeyPrefix}merchants`)
		},
		{
			callsStorageKeyPrefix: COMMUNITY_QUERY_FIXTURE_CALLS_STORAGE_KEY_PREFIX,
			fixtures,
			storageKey: COMMUNITY_QUERY_FIXTURE_STORAGE_KEY,
		},
	)
}

test.describe('Community Tab Progressive Loading', () => {
	test('renders hero and page shell while collection and merchant queries are pending', async ({ page }) => {
		await useCommunityQueryFixtures(page, {
			collections: { state: 'pending' },
			merchants: { state: 'pending' },
		})

		await page.goto('/community/')

		await expect(page.getByTestId('community-hero')).toBeVisible()
		await expect(page.getByRole('heading', { name: 'Browse Collections' })).toBeVisible()
		await expect(page.getByTestId('community-collections-section')).toBeVisible()
		await expect(page.getByTestId('community-merchants-section')).toBeVisible()
	})

	test('displays deterministic skeletons while collection and merchant queries are pending', async ({ page }) => {
		await useCommunityQueryFixtures(page, {
			collections: { state: 'pending' },
			merchants: { state: 'pending' },
		})

		await page.goto('/community/')

		await expect(page.getByTestId('community-collections-skeleton')).toHaveCount(12)
		await expect(page.getByTestId('community-collections-skeleton').first()).toBeVisible()
		await expect(page.getByTestId('community-merchants-skeleton')).toHaveCount(6)
		await expect(page.getByTestId('community-merchants-skeleton').first()).toBeVisible()
	})

	test('renders collection cards after a successful collection query', async ({ page }) => {
		const collections = [
			collectionFixture({
				dTag: 'fixture-prints',
				title: 'Fixture Prints',
				summary: 'Deterministic collection content',
			}),
			collectionFixture({
				dTag: 'fixture-books',
				title: 'Fixture Books',
				summary: 'Another deterministic collection',
			}),
		]

		await useCommunityQueryFixtures(page, {
			collections: { state: 'success', data: collections },
			merchants: { state: 'empty' },
		})

		await page.goto('/community/')

		await expect(page.getByTestId('community-collection-card')).toHaveCount(2)
		await expect(page.getByText('Fixture Prints')).toBeVisible()
		await expect(page.getByText('Fixture Books')).toBeVisible()
		await expect(page.getByTestId('community-collections-empty')).toHaveCount(0)
	})

	test('renders collection empty state after a successful empty collection query', async ({ page }) => {
		await useCommunityQueryFixtures(page, {
			collections: { state: 'empty' },
			merchants: { state: 'empty' },
		})

		await page.goto('/community/')

		await expect(page.getByTestId('community-collections-empty')).toHaveText('No collections found')
		await expect(page.getByTestId('community-collection-card')).toHaveCount(0)
		await expect(page.getByTestId('community-collections-error')).toHaveCount(0)
	})

	test('renders collection error state and recovers after retry', async ({ page }) => {
		const recoveredCollection = collectionFixture({
			dTag: 'fixture-recovered-collection',
			title: 'Recovered Collection',
			summary: 'Loaded after retry',
		})

		await useCommunityQueryFixtures(page, {
			collections: { state: 'error', errorMessage: 'Fixture collection failure' },
			merchants: { state: 'empty' },
		})

		await page.goto('/community/')

		await expect(page.getByTestId('community-collections-error')).toContainText('Unable to load collections')
		await expect(page.getByTestId('community-collections-error')).toContainText('Fixture collection failure')
		await expect(page.getByTestId('community-collections-retry')).toBeVisible()

		await setCommunityQueryFixtures(page, {
			collections: { state: 'success', data: [recoveredCollection] },
			merchants: { state: 'empty' },
		})
		await page.getByTestId('community-collections-retry').click()

		await expect(page.getByTestId('community-collection-card')).toHaveCount(1)
		await expect(page.getByText('Recovered Collection')).toBeVisible()
		await expect(page.getByTestId('community-collections-error')).toHaveCount(0)
	})

	test('renders merchant success and empty states distinctly', async ({ page }) => {
		await useCommunityQueryFixtures(page, {
			collections: { state: 'empty' },
			merchants: { state: 'success', data: [devUser1.pk, devUser2.pk] },
		})

		await page.goto('/community/')

		await expect(page.getByTestId('community-merchant-card')).toHaveCount(2)
		await expect(page.getByTestId('community-merchants-empty')).toHaveCount(0)

		await setCommunityQueryFixtures(page, { collections: { state: 'empty' }, merchants: { state: 'empty' } })
		await page.reload()

		await expect(page.getByTestId('community-merchants-empty')).toHaveText('No merchants found')
		await expect(page.getByTestId('community-merchant-card')).toHaveCount(0)
		await expect(page.getByTestId('community-merchants-error')).toHaveCount(0)
	})

	test('renders merchant error state and recovers after retry', async ({ page }) => {
		await useCommunityQueryFixtures(page, {
			collections: { state: 'empty' },
			merchants: { state: 'error', errorMessage: 'Fixture merchant failure' },
		})

		await page.goto('/community/')

		await expect(page.getByTestId('community-merchants-error')).toContainText('Unable to load merchants')
		await expect(page.getByTestId('community-merchants-error')).toContainText('Fixture merchant failure')
		await expect(page.getByTestId('community-merchants-retry')).toBeVisible()

		await setCommunityQueryFixtures(page, {
			collections: { state: 'empty' },
			merchants: { state: 'success', data: [devUser1.pk] },
		})
		await page.getByTestId('community-merchants-retry').click()

		await expect(page.getByTestId('community-merchant-card')).toHaveCount(1)
		await expect(page.getByTestId('community-merchants-error')).toHaveCount(0)
	})

	test('page remains interactive while community queries are pending', async ({ page }) => {
		await useCommunityQueryFixtures(page, {
			collections: { state: 'pending' },
			merchants: { state: 'pending' },
		})

		await page.goto('/community/')

		await page.getByRole('button', { name: 'Start Selling' }).click()
		await expect(page.getByTestId('login-dialog')).toBeVisible()
		await expect(page.getByText('Loading...')).toHaveCount(0)
	})
})
