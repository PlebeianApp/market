package bidauth

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strconv"
	"unicode/utf8"
)

var wireMagic = [4]byte{'A', 'A', 'E', 'V'}

const wireVersion byte = 1

// EncodeWire produces the only DEMO_AUTH_V1 consensus transaction encoding.
func EncodeWire(signed SignedEvent, profile Profile) ([]byte, error) {
	if err := validateWireEvent(signed.Event, profile); err != nil {
		return nil, err
	}
	content := []byte(signed.Event.Content)
	deadlineDigits := len(signed.Event.Tags[3][1])
	total := len(content) + 327 + deadlineDigits
	if total > DemoMaxRawBytes {
		return nil, fail(failureLimit, "raw transaction exceeds profile limit")
	}
	raw := make([]byte, 0, total)
	raw = append(raw, wireMagic[:]...)
	raw = append(raw, wireVersion)
	raw = append(raw, signed.Event.PublicKey[:]...)
	var fixed [8]byte
	binary.BigEndian.PutUint64(fixed[:], uint64(signed.Event.CreatedAt))
	raw = append(raw, fixed[:]...)
	var short [2]byte
	binary.BigEndian.PutUint16(short[:], signed.Event.Kind)
	raw = append(raw, short[:]...)
	raw = appendU32(raw, uint32(len(signed.Event.Tags)))
	for _, tag := range signed.Event.Tags {
		raw = appendU32(raw, uint32(len(tag)))
		for _, element := range tag {
			raw = appendU32(raw, uint32(len(element)))
			raw = append(raw, element...)
		}
	}
	raw = appendU32(raw, uint32(len(content)))
	raw = append(raw, content...)
	raw = append(raw, signed.ID[:]...)
	raw = append(raw, signed.Signature[:]...)
	if len(raw) != total {
		return nil, fmt.Errorf("bidauth: internal wire length mismatch")
	}
	return raw, nil
}

func appendU32(target []byte, value uint32) []byte {
	var encoded [4]byte
	binary.BigEndian.PutUint32(encoded[:], value)
	return append(target, encoded[:]...)
}

// DecodeWire rejects every alternate framing and validates before crypto.
func DecodeWire(raw []byte, profile Profile) (SignedEvent, error) {
	if err := profile.Validate(); err != nil {
		return SignedEvent{}, err
	}
	if len(raw) > DemoMaxRawBytes {
		return SignedEvent{}, fail(failureLimit, "raw transaction exceeds profile limit")
	}
	reader := wireReader{raw: raw}
	if magic, err := reader.take(4); err != nil || !bytes.Equal(magic, wireMagic[:]) {
		return SignedEvent{}, fail(failureEvent, "wire magic mismatch or truncation")
	}
	version, err := reader.take(1)
	if err != nil || version[0] != wireVersion {
		return SignedEvent{}, fail(failureEvent, "wire version mismatch or truncation")
	}
	var signed SignedEvent
	publicKey, err := reader.take(32)
	if err != nil {
		return SignedEvent{}, err
	}
	copy(signed.Event.PublicKey[:], publicKey)
	created, err := reader.take(8)
	if err != nil {
		return SignedEvent{}, err
	}
	createdUint := binary.BigEndian.Uint64(created)
	if createdUint > uint64(DemoMaxInteger) || createdUint > math.MaxInt64 {
		return SignedEvent{}, fail(failureWindow, "created_at is outside the exact integer range")
	}
	signed.Event.CreatedAt = int64(createdUint)
	kind, err := reader.take(2)
	if err != nil {
		return SignedEvent{}, err
	}
	signed.Event.Kind = binary.BigEndian.Uint16(kind)
	count, err := reader.u32()
	if err != nil || count != 4 {
		return SignedEvent{}, fail(failureDomain, "wire requires exactly four tags")
	}
	signed.Event.Tags = make([][]string, 4)
	for index := range signed.Event.Tags {
		elements, err := reader.u32()
		if err != nil || elements != 2 {
			return SignedEvent{}, fail(failureDomain, "wire tag requires exactly two elements")
		}
		tag := make([]string, 2)
		for element := range tag {
			length, err := reader.u32()
			if err != nil || uint64(length) > DemoMaxCommandBytes {
				return SignedEvent{}, fail(failureLimit, "wire tag string length is invalid")
			}
			value, err := reader.take(uint64(length))
			if err != nil || !utf8.Valid(value) {
				return SignedEvent{}, fail(failureEvent, "wire tag string is truncated or invalid UTF-8")
			}
			tag[element] = string(value)
		}
		signed.Event.Tags[index] = tag
	}
	contentLength, err := reader.u32()
	if err != nil || contentLength == 0 || uint64(contentLength) > DemoMaxCommandBytes {
		return SignedEvent{}, fail(failureLimit, "wire command length is invalid")
	}
	content, err := reader.take(uint64(contentLength))
	if err != nil || !utf8.Valid(content) {
		return SignedEvent{}, fail(failureEvent, "wire command is truncated or invalid UTF-8")
	}
	signed.Event.Content = string(content)
	id, err := reader.take(32)
	if err != nil {
		return SignedEvent{}, err
	}
	copy(signed.ID[:], id)
	signature, err := reader.take(64)
	if err != nil {
		return SignedEvent{}, err
	}
	copy(signed.Signature[:], signature)
	if reader.offset != uint64(len(raw)) {
		return SignedEvent{}, fail(failureEvent, "wire has trailing bytes")
	}
	if err := validateWireEvent(signed.Event, profile); err != nil {
		return SignedEvent{}, err
	}
	return signed, nil
}

