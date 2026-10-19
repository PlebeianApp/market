package bidauth

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

type bip340VerifyVector struct {
	Index     string `json:"index"`
	PublicKey string `json:"public_key"`
	EventID   string `json:"event_id"`
	Signature string `json:"signature"`
	Expected  bool   `json:"expected"`
	Comment   string `json:"comment"`
}

func loadBIP340VerifyVectors(t testing.TB) []bip340VerifyVector {
	t.Helper()
	raw, err := os.ReadFile("testdata/bip340_verify_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatal(err)
	}
	wantFields := map[string]struct{}{
		"index": {}, "public_key": {}, "event_id": {}, "signature": {}, "expected": {}, "comment": {},
	}
	for index, row := range rows {
		if len(row) != len(wantFields) {
			t.Fatalf("fixture row %d has %d fields, want %d", index, len(row), len(wantFields))
		}
		for field := range row {
			if _, ok := wantFields[field]; !ok {
				t.Fatalf("fixture row %d contains forbidden field %q", index, field)
			}
		}
	}
	var vectors []bip340VerifyVector
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	if len(vectors) != 16 {
		t.Fatalf("verification vector count = %d, want 16", len(vectors))
	}
	return vectors
}

func TestBTCECBIP340OfficialPublicVerificationVectors(t *testing.T) {
	verifier := BTCECBIP340Verifier{}
	seen := make(map[string]bool)
	for _, vector := range loadBIP340VerifyVectors(t) {
		t.Run(vector.Index, func(t *testing.T) {
			publicKey := decodeBIP340Hex32(t, vector.PublicKey)
			eventID := decodeBIP340Hex32(t, vector.EventID)
			signature := decodeBIP340Hex64(t, vector.Signature)
			err := verifier.Verify(publicKey, eventID, signature)
			if vector.Expected && err != nil {
				t.Fatalf("valid public vector rejected: %v (%s)", err, vector.Comment)
			}
			if !vector.Expected && err == nil {
				t.Fatalf("invalid public vector accepted (%s)", vector.Comment)
			}
		})
		seen[vector.Index] = true
	}
	for index := 0; index <= 14; index++ {
		if !seen[stringIndex(index)] {
			t.Fatalf("official vector %d is missing", index)
		}
	}
	if !seen["upstream-s-greater-than-n"] {
		t.Fatal("upstream s > n regression is missing")
	}
}

func TestBTCECBIP340OriginalBytesRejectSAtOrAboveOrderBeforeParse(t *testing.T) {
	vectors := loadBIP340VerifyVectors(t)
	for _, index := range []string{"13", "upstream-s-greater-than-n"} {
		vector := findBIP340Vector(t, vectors, index)
		publicKey := decodeBIP340Hex32(t, vector.PublicKey)
		eventID := decodeBIP340Hex32(t, vector.EventID)
		signature := decodeBIP340Hex64(t, vector.Signature)
		if scalarBelowGroupOrder(signature[32:]) {
			t.Fatalf("strict-s guard accepted vector %s", index)
		}
		if _, err := schnorr.ParseSignature(signature[:]); err != nil {
			t.Fatalf("pinned v2.4.0 parser no longer demonstrates reduction defect for %s: %v", index, err)
		}
		err := (BTCECBIP340Verifier{}).Verify(publicKey, eventID, signature)
		assertBidauthFailureKind(t, err, failureVerifier)
		if err.Error() != "BIP-340 signature scalar is out of range" {
			t.Fatalf("vector %s did not fail at original-byte guard: %v", index, err)
		}
	}
}

