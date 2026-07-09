type CommunityQueryName = 'collections' | 'merchants'

type CommunityFixturePendingStep = {
	state: 'pending'
	delayMs?: number
}

type CommunityFixtureErrorStep = {
	state: 'error'
	errorMessage?: string
	delayMs?: number
}

type CommunityFixtureEmptyStep = {
	state: 'empty'
	delayMs?: number
}

type CommunityFixtureSuccessStep<T> = {
	state: 'success'
	data: T
	delayMs?: number
}

export type CommunityQueryFixtureStep<T> =
	CommunityFixturePendingStep | CommunityFixtureErrorStep | CommunityFixtureEmptyStep | CommunityFixtureSuccessStep<T>

type CommunityQueryFixtureMap = Partial<
	Record<CommunityQueryName, CommunityQueryFixtureStep<unknown> | CommunityQueryFixtureStep<unknown>[]>
>

export const COMMUNITY_QUERY_FIXTURE_STORAGE_KEY = 'plebeian_community_query_fixtures'
export const COMMUNITY_QUERY_FIXTURE_CALLS_STORAGE_KEY_PREFIX = 'plebeian_community_query_fixture_calls:'

const isCommunityFixtureEnvironment = () => process.env.NODE_ENV === 'test' && typeof window !== 'undefined'

const sleep = (delayMs?: number) => {
	if (!delayMs || delayMs <= 0) return Promise.resolve()
	return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

function readFixtureMap(): CommunityQueryFixtureMap | null {
	if (!isCommunityFixtureEnvironment()) return null

	try {
		const raw = window.localStorage.getItem(COMMUNITY_QUERY_FIXTURE_STORAGE_KEY)
		if (!raw) return null

		const parsed = JSON.parse(raw)
		if (!parsed || typeof parsed !== 'object') return null

		return parsed as CommunityQueryFixtureMap
	} catch {
		return null
	}
}

function readCallIndex(queryName: CommunityQueryName): number {
	try {
		const raw = window.sessionStorage.getItem(`${COMMUNITY_QUERY_FIXTURE_CALLS_STORAGE_KEY_PREFIX}${queryName}`)
		const index = Number.parseInt(raw || '0', 10)
		return Number.isFinite(index) && index >= 0 ? index : 0
	} catch {
		return 0
	}
}

function writeCallIndex(queryName: CommunityQueryName, index: number) {
	try {
		window.sessionStorage.setItem(`${COMMUNITY_QUERY_FIXTURE_CALLS_STORAGE_KEY_PREFIX}${queryName}`, String(index))
	} catch {
		// Ignore storage failures; fixtures are best-effort and test-only.
	}
}

export function getNextCommunityQueryFixtureStep<T>(queryName: CommunityQueryName): CommunityQueryFixtureStep<T> | null {
	const fixtureMap = readFixtureMap()
	const fixture = fixtureMap?.[queryName]
	if (!fixture) return null

	const steps = Array.isArray(fixture) ? fixture : [fixture]
	if (steps.length === 0) return null

	const callIndex = readCallIndex(queryName)
	writeCallIndex(queryName, callIndex + 1)

	return steps[Math.min(callIndex, steps.length - 1)] as CommunityQueryFixtureStep<T>
}

export function hasCommunityQueryFixture(queryName: CommunityQueryName): boolean {
	const fixtureMap = readFixtureMap()
	return !!fixtureMap?.[queryName]
}

export async function resolveCommunityQueryFixtureStep<T>(
	queryName: CommunityQueryName,
	step: CommunityQueryFixtureStep<unknown>,
	normalizeData: (data: unknown) => T,
): Promise<T> {
	await sleep(step.delayMs)

	switch (step.state) {
		case 'pending':
			return await new Promise<T>(() => {})
		case 'error':
			throw new Error(step.errorMessage || `Unable to load ${queryName}`)
		case 'empty':
			return normalizeData([])
		case 'success':
			return normalizeData(step.data)
	}
}

export function normalizeCommunityArrayFixture<T>(queryName: CommunityQueryName, data: unknown): T[] {
	if (!Array.isArray(data)) {
		throw new Error(`Invalid ${queryName} fixture: expected an array`)
	}

	return data as T[]
}
