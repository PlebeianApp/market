import { checkMintReachability, type CheckProofStateOptions } from '../../lib/cashu/nut7'
import { setAuctionMintReachability, type ValidatorAuctionState } from './state'

export const refreshAuctionMintReachability = async (
	auctionState: ValidatorAuctionState,
	options?: CheckProofStateOptions,
): Promise<boolean> => {
	const reachability = await Promise.all(
		auctionState.rootAuction.mints.map(async (mintUrl) => [mintUrl, await checkMintReachability(mintUrl, options)] as const),
	)

	setAuctionMintReachability(auctionState, reachability)
	return auctionState.contextStatus === 'active'
}