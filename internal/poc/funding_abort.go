package poc

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

const (
	fundingAbortSchema          = "PLEBEIAN_FRIDAY_FUNDING_ABORT_V1"
	fundingAbortActorSchema     = "PLEBEIAN_FRIDAY_FUNDING_ABORT_ACTOR_TERMS_V1"
	fundingLifecycleSchema      = "PLEBEIAN_FRIDAY_FUNDING_LIFECYCLE_RECORD_V1"
	fundingAbortCommitteeDomain = "PLEBEIAN_FRIDAY_FUNDING_ABORT_COMMITTEE_V1"
	maxFundingAbortWindow       = int64(4_200)
	maxSafeJSONInteger          = int64(9_007_199_254_740_991)
)

// FundingAbortPinsV1 is immutable deployment authority persisted in app state.
// An abort certificate must match every field; request data never supplies or
// widens this trust boundary.
type FundingAbortPinsV1 struct {
	AuthNetworkID          string `json:"authNetworkId"`
	ChainID                string `json:"chainId"`
	GenesisSHA256          string `json:"genesisSha256"`
	MintURL                string `json:"mintUrl"`
	ActiveKeysetID         string `json:"activeKeysetId"`
	CommitteePublicKey     string `json:"committeePublicKey"`
	CommitteeKeysetID      string `json:"committeeKeysetId"`
	CommitteeKeysetVersion string `json:"committeeKeysetVersion"`
	DKGRunID               string `json:"dkgRunId"`
	PublicKeyPackageSHA256 string `json:"publicKeyPackageSha256"`
	SignerRosterDigest     string `json:"signerRosterDigest"`
}

type FundingAbortCertificateV1 struct {
	Schema                      string      `json:"schema"`
	AuthNetworkID               string      `json:"authNetworkId"`
	ChainID                     string      `json:"chainId"`
	GenesisSHA256               string      `json:"genesisSha256"`
	AuctionID                   string      `json:"auctionId"`
	OperationID                 string      `json:"operationId"`
	Actor                       string      `json:"actor"`
	MintURL                     string      `json:"mintUrl"`
	ActiveKeysetID              string      `json:"activeKeysetId"`
	Amount                      int64       `json:"amount"`
	ProofYs                     []string    `json:"proofYs"`
	PoolDigest                  string      `json:"poolDigest"`
	NUT11LockPublicKeys         []string    `json:"nut11LockPublicKeys"`
	Locktime                    int64       `json:"locktime"`
	PaymentPublicKey            string      `json:"paymentPublicKey"`
	RefundPublicKey             string      `json:"refundPublicKey"`
	CommitteePublicKey          string      `json:"committeePublicKey"`
	ReturnPackageDigest         string      `json:"returnPackageDigest"`
	ReturnCashuSigAllDigest     string      `json:"returnCashuSigAllDigest"`
	BidderReturnSignature       string      `json:"bidderReturnSignature"`
	FundingAuthorizationEventID string      `json:"fundingAuthorizationEventId"`
	AbortNotBefore              int64       `json:"abortNotBefore"`
	AbortExpiresAt              int64       `json:"abortExpiresAt"`
	AbortReason                 string      `json:"abortReason"`
	CommitteeKeysetID           string      `json:"committeeKeysetId"`
	CommitteeKeysetVersion      string      `json:"committeeKeysetVersion"`
	DKGRunID                    string      `json:"dkgRunId"`
	PublicKeyPackageSHA256      string      `json:"publicKeyPackageSha256"`
	SignerRosterDigest          string      `json:"signerRosterDigest"`
	ParticipantPolicyDigest     string      `json:"participantPolicyDigest"`
	ActorAbortEvent             SignedEvent `json:"actorAbortEvent"`
	CommitteeAbortSignature     string      `json:"committeeAbortSignature"`
}