func TestBTCECBIP340ScalarBoundary(t *testing.T) {
	zero := make([]byte, 32)
	if !scalarBelowGroupOrder(zero) {
		t.Fatal("zero scalar should be below the group order")
	}
	nMinusOne := secp256k1GroupOrder
	nMinusOne[31]--
	if !scalarBelowGroupOrder(nMinusOne[:]) {
		t.Fatal("n-1 scalar rejected")
	}
	if scalarBelowGroupOrder(secp256k1GroupOrder[:]) {
		t.Fatal("s == n accepted")
	}
	nPlusOne := secp256k1GroupOrder
	nPlusOne[31]++
	if scalarBelowGroupOrder(nPlusOne[:]) {
		t.Fatal("s > n accepted")
	}
	allOnes := make([]byte, 32)
	for index := range allOnes {
		allOnes[index] = 0xff
	}
	if scalarBelowGroupOrder(allOnes) || scalarBelowGroupOrder(allOnes[:31]) {
		t.Fatal("out-of-range or wrong-length scalar accepted")
	}
}

func TestBTCECBIP340RejectsTamperedTupleAndMalformedEncodings(t *testing.T) {
	vectors := loadBIP340VerifyVectors(t)
	valid := findBIP340Vector(t, vectors, "0")
	other := findBIP340Vector(t, vectors, "1")
	publicKey := decodeBIP340Hex32(t, valid.PublicKey)
	eventID := decodeBIP340Hex32(t, valid.EventID)
	signature := decodeBIP340Hex64(t, valid.Signature)
	verifier := BTCECBIP340Verifier{}
	if err := verifier.Verify(publicKey, eventID, signature); err != nil {
		t.Fatalf("valid setup vector rejected: %v", err)
	}

	wrongKey := decodeBIP340Hex32(t, other.PublicKey)
	if err := verifier.Verify(wrongKey, eventID, signature); err == nil {
		t.Fatal("wrong public key accepted")
	}
	wrongEventID := eventID
	wrongEventID[0] ^= 0x01
	if err := verifier.Verify(publicKey, wrongEventID, signature); err == nil {
		t.Fatal("wrong event ID accepted")
	}
	wrongSignature := signature
	wrongSignature[0] ^= 0x01
	if err := verifier.Verify(publicKey, eventID, wrongSignature); err == nil {
		t.Fatal("tampered signature accepted")
	}
	zeroSignature := [64]byte{}
	if err := verifier.Verify(publicKey, eventID, zeroSignature); err == nil {
		t.Fatal("malformed all-zero signature accepted")
	}
	invalidKey := decodeBIP340Hex32(t, findBIP340Vector(t, vectors, "14").PublicKey)
	if err := verifier.Verify(invalidKey, eventID, signature); err == nil {
		t.Fatal("invalid x-only public key accepted")
	}
}

func TestBTCECBIP340VerifierExposesVerificationOnly(t *testing.T) {
	verifierType := reflect.TypeOf(BTCECBIP340Verifier{})
	if verifierType.NumMethod() != 1 || verifierType.Method(0).Name != "Verify" {
		t.Fatalf("exported verifier methods = %v, want Verify only", exportedMethodNames(verifierType))
	}
	var _ SignatureVerifier = BTCECBIP340Verifier{}
}

func findBIP340Vector(t testing.TB, vectors []bip340VerifyVector, index string) bip340VerifyVector {
	t.Helper()
	for _, vector := range vectors {
		if vector.Index == index {
			return vector
		}
	}
	t.Fatalf("vector %q not found", index)
	return bip340VerifyVector{}
}

func decodeBIP340Hex32(t testing.TB, value string) [32]byte {
	t.Helper()
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != 32 {
		t.Fatalf("32-byte public fixture decode: len=%d err=%v", len(decoded), err)
	}
	var result [32]byte
	copy(result[:], decoded)
	return result
}

func decodeBIP340Hex64(t testing.TB, value string) [64]byte {
	t.Helper()
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != 64 {
		t.Fatalf("64-byte public fixture decode: len=%d err=%v", len(decoded), err)
	}
	var result [64]byte
	copy(result[:], decoded)
	return result
}

func stringIndex(index int) string {
	if index < 10 {
		return string(rune('0' + index))
	}
	return "1" + string(rune('0'+index-10))
}

func exportedMethodNames(value reflect.Type) []string {
	names := make([]string, value.NumMethod())
	for index := range names {
		names[index] = value.Method(index).Name
	}
	return names
}
