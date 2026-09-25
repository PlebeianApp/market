import { normalizeCocoMintUrl } from './canonical'

export const COCO_V2_AUCTION_MONETARY_MODE = 'coco-v2' as const

export interface CocoV2AuctionEnvironment {
	environmentId: string
	monetaryMode: 'fake'
	fakeMintAllowlist: readonly string[]
}

// Bun only exposes BUN_PUBLIC_* values to browser bundles when the property
// access is statically discoverable. Keep these reads explicit; routing them
// solely through process.env[name] makes server and browser select different
// monetary engines.
const BUN_PUBLIC_AUCTION_MONETARY_MODE = process.env.BUN_PUBLIC_AUCTION_MONETARY_MODE
const BUN_PUBLIC_COCO_ENVIRONMENT_ID = process.env.BUN_PUBLIC_COCO_ENVIRONMENT_ID
const BUN_PUBLIC_COCO_MONETARY_MODE = process.env.BUN_PUBLIC_COCO_MONETARY_MODE
const BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST = process.env.BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST
const BUN_PUBLIC_COCO_FAKE_MINT_IDENTITIES = process.env.BUN_PUBLIC_COCO_FAKE_MINT_IDENTITIES
const BUN_PUBLIC_MARKET_COMMIT_SHA = process.env.BUN_PUBLIC_MARKET_COMMIT_SHA

const readEnv = (name: string): string | undefined => {
	const staticallyExposedValue =
		name === 'BUN_PUBLIC_AUCTION_MONETARY_MODE'
			? BUN_PUBLIC_AUCTION_MONETARY_MODE
			: name === 'BUN_PUBLIC_COCO_ENVIRONMENT_ID'
				? BUN_PUBLIC_COCO_ENVIRONMENT_ID
				: name === 'BUN_PUBLIC_COCO_MONETARY_MODE'
					? BUN_PUBLIC_COCO_MONETARY_MODE
					: name === 'BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST'
						? BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST
						: name === 'BUN_PUBLIC_COCO_FAKE_MINT_IDENTITIES'
							? BUN_PUBLIC_COCO_FAKE_MINT_IDENTITIES
							: name === 'BUN_PUBLIC_MARKET_COMMIT_SHA'
								? BUN_PUBLIC_MARKET_COMMIT_SHA
								: undefined
	const value = staticallyExposedValue ?? process.env[name]
	return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export const readCocoFakeMintIdentityCommitments = (): ReadonlyMap<string, string> => {
	const raw = readEnv('BUN_PUBLIC_COCO_FAKE_MINT_IDENTITIES') ?? readEnv('APP_COCO_FAKE_MINT_IDENTITIES') ?? ''
	const entries = raw
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const separator = entry.lastIndexOf('=sha256:')
			if (separator < 0) throw new Error('Fake mint identity entries must be URL=sha256:<digest>')
			const mint = normalizeCocoMintUrl(entry.slice(0, separator))
			const commitment = entry.slice(separator + 1)
			if (!/^sha256:[0-9a-f]{64}$/.test(commitment)) throw new Error('Fake mint identity commitment is invalid')
			return [mint, commitment] as const
		})
	return new Map(entries)
}

export const readMarketCommitSha = (): string => {
	const value = readEnv('BUN_PUBLIC_MARKET_COMMIT_SHA') ?? readEnv('APP_MARKET_COMMIT_SHA')
	if (!value || !/^[0-9a-f]{40}$/.test(value)) throw new Error('Fresh AuctionsDev mode requires an exact lowercase Market Git SHA')
	return value
}

export const isCocoV2AuctionMode = (): boolean =>
	(readEnv('BUN_PUBLIC_AUCTION_MONETARY_MODE') ?? readEnv('APP_AUCTION_MONETARY_MODE')) === COCO_V2_AUCTION_MONETARY_MODE

export const readCocoV2AuctionEnvironment = (): CocoV2AuctionEnvironment => {
	const environmentId = readEnv('BUN_PUBLIC_COCO_ENVIRONMENT_ID') ?? readEnv('APP_COCO_ENVIRONMENT_ID')
	if (!environmentId) throw new Error('Coco v2 Auction mode requires an explicit environment identity')
	const monetaryMode = readEnv('BUN_PUBLIC_COCO_MONETARY_MODE') ?? readEnv('APP_COCO_MONETARY_MODE')
	if (monetaryMode !== 'fake') throw new Error('Coco v2 Auction mode is fake-funds-only; real monetary mode is forbidden')
	const rawAllowlist = readEnv('BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST') ?? readEnv('APP_COCO_FAKE_MINT_ALLOWLIST')
	const fakeMintAllowlist = Object.freeze(
		Array.from(
			new Set(
				(rawAllowlist ?? '')
					.split(',')
					.map((mint) => mint.trim())
					.filter(Boolean)
					.map(normalizeCocoMintUrl),
			),
		).sort(),
	)
	if (!fakeMintAllowlist.length) throw new Error('Coco v2 Auction mode requires a non-empty fake mint allowlist')
	return Object.freeze({ environmentId, monetaryMode: 'fake', fakeMintAllowlist })
}

export const assertFakeCocoAuctionMint = (mintUrl: string, environment: CocoV2AuctionEnvironment): string => {
	if (environment.monetaryMode !== 'fake') throw new Error('Real funds are forbidden in the Coco v2 Auction candidate')
	const normalized = normalizeCocoMintUrl(mintUrl)
	if (!environment.fakeMintAllowlist.includes(normalized)) {
		throw new Error('Coco v2 Auction mint is not present in the explicit fake-mint allowlist')
	}
	return normalized
}

export const assertLegacyAuctionMoneyAllowed = (action: string): void => {
	if (isCocoV2AuctionMode()) throw new Error(`Legacy Auction monetary action "${action}" is disabled while Coco v2 mode is active`)
}
