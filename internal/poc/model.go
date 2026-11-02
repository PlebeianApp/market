package poc

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

const (
	TxVersion        = 1
	KindCreate       = 28640
	KindBid          = 28641
	KindRefund       = 28642
	KindFundingAbort = 28650
	MaxTxBytes       = 64 * 1024
	MaxInputs        = 32
	TestMintURL      = "http://127.0.0.1:8080/test-mint"
	CashuMintURL     = "http://127.0.0.1:3338"
	ProductionURL    = "relay.plebeian.market"

	FundingModeLegacy               = "legacy"
	FundingModeCustodialReservation = "custodial_reservation_v1"
	FundingModeThresholdSigAll      = "threshold_sigall_v1"
	ApplicationAuthorityLegacy      = "legacy_ed25519_v1"
	ApplicationAuthorityFrostCashu  = "frost_cashu_v4"
	frostLegacyNotePublicPinDomain  = "PLEBEIAN_FRIDAY_DISABLED_LEGACY_NOTE_AUTHORITY_V1"

	// EmergencyRecoverySeconds is measured from the maximum possible auction
	// end, not the current end.  The cooperative committee stops new MAIN
	// authorizations five minutes before this locktime; the later unilateral
	// refund branch remains a liveness escape and does not revoke an older MAIN.
	EmergencyRecoverySeconds = int64(900)
)

var errIntegratedFundingReceiptExpired = errors.New("integrated funding attestation expired at committed block time")

type Policy struct {
	FaucetAmount       int64 `json:"faucet_amount"`
	FaucetCap          int64 `json:"faucet_cap"`
	MinBidIncrement    int64 `json:"min_bid_increment"`
	MinDurationSeconds int64 `json:"min_duration_seconds"`
	MaxDurationSeconds int64 `json:"max_duration_seconds"`
	EventSkewSeconds   int64 `json:"event_skew_seconds"`
	LateBidWindow      int64 `json:"late_bid_window_seconds"`
	LateBidExtension   int64 `json:"late_bid_extension_seconds"`
	MaxTotalExtension  int64 `json:"max_total_extension_seconds"`
	ReceiptTTLSeconds  int64 `json:"receipt_ttl_seconds"`
}

func DefaultPolicy() Policy {
	return Policy{
		FaucetAmount: 10_000, FaucetCap: 50_000, MinBidIncrement: 100,
		MinDurationSeconds: 3, MaxDurationSeconds: 3_600, EventSkewSeconds: 300,
		LateBidWindow: 180, LateBidExtension: 180, MaxTotalExtension: 1_800,
		ReceiptTTLSeconds: 300,
	}
}

func (p Policy) Validate() error {
	if p.FaucetAmount <= 0 || p.FaucetCap < p.FaucetAmount || p.MinBidIncrement <= 0 ||
		p.FaucetAmount > 9_007_199_254_740_991 || p.FaucetCap > 9_007_199_254_740_991 ||
		p.MinDurationSeconds <= 0 || p.MaxDurationSeconds < p.MinDurationSeconds || p.EventSkewSeconds <= 0 ||
		p.LateBidWindow <= 0 || p.LateBidExtension <= 0 || p.MaxTotalExtension < p.LateBidExtension || p.ReceiptTTLSeconds <= 0 {
		return errors.New("invalid explicit POC policy")
	}
	return nil
}

type SignedEvent struct {
	ID        string     `json:"id"`
	PubKey    string     `json:"pubkey"`
	CreatedAt int64      `json:"created_at"`
	Kind      int        `json:"kind"`
	Tags      [][]string `json:"tags"`
	Content   string     `json:"content"`
	Sig       string     `json:"sig"`
}

type Transaction struct {
	Version      int                        `json:"version"`
	Type         string                     `json:"type"`
	Actor        string                     `json:"actor,omitempty"`
	AuctionID    string                     `json:"auction_id,omitempty"`
	Event        *SignedEvent               `json:"event,omitempty"`
	FundingAbort *FundingAbortCertificateV1 `json:"funding_abort,omitempty"`
}

type Note struct {
	ID        string `json:"id"`
	Amount    int64  `json:"amount"`
	Owner     string `json:"owner"`
	Signature string `json:"signature"`
	SpentBy   string `json:"spent_by,omitempty"`
}

type Bid struct {
	ID                  string   `json:"id"`
	AuctionID           string   `json:"auction_id"`
	Bidder              string   `json:"bidder"`
	Amount              int64    `json:"amount"`
	InputNoteIDs        []string `json:"input_note_ids,omitempty"`
	CashuTokenSHA256    string   `json:"cashu_token_sha256,omitempty"`
	CashuLockOperation  string   `json:"cashu_lock_operation,omitempty"`
	ReservationID       string   `json:"reservation_id,omitempty"`
	IntegratedFundingID string   `json:"integrated_funding_id,omitempty"`
	ReplacesBidID       string   `json:"replaces_bid_id,omitempty"`
	CommittedAt         int64    `json:"committed_at"`
}

// IntegratedFundingReceipt is the non-bearer, consensus-visible admission
// record for the fake-only threshold route.  The proof references are Cashu Y
// points, never bearer secrets.  The FROST group attests that its participants
// independently verified the exact hidden package, mint state, current leader,
// and pre-signed full-pool return before admission.  The ABCI transition—not a
// participant-local row—then serializes the global proof claim.  This route is
// deliberately separate from the coordinator-signed custodial candidate.
type IntegratedFundingReceipt struct {
	Schema                    string       `json:"schema"`
	AuthNetworkID             string       `json:"auth_network_id"`
	ChainID                   string       `json:"chain_id"`
	MintURL                   string       `json:"mint_url"`
	AuctionID                 string       `json:"auction_id"`
	Bidder                    string       `json:"bidder"`
	BidAmount                 int64        `json:"bid_amount"`
	PoolAmount                int64        `json:"pool_amount"`
	ReplacesBidID             string       `json:"replaces_bid_id"`
	FundingOperationID        string       `json:"funding_operation_id"`
	AttestedAt                int64        `json:"attested_at"`
	ExpiresAt                 int64        `json:"expires_at"`
	ProofStateRefs            []string     `json:"proof_state_refs"`
	ActiveKeysetID            string       `json:"active_keyset_id"`
	InputFeePPK               int64        `json:"input_fee_ppk"`
	Locktime                  int64        `json:"locktime"`
	BidderPublicKey           string       `json:"bidder_public_key"`
	RefundPublicKey           string       `json:"refund_public_key"`
	CommitteePublicKey        string       `json:"committee_public_key"`
	CommitteeKeysetID         string       `json:"committee_keyset_id"`
	CommitteeKeysetVersion    string       `json:"committee_keyset_version"`
	DKGRunID                  string       `json:"dkg_run_id"`
	PublicKeyPackageSHA256    string       `json:"public_key_package_sha256"`
	SignerRosterDigest        string       `json:"signer_roster_digest"`
	WinnerPackageDigest       string       `json:"winner_package_digest"`
	ReturnPackageDigest       string       `json:"return_package_digest"`
	ReturnCashuSigAllDigest   string       `json:"return_cashu_sigall_digest"`
	PreparedBundleDigest      string       `json:"prepared_bundle_digest,omitempty"`
	BundleDigest              string       `json:"bundle_digest"`
	ActorFundingSignature     string       `json:"actor_funding_signature,omitempty"`
	ActorFundingAuthorization *SignedEvent `json:"actor_funding_authorization,omitempty"`
	BidderReturnSignature     string       `json:"bidder_return_signature"`
	ParticipantPolicyDigest   string       `json:"participant_policy_digest"`
	CommitteeSignature        string       `json:"committee_signature"`
}

type IntegratedFunding struct {
	ID              string                   `json:"id"`
	AuctionID       string                   `json:"auction_id"`
	BidID           string                   `json:"bid_id"`
	Bidder          string                   `json:"bidder"`
	Status          string                   `json:"status"`
	RejectionReason string                   `json:"rejection_reason,omitempty"`
	CommittedAt     int64                    `json:"committed_at"`
	Receipt         IntegratedFundingReceipt `json:"receipt"`
}

// IntegratedDisplacement is immutable consensus history retained when one
// threshold-funded bid replaces another.  A signer still verifies the raw
// replacement transaction in its local Comet block and H+1/H+2 commits; this
// record supplies the deterministic prior-state facts that are not caller
// assertions.
type IntegratedDisplacement struct {
	ID                   string `json:"id"`
	AuctionID            string `json:"auction_id"`
	DisplacedBidID       string `json:"displaced_bid_id"`
	ReplacementBidID     string `json:"replacement_bid_id"`
	DisplacedFundingID   string `json:"displaced_funding_id"`
	ReplacementFundingID string `json:"replacement_funding_id"`
	CommittedAt          int64  `json:"committed_at"`
	OriginalEndTime      int64  `json:"original_end_time"`
	CertifiedEndTime     int64  `json:"certified_end_time"`
}

// CustodyReservationReceipt is public, non-bearer evidence that the custodial
// coordinator has made already-funded wallet value unavailable. It is an
// application reservation, not a Cashu/NUT-11 lock.
type CustodyReservationReceipt struct {
	Schema                string `json:"schema"`
	MintURL               string `json:"mint_url"`
	AuctionID             string `json:"auction_id"`
	Bidder                string `json:"bidder"`
	Amount                int64  `json:"amount"`
	ReservationID         string `json:"reservation_id"`
	ReplacesReservationID string `json:"replaces_reservation_id,omitempty"`
	ExpiresAt             int64  `json:"expires_at"`
	CommitteePublicKey    string `json:"committee_public_key"`
	Signature             string `json:"signature"`
}

type CustodyReservation struct {
	ID                    string `json:"id"`
	AuctionID             string `json:"auction_id"`
	BidID                 string `json:"bid_id"`
	Bidder                string `json:"bidder"`
	Amount                int64  `json:"amount"`
	ReplacesReservationID string `json:"replaces_reservation_id,omitempty"`
	Status                string `json:"status"`
	CommittedAt           int64  `json:"committed_at"`
}