type wireReader struct {
	raw    []byte
	offset uint64
}

func (reader *wireReader) take(length uint64) ([]byte, error) {
	end := reader.offset + length
	if end < reader.offset || end > uint64(len(reader.raw)) {
		return nil, fail(failureEvent, "truncated wire")
	}
	value := reader.raw[reader.offset:end]
	reader.offset = end
	return value, nil
}
func (reader *wireReader) u32() (uint32, error) {
	raw, err := reader.take(4)
	if err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint32(raw), nil
}

func validateWireEvent(event UnsignedEvent, profile Profile) error {
	if err := profile.Validate(); err != nil {
		return err
	}
	if event.CreatedAt < 0 || event.CreatedAt > DemoMaxInteger {
		return fail(failureWindow, "created_at is outside the exact integer range")
	}
	if event.Kind != DemoBidKind {
		return fail(failureEvent, "wire kind is not DEMO_AUTH_V1 Bid")
	}
	if len(event.Content) == 0 || uint64(len(event.Content)) > DemoMaxCommandBytes || !utf8.ValidString(event.Content) {
		return fail(failureLimit, "wire command length or UTF-8 is invalid")
	}
	_, err := parseProfileTags(event.Tags, profile)
	return err
}

type signedEventJSON struct {
	PubKey    string     `json:"pubkey"`
	CreatedAt int64      `json:"created_at"`
	Kind      uint16     `json:"kind"`
	Tags      [][]string `json:"tags"`
	Content   string     `json:"content"`
	ID        string     `json:"id"`
	Sig       string     `json:"sig"`
}

// DecodeBridgeJSON is bounded non-consensus input. It never accepts an event
// as consensus wire and never normalizes hexadecimal or integer fields.
func DecodeBridgeJSON(raw []byte, profile Profile) (SignedEvent, error) {
	if len(raw) > DemoMaxJSONBytes {
		return SignedEvent{}, fail(failureLimit, "event JSON exceeds bridge limit")
	}
	members, err := exactBridgeMembers(raw)
	if err != nil {
		return SignedEvent{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var value signedEventJSON
	if err := decoder.Decode(&value); err != nil {
		return SignedEvent{}, fail(failureEvent, "event JSON is invalid")
	}
	if string(members["created_at"]) != strconv.FormatInt(value.CreatedAt, 10) || string(members["kind"]) != strconv.FormatUint(uint64(value.Kind), 10) {
		return SignedEvent{}, fail(failureEvent, "event JSON integers are not canonical")
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return SignedEvent{}, err
	}
	var signed SignedEvent
	if err := decodeLowerHexExact(value.PubKey, signed.Event.PublicKey[:]); err != nil {
		return SignedEvent{}, err
	}
	if err := decodeLowerHexExact(value.ID, signed.ID[:]); err != nil {
		return SignedEvent{}, err
	}
	if err := decodeLowerHexExact(value.Sig, signed.Signature[:]); err != nil {
		return SignedEvent{}, err
	}
	signed.Event.CreatedAt, signed.Event.Kind, signed.Event.Tags, signed.Event.Content = value.CreatedAt, value.Kind, value.Tags, value.Content
	if err := validateWireEvent(signed.Event, profile); err != nil {
		return SignedEvent{}, err
	}
	return signed, nil
}

func exactBridgeMembers(raw []byte) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return nil, fail(failureEvent, "event JSON root is not an object")
	}
	allowed := map[string]bool{"pubkey": true, "created_at": true, "kind": true, "tags": true, "content": true, "id": true, "sig": true}
	members := make(map[string]json.RawMessage, len(allowed))
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, fail(failureEvent, "event JSON member is invalid")
		}
		name, ok := token.(string)
		if !ok || !allowed[name] {
			return nil, fail(failureEvent, "event JSON has unknown member")
		}
		if _, duplicate := members[name]; duplicate {
			return nil, fail(failureEvent, "event JSON has duplicate member")
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, fail(failureEvent, "event JSON member is invalid")
		}
		members[name] = value
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') || len(members) != len(allowed) {
		return nil, fail(failureEvent, "event JSON does not have exactly seven members")
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return nil, err
	}
	return members, nil
}

func EncodeBridgeJSON(signed SignedEvent, profile Profile) ([]byte, error) {
	if err := validateWireEvent(signed.Event, profile); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(signedEventJSON{PubKey: hex.EncodeToString(signed.Event.PublicKey[:]), CreatedAt: signed.Event.CreatedAt, Kind: signed.Event.Kind, Tags: signed.Event.Tags, Content: signed.Event.Content, ID: hex.EncodeToString(signed.ID[:]), Sig: hex.EncodeToString(signed.Signature[:])})
	if err != nil || len(raw) > DemoMaxJSONBytes {
		return nil, fail(failureLimit, "event JSON exceeds bridge limit")
	}
	return raw, nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return fail(failureEvent, "event JSON has trailing content")
	}
	return nil
}

func decodeLowerHexExact(value string, target []byte) error {
	if len(value) != len(target)*2 {
		return fail(failureEvent, "hex field has wrong length")
	}
	for _, current := range []byte(value) {
		if !((current >= '0' && current <= '9') || (current >= 'a' && current <= 'f')) {
			return fail(failureEvent, "hex field is not lowercase hexadecimal")
		}
	}
	if _, err := hex.Decode(target, []byte(value)); err != nil {
		return fail(failureEvent, "hex field is invalid")
	}
	return nil
}
