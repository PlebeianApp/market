package poc

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

func VerifyNostrEvent(event SignedEvent) (string, error) {
	if !validActor(event.PubKey) || event.CreatedAt < 0 || event.Kind < 0 || event.Kind > 65535 || len(event.Tags) > 32 || len(event.Content) > 16*1024 {
		return "", errors.New("invalid bounded Nostr event")
	}
	for _, tag := range event.Tags {
		if len(tag) > 8 {
			return "", errors.New("Nostr tag has too many elements")
		}
		for _, value := range tag {
			if len(value) > 512 {
				return "", errors.New("Nostr tag element is too large")
			}
		}
	}
	serialized, err := serializeNostrUnsigned(event)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(serialized)
	computedID := hex.EncodeToString(digest[:])
	if event.ID != computedID {
		return "", errors.New("Nostr event id does not match canonical event")
	}
	publicBytes, _ := hex.DecodeString(event.PubKey)
	publicKey, err := schnorr.ParsePubKey(publicBytes)
	if err != nil {
		return "", fmt.Errorf("parse Nostr public key: %w", err)
	}
	signatureBytes, err := hex.DecodeString(event.Sig)
	if err != nil || len(signatureBytes) != schnorr.SignatureSize {
		return "", errors.New("invalid Nostr signature encoding")
	}
	signature, err := schnorr.ParseSignature(signatureBytes)
	if err != nil || !signature.Verify(digest[:], publicKey) {
		return "", errors.New("Nostr signature verification failed")
	}
	return event.PubKey, nil
}

func SignNostrEvent(privateKey *btcec.PrivateKey, createdAt int64, kind int, tags [][]string, content string) (SignedEvent, error) {
	if privateKey == nil {
		return SignedEvent{}, errors.New("private key is required")
	}
	event := SignedEvent{
		PubKey:    hex.EncodeToString(schnorr.SerializePubKey(privateKey.PubKey())),
		CreatedAt: createdAt,
		Kind:      kind,
		Tags:      tags,
		Content:   content,
	}
	serialized, err := serializeNostrUnsigned(event)
	if err != nil {
		return SignedEvent{}, err
	}
	digest := sha256.Sum256(serialized)
	signature, err := schnorr.Sign(privateKey, digest[:])
	if err != nil {
		return SignedEvent{}, err
	}
	event.ID = hex.EncodeToString(digest[:])
	event.Sig = hex.EncodeToString(signature.Serialize())
	return event, nil
}

func serializeNostrUnsigned(event SignedEvent) ([]byte, error) {
	value := []any{0, event.PubKey, event.CreatedAt, event.Kind, event.Tags, event.Content}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return []byte(strings.TrimSuffix(buffer.String(), "\n")), nil
}
