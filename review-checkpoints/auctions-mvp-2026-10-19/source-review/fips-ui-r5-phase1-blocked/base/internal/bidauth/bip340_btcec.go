package bidauth

import "github.com/btcsuite/btcd/btcec/v2/schnorr"

// BTCECBIP340Verifier verifies fixed-size NIP-01 event IDs using the BIP-340
// verifier in btcec. It exposes verification only; there is no signing API.
//
// btcec/v2 v2.4.0 reduces an out-of-range s while parsing. The original bytes
// are therefore checked against the secp256k1 group order before parsing.
type BTCECBIP340Verifier struct{}

var _ SignatureVerifier = BTCECBIP340Verifier{}

var secp256k1GroupOrder = [32]byte{
	0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
	0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
	0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b,
	0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
}

// Verify rejects s >= n from the original signature encoding, parses the
// x-only public key and signature, and verifies the exact 32-byte event ID.
func (BTCECBIP340Verifier) Verify(publicKey [32]byte, eventID [32]byte, signature [64]byte) error {
	if !scalarBelowGroupOrder(signature[32:]) {
		return fail(failureVerifier, "BIP-340 signature scalar is out of range")
	}
	parsedKey, err := schnorr.ParsePubKey(publicKey[:])
	if err != nil {
		return fail(failureVerifier, "BIP-340 public key is invalid")
	}
	parsedSignature, err := schnorr.ParseSignature(signature[:])
	if err != nil {
		return fail(failureVerifier, "BIP-340 signature encoding is invalid")
	}
	if !parsedSignature.Verify(eventID[:], parsedKey) {
		return fail(failureVerifier, "BIP-340 signature verification failed")
	}
	return nil
}

func scalarBelowGroupOrder(scalar []byte) bool {
	if len(scalar) != len(secp256k1GroupOrder) {
		return false
	}
	for index, orderByte := range secp256k1GroupOrder {
		if scalar[index] < orderByte {
			return true
		}
		if scalar[index] > orderByte {
			return false
		}
	}
	return false
}