// CashuLockReceipt is public, non-bearer evidence from the application-level
// payment coordinator. The signed receipt is issued only after Coco has
// produced and read back the mint-signed NUT-11 token. It deliberately carries
// a token digest rather than bearer proofs. The trusted signer is a single POC
// committee key, not FROST or threshold custody.
type CashuLockReceipt struct {
	Schema             string `json:"schema"`
	MintURL            string `json:"mint_url"`
	AuctionID          string `json:"auction_id"`
	Bidder             string `json:"bidder"`
	Amount             int64  `json:"amount"`
	OperationID        string `json:"operation_id"`
	TokenSHA256        string `json:"token_sha256"`
	CommitteePublicKey string `json:"committee_public_key"`
	RefundPublicKey    string `json:"refund_public_key"`
	Locktime           int64  `json:"locktime"`
	Signature          string `json:"signature"`
}

type Lock struct {
	ID           string `json:"id"`
	AuctionID    string `json:"auction_id"`
	BidID        string `json:"bid_id"`
	Bidder       string `json:"bidder"`
	Amount       int64  `json:"amount"`
	Status       string `json:"status"`
	OutputNoteID string `json:"output_note_id,omitempty"`
}

type Auction struct {
	ID                         string `json:"id"`
	Seller                     string `json:"seller"`
	Title                      string `json:"title"`
	Description                string `json:"description,omitempty"`
	ImageURL                   string `json:"image_url,omitempty"`
	FundingMode                string `json:"funding_mode"`
	SellerCocoPaymentPublicKey string `json:"seller_coco_payment_public_key,omitempty"`
	StartingBid                int64  `json:"starting_bid"`
	MinIncrement               int64  `json:"min_increment"`
	Reserve                    int64  `json:"reserve"`
	CreatedAt                  int64  `json:"created_at"`
	OriginalEndTime            int64  `json:"original_end_time"`
	EndTime                    int64  `json:"end_time"`
	ExtensionCount             int    `json:"extension_count"`
	Status                     string `json:"status"`
	LeaderBidID                string `json:"leader_bid_id,omitempty"`
	HighBid                    int64  `json:"high_bid"`
	Winner                     string `json:"winner,omitempty"`
	ClosedAt                   int64  `json:"closed_at,omitempty"`
	PaymentNoteID              string `json:"payment_note_id,omitempty"`
}

type State struct {
	Schema                  string                            `json:"schema"`
	ApplicationAuthority    string                            `json:"application_authority"`
	AuthNetworkID           string                            `json:"auth_network_id"`
	ChainID                 string                            `json:"chain_id"`
	Height                  int64                             `json:"height"`
	MintURL                 string                            `json:"mint_url"`
	MintPublicKey           string                            `json:"mint_public_key"`
	CashuMintURL            string                            `json:"cashu_mint_url"`
	CommitteePublicKey      string                            `json:"committee_public_key"`
	Issued                  map[string]bool                   `json:"issued"`
	Notes                   map[string]Note                   `json:"notes"`
	Auctions                map[string]Auction                `json:"auctions"`
	Bids                    map[string]Bid                    `json:"bids"`
	Locks                   map[string]Lock                   `json:"locks"`
	Operations              map[string]bool                   `json:"operations"`
	CashuLocks              map[string]CashuLockReceipt       `json:"cashu_locks"`
	CustodyReservations     map[string]CustodyReservation     `json:"custody_reservations"`
	IntegratedFundings      map[string]IntegratedFunding      `json:"integrated_fundings"`
	IntegratedProofUses     map[string]string                 `json:"integrated_proof_uses"`
	IntegratedDisplacements map[string]IntegratedDisplacement `json:"integrated_displacements"`
	FundingAbortPins        *FundingAbortPinsV1               `json:"funding_abort_pins,omitempty"`
	FundingLifecycles       map[string]FundingLifecycleV1     `json:"funding_lifecycles"`
	FundingProofOwners      map[string]string                 `json:"funding_proof_owners"`
	LastConsensusTime       int64                             `json:"last_consensus_time"`
}

type WalletView struct {
	Actor      string `json:"actor"`
	Spendable  int64  `json:"spendable"`
	Locked     int64  `json:"locked"`
	Refundable int64  `json:"refundable"`
	Notes      []Note `json:"notes"`
}

type StateView struct {
	State          State      `json:"state"`
	Wallet         WalletView `json:"wallet"`
	AppHash        string     `json:"app_hash"`
	CanonicalState string     `json:"canonical_state"`
}

func NewState(chainID string, mintPublic ed25519.PublicKey, committeePublicKey string) (State, error) {
	return NewStateWithEndpoints(chainID, mintPublic, committeePublicKey, TestMintURL, CashuMintURL)
}

func validateFakeMoneyEndpoint(raw string, expectedPath string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != expectedPath {
		return errors.New("fake-money endpoint must be one exact private HTTP origin/path")
	}
	ip := net.ParseIP(parsed.Hostname())
	port, err := strconv.Atoi(parsed.Port())
	if ip == nil || (!ip.IsLoopback() && !ip.IsPrivate()) || err != nil || port < 1024 || port > 65535 || strings.Contains(raw, ProductionURL) {
		return errors.New("fake-money endpoint must use a private IP and unprivileged port")
	}
	return nil
}

// validateCashuMintIdentity validates the canonical receipt identity, not the
// server's transport address. Local/lab networks retain the private HTTP form;
// the Friday browser flow uses one public HTTPS IP origin which is mapped to a
// separately pinned private FIPS transport by the authority/proxy.
func validateCashuMintIdentity(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" || parsed.Opaque != "" || strings.Contains(raw, ProductionURL) {
		return errors.New("Cashu mint identity must be one exact credential-free origin")
	}
	if parsed.Scheme == "http" {
		return validateFakeMoneyEndpoint(raw, "")
	}
	if parsed.Scheme != "https" || parsed.Hostname() == "" || (parsed.Port() != "" && parsed.Port() != "443") {
		return errors.New("Cashu mint identity must use private HTTP or public HTTPS")
	}
	ip := net.ParseIP(parsed.Hostname())
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
		return errors.New("public Cashu HTTPS identity must use a public IP literal")
	}
	return nil
}

func NewStateWithEndpoints(chainID string, mintPublic ed25519.PublicKey, committeePublicKey, mintURL, cashuMintURL string) (State, error) {
	return newStateWithAuthority(chainID, mintPublic, committeePublicKey, mintURL, cashuMintURL, ApplicationAuthorityLegacy)
}

// newStateWithFrostAuthority creates the Friday FROST/Coco application state
// from public pins only. MintPublicKey is a deterministic disabled-legacy-note
// namespace pin; no corresponding private key is generated or accepted.
func newStateWithFrostAuthority(chainID string, mintPublic ed25519.PublicKey, committeePublicKey, mintURL, cashuMintURL string) (State, error) {
	return newStateWithAuthority(chainID, mintPublic, committeePublicKey, mintURL, cashuMintURL, ApplicationAuthorityFrostCashu)
}

func newStateWithAuthority(chainID string, mintPublic ed25519.PublicKey, committeePublicKey, mintURL, cashuMintURL, authority string) (State, error) {
	if strings.TrimSpace(chainID) == "" || len(mintPublic) != ed25519.PublicKeySize || !validCompressedPublicKey(committeePublicKey) {
		return State{}, errors.New("chain id, mint public key, and Cashu committee public key are required")
	}
	if authority != ApplicationAuthorityLegacy && authority != ApplicationAuthorityFrostCashu {
		return State{}, errors.New("application authority mode is unsupported")
	}
	if err := validateFakeMoneyEndpoint(mintURL, "/test-mint"); err != nil {
		return State{}, err
	}
	if err := validateCashuMintIdentity(cashuMintURL); err != nil {
		return State{}, err
	}
	return State{
		Schema:                  "PlebeianAuctionsPOCStateV8",
		ApplicationAuthority:    authority,
		AuthNetworkID:           chainID,
		ChainID:                 chainID,
		MintURL:                 mintURL,
		MintPublicKey:           hex.EncodeToString(mintPublic),
		CashuMintURL:            cashuMintURL,
		CommitteePublicKey:      committeePublicKey,
		Issued:                  map[string]bool{},
		Notes:                   map[string]Note{},
		Auctions:                map[string]Auction{},
		Bids:                    map[string]Bid{},
		Locks:                   map[string]Lock{},
		Operations:              map[string]bool{},
		CashuLocks:              map[string]CashuLockReceipt{},
		CustodyReservations:     map[string]CustodyReservation{},
		IntegratedFundings:      map[string]IntegratedFunding{},
		IntegratedProofUses:     map[string]string{},
		IntegratedDisplacements: map[string]IntegratedDisplacement{},
		FundingLifecycles:       map[string]FundingLifecycleV1{},
		FundingProofOwners:      map[string]string{},
	}, nil
}

// NewStateWithFundingAbortPins is the only constructor that enables the
// FundingAbortV1 transition. The persisted pins are deployment authority;
// abort transactions can never supply or replace them.
func NewStateWithFundingAbortPins(chainID string, mintPublic ed25519.PublicKey, committeePublicKey, mintURL, cashuMintURL string, pins FundingAbortPinsV1) (State, error) {
	state, err := NewStateWithEndpoints(chainID, mintPublic, committeePublicKey, mintURL, cashuMintURL)
	if err != nil {
		return State{}, err
	}
	if err := validateFundingAbortPins(state, pins); err != nil {
		return State{}, err
	}
	state.FundingAbortPins = &pins
	return state, nil
}

// NewStateWithFrostFundingAbortPins binds FundingAbortV1 without enrolling
// the legacy shared Ed25519 note issuer.
func NewStateWithFrostFundingAbortPins(chainID string, mintPublic ed25519.PublicKey, committeePublicKey, mintURL, cashuMintURL string, pins FundingAbortPinsV1) (State, error) {
	expectedPublic, err := DeriveFrostCashuLegacyNotePublicPin(pins)
	if err != nil {
		return State{}, err
	}
	if !bytes.Equal(mintPublic, expectedPublic) {
		return State{}, errors.New("FROST/Cashu disabled legacy-note authority pin differs")
	}
	state, err := newStateWithFrostAuthority(chainID, mintPublic, committeePublicKey, mintURL, cashuMintURL)
	if err != nil {
		return State{}, err
	}
	if err := validateFundingAbortPins(state, pins); err != nil {
		return State{}, err
	}
	state.FundingAbortPins = &pins
	return state, nil
}

