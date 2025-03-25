export function bytesFromHex(hex: string): Uint8Array {
	return new Uint8Array(Buffer.from(hex, 'hex'))
}
