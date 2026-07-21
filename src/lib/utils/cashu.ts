import type { Secret, SecretData } from '@cashu/crypto/modules/common'
import { parseSecret } from '@cashu/crypto/modules/common/NUT11'

interface P2PKSecretData extends SecretData {
	tags?: Array<Array<string>>
}

function isP2PKSecret(parsed: Secret): parsed is ['P2PK', P2PKSecretData] {
	return Array.isArray(parsed) && parsed[0] === 'P2PK' && parsed[1] != null
}

export function getP2PKLocktime(secret: Uint8Array | string): number {
	const parsed = parseSecret(secret instanceof Uint8Array ? new TextDecoder().decode(secret) : secret)
	if (!isP2PKSecret(parsed)) {
		throw new Error('Invalid P2PK secret: must start with "P2PK"')
	}
	const tags = parsed[1].tags
	const locktimeTag = tags?.find((t) => t[0] === 'locktime')
	return locktimeTag && locktimeTag.length > 1 ? parseInt(locktimeTag[1], 10) : Infinity
}