// DeriveFrostCashuLegacyNotePublicPin deterministically fills the historical
// MintPublicKey field without creating, retaining, or implying a shared note
// issuer secret. The FROST/Cashu transition gate rejects every legacy note
// issuance path; the derived bytes only bind that disabled namespace into the
// genesis application hash and deployment receipt.
func DeriveFrostCashuLegacyNotePublicPin(pins FundingAbortPinsV1) (ed25519.PublicKey, error) {
	if pins.AuthNetworkID == "" || pins.AuthNetworkID != pins.ChainID ||
		validateCashuMintIdentity(pins.MintURL) != nil || !validLowerHex(pins.GenesisSHA256, sha256.Size) ||
		!validOperationID(pins.ActiveKeysetID) || !validCompressedPublicKey(pins.CommitteePublicKey) ||
		!validOperationID(pins.CommitteeKeysetID) || !validOperationID(pins.CommitteeKeysetVersion) ||
		!validOperationID(pins.DKGRunID) || !validLowerHex(pins.PublicKeyPackageSHA256, sha256.Size) ||
		!validLowerHex(pins.SignerRosterDigest, sha256.Size) {
		return nil, errors.New("FROST/Cashu authority pins are malformed")
	}
	material, err := json.Marshal([]string{
		pins.AuthNetworkID, pins.ChainID, pins.GenesisSHA256, pins.MintURL, pins.ActiveKeysetID,
		pins.CommitteePublicKey, pins.CommitteeKeysetID, pins.CommitteeKeysetVersion,
		pins.DKGRunID, pins.PublicKeyPackageSHA256, pins.SignerRosterDigest,
	})
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(append([]byte(frostLegacyNotePublicPinDomain), material...))
	return append(ed25519.PublicKey(nil), digest[:]...), nil
}

func normalizeState(state *State, policy Policy) error {
	if state.Schema != "PlebeianAuctionsPOCStateV2" && state.Schema != "PlebeianAuctionsPOCStateV3" &&
		state.Schema != "PlebeianAuctionsPOCStateV4" && state.Schema != "PlebeianAuctionsPOCStateV5" &&
		state.Schema != "PlebeianAuctionsPOCStateV6" && state.Schema != "PlebeianAuctionsPOCStateV7" &&
		state.Schema != "PlebeianAuctionsPOCStateV8" {
		return errors.New("persisted application state schema is unsupported")
	}
	state.Schema = "PlebeianAuctionsPOCStateV8"
	if state.ApplicationAuthority == "" {
		state.ApplicationAuthority = ApplicationAuthorityLegacy
	}
	if state.ApplicationAuthority != ApplicationAuthorityLegacy && state.ApplicationAuthority != ApplicationAuthorityFrostCashu {
		return errors.New("persisted application authority mode is unsupported")
	}
	if state.AuthNetworkID == "" {
		state.AuthNetworkID = state.ChainID
	}
	if state.CustodyReservations == nil {
		state.CustodyReservations = map[string]CustodyReservation{}
	}
	if state.IntegratedFundings == nil {
		state.IntegratedFundings = map[string]IntegratedFunding{}
	}
	if state.IntegratedProofUses == nil {
		state.IntegratedProofUses = map[string]string{}
	}
	normalizedProofUses := make(map[string]string, len(state.IntegratedProofUses))
	for proofStateRef, operationID := range state.IntegratedProofUses {
		key := proofStateRef
		if validCompressedPublicKey(proofStateRef) {
			key = proofStateRef[2:]
		} else if !validLowerHex(proofStateRef, 32) {
			return errors.New("persisted integrated proof-use key is malformed")
		}
		if !validOperationID(operationID) {
			return errors.New("persisted integrated proof-use operation is malformed")
		}
		if existing := normalizedProofUses[key]; existing != "" && existing != operationID {
			return errors.New("persisted integrated proof-use aliases conflict")
		}
		normalizedProofUses[key] = operationID
	}
	state.IntegratedProofUses = normalizedProofUses
	if state.IntegratedDisplacements == nil {
		state.IntegratedDisplacements = map[string]IntegratedDisplacement{}
	}
	if state.FundingLifecycles == nil {
		state.FundingLifecycles = map[string]FundingLifecycleV1{}
	}
	if state.FundingProofOwners == nil {
		state.FundingProofOwners = map[string]string{}
	}
	if state.FundingAbortPins != nil {
		if err := validateFundingAbortPins(*state, *state.FundingAbortPins); err != nil {
			return fmt.Errorf("persisted funding-abort pins are invalid: %w", err)
		}
	}
	if err := normalizeFundingLifecycleState(state); err != nil {
		return err
	}
	for id, auction := range state.Auctions {
		if auction.FundingMode == "" {
			auction.FundingMode = FundingModeLegacy
		}
		if auction.FundingMode != FundingModeLegacy && auction.FundingMode != FundingModeCustodialReservation && auction.FundingMode != FundingModeThresholdSigAll {
			return errors.New("persisted auction funding mode is unsupported")
		}
		if auction.OriginalEndTime == 0 {
			auction.OriginalEndTime = auction.EndTime
		}
		if auction.MinIncrement == 0 {
			auction.MinIncrement = policy.MinBidIncrement
		}
		state.Auctions[id] = auction
	}
	return nil
}

func (s State) Clone() (State, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return State{}, err
	}
	var cloned State
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return State{}, err
	}
	return cloned, nil
}

func (s State) CanonicalHash() ([32]byte, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return [32]byte{}, err
	}
	return sha256.Sum256(raw), nil
}

func (s State) View(actor string) (StateView, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return StateView{}, err
	}
	hash := sha256.Sum256(raw)
	view := StateView{
		State: s, AppHash: hex.EncodeToString(hash[:]), CanonicalState: base64.StdEncoding.EncodeToString(raw),
		Wallet: WalletView{Actor: actor},
	}
	for _, note := range s.Notes {
		if note.Owner == actor && note.SpentBy == "" {
			view.Wallet.Spendable += note.Amount
			view.Wallet.Notes = append(view.Wallet.Notes, note)
		}
	}
	for _, lock := range s.Locks {
		if lock.Bidder != actor {
			continue
		}
		switch lock.Status {
		case "locked":
			view.Wallet.Locked += lock.Amount
		case "refundable":
			view.Wallet.Refundable += lock.Amount
		}
	}
	sort.Slice(view.Wallet.Notes, func(i, j int) bool { return view.Wallet.Notes[i].ID < view.Wallet.Notes[j].ID })
	return view, nil
}

func EncodeTransaction(tx Transaction) ([]byte, error) {
	if tx.Version == 0 {
		tx.Version = TxVersion
	}
	raw, err := json.Marshal(tx)
	if err != nil {
		return nil, err
	}
	if len(raw) > MaxTxBytes {
		return nil, errors.New("transaction exceeds POC byte limit")
	}
	return raw, nil
}

