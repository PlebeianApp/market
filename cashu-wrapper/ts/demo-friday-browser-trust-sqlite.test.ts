import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'

import {
	DemoFridaySellerPlanRollbackAnchorSqlite,
	DemoFridaySellerPlanSqlite,
} from './demo-friday-browser-trust-sqlite'
import type { DemoFridaySellerPlanRecordV1 } from './demo-friday-browser-trust-service'
import type { DemoFridaySellerWinnerPlanEnvelopeV1 } from './demo-friday-browser-coco-seller-plan'

const operationId = 'funding-1'
const record: DemoFridaySellerPlanRecordV1 = {
	intentEventId: '1'.repeat(64),
	intent: {
		schema: 'PLEBEIAN_FRIDAY_SELLER_PLAN_INTENT_V1', authNetworkId: 'network-1', chainId: 'chain-1',
		auctionId: 'auction-1', fundingOperationId: operationId, bidAmount: 600, fullPoolAmount: 600,
		replacesBidId: '', canonicalMintUrl: 'https://mint.example', expiresAt: 1_200,
	},
	challenge: {
		schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_V1', authNetworkId: 'network-1', chainId: 'chain-1',
		auctionId: 'auction-1', fundingOperationId: operationId, sellerActor: '2'.repeat(64),
		sellerPaymentPublicKey: `02${'7'.repeat(64)}`, bidderActor: '3'.repeat(64),
		bidAmount: 600, canonicalMintUrl: 'https://mint.example', activeSatKeysetId: 'keyset-1',
		denominationKeyDigest: '4'.repeat(64), expiresAt: 1_200,
	},
	leaderBidId: '', leaderActor: '', leaderBidAmount: 0, deploymentDigest: '5'.repeat(64), envelope: null,
}

const envelope = {
	schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_ENVELOPE_V1', planDigest: '6'.repeat(64),
	plan: { fundingOperationId: operationId }, sellerAuthorization: {},
} as unknown as DemoFridaySellerWinnerPlanEnvelopeV1

describe('Friday durable seller-plan registry', () => {
	test('survives restart, preserves one exact plan, and advances an independent anchor', () => {
		const database = new Database(':memory:', { strict: true })
		const anchorDatabase = new Database(':memory:', { strict: true })
		try {
			const first = new DemoFridaySellerPlanSqlite(database, 'deployment-1',
				new DemoFridaySellerPlanRollbackAnchorSqlite(anchorDatabase, true))
			expect(first.createChallengeExact(record)).toEqual(record)
			const registered = first.registerExact(operationId, envelope)
			expect(registered.envelope).toEqual(envelope)
			const restarted = new DemoFridaySellerPlanSqlite(database, 'deployment-1',
				new DemoFridaySellerPlanRollbackAnchorSqlite(anchorDatabase))
			expect(restarted.readExact(operationId)).toEqual(registered)
			expect(restarted.registerExact(operationId, envelope)).toEqual(registered)
			expect(() => restarted.createChallengeExact({ ...record, leaderBidAmount: 1 })).toThrow(/another challenge/)
		} finally { database.close(); anchorDatabase.close() }
	})

	test('fails closed if an independent anchor observes a regressed seller-plan database', () => {
		const database = new Database(':memory:', { strict: true })
		const anchorDatabase = new Database(':memory:', { strict: true })
		try {
			const store = new DemoFridaySellerPlanSqlite(database, 'deployment-1',
				new DemoFridaySellerPlanRollbackAnchorSqlite(anchorDatabase, true))
			store.createChallengeExact(record)
			database.query('UPDATE friday_seller_plan_metadata SET global_revision=0 WHERE id=1').run()
			expect(() => store.readExact(operationId)).toThrow(/restored/)
		} finally { database.close(); anchorDatabase.close() }
	})
})
