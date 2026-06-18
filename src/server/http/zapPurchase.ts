import { ZapInvoiceError, type ZapPurchaseInvoiceRequestBody } from '../ZapPurchaseManager'
import { getEventHandler } from '../EventHandler'
import { getAppLightningIdentifier } from '../lightning'
import { getAppPublicKeyOrThrow } from '../runtime'
import { jsonError } from '../util/httpResponses'
import { toLnurlpEndpoint } from '../util/lnurl'
import type { BunRoutes } from './types'

/**
 * Generic zap-purchase invoice endpoint. Auto-resolves the correct
 * `ZapPurchaseManager` from the zap request's `L` (label) tag.
 */
export const zapPurchaseRoutes: BunRoutes = {
	'/api/zapPurchase': {
		POST: async (req) => {
			console.log('📨 /api/zapPurchase request received')

			let body: ZapPurchaseInvoiceRequestBody
			try {
				body = (await req.json()) as ZapPurchaseInvoiceRequestBody
			} catch {
				return jsonError('Invalid JSON body', 400)
			}

			const { amountSats, registryKey, zapRequest } = body
			const zapLabel = zapRequest?.tags?.find((t) => t[0] === 'L')?.[1]
			if (!zapLabel) {
				return jsonError('zapRequest missing L tag', 400)
			}

			const manager = getEventHandler().getPurchaseManager(zapLabel)
			if (!manager) {
				return jsonError(`Unknown purchase type: ${zapLabel}`, 400)
			}

			try {
				const appPubkey = getAppPublicKeyOrThrow()
				const lightningIdentifier = await getAppLightningIdentifier()

				console.log(`⚡ Creating ${zapLabel} invoice:`, { registryKey, amountSats })

				const result = await manager.generateInvoice(
					{ amountSats, registryKey, zapRequest },
					appPubkey,
					lightningIdentifier,
					toLnurlpEndpoint,
				)

				console.log(`✅ ${zapLabel} invoice created`)
				return Response.json(result)
			} catch (error) {
				console.error(`${zapLabel} invoice error:`, error)
				if (error instanceof ZapInvoiceError) {
					return jsonError(error.message, error.status)
				}
				return jsonError(error instanceof Error ? error.message : 'Failed to create invoice', 500)
			}
		},
	},
}