func DecodeTransaction(raw []byte) (Transaction, error) {
	if len(raw) == 0 || len(raw) > MaxTxBytes {
		return Transaction{}, errors.New("transaction byte length is invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var tx Transaction
	if err := decoder.Decode(&tx); err != nil {
		return Transaction{}, fmt.Errorf("decode transaction: %w", err)
	}
	if err := requireEOF(decoder); err != nil {
		return Transaction{}, err
	}
	if tx.Version != TxVersion {
		return Transaction{}, errors.New("unsupported transaction version")
	}
	switch tx.Type {
	case "faucet":
		if !validActor(tx.Actor) || tx.Event != nil || tx.AuctionID != "" || tx.FundingAbort != nil {
			return Transaction{}, errors.New("invalid faucet transaction shape")
		}
	case "event":
		if tx.Event == nil || tx.Actor != "" || tx.AuctionID != "" || tx.FundingAbort != nil {
			return Transaction{}, errors.New("invalid signed-event transaction shape")
		}
	case "close":
		if !validIdentifier(tx.AuctionID) || tx.Actor != "" || tx.Event != nil || tx.FundingAbort != nil {
			return Transaction{}, errors.New("invalid close transaction shape")
		}
	case "funding_abort":
		if tx.FundingAbort == nil || tx.Actor != "" || tx.AuctionID != "" || tx.Event != nil {
			return Transaction{}, errors.New("invalid funding-abort transaction shape")
		}
	default:
		return Transaction{}, errors.New("unsupported transaction type")
	}
	return tx, nil
}

type createContent struct {
	AuctionID                  string `json:"auction_id"`
	Title                      string `json:"title"`
	Description                string `json:"description,omitempty"`
	ImageURL                   string `json:"image_url,omitempty"`
	Duration                   int64  `json:"duration_seconds"`
	StartingBid                int64  `json:"starting_bid"`
	MinIncrement               int64  `json:"min_increment,omitempty"`
	Reserve                    int64  `json:"reserve"`
	FundingMode                string `json:"funding_mode,omitempty"`
	SellerCocoPaymentPublicKey string `json:"seller_coco_payment_public_key,omitempty"`
}

type bidContent struct {
	AuctionID         string                     `json:"auction_id"`
	Amount            int64                      `json:"amount"`
	ReplacesBidID     string                     `json:"replaces_bid_id,omitempty"`
	Inputs            []string                   `json:"inputs,omitempty"`
	CashuLock         *CashuLockReceipt          `json:"cashu_lock,omitempty"`
	Reservation       *CustodyReservationReceipt `json:"reservation,omitempty"`
	IntegratedFunding *IntegratedFundingReceipt  `json:"integrated_funding,omitempty"`
}

type refundContent struct {
	BidID string `json:"bid_id"`
}

func ApplyTransaction(prior State, tx Transaction, consensusSeconds int64, policy Policy, mintSeed []byte) (State, error) {
	if err := policy.Validate(); err != nil {
		return State{}, err
	}
	if consensusSeconds < prior.LastConsensusTime {
		return State{}, errors.New("consensus time moved backwards")
	}
	next, err := prior.Clone()
	if err != nil {
		return State{}, err
	}
	var privateKey ed25519.PrivateKey
	switch next.ApplicationAuthority {
	case ApplicationAuthorityLegacy:
		if len(mintSeed) != ed25519.SeedSize {
			return State{}, errors.New("shared POC committee seed is invalid")
		}
		privateKey = ed25519.NewKeyFromSeed(mintSeed)
		if next.MintPublicKey != hex.EncodeToString(privateKey.Public().(ed25519.PublicKey)) {
			return State{}, errors.New("shared POC committee key does not match state")
		}
	case ApplicationAuthorityFrostCashu:
		if len(mintSeed) != 0 {
			return State{}, errors.New("FROST/Cashu application refuses a legacy mint seed")
		}
		if next.FundingAbortPins == nil {
			return State{}, errors.New("FROST/Cashu application requires pinned funding authority")
		}
		if err := validateFrostCashuTransaction(next, tx); err != nil {
			return State{}, err
		}
	default:
		return State{}, errors.New("application authority mode is unsupported")
	}
	switch tx.Type {
	case "faucet":
		err = applyFaucet(&next, tx.Actor, policy, privateKey)
	case "event":
		err = applySignedEvent(&next, *tx.Event, consensusSeconds, policy, privateKey)
	case "close":
		err = applyClose(&next, tx.AuctionID, consensusSeconds, privateKey)
	case "funding_abort":
		err = applyFundingAbort(&next, *tx.FundingAbort, consensusSeconds)
	default:
		err = errors.New("unsupported transaction")
	}
	if err != nil {
		return State{}, err
	}
	next.LastConsensusTime = consensusSeconds
	return next, nil
}

// validateFrostCashuTransaction proves the transition cannot reach any legacy
// Ed25519 note-issuing path. The normal V4 receipt and FundingAbort handlers
// still perform the complete cryptographic and state validation afterward.
func validateFrostCashuTransaction(state State, tx Transaction) error {
	switch tx.Type {
	case "faucet":
		return errors.New("FROST/Cashu application does not support the legacy faucet")
	case "event":
		if tx.Event == nil {
			return errors.New("FROST/Cashu event is absent")
		}
		switch tx.Event.Kind {
		case KindCreate:
			var content createContent
			if err := decodeStrictContent(tx.Event.Content, &content); err != nil {
				return err
			}
			if content.FundingMode != FundingModeThresholdSigAll {
				return errors.New("FROST/Cashu application requires threshold-funded auctions")
			}
		case KindBid:
			var content bidContent
			if err := decodeStrictContent(tx.Event.Content, &content); err != nil {
				return err
			}
			if content.IntegratedFunding == nil || content.IntegratedFunding.Schema != "PlebeianAuctionsPOCIntegratedFundingV4" {
				return errors.New("FROST/Cashu application requires V4 integrated funding")
			}
		case KindRefund:
			return errors.New("FROST/Cashu refunds require committed terminal entitlement")
		default:
			return errors.New("unsupported Nostr event kind")
		}
	case "close":
		auction, ok := state.Auctions[tx.AuctionID]
		if !ok || auction.FundingMode != FundingModeThresholdSigAll {
			return errors.New("FROST/Cashu close requires a threshold-funded auction")
		}
	case "funding_abort":
		// applyFundingAbort verifies the complete pinned certificate and proof
		// ownership after this authority-mode gate.
	default:
		return errors.New("FROST/Cashu application transaction type is unsupported")
	}
	return nil
}

func ValidateForMempool(prior State, tx Transaction, policy Policy, mintSeed []byte) error {
	if tx.Type == "close" {
		auction, ok := prior.Auctions[tx.AuctionID]
		if !ok || auction.Status != "open" {
			return errors.New("auction is not open")
		}
		if prior.ApplicationAuthority == ApplicationAuthorityFrostCashu && auction.FundingMode != FundingModeThresholdSigAll {
			return errors.New("FROST/Cashu close requires a threshold-funded auction")
		}
		// Close is a permissionless deterministic-finalization trigger: it has
		// no actor and cannot select or alter the winner, amount, or destination.
		// CheckTx has no proposed block time, so it admits the trigger only once
		// the last committed consensus clock reaches the certified end. Proposal
		// and finalization repeat the same rule with their authoritative time.
		if prior.LastConsensusTime < auction.EndTime {
			return errors.New("auction has not ended")
		}
		return nil
	}
	// CheckTx has no proposed block timestamp. Use only the last committed
	// consensus time for advisory admission; a client-controlled Nostr timestamp
	// must never decide whether a deadline has passed. PrepareProposal,
	// ProcessProposal, and FinalizeBlock repeat the complete transition with the
	// proposed/committed block time and remain authoritative.
	_, err := ApplyTransaction(prior, tx, prior.LastConsensusTime, policy, mintSeed)
	return err
}

func applyFaucet(state *State, actor string, policy Policy, privateKey ed25519.PrivateKey) error {
	operation := "faucet:" + actor
	if state.Operations[operation] || state.Issued[actor] {
		return errors.New("faucet already used for this Nostr identity")
	}
	note, err := issueNote(*state, privateKey, operation, "faucet", actor, policy.FaucetAmount)
	if err != nil {
		return err
	}
	state.Issued[actor] = true
	state.Operations[operation] = true
	state.Notes[note.ID] = note
	return nil
}

func applySignedEvent(state *State, event SignedEvent, now int64, policy Policy, privateKey ed25519.PrivateKey) error {
	actor, err := VerifyNostrEvent(event)
	if err != nil {
		return err
	}
	if state.Operations[event.ID] {
		return errors.New("signed event was already committed")
	}
	if delta := now - event.CreatedAt; delta > policy.EventSkewSeconds || delta < -policy.EventSkewSeconds {
		return errors.New("signed event is outside the consensus-time window")
	}
	switch event.Kind {
	case KindCreate:
		var content createContent
		if err := decodeStrictContent(event.Content, &content); err != nil {
			return err
		}
		if !validIdentifier(content.AuctionID) || strings.TrimSpace(content.Title) == "" || len(content.Title) > 120 ||
			len(content.Description) > 2_000 || !validImageURL(content.ImageURL) {
			return errors.New("invalid auction identity or title")
		}
		if content.Duration < policy.MinDurationSeconds || content.Duration > policy.MaxDurationSeconds {
			return errors.New("auction duration is outside POC policy")
		}
		if content.StartingBid <= 0 || content.Reserve < 0 || content.MinIncrement < 0 {
			return errors.New("auction amount policy is invalid")
		}
		if _, exists := state.Auctions[content.AuctionID]; exists {
			return errors.New("auction already exists")
		}
		fundingMode := content.FundingMode
		if fundingMode == "" {
			fundingMode = FundingModeCustodialReservation
		}
		if fundingMode != FundingModeCustodialReservation && fundingMode != FundingModeThresholdSigAll {
			return errors.New("auction funding mode is unsupported")
		}
		if fundingMode == FundingModeThresholdSigAll && content.SellerCocoPaymentPublicKey == "" {
			return errors.New("threshold auction requires the seller Coco payment key")
		}
		if content.SellerCocoPaymentPublicKey != "" &&
			(fundingMode != FundingModeThresholdSigAll || !validCompressedPublicKey(content.SellerCocoPaymentPublicKey) || content.SellerCocoPaymentPublicKey[2:] == actor) {
			return errors.New("direct Coco seller payment key is invalid or used outside a threshold auction")
		}
		increment := content.MinIncrement
		if increment == 0 {
			increment = policy.MinBidIncrement
		}
		end := now + content.Duration
		state.Auctions[content.AuctionID] = Auction{
			ID: content.AuctionID, Seller: actor, Title: strings.TrimSpace(content.Title),
			Description: strings.TrimSpace(content.Description), ImageURL: strings.TrimSpace(content.ImageURL),
			FundingMode: fundingMode, SellerCocoPaymentPublicKey: content.SellerCocoPaymentPublicKey,
			StartingBid: content.StartingBid, MinIncrement: increment, Reserve: content.Reserve,
			CreatedAt: now, OriginalEndTime: end, EndTime: end, Status: "open",
		}
	case KindBid:
		var content bidContent
		if err := decodeStrictContent(event.Content, &content); err != nil {
			return err
		}
		if err := applyBid(state, actor, event.ID, now, content, policy, privateKey); err != nil {
			return err
		}
	case KindRefund:
		var content refundContent
		if err := decodeStrictContent(event.Content, &content); err != nil {
			return err
		}
		if err := applyRefund(state, actor, event.ID, content.BidID, privateKey); err != nil {
			return err
		}
	default:
		return errors.New("unsupported Nostr event kind")
	}
	state.Operations[event.ID] = true
	return nil
}

func applyBid(state *State, actor, eventID string, committedAt int64, content bidContent, policy Policy, privateKey ed25519.PrivateKey) error {
	auction, ok := state.Auctions[content.AuctionID]
	if !ok {
		return errors.New("auction is not open")
	}
	minimum := auction.StartingBid
	if auction.LeaderBidID != "" {
		minimum = auction.HighBid + auction.MinIncrement
	}
	rejectionReason := ""
	var rejectionError error
	switch {
	case auction.Status != "open":
		rejectionReason, rejectionError = "auction_not_open", errors.New("auction is not open")
	case actor == auction.Seller:
		rejectionReason, rejectionError = "seller_self_bid", errors.New("seller cannot bid on own auction")
	case committedAt >= auction.EndTime:
		rejectionReason, rejectionError = "late", errors.New("bid is late")
	case content.Amount < minimum:
		rejectionReason, rejectionError = "below_minimum", errors.New("bid does not satisfy the starting price and minimum increment")
	case content.IntegratedFunding != nil && content.ReplacesBidID != auction.LeaderBidID:
		rejectionReason, rejectionError = "stale_leader", errors.New("integrated bid replacement does not match the committed leader")
	}
	// Only the V4 browser route has a pre-authorized, exact full-pool return
	// package.  Its valid funding receipt may have been prepared against an
	// earlier leader or pre-deadline state.  Committing the definitive business
	// rejection gives participant-local terminal signers authenticated evidence
	// for that return.  Legacy/V3 or structurally invalid bids remain ordinary
	// transaction errors.
	canCommitRejectedReturn := rejectionError != nil && content.IntegratedFunding != nil &&
		content.IntegratedFunding.Schema == "PlebeianAuctionsPOCIntegratedFundingV4"
	if rejectionError != nil && !canCommitRejectedReturn {
		return rejectionError
	}
	paths := 0
	if content.CashuLock != nil {
		paths++
	}
	if content.Reservation != nil {
		paths++
	}
	if content.IntegratedFunding != nil {
		paths++
	}
	if len(content.Inputs) != 0 {
		paths++
	}
	if paths != 1 {
		return errors.New("bid must use exactly one funding path")
	}
	if auction.FundingMode == FundingModeCustodialReservation && content.Reservation == nil {
		return errors.New("Friday auction requires a custodial reservation")
	}
	if auction.FundingMode == FundingModeThresholdSigAll && content.IntegratedFunding == nil {
		return errors.New("integrated auction requires threshold SIG_ALL funding")
	}
	if auction.FundingMode == FundingModeLegacy && (content.Reservation != nil || content.IntegratedFunding != nil) {
		return errors.New("legacy auction cannot mix in Friday reservations")
	}
	if auction.FundingMode == FundingModeCustodialReservation && content.IntegratedFunding != nil {
		return errors.New("custodial auction cannot mix in threshold funding")
	}
	if auction.FundingMode == FundingModeThresholdSigAll && content.Reservation != nil {
		return errors.New("threshold auction cannot mix in custodial reservations")
	}
	if content.IntegratedFunding != nil {
		if err := verifyIntegratedFundingReceipt(*state, actor, committedAt, content, *content.IntegratedFunding, policy); err != nil {
			// Expiry is a deterministic auction-business outcome for a fully
			// authenticated V4 package.  It can race between browser preparation,
			// CheckTx and DeliverTx after Coco has reserved the proof pool.  Commit
			// the exact return entitlement instead of leaving the wallet operation
			// indefinitely ambiguous.  Every structural and cryptographic error
			// remains a hard transaction failure.
			if errors.Is(err, errIntegratedFundingReceiptExpired) &&
				content.IntegratedFunding.Schema == "PlebeianAuctionsPOCIntegratedFundingV4" {
				// Receipt expiry is checked only after every structural, cryptographic,
				// mint and proof binding.  Once authenticated, it has deterministic
				// precedence over simultaneous auction-business rejection so every
				// verifier observes one canonical terminal cause.
				return applyRejectedIntegratedFunding(state, actor, eventID, committedAt, content, "funding_expired")
			}
			return err
		}
		if canCommitRejectedReturn {
			return applyRejectedIntegratedFunding(state, actor, eventID, committedAt, content, rejectionReason)
		}
		return applyAcceptedBid(state, actor, eventID, committedAt, content, nil, policy)
	}
	if content.Reservation != nil {
		if err := verifyCustodyReservationReceipt(*state, actor, committedAt, content, *content.Reservation, policy); err != nil {
			return err
		}
		return applyAcceptedBid(state, actor, eventID, committedAt, content, nil, policy)
	}
	if content.CashuLock != nil {
		if err := verifyCashuLockReceipt(*state, actor, content, *content.CashuLock); err != nil {
			return err
		}
		return applyAcceptedBid(state, actor, eventID, committedAt, content, nil, policy)
	}
	if len(content.Inputs) == 0 || len(content.Inputs) > MaxInputs {
		return errors.New("bid must carry a verified Cashu lock or spend a bounded nonempty interim note set")
	}
	seen := map[string]bool{}
	var total int64
	for _, input := range content.Inputs {
		if seen[input] {
			return errors.New("duplicate input note")
		}
		seen[input] = true
		note, exists := state.Notes[input]
		if !exists || note.Owner != actor || note.SpentBy != "" {
			return errors.New("bid input is missing, spent, or not owned by signer")
		}
		if err := verifyNote(*state, note); err != nil {
			return err
		}
		if note.Amount > (1<<62)-total {
			return errors.New("input amount overflow")
		}
		total += note.Amount
	}
	if total < content.Amount {
		return errors.New("unfunded bid")
	}
	for _, input := range content.Inputs {
		note := state.Notes[input]
		note.SpentBy = eventID
		state.Notes[input] = note
	}
	if change := total - content.Amount; change > 0 {
		note, err := issueNote(*state, privateKey, eventID, "change", actor, change)
		if err != nil {
			return err
		}
		state.Notes[note.ID] = note
	}
	return applyAcceptedBid(state, actor, eventID, committedAt, content, content.Inputs, policy)
}

func applyRejectedIntegratedFunding(state *State, actor, eventID string, committedAt int64, content bidContent, reason string) error {
	receipt := *content.IntegratedFunding
	if receipt.Schema != "PlebeianAuctionsPOCIntegratedFundingV4" ||
		(reason != "auction_not_open" && reason != "seller_self_bid" && reason != "late" &&
			reason != "below_minimum" && reason != "stale_leader" && reason != "funding_expired") {
		return errors.New("integrated rejected-return authority is invalid")
	}
	// Rejected V4 bids cannot replace or alias an earlier funding operation.
	// Their complete proof pool becomes owned by this one committed return
	// entitlement until terminal import completes.
	for _, proofStateRef := range receipt.ProofStateRefs {
		if state.IntegratedProofUses[proofStateRef[2:]] != "" {
			return errors.New("rejected integrated funding proof was already allocated")
		}
	}
	if err := claimCommittedV4Funding(state, receipt, actor, eventID, committedAt, "rejected_return_entitled", reason); err != nil {
		return err
	}
	state.IntegratedFundings[receipt.FundingOperationID] = IntegratedFunding{
		ID: receipt.FundingOperationID, AuctionID: content.AuctionID, BidID: eventID, Bidder: actor,
		Status: "rejected_return_entitled", RejectionReason: reason, CommittedAt: committedAt, Receipt: receipt,
	}
	for _, proofStateRef := range receipt.ProofStateRefs {
		state.IntegratedProofUses[proofStateRef[2:]] = receipt.FundingOperationID
	}
	return nil
}

func applyAcceptedBid(state *State, actor, eventID string, committedAt int64, content bidContent, inputs []string, policy Policy) error {
	auction := state.Auctions[content.AuctionID]
	previousBidID := auction.LeaderBidID
	if auction.LeaderBidID != "" {
		previous := state.Locks[auction.LeaderBidID]
		if previous.Status != "locked" {
			return errors.New("previous leader lock is not spendable")
		}
		previous.Status = "refundable"
		state.Locks[auction.LeaderBidID] = previous
		previousBid := state.Bids[auction.LeaderBidID]
		if previousBid.IntegratedFundingID != "" {
			funding := state.IntegratedFundings[previousBid.IntegratedFundingID]
			if previousBid.Bidder == actor {
				funding.Status = "superseded"
			} else {
				funding.Status = "outbid_return_entitled"
			}
			state.IntegratedFundings[funding.ID] = funding
		}
		if previousBid.ReservationID != "" {
			reservation := state.CustodyReservations[previousBid.ReservationID]
			reservation.Status = "release_entitled"
			state.CustodyReservations[reservation.ID] = reservation
		}
	}
	bid := Bid{ID: eventID, AuctionID: auction.ID, Bidder: actor, Amount: content.Amount, InputNoteIDs: append([]string(nil), inputs...), ReplacesBidID: previousBidID, CommittedAt: committedAt}
	if content.CashuLock != nil {
		bid.CashuTokenSHA256 = content.CashuLock.TokenSHA256
		bid.CashuLockOperation = content.CashuLock.OperationID
		state.CashuLocks[content.CashuLock.TokenSHA256] = *content.CashuLock
	}
	if content.Reservation != nil {
		bid.ReservationID = content.Reservation.ReservationID
		state.CustodyReservations[bid.ReservationID] = CustodyReservation{
			ID: bid.ReservationID, AuctionID: auction.ID, BidID: eventID, Bidder: actor,
			Amount: content.Amount, ReplacesReservationID: content.Reservation.ReplacesReservationID,
			Status: "reserved", CommittedAt: committedAt,
		}
	}
	if content.IntegratedFunding != nil {
		receipt := *content.IntegratedFunding
		if err := claimCommittedV4Funding(state, receipt, actor, eventID, committedAt, "active", ""); err != nil {
			return err
		}
		bid.IntegratedFundingID = receipt.FundingOperationID
		state.IntegratedFundings[receipt.FundingOperationID] = IntegratedFunding{
			ID: receipt.FundingOperationID, AuctionID: auction.ID, BidID: eventID, Bidder: actor,
			Status: "active", CommittedAt: committedAt, Receipt: receipt,
		}
		for _, proofStateRef := range receipt.ProofStateRefs {
			state.IntegratedProofUses[proofStateRef[2:]] = receipt.FundingOperationID
		}
		if previousBidID != "" {
			previousBid := state.Bids[previousBidID]
			state.IntegratedDisplacements[eventID] = IntegratedDisplacement{
				ID: eventID, AuctionID: auction.ID, DisplacedBidID: previousBidID, ReplacementBidID: eventID,
				DisplacedFundingID: previousBid.IntegratedFundingID, ReplacementFundingID: receipt.FundingOperationID,
				CommittedAt: committedAt, OriginalEndTime: auction.OriginalEndTime, CertifiedEndTime: auction.EndTime,
			}
		}
	}
	state.Bids[eventID] = bid
	state.Locks[eventID] = Lock{ID: eventID, AuctionID: auction.ID, BidID: eventID, Bidder: actor, Amount: content.Amount, Status: "locked"}
	auction.LeaderBidID = eventID
	auction.HighBid = content.Amount
	if committedAt >= auction.EndTime-policy.LateBidWindow {
		candidate := committedAt + policy.LateBidExtension
		capEnd := auction.OriginalEndTime + policy.MaxTotalExtension
		if candidate > capEnd {
			candidate = capEnd
		}
		if candidate > auction.EndTime {
			auction.EndTime = candidate
			auction.ExtensionCount++
		}
	}
	if displacement, exists := state.IntegratedDisplacements[eventID]; exists {
		displacement.CertifiedEndTime = auction.EndTime
		state.IntegratedDisplacements[eventID] = displacement
	}
	state.Auctions[auction.ID] = auction
	return nil
}

func verifyCustodyReservationReceipt(state State, actor string, committedAt int64, content bidContent, receipt CustodyReservationReceipt, policy Policy) error {
	if receipt.Schema != "PlebeianAuctionsPOCCustodyReservationV1" || receipt.MintURL != state.CashuMintURL {
		return errors.New("custody reservation receipt schema or mint is not trusted")
	}
	if receipt.AuctionID != content.AuctionID || receipt.Bidder != actor || receipt.Amount != content.Amount || receipt.Amount <= 0 {
		return errors.New("custody reservation receipt does not bind this bid")
	}
	if receipt.CommitteePublicKey != state.CommitteePublicKey || !validOperationID(receipt.ReservationID) {
		return errors.New("custody reservation receipt identity is invalid")
	}
	if committedAt > (1<<63-1)-policy.ReceiptTTLSeconds || receipt.ExpiresAt < committedAt || receipt.ExpiresAt > committedAt+policy.ReceiptTTLSeconds {
		return errors.New("custody reservation receipt is expired or unbounded")
	}
	if _, exists := state.CustodyReservations[receipt.ReservationID]; exists {
		return errors.New("custody reservation was already committed")
	}
	auction := state.Auctions[content.AuctionID]
	wantReplacement := ""
	if auction.LeaderBidID != "" {
		prior := state.Bids[auction.LeaderBidID]
		if prior.Bidder == actor && prior.ReservationID != "" {
			wantReplacement = prior.ReservationID
		}
	}
	if receipt.ReplacesReservationID != wantReplacement {
		return errors.New("custody reservation replacement does not match the committed leader")
	}
	if !validLowerHex(receipt.Signature, schnorr.SignatureSize) {
		return errors.New("custody reservation signature shape is invalid")
	}
	publicBytes, _ := hex.DecodeString(receipt.CommitteePublicKey)
	publicKey, err := btcec.ParsePubKey(publicBytes)
	if err != nil {
		return errors.New("custody reservation committee key is invalid")
	}
	signatureBytes, _ := hex.DecodeString(receipt.Signature)
	signature, err := schnorr.ParseSignature(signatureBytes)
	digest := custodyReservationDigest(receipt)
	if err != nil || !signature.Verify(digest[:], publicKey) {
		return errors.New("custody reservation signature is invalid")
	}
	return nil
}

func custodyReservationDigest(receipt CustodyReservationReceipt) [32]byte {
	material, _ := json.Marshal([]any{
		receipt.Schema, receipt.MintURL, receipt.AuctionID, receipt.Bidder, receipt.Amount,
		receipt.ReservationID, receipt.ReplacesReservationID, receipt.ExpiresAt, receipt.CommitteePublicKey,
	})
	return sha256.Sum256(material)
}

func verifyIntegratedFundingReceipt(state State, actor string, committedAt int64, content bidContent, receipt IntegratedFundingReceipt, policy Policy) error {
	if (receipt.Schema != "PlebeianAuctionsPOCIntegratedFundingV3" && receipt.Schema != "PlebeianAuctionsPOCIntegratedFundingV4") || receipt.MintURL != state.CashuMintURL {
		return errors.New("integrated funding schema or mint is not trusted")
	}
	// A network with FundingAbortV1 enabled must never admit the legacy V3
	// receipt. V3 writes only IntegratedProofUses, while FundingAbort owns the
	// unified lifecycle/proof tombstones required to make abort-first and
	// bid-first mutually exclusive across restart and parity aliases. Rejecting
	// V3 before any receipt or proof processing prevents an old, otherwise valid
	// receipt from bypassing that consensus invariant.
	if state.FundingAbortPins != nil && receipt.Schema != "PlebeianAuctionsPOCIntegratedFundingV4" {
		return errors.New("legacy integrated funding is disabled when funding-abort lifecycle pins are active")
	}
	if receipt.AuthNetworkID != state.AuthNetworkID || receipt.ChainID != state.ChainID {
		return errors.New("integrated funding belongs to another authenticated network or chain")
	}
	if err := verifyIntegratedFundingAbortPins(state, receipt); err != nil {
		return err
	}
	if receipt.AuctionID != content.AuctionID || receipt.Bidder != actor || receipt.BidAmount != content.Amount || receipt.BidAmount <= 0 || receipt.PoolAmount != receipt.BidAmount || receipt.ReplacesBidID != content.ReplacesBidID {
		return errors.New("integrated funding does not bind this bid and its full pool")
	}
	if receipt.AttestedAt <= 0 || receipt.ExpiresAt < receipt.AttestedAt || receipt.ExpiresAt-receipt.AttestedAt > policy.ReceiptTTLSeconds ||
		(receipt.AttestedAt > committedAt && receipt.AttestedAt-committedAt > policy.EventSkewSeconds) {
		return errors.New("integrated funding attestation interval is invalid or unbounded")
	}
	if !validOperationID(receipt.FundingOperationID) || !validOperationID(receipt.ActiveKeysetID) || receipt.InputFeePPK != 0 {
		return errors.New("integrated funding identity, keyset, or zero-fee policy is invalid")
	}
	if receipt.CommitteePublicKey != state.CommitteePublicKey || !strings.HasPrefix(receipt.CommitteePublicKey, "02") ||
		!validCompressedPublicKey(receipt.BidderPublicKey) || !validCompressedPublicKey(receipt.RefundPublicKey) ||
		receipt.BidderPublicKey[2:] == receipt.RefundPublicKey[2:] || receipt.BidderPublicKey[2:] == receipt.CommitteePublicKey[2:] || receipt.RefundPublicKey[2:] == receipt.CommitteePublicKey[2:] ||
		receipt.BidderPublicKey[2:] == actor || receipt.RefundPublicKey[2:] == actor || receipt.CommitteePublicKey[2:] == actor {
		return errors.New("integrated funding signer keys are invalid or not distinct")
	}
	if !validOperationID(receipt.CommitteeKeysetID) || !validOperationID(receipt.CommitteeKeysetVersion) || !validOperationID(receipt.DKGRunID) {
		return errors.New("integrated funding committee keyset identity is invalid")
	}
	digests := []string{receipt.PublicKeyPackageSHA256, receipt.SignerRosterDigest, receipt.WinnerPackageDigest, receipt.ReturnPackageDigest, receipt.ReturnCashuSigAllDigest, receipt.BundleDigest, receipt.ParticipantPolicyDigest}
	if receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV4" {
		digests = append(digests, receipt.PreparedBundleDigest)
	}
	for _, digest := range digests {
		if !validLowerHex(digest, sha256.Size) {
			return errors.New("integrated funding package digest is invalid")
		}
	}
	if (receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV3" && !validLowerHex(receipt.ActorFundingSignature, schnorr.SignatureSize)) ||
		(receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV4" && receipt.ActorFundingSignature != "") ||
		!validLowerHex(receipt.BidderReturnSignature, schnorr.SignatureSize) || !validLowerHex(receipt.CommitteeSignature, schnorr.SignatureSize) {
		return errors.New("integrated funding signature shape is invalid")
	}
	if receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV3" &&
		(receipt.PreparedBundleDigest != "" || receipt.ActorFundingAuthorization != nil) {
		return errors.New("integrated funding V3 receipt contains V4 authorization fields")
	}
	auction := state.Auctions[content.AuctionID]
	if receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV4" &&
		(!validCompressedPublicKey(auction.SellerCocoPaymentPublicKey) || auction.SellerCocoPaymentPublicKey[2:] == auction.Seller) {
		return errors.New("integrated V4 funding auction lacks a distinct direct Coco seller payment key")
	}
	if auction.OriginalEndTime > (1<<63-1)-policy.MaxTotalExtension-EmergencyRecoverySeconds || receipt.Locktime != auction.OriginalEndTime+policy.MaxTotalExtension+EmergencyRecoverySeconds {
		return errors.New("integrated funding locktime does not use the selected maximum-end recovery policy")
	}
	if len(receipt.ProofStateRefs) == 0 || len(receipt.ProofStateRefs) > MaxInputs {
		return errors.New("integrated funding proof pool is empty or unbounded")
	}
	seenX := map[string]bool{}
	previousFundingID := ""
	previousRefs := map[string]bool{}
	if auction.LeaderBidID != "" {
		previousBid := state.Bids[auction.LeaderBidID]
		if previousBid.Bidder == actor && previousBid.IntegratedFundingID != "" {
			previousFundingID = previousBid.IntegratedFundingID
			for _, proofStateRef := range state.IntegratedFundings[previousFundingID].Receipt.ProofStateRefs {
				previousRefs[proofStateRef] = true
			}
		}
	}
	for index, proofStateRef := range receipt.ProofStateRefs {
		if !validCompressedPublicKey(proofStateRef) || seenX[proofStateRef[2:]] || (index > 0 && receipt.ProofStateRefs[index-1] >= proofStateRef) {
			return errors.New("integrated funding proof references are invalid, duplicated, or noncanonical")
		}
		seenX[proofStateRef[2:]] = true
		if existing := state.IntegratedProofUses[proofStateRef[2:]]; existing != "" && existing != previousFundingID {
			return errors.New("integrated funding proof was already allocated to another bid or operation")
		}
	}
	for proofStateRef := range previousRefs {
		if !slicesContains(receipt.ProofStateRefs, proofStateRef) {
			return errors.New("integrated own raise cannot silently drop the previously active proof pool")
		}
	}
	if _, exists := state.IntegratedFundings[receipt.FundingOperationID]; exists {
		return errors.New("integrated funding operation was already committed")
	}
	expectedBundle := integratedFundingBundleDigest(receipt)
	if receipt.BundleDigest != hex.EncodeToString(expectedBundle[:]) {
		return errors.New("integrated funding bundle digest is not canonical")
	}
	if receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV3" {
		actorPublicBytes, _ := hex.DecodeString(actor)
		actorPublic, err := schnorr.ParsePubKey(actorPublicBytes)
		actorSignatureBytes, _ := hex.DecodeString(receipt.ActorFundingSignature)
		actorSignature, signatureErr := schnorr.ParseSignature(actorSignatureBytes)
		if err != nil || signatureErr != nil || !actorSignature.Verify(expectedBundle[:], actorPublic) {
			return errors.New("auction actor did not approve the exact integrated funding bundle")
		}
	} else if err := verifyIntegratedFundingV4Authorization(receipt, actor); err != nil {
		return err
	}
	bidderPublicBytes, _ := hex.DecodeString(receipt.BidderPublicKey)
	bidderPublic, err := btcec.ParsePubKey(bidderPublicBytes)
	if err != nil {
		return errors.New("integrated bidder public key is invalid")
	}
	bidderSignatureBytes, _ := hex.DecodeString(receipt.BidderReturnSignature)
	bidderSignature, err := schnorr.ParseSignature(bidderSignatureBytes)
	returnDigest, _ := hex.DecodeString(receipt.ReturnCashuSigAllDigest)
	if err != nil || !bidderSignature.Verify(returnDigest, bidderPublic) {
		return errors.New("integrated bidder did not pre-sign the exact full-pool return package")
	}
	committeePublicBytes, _ := hex.DecodeString(receipt.CommitteePublicKey)
	committeePublic, err := btcec.ParsePubKey(committeePublicBytes)
	if err != nil {
		return errors.New("integrated committee public key is invalid")
	}
	committeeSignatureBytes, _ := hex.DecodeString(receipt.CommitteeSignature)
	committeeSignature, err := schnorr.ParseSignature(committeeSignatureBytes)
	digest := integratedFundingAdmissionSignatureDigest(receipt)
	if err != nil || !committeeSignature.Verify(digest[:], committeePublic) {
		return errors.New("integrated funding threshold attestation is invalid")
	}
	// Check committed-time expiry only after every exact package, signer,
	// proof-reference and threshold binding above has authenticated.  This
	// prevents malformed client claims from obtaining a return entitlement.
	if receipt.ExpiresAt < committedAt {
		return errIntegratedFundingReceiptExpired
	}
	return nil
}

func slicesContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func integratedFundingBundleDigest(receipt IntegratedFundingReceipt) [32]byte {
	if receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV4" {
		material, _ := json.Marshal([]any{
			"PlebeianAuctionsPOCIntegratedFundingBundleV4", receipt.AuthNetworkID, receipt.ChainID,
			receipt.MintURL, receipt.AuctionID, receipt.Bidder,
			receipt.BidAmount, receipt.PoolAmount, receipt.ReplacesBidID, receipt.FundingOperationID, receipt.AttestedAt, receipt.ExpiresAt, receipt.ProofStateRefs,
			receipt.ActiveKeysetID, receipt.InputFeePPK, receipt.Locktime, receipt.BidderPublicKey,
			receipt.RefundPublicKey, receipt.CommitteePublicKey, receipt.CommitteeKeysetID,
			receipt.CommitteeKeysetVersion, receipt.DKGRunID, receipt.PublicKeyPackageSHA256, receipt.SignerRosterDigest,
			receipt.WinnerPackageDigest, receipt.ReturnPackageDigest, receipt.ReturnCashuSigAllDigest,
			receipt.PreparedBundleDigest,
		})
		return sha256.Sum256(material)
	}
	material, _ := json.Marshal([]any{
		"PlebeianAuctionsPOCIntegratedFundingBundleV3", receipt.AuthNetworkID, receipt.ChainID,
		receipt.MintURL, receipt.AuctionID, receipt.Bidder,
		receipt.BidAmount, receipt.PoolAmount, receipt.ReplacesBidID, receipt.FundingOperationID, receipt.AttestedAt, receipt.ExpiresAt, receipt.ProofStateRefs,
		receipt.ActiveKeysetID, receipt.InputFeePPK, receipt.Locktime, receipt.BidderPublicKey,
		receipt.RefundPublicKey, receipt.CommitteePublicKey, receipt.CommitteeKeysetID,
		receipt.CommitteeKeysetVersion, receipt.DKGRunID, receipt.PublicKeyPackageSHA256, receipt.SignerRosterDigest,
		receipt.WinnerPackageDigest, receipt.ReturnPackageDigest,
		receipt.ReturnCashuSigAllDigest,
	})
	return sha256.Sum256(material)
}

func integratedFundingReceiptDigest(receipt IntegratedFundingReceipt) [32]byte {
	if receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV4" {
		authorizationID := ""
		if receipt.ActorFundingAuthorization != nil {
			authorizationID = receipt.ActorFundingAuthorization.ID
		}
		material, _ := json.Marshal([]any{
			receipt.Schema, receipt.AuthNetworkID, receipt.ChainID, receipt.MintURL, receipt.AuctionID, receipt.Bidder, receipt.BidAmount,
			receipt.PoolAmount, receipt.ReplacesBidID, receipt.FundingOperationID, receipt.AttestedAt, receipt.ExpiresAt, receipt.ProofStateRefs, receipt.ActiveKeysetID,
			receipt.InputFeePPK, receipt.Locktime, receipt.BidderPublicKey, receipt.RefundPublicKey,
			receipt.CommitteePublicKey, receipt.CommitteeKeysetID, receipt.CommitteeKeysetVersion,
			receipt.DKGRunID, receipt.PublicKeyPackageSHA256, receipt.SignerRosterDigest,
			receipt.WinnerPackageDigest, receipt.ReturnPackageDigest, receipt.ReturnCashuSigAllDigest,
			receipt.PreparedBundleDigest, receipt.BundleDigest, authorizationID, receipt.BidderReturnSignature,
		})
		return sha256.Sum256(material)
	}
	material, _ := json.Marshal([]any{
		receipt.Schema, receipt.AuthNetworkID, receipt.ChainID, receipt.MintURL, receipt.AuctionID, receipt.Bidder, receipt.BidAmount,
		receipt.PoolAmount, receipt.ReplacesBidID, receipt.FundingOperationID, receipt.AttestedAt, receipt.ExpiresAt, receipt.ProofStateRefs, receipt.ActiveKeysetID,
		receipt.InputFeePPK, receipt.Locktime, receipt.BidderPublicKey, receipt.RefundPublicKey,
		receipt.CommitteePublicKey, receipt.CommitteeKeysetID, receipt.CommitteeKeysetVersion,
		receipt.DKGRunID, receipt.PublicKeyPackageSHA256, receipt.SignerRosterDigest,
		receipt.WinnerPackageDigest, receipt.ReturnPackageDigest, receipt.ReturnCashuSigAllDigest,
		receipt.BundleDigest,
		receipt.ActorFundingSignature,
		receipt.BidderReturnSignature,
	})
	return sha256.Sum256(material)
}

