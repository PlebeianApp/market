package bidauth

import (
	"bytes"
	"reflect"
	"strings"
	"testing"
)

func wireEvent(t *testing.T, content string, validUntil int64) SignedEvent {
	t.Helper()
	tags, err := ExpectedTags(testProfile(), validUntil)
	if err != nil {
		t.Fatal(err)
	}
	var event SignedEvent
	for index := range event.Event.PublicKey {
		event.Event.PublicKey[index] = byte(100 + index)
	}
	for index := range event.ID {
		event.ID[index] = byte(index)
	}
	for index := range event.Signature {
		event.Signature[index] = byte(index + 1)
	}
	event.Event.CreatedAt = 100
	event.Event.Kind = DemoBidKind
	event.Event.Tags = tags
	event.Event.Content = content
	return event
}

func TestWireRoundTripAndExactMaximum(t *testing.T) {
	event := wireEvent(t, strings.Repeat("x", 2048), DemoMaxInteger)
	raw, err := EncodeWire(event, testProfile())
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != DemoMaxRawBytes {
		t.Fatalf("raw length=%d want %d", len(raw), DemoMaxRawBytes)
	}
	decoded, err := DecodeWire(raw, testProfile())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decoded, event) {
		t.Fatal("wire round trip mismatch")
	}
	if _, err := DecodeWire(append(raw, 0), testProfile()); err == nil {
		t.Fatal("one-over raw bytes accepted")
	}
	if _, err := EncodeWire(wireEvent(t, strings.Repeat("x", 2049), DemoMaxInteger), testProfile()); err == nil {
		t.Fatal("one-over command accepted")
	}
}

func TestWireRejectsTruncationTrailingAliasesAndKind(t *testing.T) {
	raw, err := EncodeWire(wireEvent(t, "{}", 200), testProfile())
	if err != nil {
		t.Fatal(err)
	}
	for _, cut := range []int{0, 4, 5, 37, 45, 47, len(raw) - 1} {
		if _, err := DecodeWire(raw[:cut], testProfile()); err == nil {
			t.Fatalf("truncation %d accepted", cut)
		}
	}
	for _, kind := range []uint16{5900, 65535, 1021} {
		copyRaw := append([]byte(nil), raw...)
		copyRaw[45] = byte(kind >> 8)
		copyRaw[46] = byte(kind)
		if _, err := DecodeWire(copyRaw, testProfile()); err == nil {
			t.Fatalf("kind %d accepted", kind)
		}
	}
	alias := append([]byte(nil), raw...)
	alias[47], alias[48], alias[49], alias[50] = 0, 0, 0, 5
	if _, err := DecodeWire(alias, testProfile()); err == nil {
		t.Fatal("tag count alias accepted")
	}
	if _, err := DecodeWire(append(raw, 0), testProfile()); err == nil {
		t.Fatal("trailing byte accepted")
	}
}

func TestBridgeJSONBoundAndNoConsensusFallback(t *testing.T) {
	event := wireEvent(t, "{}", 200)
	raw, err := EncodeBridgeJSON(event, testProfile())
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeBridgeJSON(raw, testProfile())
	if err != nil || !reflect.DeepEqual(decoded, event) {
		t.Fatalf("bridge round trip: %v", err)
	}
	if _, err := DecodeBridgeJSON(bytes.Repeat([]byte{' '}, DemoMaxJSONBytes+1), testProfile()); err == nil {
		t.Fatal("one-over JSON accepted")
	}
	if _, err := DecodeWire(raw, testProfile()); err == nil {
		t.Fatal("JSON accepted as consensus wire")
	}
	upper := bytes.Replace(raw, []byte(`"pubkey":"`), []byte(`"pubkey":"A`), 1)
	if _, err := DecodeBridgeJSON(upper, testProfile()); err == nil {
		t.Fatal("noncanonical hex accepted")
	}
	sigOffset := bytes.LastIndex(raw, []byte(`,"sig":`))
	missing := append(append([]byte(nil), raw[:sigOffset]...), '}')
	if _, err := DecodeBridgeJSON(missing, testProfile()); err == nil {
		t.Fatal("missing JSON field accepted")
	}
	duplicate := bytes.Replace(raw, []byte(`{"pubkey":`), []byte(`{"kind":28642,"pubkey":`), 1)
	if _, err := DecodeBridgeJSON(duplicate, testProfile()); err == nil {
		t.Fatal("duplicate JSON field accepted")
	}
	exponent := bytes.Replace(raw, []byte(`"created_at":100`), []byte(`"created_at":1e2`), 1)
	if _, err := DecodeBridgeJSON(exponent, testProfile()); err == nil {
		t.Fatal("noncanonical JSON integer accepted")
	}
}