type FundingLifecycleV1 struct {
	Schema                    string   `json:"schema"`
	OperationID               string   `json:"operationId"`
	ProofYs                   []string `json:"proofYs"`
	AuctionID                 string   `json:"auctionId"`
	Actor                     string   `json:"actor"`
	Amount                    int64    `json:"amount"`
	Origin                    string   `json:"origin"`
	Status                    string   `json:"status"`
	ConsensusEventID          string   `json:"consensusEventId"`
	ActorAuthorizationEventID string   `json:"actorAuthorizationEventId,omitempty"`
	CommittedHeight           int64    `json:"committedHeight"`
	CommittedAt               int64    `json:"committedAt"`
	Reason                    string   `json:"reason,omitempty"`
	AbortCertificateDigest    string   `json:"abortCertificateDigest,omitempty"`
}

func validateFundingAbortPins(state State, pins FundingAbortPinsV1) error {
	if pins.AuthNetworkID != state.AuthNetworkID || pins.ChainID != state.ChainID ||
		pins.MintURL != state.CashuMintURL || pins.CommitteePublicKey != state.CommitteePublicKey {
		return errors.New("funding-abort pins differ from canonical state identity")
	}
	if !validLowerHex(pins.GenesisSHA256, sha256.Size) || !validOperationID(pins.ActiveKeysetID) ||
		!validCompressedPublicKey(pins.CommitteePublicKey) || !validOperationID(pins.CommitteeKeysetID) ||
		!validOperationID(pins.CommitteeKeysetVersion) || !validOperationID(pins.DKGRunID) ||
		!validLowerHex(pins.PublicKeyPackageSHA256, sha256.Size) || !validLowerHex(pins.SignerRosterDigest, sha256.Size) {
		return errors.New("funding-abort deployment pins are malformed")
	}
	return nil
}