type fridayFundingAuthorizationContentV1 struct {
	Schema                           string `json:"schema"`
	AuthNetworkID                    string `json:"authNetworkId"`
	ChainID                          string `json:"chainId"`
	AuctionID                        string `json:"auctionId"`
	Amount                           int64  `json:"amount"`
	MintURL                          string `json:"mintUrl"`
	PaymentPublicKey                 string `json:"paymentPublicKey"`
	RefundPublicKey                  string `json:"refundPublicKey"`
	FundingOperationID               string `json:"fundingOperationId"`
	BundleDigest                     string `json:"bundleDigest"`
	ReturnPackageDigest              string `json:"returnPackageDigest"`
	ReturnCashuSigAllDigest          string `json:"returnCashuSigAllDigest"`
	BidderReturnSignature            string `json:"bidderReturnSignature"`
	ExpiresAt                        int64  `json:"expiresAt"`
	PaymentKeyAuthorizationSignature string `json:"paymentKeyAuthorizationSignature"`
	RefundKeyAuthorizationSignature  string `json:"refundKeyAuthorizationSignature"`
}

func verifyIntegratedFundingV4Authorization(receipt IntegratedFundingReceipt, actor string) error {
	event := receipt.ActorFundingAuthorization
	if event == nil || event.Kind != 28647 || event.PubKey != actor || event.CreatedAt != receipt.AttestedAt {
		return errors.New("V4 funding authorization event identity differs")
	}
	verifiedActor, err := VerifyNostrEvent(*event)
	if err != nil || verifiedActor != actor {
		return errors.New("V4 funding authorization Nostr signature is invalid")
	}
	decoder := json.NewDecoder(strings.NewReader(event.Content))
	decoder.DisallowUnknownFields()
	var authorization fridayFundingAuthorizationContentV1
	if err := decoder.Decode(&authorization); err != nil {
		return errors.New("V4 funding authorization content is noncanonical")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("V4 funding authorization content is noncanonical")
	}
	canonical, err := json.Marshal(authorization)
	if err != nil || string(canonical) != event.Content {
		return errors.New("V4 funding authorization content is noncanonical")
	}
	expectedTags := [][]string{
		{"t", "plebeian-friday-funding-v1"}, {"a", receipt.AuctionID},
		{"operation", receipt.FundingOperationID}, {"payment", receipt.BidderPublicKey},
	}
	actualTags, _ := json.Marshal(event.Tags)
	wantedTags, _ := json.Marshal(expectedTags)
	if !bytes.Equal(actualTags, wantedTags) {
		return errors.New("V4 funding authorization tags differ")
	}
	if authorization.Schema != "PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1" ||
		authorization.AuthNetworkID != receipt.AuthNetworkID || authorization.ChainID != receipt.ChainID ||
		authorization.AuctionID != receipt.AuctionID || authorization.Amount != receipt.PoolAmount ||
		authorization.MintURL != receipt.MintURL || authorization.PaymentPublicKey != receipt.BidderPublicKey ||
		authorization.RefundPublicKey != receipt.RefundPublicKey || authorization.FundingOperationID != receipt.FundingOperationID ||
		authorization.BundleDigest != receipt.PreparedBundleDigest || authorization.ReturnPackageDigest != receipt.ReturnPackageDigest ||
		authorization.ReturnCashuSigAllDigest != receipt.ReturnCashuSigAllDigest || authorization.BidderReturnSignature != receipt.BidderReturnSignature ||
		authorization.ExpiresAt != receipt.ExpiresAt {
		return errors.New("V4 funding authorization content differs from receipt")
	}
	type keyTerms struct {
		Schema                  string `json:"schema"`
		Actor                   string `json:"actor"`
		AuthNetworkID           string `json:"authNetworkId"`
		ChainID                 string `json:"chainId"`
		AuctionID               string `json:"auctionId"`
		Amount                  int64  `json:"amount"`
		MintURL                 string `json:"mintUrl"`
		PaymentPublicKey        string `json:"paymentPublicKey"`
		RefundPublicKey         string `json:"refundPublicKey"`
		FundingOperationID      string `json:"fundingOperationId"`
		BundleDigest            string `json:"bundleDigest"`
		ReturnPackageDigest     string `json:"returnPackageDigest"`
		ReturnCashuSigAllDigest string `json:"returnCashuSigAllDigest"`
		BidderReturnSignature   string `json:"bidderReturnSignature"`
		ExpiresAt               int64  `json:"expiresAt"`
	}
	terms, _ := json.Marshal(keyTerms{
		authorization.Schema, actor, authorization.AuthNetworkID, authorization.ChainID,
		authorization.AuctionID, authorization.Amount, authorization.MintURL,
		authorization.PaymentPublicKey, authorization.RefundPublicKey, authorization.FundingOperationID,
		authorization.BundleDigest, authorization.ReturnPackageDigest, authorization.ReturnCashuSigAllDigest,
		authorization.BidderReturnSignature, authorization.ExpiresAt,
	})
	domain := []byte("PLEBEIAN_FRIDAY_PAYMENT_KEY_AUTHORIZATION_V1")
	keyDigest := sha256.Sum256(append(domain, terms...))
	verifyKey := func(signatureHex, compressed string) bool {
		if !validLowerHex(signatureHex, schnorr.SignatureSize) || !validCompressedPublicKey(compressed) {
			return false
		}
		signatureBytes, _ := hex.DecodeString(signatureHex)
		signature, err := schnorr.ParseSignature(signatureBytes)
		publicBytes, _ := hex.DecodeString(compressed[2:])
		public, keyErr := schnorr.ParsePubKey(publicBytes)
		return err == nil && keyErr == nil && signature.Verify(keyDigest[:], public)
	}
	if !verifyKey(authorization.PaymentKeyAuthorizationSignature, receipt.BidderPublicKey) ||
		!verifyKey(authorization.RefundKeyAuthorizationSignature, receipt.RefundPublicKey) {
		return errors.New("V4 payment/refund key proof-of-possession is invalid")
	}
	return nil
}

