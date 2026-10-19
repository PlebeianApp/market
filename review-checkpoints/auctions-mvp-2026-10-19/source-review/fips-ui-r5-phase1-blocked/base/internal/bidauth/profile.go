package bidauth

import (
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
)

const (
	DemoAuthProfile             = "DEMO_AUTH_V1"
	DemoProtocol                = "plebeian-auction-auth-demo"
	DemoVersion                 = "1"
	DemoBidKind          uint16 = 28642
	DemoMaxInteger       int64  = 9007199254740991
	DemoMaxLifetime      int64  = 300
	DemoActivationHeight int64  = 1
	DemoMaxCommandBytes  uint64 = 2048
	DemoMaxJSONBytes            = 8192
	DemoMaxRawBytes             = 2391
)

// Profile is the immutable public authentication record supplied by genesis.
// NetworkID has deliberately no source default.
type Profile struct {
	NetworkID        [32]byte
	ChainID          string
	ActivationHeight int64
}

func (profile Profile) Validate() error {
	if profile.ActivationHeight != DemoActivationHeight {
		return fail(failureDomain, "authenticated activation height must be 1")
	}
	if profile.ChainID == "" {
		return fail(failureDomain, "chain ID must be nonempty")
	}
	var zero [32]byte
	if profile.NetworkID == zero {
		return fail(failureDomain, "network ID must be explicitly assigned")
	}
	return nil
}

func (profile Profile) NetworkHex() string { return hex.EncodeToString(profile.NetworkID[:]) }

// EventLimitsForProfile is an exact sizing policy, not a runtime default.
func EventLimitsForProfile() EventLimits {
	return EventLimits{MaxTagCount: 4, MaxTagElements: 8, MaxStringBytes: 2048, MaxSerializedBytes: 4623}
}

func ExpectedTags(profile Profile, validUntil int64) ([][]string, error) {
	if err := profile.Validate(); err != nil {
		return nil, err
	}
	if validUntil < 1 || validUntil > DemoMaxInteger {
		return nil, fail(failureWindow, "valid_until is outside the exact integer range")
	}
	return [][]string{
		{"protocol", DemoProtocol},
		{"version", DemoVersion},
		{"environment", profile.NetworkHex()},
		{"valid_until", strconv.FormatInt(validUntil, 10)},
	}, nil
}

// ValidateProfileEvent checks the exact profile, domain and signed window.
func ValidateProfileEvent(event VerifiedEvent, profile Profile, consensusSeconds int64) (int64, error) {
	if !event.valid {
		return 0, fail(failureEvent, "verified event is invalid")
	}
	if err := profile.Validate(); err != nil {
		return 0, err
	}
	if event.kind != DemoBidKind {
		return 0, fail(failureEvent, "event kind is not DEMO_AUTH_V1 Bid")
	}
	if event.createdAt < 0 || event.createdAt > DemoMaxInteger {
		return 0, fail(failureWindow, "created_at is outside the exact integer range")
	}
	validUntil, err := parseProfileTags(event.tags, profile)
	if err != nil {
		return 0, err
	}
	if consensusSeconds < 0 || consensusSeconds > DemoMaxInteger {
		return 0, fail(failureWindow, "consensus time is outside the exact integer range")
	}
	if err := ValidateWindow(event.createdAt, validUntil, consensusSeconds, WindowPolicy{MaxLifetimeSeconds: DemoMaxLifetime}); err != nil {
		return 0, err
	}
	return validUntil, nil
}

// VerifyProfileBid is the only profile entry point from untrusted event bytes.
func VerifyProfileBid(signed SignedEvent, profile Profile, consensusSeconds int64, policy auction.Policy, verifier SignatureVerifier) (VerifiedBid, error) {
	if policy.MaxCommandBytes != DemoMaxCommandBytes {
		return VerifiedBid{}, fail(failureCommand, "auction command limit does not match profile")
	}
	verified, err := VerifyEvent(signed, EventLimitsForProfile(), verifier)
	if err != nil {
		return VerifiedBid{}, err
	}
	if _, err := ValidateProfileEvent(verified, profile, consensusSeconds); err != nil {
		return VerifiedBid{}, err
	}
	return BindCanonicalBid(verified, policy)
}

func parseProfileTags(tags [][]string, profile Profile) (int64, error) {
	if len(tags) != 4 {
		return 0, fail(failureDomain, "profile requires exactly four tags")
	}
	for _, tag := range tags {
		if len(tag) != 2 {
			return 0, fail(failureDomain, "profile tags require exactly two elements")
		}
	}
	want := [][2]string{{"protocol", DemoProtocol}, {"version", DemoVersion}, {"environment", profile.NetworkHex()}}
	for index := range want {
		if tags[index][0] != want[index][0] || tags[index][1] != want[index][1] {
			return 0, fail(failureDomain, "profile tag order or value mismatch")
		}
	}
	if tags[3][0] != "valid_until" {
		return 0, fail(failureDomain, "valid_until tag is missing or reordered")
	}
	value := tags[3][1]
	if len(value) < 1 || len(value) > 16 || value[0] == '0' || strings.IndexFunc(value, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
		return 0, fail(failureWindow, "valid_until is not canonical decimal ASCII")
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed < 1 || parsed > DemoMaxInteger || strconv.FormatInt(parsed, 10) != value {
		return 0, fail(failureWindow, "valid_until is outside the exact integer range")
	}
	return parsed, nil
}

func (bid VerifiedBid) ActorID() string          { return bid.actorID }
func (bid VerifiedBid) EventID() [32]byte        { return bid.eventID }
func (bid VerifiedBid) CanonicalCommand() []byte { return append([]byte(nil), bid.canonical...) }

func (profile Profile) String() string {
	return fmt.Sprintf("%s/%s/%s", DemoAuthProfile, profile.ChainID, profile.NetworkHex())
}