func normalizeFundingLifecycleState(state *State) error {
	if (len(state.FundingLifecycles) != 0 || len(state.FundingProofOwners) != 0) && state.FundingAbortPins == nil {
		return errors.New("persisted funding-abort lifecycle lacks immutable deployment pins")
	}
	normalizedOwners := make(map[string]string, len(state.FundingProofOwners))
	for proofY, operationID := range state.FundingProofOwners {
		key := proofY
		if validCompressedPublicKey(proofY) {
			key = proofY[2:]
		} else if !validLowerHex(proofY, 32) {
			return errors.New("persisted funding proof-owner key is malformed")
		}
		if !validOperationID(operationID) {
			return errors.New("persisted funding proof owner is malformed")
		}
		if existing := normalizedOwners[key]; existing != "" && existing != operationID {
			return errors.New("persisted funding proof aliases conflict")
		}
		normalizedOwners[key] = operationID
	}
	for operationID, record := range state.FundingLifecycles {
		if integrated, exists := state.IntegratedFundings[operationID]; exists {
			if record.Origin != "committed_bid" || integrated.ID != operationID || integrated.AuctionID != record.AuctionID ||
				integrated.Bidder != record.Actor || integrated.Receipt.PoolAmount != record.Amount ||
				integrated.CommittedAt != record.CommittedAt || len(integrated.Receipt.ProofStateRefs) != len(record.ProofYs) {
				return errors.New("persisted integrated funding and lifecycle mirror disagree")
			}
			for index, proofY := range record.ProofYs {
				if integrated.Receipt.ProofStateRefs[index] != proofY {
					return errors.New("persisted integrated funding and lifecycle proofs disagree")
				}
			}
			if record.Status == "rejected_return_entitled" {
				if integrated.Status != record.Status || integrated.RejectionReason != record.Reason {
					return errors.New("persisted rejected funding and lifecycle mirror disagree")
				}
			} else if integrated.RejectionReason != "" || (integrated.Status != "active" && integrated.Status != "superseded" &&
				integrated.Status != "outbid_return_entitled" && integrated.Status != "payout_entitled" &&
				integrated.Status != "release_entitled") {
				return errors.New("persisted active funding status is invalid")
			}
		}
		if operationID != record.OperationID || record.Schema != fundingLifecycleSchema ||
			!validOperationID(operationID) || !validOperationID(record.AuctionID) || !validActor(record.Actor) ||
			record.Amount < 1 || record.Amount > 50_000 || record.CommittedHeight < 1 || record.CommittedAt < 1 ||
			!validLowerHex(record.ConsensusEventID, sha256.Size) || len(record.ProofYs) < 1 || len(record.ProofYs) > MaxInputs {
			return errors.New("persisted funding lifecycle record is malformed")
		}
		if (record.Origin == "committed_bid" && record.Status != "active" && record.Status != "rejected_return_entitled") ||
			(record.Origin == "committed_abort" && record.Status != "aborted_return_entitled") ||
			(record.Origin != "committed_bid" && record.Origin != "committed_abort") {
			return errors.New("persisted funding lifecycle origin or status is malformed")
		}
		if record.Origin == "committed_abort" {
			if !validLowerHex(record.AbortCertificateDigest, sha256.Size) || record.AbortCertificateDigest != record.ConsensusEventID ||
				!validLowerHex(record.ActorAuthorizationEventID, sha256.Size) ||
				(record.Reason != "prebroadcast_client_abandonment" && record.Reason != "prebroadcast_service_failure") {
				return errors.New("persisted funding-abort lifecycle binding is malformed")
			}
		} else {
			if record.ActorAuthorizationEventID != "" {
				return errors.New("persisted bid lifecycle contains an abort actor authorization")
			}
			if record.AbortCertificateDigest != "" {
				return errors.New("persisted bid lifecycle contains an abort digest")
			}
			if record.Status == "active" && record.Reason != "" {
				return errors.New("persisted active funding contains a rejection reason")
			}
			if record.Status == "rejected_return_entitled" {
				switch record.Reason {
				case "auction_not_open", "seller_self_bid", "late", "below_minimum", "stale_leader", "funding_expired":
				default:
					return errors.New("persisted rejected funding reason is malformed")
				}
			}
		}
		seenProofs := map[string]bool{}
		for index, proofY := range record.ProofYs {
			if !validCompressedPublicKey(proofY) || (index > 0 && record.ProofYs[index-1] >= proofY) {
				return errors.New("persisted funding lifecycle proof set is malformed")
			}
			key := proofY[2:]
			if seenProofs[key] {
				return errors.New("persisted funding lifecycle proof aliases conflict")
			}
			seenProofs[key] = true
			if existing := normalizedOwners[key]; existing != "" && existing != operationID {
				return errors.New("persisted funding lifecycle proof owner conflicts")
			}
			if existing := state.IntegratedProofUses[key]; existing != "" && existing != operationID {
				return errors.New("persisted proof is owned by integrated and lifecycle funding")
			}
			normalizedOwners[key] = operationID
		}
	}
	for proofY, operationID := range normalizedOwners {
		if integrated := state.IntegratedProofUses[proofY]; integrated != "" && integrated != operationID {
			return errors.New("persisted proof ownership conflicts across funding stores")
		}
	}
	for proofY, operationID := range normalizedOwners {
		record, exists := state.FundingLifecycles[operationID]
		if !exists {
			return errors.New("persisted funding proof owner lacks a lifecycle record")
		}
		found := false
		for _, recordProofY := range record.ProofYs {
			if recordProofY[2:] == proofY {
				found = true
				break
			}
		}
		if !found {
			return errors.New("persisted funding proof owner differs from its lifecycle record")
		}
	}
	state.FundingProofOwners = normalizedOwners
	return nil
}