// The admission threshold signature has its own protocol domain.  In
// particular it is not a signature over the raw receipt digest and cannot be
// replayed as a Cashu disposition authorization.  Keep this framing byte-for-
// byte aligned with demoIntegratedFundingAdmissionSignatureDigest in the TS
// coordinator and ADMISSION_SIGNATURE_DOMAIN in the Rust signer.
func integratedFundingAdmissionSignatureDigest(receipt IntegratedFundingReceipt) [32]byte {
	policyDigest, _ := hex.DecodeString(receipt.ParticipantPolicyDigest)
	return integratedFundingAdmissionSignatureDigestFromDigests(integratedFundingReceiptDigest(receipt), policyDigest)
}

func integratedFundingAdmissionSignatureDigestFromDigests(receiptDigest [32]byte, participantPolicyDigest []byte) [32]byte {
	const domain = "COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1"
	material := make([]byte, 0, len(domain)+len(receiptDigest)+len(participantPolicyDigest))
	material = append(material, domain...)
	material = append(material, receiptDigest[:]...)
	material = append(material, participantPolicyDigest...)
	return sha256.Sum256(material)
}

func verifyCashuLockReceipt(state State, actor string, content bidContent, receipt CashuLockReceipt) error {
	if receipt.Schema != "PlebeianAuctionsPOCCashuLockV1" || receipt.MintURL != state.CashuMintURL {
		return errors.New("Cashu lock receipt schema or mint is not trusted")
	}
	if receipt.AuctionID != content.AuctionID || receipt.Bidder != actor || receipt.Amount != content.Amount || receipt.Amount <= 0 {
		return errors.New("Cashu lock receipt does not bind this bid")
	}
	if receipt.CommitteePublicKey != state.CommitteePublicKey || !validCompressedPublicKey(receipt.RefundPublicKey) {
		return errors.New("Cashu lock receipt does not use the trusted committee and a valid refund key")
	}
	auction := state.Auctions[content.AuctionID]
	if receipt.Locktime < auction.EndTime || receipt.Locktime > auction.EndTime+3_600 {
		return errors.New("Cashu lock receipt locktime is outside the auction settlement window")
	}
	if !validOperationID(receipt.OperationID) || !validLowerHex(receipt.TokenSHA256, sha256.Size) || !validLowerHex(receipt.Signature, schnorr.SignatureSize) {
		return errors.New("Cashu lock receipt identifiers or signature shape are invalid")
	}
	if _, exists := state.CashuLocks[receipt.TokenSHA256]; exists {
		return errors.New("Cashu lock token was already committed")
	}
	publicBytes, _ := hex.DecodeString(receipt.CommitteePublicKey)
	publicKey, err := btcec.ParsePubKey(publicBytes)
	if err != nil {
		return errors.New("Cashu committee public key is invalid")
	}
	signatureBytes, _ := hex.DecodeString(receipt.Signature)
	signature, err := schnorr.ParseSignature(signatureBytes)
	digest := cashuReceiptDigest(receipt)
	if err != nil || !signature.Verify(digest[:], publicKey) {
		return errors.New("Cashu lock receipt signature is invalid")
	}
	return nil
}

