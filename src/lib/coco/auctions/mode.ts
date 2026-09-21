import { normalizeCocoMintUrl } from './canonical'

export const COCO_V2_AUCTION_MONETARY_MODE = 'coco-v2' as const

export interface CocoV2AuctionEnvironment {
	environmentId: string
	monetaryMode: 'fake'
	fakeMintAllowlist: readonly string[]
}

const readEnv = (name: string): string | undefined => {
	const value = process.env[name]
	return typeof value === 'string' && value.trim() ? value.trim() : undefined
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
		[
			...new Set(
				(rawAllowlist ?? '')
					.split(',')
					.map((mint) => mint.trim())
					.filter(Boolean)
					.map(normalizeCocoMintUrl),
			),
		].sort(),
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