func fundingAbortMap(certificate FundingAbortCertificateV1) (map[string]any, error) {
	raw, err := json.Marshal(certificate)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

func canonicalFundingJSON(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var normalized any
	if err := decoder.Decode(&normalized); err != nil {
		return nil, err
	}
	return json.Marshal(normalized)
}

func fundingAbortActorTerms(certificate FundingAbortCertificateV1) ([]byte, error) {
	value, err := fundingAbortMap(certificate)
	if err != nil {
		return nil, err
	}
	delete(value, "schema")
	delete(value, "participantPolicyDigest")
	delete(value, "actorAbortEvent")
	delete(value, "committeeAbortSignature")
	value["schema"] = fundingAbortActorSchema
	return canonicalFundingJSON(value)
}

func fundingAbortCommitteeDigest(certificate FundingAbortCertificateV1) ([32]byte, error) {
	value, err := fundingAbortMap(certificate)
	if err != nil {
		return [32]byte{}, err
	}
	delete(value, "committeeAbortSignature")
	canonical, err := canonicalFundingJSON(value)
	if err != nil {
		return [32]byte{}, err
	}
	material := append([]byte(fundingAbortCommitteeDomain), canonical...)
	return sha256.Sum256(material), nil
}

func fundingAbortCertificateDigest(certificate FundingAbortCertificateV1) ([32]byte, error) {
	canonical, err := canonicalFundingJSON(certificate)
	if err != nil {
		return [32]byte{}, err
	}
	return sha256.Sum256(canonical), nil
}

func verifyFundingAbortCertificate(state State, certificate FundingAbortCertificateV1, committedAt int64) ([32]byte, error) {
	if state.FundingAbortPins == nil {
		return [32]byte{}, errors.New("funding abort is disabled without persisted deployment pins")
	}
	pins := *state.FundingAbortPins
	if err := validateFundingAbortPins(state, pins); err != nil {
		return [32]byte{}, err
	}
	if certificate.Schema != fundingAbortSchema || !validOperationID(certificate.AuctionID) ||
		!validOperationID(certificate.OperationID) || !validActor(certificate.Actor) ||
		certificate.Amount < 1 || certificate.Amount > 50_000 || certificate.Locktime < 1 ||
		certificate.AbortNotBefore < 1 || certificate.AbortExpiresAt < certificate.AbortNotBefore ||
		certificate.AbortExpiresAt-certificate.AbortNotBefore > maxFundingAbortWindow ||
		certificate.Locktime < certificate.AbortExpiresAt || committedAt < certificate.AbortNotBefore ||
		committedAt > certificate.AbortExpiresAt || committedAt > maxSafeJSONInteger ||
		len(certificate.ProofYs) < 1 || len(certificate.ProofYs) > MaxInputs {
		return [32]byte{}, errors.New("funding-abort identity, amount, validity, or proof set is invalid")
	}
	if certificate.AuthNetworkID != pins.AuthNetworkID || certificate.ChainID != pins.ChainID ||
		certificate.GenesisSHA256 != pins.GenesisSHA256 || certificate.MintURL != pins.MintURL ||
		certificate.ActiveKeysetID != pins.ActiveKeysetID || certificate.CommitteePublicKey != pins.CommitteePublicKey ||
		certificate.CommitteeKeysetID != pins.CommitteeKeysetID || certificate.CommitteeKeysetVersion != pins.CommitteeKeysetVersion ||
		certificate.DKGRunID != pins.DKGRunID || certificate.PublicKeyPackageSHA256 != pins.PublicKeyPackageSHA256 ||
		certificate.SignerRosterDigest != pins.SignerRosterDigest {
		return [32]byte{}, errors.New("funding-abort certificate differs from persisted deployment pins")
	}
	for _, digest := range []string{certificate.GenesisSHA256, certificate.PoolDigest, certificate.ReturnPackageDigest,
		certificate.ReturnCashuSigAllDigest, certificate.FundingAuthorizationEventID, certificate.PublicKeyPackageSHA256,
		certificate.SignerRosterDigest, certificate.ParticipantPolicyDigest} {
		if !validLowerHex(digest, sha256.Size) {
			return [32]byte{}, errors.New("funding-abort digest is malformed")
		}
	}
	if !validOperationID(certificate.ActiveKeysetID) || !validOperationID(certificate.CommitteeKeysetID) ||
		!validOperationID(certificate.CommitteeKeysetVersion) || !validOperationID(certificate.DKGRunID) ||
		(certificate.AbortReason != "prebroadcast_client_abandonment" && certificate.AbortReason != "prebroadcast_service_failure") {
		return [32]byte{}, errors.New("funding-abort deployment or reason identity is invalid")
	}
	if len(certificate.NUT11LockPublicKeys) != 2 || certificate.NUT11LockPublicKeys[0] != certificate.PaymentPublicKey ||
		certificate.NUT11LockPublicKeys[1] != certificate.CommitteePublicKey || !validCompressedPublicKey(certificate.PaymentPublicKey) ||
		!validCompressedPublicKey(certificate.RefundPublicKey) || !validCompressedPublicKey(certificate.CommitteePublicKey) {
		return [32]byte{}, errors.New("funding-abort NUT-11 key binding is invalid")
	}
	roles := []string{certificate.Actor, certificate.PaymentPublicKey[2:], certificate.RefundPublicKey[2:], certificate.CommitteePublicKey[2:]}
	roleSet := map[string]bool{}
	for _, role := range roles {
		if roleSet[role] {
			return [32]byte{}, errors.New("funding-abort role keys are not distinct")
		}
		roleSet[role] = true
	}
	proofSet := map[string]bool{}
	for index, proofY := range certificate.ProofYs {
		if !validCompressedPublicKey(proofY) || (index > 0 && certificate.ProofYs[index-1] >= proofY) || proofSet[proofY[2:]] {
			return [32]byte{}, errors.New("funding-abort proof set is invalid, aliased, or noncanonical")
		}
		proofSet[proofY[2:]] = true
	}
	returnDigest, _ := hex.DecodeString(certificate.ReturnCashuSigAllDigest)
	if !verifyFundingSchnorr(certificate.BidderReturnSignature, returnDigest, certificate.PaymentPublicKey) {
		return [32]byte{}, errors.New("funding-abort bidder return signature is invalid")
	}
	event := certificate.ActorAbortEvent
	if event.Kind != KindFundingAbort || event.PubKey != certificate.Actor || event.CreatedAt < 1 || event.CreatedAt > certificate.AbortExpiresAt {
		return [32]byte{}, errors.New("funding-abort actor event identity is invalid")
	}
	wantedTags := [][]string{{"t", "plebeian-friday-funding-abort-v1"}, {"a", certificate.AuctionID}, {"operation", certificate.OperationID}}
	actualTags, _ := json.Marshal(event.Tags)
	expectedTags, _ := json.Marshal(wantedTags)
	terms, err := fundingAbortActorTerms(certificate)
	if err != nil || !bytes.Equal(actualTags, expectedTags) || event.Content != string(terms) {
		return [32]byte{}, errors.New("funding-abort actor event terms differ")
	}
	actor, err := VerifyNostrEvent(event)
	if err != nil || actor != certificate.Actor {
		return [32]byte{}, errors.New("funding-abort actor Nostr signature is invalid")
	}
	committeeDigest, err := fundingAbortCommitteeDigest(certificate)
	if err != nil || !verifyFundingSchnorr(certificate.CommitteeAbortSignature, committeeDigest[:], certificate.CommitteePublicKey) {
		return [32]byte{}, errors.New("funding-abort committee signature is invalid")
	}
	return fundingAbortCertificateDigest(certificate)
}

func verifyFundingSchnorr(signatureHex string, digest []byte, compressedPublicKey string) bool {
	if len(digest) != sha256.Size || !validLowerHex(signatureHex, schnorr.SignatureSize) || !validCompressedPublicKey(compressedPublicKey) {
		return false
	}
	signatureBytes, _ := hex.DecodeString(signatureHex)
	signature, err := schnorr.ParseSignature(signatureBytes)
	publicBytes, _ := hex.DecodeString(compressedPublicKey)
	public, keyErr := btcec.ParsePubKey(publicBytes)
	return err == nil && keyErr == nil && signature.Verify(digest, public)
}

func applyFundingAbort(state *State, certificate FundingAbortCertificateV1, committedAt int64) error {
	digest, err := verifyFundingAbortCertificate(*state, certificate, committedAt)
	if err != nil {
		return err
	}
	if _, exists := state.FundingLifecycles[certificate.OperationID]; exists {
		return errors.New("funding operation already has a committed lifecycle origin")
	}
	if _, exists := state.IntegratedFundings[certificate.OperationID]; exists {
		return errors.New("funding operation was already committed as a bid")
	}
	for _, proofY := range certificate.ProofYs {
		key := proofY[2:]
		if state.FundingProofOwners[key] != "" || state.IntegratedProofUses[key] != "" {
			return errors.New("funding proof already has a committed lifecycle origin")
		}
	}
	digestHex := hex.EncodeToString(digest[:])
	state.FundingLifecycles[certificate.OperationID] = FundingLifecycleV1{
		Schema: fundingLifecycleSchema, OperationID: certificate.OperationID, ProofYs: append([]string(nil), certificate.ProofYs...),
		AuctionID: certificate.AuctionID, Actor: certificate.Actor, Amount: certificate.Amount,
		Origin: "committed_abort", Status: "aborted_return_entitled", ConsensusEventID: digestHex,
		ActorAuthorizationEventID: certificate.ActorAbortEvent.ID,
		CommittedHeight:           state.Height + 1, CommittedAt: committedAt, Reason: certificate.AbortReason,
		AbortCertificateDigest: digestHex,
	}
	for _, proofY := range certificate.ProofYs {
		state.FundingProofOwners[proofY[2:]] = certificate.OperationID
	}
	return nil
}

func verifyIntegratedFundingAbortPins(state State, receipt IntegratedFundingReceipt) error {
	if state.FundingAbortPins == nil || receipt.Schema != "PlebeianAuctionsPOCIntegratedFundingV4" {
		return nil
	}
	pins := *state.FundingAbortPins
	if receipt.AuthNetworkID != pins.AuthNetworkID || receipt.ChainID != pins.ChainID || receipt.MintURL != pins.MintURL ||
		receipt.ActiveKeysetID != pins.ActiveKeysetID || receipt.CommitteePublicKey != pins.CommitteePublicKey ||
		receipt.CommitteeKeysetID != pins.CommitteeKeysetID || receipt.CommitteeKeysetVersion != pins.CommitteeKeysetVersion ||
		receipt.DKGRunID != pins.DKGRunID || receipt.PublicKeyPackageSHA256 != pins.PublicKeyPackageSHA256 ||
		receipt.SignerRosterDigest != pins.SignerRosterDigest {
		return errors.New("integrated funding differs from persisted abort deployment pins")
	}
	return nil
}

func claimCommittedV4Funding(state *State, receipt IntegratedFundingReceipt, actor, eventID string, committedAt int64, status, reason string) error {
	if state.FundingAbortPins == nil || receipt.Schema != "PlebeianAuctionsPOCIntegratedFundingV4" {
		return nil
	}
	if _, exists := state.FundingLifecycles[receipt.FundingOperationID]; exists {
		return errors.New("funding operation already has a committed lifecycle origin")
	}
	for _, proofY := range receipt.ProofStateRefs {
		if state.FundingProofOwners[proofY[2:]] != "" {
			return errors.New("funding proof already has a committed lifecycle origin")
		}
	}
	record := FundingLifecycleV1{
		Schema: fundingLifecycleSchema, OperationID: receipt.FundingOperationID,
		ProofYs: append([]string(nil), receipt.ProofStateRefs...), AuctionID: receipt.AuctionID,
		Actor: actor, Amount: receipt.PoolAmount, Origin: "committed_bid", Status: status,
		ConsensusEventID: eventID, CommittedHeight: state.Height + 1, CommittedAt: committedAt, Reason: reason,
	}
	state.FundingLifecycles[receipt.FundingOperationID] = record
	for _, proofY := range receipt.ProofStateRefs {
		state.FundingProofOwners[proofY[2:]] = receipt.FundingOperationID
	}
	return nil
}