func cashuReceiptDigest(receipt CashuLockReceipt) [32]byte {
	material, _ := json.Marshal([]any{
		receipt.Schema, receipt.MintURL, receipt.AuctionID, receipt.Bidder, receipt.Amount,
		receipt.OperationID, receipt.TokenSHA256, receipt.CommitteePublicKey,
		receipt.RefundPublicKey, receipt.Locktime,
	})
	return sha256.Sum256(material)
}

func validLowerHex(value string, bytes int) bool {
	if len(value) != bytes*2 || strings.ToLower(value) != value {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == bytes
}

func validCompressedPublicKey(value string) bool {
	if !validLowerHex(value, 33) || (value[:2] != "02" && value[:2] != "03") {
		return false
	}
	decoded, _ := hex.DecodeString(value)
	_, err := btcec.ParsePubKey(decoded)
	return err == nil
}

func validOperationID(value string) bool {
	if len(value) < 1 || len(value) > 160 {
		return false
	}
	for _, current := range value {
		if !((current >= 'a' && current <= 'z') || (current >= 'A' && current <= 'Z') || (current >= '0' && current <= '9') || current == '-' || current == '_') {
			return false
		}
	}
	return true
}

func applyClose(state *State, auctionID string, now int64, privateKey ed25519.PrivateKey) error {
	operation := "close:" + auctionID
	if state.Operations[operation] {
		return errors.New("auction close was already committed")
	}
	auction, ok := state.Auctions[auctionID]
	if !ok || auction.Status != "open" {
		return errors.New("auction is not open")
	}
	if now < auction.EndTime {
		return errors.New("auction has not ended")
	}
	auction.Status = "closed"
	auction.ClosedAt = now
	if auction.LeaderBidID != "" {
		lock := state.Locks[auction.LeaderBidID]
		if lock.Status != "locked" {
			return errors.New("winner lock is not locked")
		}
		winningBid := state.Bids[auction.LeaderBidID]
		if auction.Reserve == 0 || lock.Amount >= auction.Reserve {
			if winningBid.IntegratedFundingID != "" {
				funding := state.IntegratedFundings[winningBid.IntegratedFundingID]
				funding.Status = "payout_entitled"
				state.IntegratedFundings[funding.ID] = funding
				lock.Status = "winner_selected"
				auction.Winner = lock.Bidder
				state.Locks[auction.LeaderBidID] = lock
				state.Operations[operation] = true
				state.Auctions[auctionID] = auction
				return nil
			}
			if winningBid.ReservationID != "" {
				reservation := state.CustodyReservations[winningBid.ReservationID]
				reservation.Status = "payout_entitled"
				state.CustodyReservations[reservation.ID] = reservation
				lock.Status = "winner_selected"
				auction.Winner = lock.Bidder
				state.Locks[auction.LeaderBidID] = lock
				state.Operations[operation] = true
				state.Auctions[auctionID] = auction
				return nil
			}
			if winningBid.CashuTokenSHA256 != "" {
				lock.Status = "winner_selected"
				auction.Winner = lock.Bidder
				state.Locks[auction.LeaderBidID] = lock
				state.Operations[operation] = true
				state.Auctions[auctionID] = auction
				return nil
			}
			note, err := issueNote(*state, privateKey, operation, "seller-payout", auction.Seller, lock.Amount)
			if err != nil {
				return err
			}
			state.Notes[note.ID] = note
			lock.Status = "paid"
			lock.OutputNoteID = note.ID
			auction.Winner = lock.Bidder
			auction.PaymentNoteID = note.ID
		} else {
			lock.Status = "refundable"
			if winningBid.IntegratedFundingID != "" {
				funding := state.IntegratedFundings[winningBid.IntegratedFundingID]
				funding.Status = "release_entitled"
				state.IntegratedFundings[funding.ID] = funding
			}
			if winningBid.ReservationID != "" {
				reservation := state.CustodyReservations[winningBid.ReservationID]
				reservation.Status = "release_entitled"
				state.CustodyReservations[reservation.ID] = reservation
			}
		}
		state.Locks[auction.LeaderBidID] = lock
	}
	state.Operations[operation] = true
	state.Auctions[auctionID] = auction
	return nil
}

func applyRefund(state *State, actor, eventID, bidID string, privateKey ed25519.PrivateKey) error {
	lock, ok := state.Locks[bidID]
	if !ok || lock.Bidder != actor {
		return errors.New("refund lock is missing or owned by another signer")
	}
	if lock.Status != "refundable" {
		return errors.New("bid is not refund eligible")
	}
	note, err := issueNote(*state, privateKey, eventID, "loser-refund", actor, lock.Amount)
	if err != nil {
		return err
	}
	state.Notes[note.ID] = note
	lock.Status = "refunded"
	lock.OutputNoteID = note.ID
	state.Locks[bidID] = lock
	return nil
}

func issueNote(state State, privateKey ed25519.PrivateKey, operation, purpose, owner string, amount int64) (Note, error) {
	if len(privateKey) != ed25519.PrivateKeySize {
		return Note{}, errors.New("legacy test-mint authority is unavailable")
	}
	if amount <= 0 || !validActor(owner) {
		return Note{}, errors.New("invalid test-mint output")
	}
	material := fmt.Sprintf("%s|%s|%s|%s|%d", state.ChainID, operation, purpose, owner, amount)
	digest := sha256.Sum256([]byte(material))
	note := Note{ID: hex.EncodeToString(digest[:]), Amount: amount, Owner: owner}
	message := noteMessage(state, note)
	note.Signature = hex.EncodeToString(ed25519.Sign(privateKey, []byte(message)))
	if _, exists := state.Notes[note.ID]; exists {
		return Note{}, errors.New("deterministic test-mint output already exists")
	}
	return note, nil
}

func verifyNote(state State, note Note) error {
	publicKey, err := hex.DecodeString(state.MintPublicKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return errors.New("invalid mint public key")
	}
	signature, err := hex.DecodeString(note.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(publicKey), []byte(noteMessage(state, note)), signature) {
		return errors.New("test-mint note signature is invalid")
	}
	return nil
}

func noteMessage(state State, note Note) string {
	return fmt.Sprintf("plebeian-test-mint-v1|%s|%s|%s|%d", state.ChainID, note.ID, note.Owner, note.Amount)
}

func decodeStrictContent(raw string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode signed event content: %w", err)
	}
	return requireEOF(decoder)
}

func requireEOF(decoder *json.Decoder) error {
	var extra any
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return errors.New("trailing JSON value")
	}
	return err
}

func validActor(actor string) bool {
	if len(actor) != 64 || strings.ToLower(actor) != actor {
		return false
	}
	decoded, err := hex.DecodeString(actor)
	return err == nil && len(decoded) == 32
}

func validIdentifier(value string) bool {
	if len(value) < 1 || len(value) > 64 {
		return false
	}
	for _, current := range value {
		if !((current >= 'a' && current <= 'z') || (current >= 'A' && current <= 'Z') || (current >= '0' && current <= '9') || current == '-' || current == '_') {
			return false
		}
	}
	return true
}

func validImageURL(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return true
	}
	if len(value) > 512 {
		return false
	}
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil && parsed.Fragment == ""
}
