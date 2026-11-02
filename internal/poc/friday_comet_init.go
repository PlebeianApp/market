package poc

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	cmtcrypto "github.com/cometbft/cometbft/crypto"
	cmted25519 "github.com/cometbft/cometbft/crypto/ed25519"
	cmtbytes "github.com/cometbft/cometbft/libs/bytes"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	cmttypes "github.com/cometbft/cometbft/types"
)

const (
	fridayCometValidatorPublicSchema  = "PLEBEIAN_FRIDAY_COMET_VALIDATOR_PUBLIC_V2"
	fridayCometGenesisBundleSchema    = "PLEBEIAN_FRIDAY_COMET_GENESIS_BUNDLE_V2"
	fridayCometFinalizeSchema         = "PLEBEIAN_FRIDAY_COMET_VALIDATOR_FINALIZED_V1"
	fridayCometDeploymentAnchorSchema = "PLEBEIAN_FRIDAY_COMET_DEPLOYMENT_ANCHOR_V1"
	fridayCometLaunchSealSchema       = "PLEBEIAN_FRIDAY_COMET_LAUNCH_SEAL_V1"
	fridayCometDescriptorDomain       = "PLEBEIAN_FRIDAY_COMET_VALIDATOR_DESCRIPTOR_V2"
	fridayCometDeploymentDomain       = "PLEBEIAN_FRIDAY_COMET_DEPLOYMENT_ANCHOR_V1"
	fridayCometBundleDomain           = "PLEBEIAN_FRIDAY_COMET_GENESIS_BUNDLE_V2"
	fridayCometFinalAckDomain         = "PLEBEIAN_FRIDAY_COMET_FINAL_ACK_V1"
	fridayValidatorRosterVersion      = "genesis-v1"
	fridayCometP2PPort                = 27656
	fridayCometRPCPort                = 27657
)

// FridayFROSTFinalPackageV1 keeps the existing ceremony API name while the
// accepted wire schema is exclusively the authenticated V2 result.
type FridayFROSTFinalPackageV1 = FridayAuthenticatedDKGResultV2

type FridayCometRosterAnchorV1 struct {
	Slot           int    `json:"slot"`
	HostID         string `json:"host_id"`
	FIPSULA        string `json:"fips_ula"`
	SignerIdentity string `json:"signer_identity"`
}

type FridayCometDeploymentAnchorV1 struct {
	Schema                         string                      `json:"schema"`
	DeploymentID                   string                      `json:"deployment_id"`
	ChainID                        string                      `json:"chain_id"`
	ApplicationRunID               string                      `json:"application_run_id"`
	ExpectedManifestDigest         string                      `json:"expected_manifest_digest"`
	GenesisTime                    string                      `json:"genesis_time"`
	ActiveKeysetID                 string                      `json:"active_keyset_id"`
	FROSTFinalPackageSHA256        string                      `json:"frost_final_package_sha256"`
	FundingAbortBootstrapSHA256    string                      `json:"funding_abort_bootstrap_sha256"`
	R20RuntimeBindingDigest        string                      `json:"r20_runtime_binding_digest,omitempty"`
	R20PredecessorAbortDigest      string                      `json:"r20_predecessor_abort_digest,omitempty"`
	R20RuntimeBindingSHA256        string                      `json:"r20_runtime_binding_sha256,omitempty"`
	SeparatedBootstrapDigest       string                      `json:"separated_bootstrap_digest,omitempty"`
	SeparatedRuntimeBindingDigest  string                      `json:"separated_runtime_binding_digest,omitempty"`
	SeparatedRuntimeBindingSHA256  string                      `json:"separated_runtime_binding_sha256,omitempty"`
	SeparatedMintConformanceSHA256 string                      `json:"separated_mint_conformance_sha256,omitempty"`
	ApplicationFIPSULA             string                      `json:"application_fips_ula,omitempty"`
	ApplicationFIPSNpub            string                      `json:"application_fips_npub,omitempty"`
	SeparatedMintOrigin            string                      `json:"separated_mint_origin,omitempty"`
	OwnerApprovalPublicKey         string                      `json:"owner_approval_public_key"`
	Roster                         []FridayCometRosterAnchorV1 `json:"roster"`
	OwnerApprovalSignature         string                      `json:"owner_approval_signature"`
}

// FridayCometValidatorPublicV1 is the only output that leaves a validator
// host during the Comet identity ceremony. It contains no private key or
// signing state and is bound to one deployment, chain, genesis time and slot.
type FridayCometValidatorPublicV1 struct {
	Schema                 string            `json:"schema"`
	DeploymentID           string            `json:"deployment_id"`
	ChainID                string            `json:"chain_id"`
	ValidatorRosterVersion string            `json:"validator_roster_version"`
	GenesisTime            string            `json:"genesis_time"`
	HostID                 string            `json:"host_id"`
	DeploymentAnchorSHA256 string            `json:"deployment_anchor_sha256"`
	ValidatorPublicKey     string            `json:"validator_public_key"`
	Validator              ValidatorManifest `json:"validator"`
	DescriptorDigest       string            `json:"descriptor_digest"`
	ValidatorSignature     string            `json:"validator_signature"`
}

// FridayCometGenesisBundleV1 binds the exact public inputs to the three common
// public files that are copied to every host only after local-key validation.
type FridayCometGenesisBundleV1 struct {
	Schema                        string             `json:"schema"`
	DeploymentID                  string             `json:"deployment_id"`
	ChainID                       string             `json:"chain_id"`
	ValidatorRosterVersion        string             `json:"validator_roster_version"`
	GenesisTime                   string             `json:"genesis_time"`
	GenesisSHA256                 string             `json:"genesis_sha256"`
	GenesisFileSHA256             string             `json:"genesis_file_sha256"`
	ValidatorsHash                string             `json:"validators_hash"`
	ValidatorRosterSHA256         string             `json:"validator_roster_sha256"`
	NetworkManifestSHA256         string             `json:"network_manifest_sha256"`
	NetworkFactsSHA256            string             `json:"network_facts_sha256"`
	DeploymentAnchorSHA256        string             `json:"deployment_anchor_sha256"`
	FROSTFinalPackageSHA256       string             `json:"frost_final_package_sha256"`
	FROSTManifestDigest           string             `json:"frost_manifest_digest"`
	FROSTPublicSummaryDigest      string             `json:"frost_public_summary_digest"`
	FundingAbortBootstrapSHA256   string             `json:"funding_abort_bootstrap_sha256"`
	R20RuntimeBindingDigest       string             `json:"r20_runtime_binding_digest,omitempty"`
	R20PredecessorAbortDigest     string             `json:"r20_predecessor_abort_digest,omitempty"`
	R20RuntimeBindingSHA256       string             `json:"r20_runtime_binding_sha256,omitempty"`
	SeparatedBootstrapDigest      string             `json:"separated_bootstrap_digest,omitempty"`
	SeparatedRuntimeBindingDigest string             `json:"separated_runtime_binding_digest,omitempty"`
	SeparatedRuntimeBindingSHA256 string             `json:"separated_runtime_binding_sha256,omitempty"`
	OwnerApprovalPublicKey        string             `json:"owner_approval_public_key"`
	CommitteePublicKey            string             `json:"committee_public_key"`
	MintPublicKey                 string             `json:"mint_public_key"`
	FundingAbortPins              FundingAbortPinsV1 `json:"funding_abort_pins"`
	BundleDigest                  string             `json:"bundle_digest"`
}

type FridayCometValidatorFinalizeV1 struct {
	Schema                 string `json:"schema"`
	DeploymentID           string `json:"deployment_id"`
	ChainID                string `json:"chain_id"`
	Slot                   int    `json:"slot"`
	HostID                 string `json:"host_id"`
	NodeID                 string `json:"node_id"`
	ValidatorAddress       string `json:"validator_address"`
	GenesisSHA256          string `json:"genesis_sha256"`
	ValidatorsHash         string `json:"validators_hash"`
	DeploymentAnchorSHA256 string `json:"deployment_anchor_sha256"`
	BundleDigest           string `json:"bundle_digest"`
	DescriptorDigest       string `json:"descriptor_digest"`
	ValidatorSignature     string `json:"validator_signature"`
}

type FridayCometLaunchSealV1 struct {
	Schema                 string                           `json:"schema"`
	DeploymentID           string                           `json:"deployment_id"`
	ChainID                string                           `json:"chain_id"`
	DeploymentAnchorSHA256 string                           `json:"deployment_anchor_sha256"`
	BundleDigest           string                           `json:"bundle_digest"`
	Acknowledgements       []FridayCometValidatorFinalizeV1 `json:"acknowledgements"`
}

type FridayCometValidatorInit struct {
	DeploymentAnchorPath   string
	OwnerApprovalPublicKey string
	Slot                   int
}

type FridayCometGenesisAssembly struct {
	DeploymentAnchorPath        string
	FROSTFinalPackagePath       string
	FundingAbortBootstrapPath   string
	R20RuntimeBindingPath       string
	SeparatedRuntimeBindingPath string
	OwnerApprovalPublicKey      string
	MintURL                     string
	CashuMintURL                string
	Policy                      Policy
}

type fridayCometKeySource func() (node cmtcrypto.PrivKey, validator cmtcrypto.PrivKey, err error)

func randomFridayCometKeys() (cmtcrypto.PrivKey, cmtcrypto.PrivKey, error) {
	_, node, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	_, validator, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	return cmted25519.PrivKey(node), cmted25519.PrivKey(validator), nil
}

func canonicalFridayGenesisTime(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil || parsed.IsZero() || parsed.Location() != time.UTC || parsed.Format(time.RFC3339Nano) != value {
		return time.Time{}, errors.New("Friday Comet genesis time must be canonical UTC RFC3339")
	}
	return parsed, nil
}

func validFridayChainID(value string) bool {
	if len(value) < 1 || len(value) > cmttypes.MaxChainIDLen || strings.TrimSpace(value) != value {
		return false
	}
	for _, current := range value {
		if !((current >= 'a' && current <= 'z') || (current >= '0' && current <= '9') || current == '-' || current == '_' || current == '.') {
			return false
		}
	}
	return true
}

func canonicalFridayULA(value string) (string, error) {
	if strings.ContainsAny(value, "[]%") || value != strings.ToLower(value) {
		return "", errors.New("Friday Comet FIPS address must be an unscoped canonical IPv6 ULA")
	}
	ip := net.ParseIP(value)
	if ip == nil || ip.To4() != nil || !ip.IsPrivate() || (ip[0]&0xfe) != 0xfc || ip.String() != value {
		return "", errors.New("Friday Comet FIPS address must be an unscoped canonical IPv6 ULA")
	}
	return value, nil
}

func fridayCometEndpoint(ula string) string {
	return "tcp://" + net.JoinHostPort(ula, strconv.Itoa(fridayCometP2PPort))
}

func marshalJSON(value any, comet bool) ([]byte, error) {
	var raw []byte
	var err error
	if comet {
		raw, err = cmtjson.MarshalIndent(value, "", "  ")
	} else {
		raw, err = json.MarshalIndent(value, "", "  ")
		if err == nil {
			raw = append(raw, '\n')
		}
	}
	return raw, err
}

func writeExclusive(path string, raw []byte, mode os.FileMode) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	if _, err = file.Write(raw); err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	return err
}

func readStrictJSON(path string, target any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	return requireEOF(decoder)
}

func fridayDomainJSON(domain string, value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return append(append([]byte(domain), 0), raw...), nil
}

func fridayAnchorSigningBytes(value FridayCometDeploymentAnchorV1) ([]byte, error) {
	value.OwnerApprovalSignature = ""
	return fridayDomainJSON(fridayCometDeploymentDomain, value)
}

func loadFridayDeploymentAnchor(path, expectedOwnerPublicKey string) (FridayCometDeploymentAnchorV1, string, error) {
	var value FridayCometDeploymentAnchorV1
	raw, err := os.ReadFile(path)
	if err != nil {
		return value, "", err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, "", err
	}
	if err := requireEOF(decoder); err != nil {
		return value, "", err
	}
	if value.Schema != fridayCometDeploymentAnchorSchema || !validOperationID(value.DeploymentID) ||
		!validFridayChainID(value.ChainID) || !validOperationID(value.ApplicationRunID) ||
		!validLowerHex(value.ExpectedManifestDigest, sha256.Size) ||
		!validOperationID(value.ActiveKeysetID) || !validLowerHex(value.FROSTFinalPackageSHA256, sha256.Size) ||
		!validLowerHex(value.FundingAbortBootstrapSHA256, sha256.Size) ||
		!validLowerHex(value.OwnerApprovalPublicKey, ed25519.PublicKeySize) ||
		value.OwnerApprovalPublicKey != expectedOwnerPublicKey ||
		!validLowerHex(value.OwnerApprovalSignature, ed25519.SignatureSize) || len(value.Roster) != 4 {
		return value, "", errors.New("Friday Comet owner-approved deployment anchor is malformed")
	}
	if value.DeploymentID == fridaySeparatedDeploymentID {
		ula, ulaErr := canonicalFridayULA(value.ApplicationFIPSULA)
		if ulaErr != nil || ula != value.ApplicationFIPSULA || !validSeparatedNpub(value.ApplicationFIPSNpub) || value.SeparatedMintOrigin != "https://139.162.161.233" {
			return value, "", errors.New("separated anchor application transport/origin differs")
		}
		if value.ApplicationRunID != fridaySeparatedApplicationRunID || !validLowerHex(value.SeparatedBootstrapDigest, 32) || !validLowerHex(value.SeparatedRuntimeBindingDigest, 32) || !validLowerHex(value.SeparatedRuntimeBindingSHA256, 32) || !validLowerHex(value.SeparatedMintConformanceSHA256, 32) {
			return value, "", errors.New("separated owner anchor lacks completed bootstrap/runtime/mint pins")
		}
	} else if value.ApplicationFIPSULA != "" || value.ApplicationFIPSNpub != "" || value.SeparatedMintOrigin != "" || value.SeparatedBootstrapDigest != "" || value.SeparatedRuntimeBindingDigest != "" || value.SeparatedRuntimeBindingSHA256 != "" || value.SeparatedMintConformanceSHA256 != "" {
		return value, "", errors.New("non-separated anchor carries separated authority")
	}
	if value.DeploymentID == fridayR20DeploymentID {
		if value.ApplicationRunID != fridayR20ApplicationRunID ||
			!validLowerHex(value.R20RuntimeBindingDigest, sha256.Size) ||
			!validLowerHex(value.R20PredecessorAbortDigest, sha256.Size) ||
			!validLowerHex(value.R20RuntimeBindingSHA256, sha256.Size) {
			return value, "", errors.New("Friday R20 owner-approved deployment anchor lacks its exact runtime binding")
		}
	} else if value.R20RuntimeBindingDigest != "" || value.R20PredecessorAbortDigest != "" || value.R20RuntimeBindingSHA256 != "" {
		return value, "", errors.New("non-R20 Friday deployment anchor carries R20 runtime authority")
	}
	if _, err := canonicalFridayGenesisTime(value.GenesisTime); err != nil {
		return value, "", err
	}
	hosts, endpoints, signers := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for index, entry := range value.Roster {
		ula, err := canonicalFridayULA(entry.FIPSULA)
		if err != nil || entry.Slot != index+1 || !validOperationID(entry.HostID) ||
			!validLowerHex(entry.SignerIdentity, 32) || hosts[entry.HostID] || endpoints[ula] || signers[entry.SignerIdentity] {
			return value, "", errors.New("Friday Comet deployment anchor roster is not four distinct ordered hosts")
		}
		if value.DeploymentID == fridaySeparatedDeploymentID && (ula == value.ApplicationFIPSULA || entry.HostID == "linode-109290386") {
			return value, "", errors.New("application cannot be a voting host")
		}
		hosts[entry.HostID], endpoints[ula], signers[entry.SignerIdentity] = true, true, true
	}
	message, err := fridayAnchorSigningBytes(value)
	if err != nil {
		return value, "", err
	}
	publicRaw, _ := hex.DecodeString(value.OwnerApprovalPublicKey)
	signatureRaw, _ := hex.DecodeString(value.OwnerApprovalSignature)
	if !ed25519.Verify(ed25519.PublicKey(publicRaw), message, signatureRaw) {
		return value, "", errors.New("Friday Comet deployment anchor owner signature is invalid")
	}
	return value, hashBytes(raw), nil
}

func loadFridayR20RuntimeBinding(path string, anchor FridayCometDeploymentAnchorV1,
	frost FridayFROSTFinalPackageV1) (FridayR20RuntimeDKGBindingV1, []byte, error) {
	if anchor.DeploymentID != fridayR20DeploymentID {
		if path != "" {
			return FridayR20RuntimeDKGBindingV1{}, nil, errors.New("non-R20 Friday assembly supplied an R20 runtime binding")
		}
		return FridayR20RuntimeDKGBindingV1{}, nil, nil
	}
	if strings.TrimSpace(path) == "" {
		return FridayR20RuntimeDKGBindingV1{}, nil, errors.New("Friday R20 assembly requires its owner-pinned runtime binding")
	}
	raw, err := os.ReadFile(path)
	if err != nil || hashBytes(raw) != anchor.R20RuntimeBindingSHA256 {
		return FridayR20RuntimeDKGBindingV1{}, nil, errors.New("Friday R20 runtime binding bytes differ from the owner anchor")
	}
	value, err := parseAndVerifyFridayR20RuntimeDKGBinding(raw, anchor.R20RuntimeBindingDigest,
		anchor.R20PredecessorAbortDigest)
	if err != nil {
		return FridayR20RuntimeDKGBindingV1{}, nil, fmt.Errorf("verify Friday R20 runtime binding: %w", err)
	}
	left, leftErr := json.Marshal(value.Result)
	right, rightErr := json.Marshal(frost)
	if leftErr != nil || rightErr != nil || !bytes.Equal(left, right) {
		return FridayR20RuntimeDKGBindingV1{}, nil, errors.New("Friday R20 runtime result differs from the owner-pinned FROST package")
	}
	return value, raw, nil
}

func loadFridayFROSTFinalPackage(path string, anchor FridayCometDeploymentAnchorV1) (FridayFROSTFinalPackageV1, error) {
	var value FridayFROSTFinalPackageV1
	raw, err := os.ReadFile(path)
	if err != nil {
		return value, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, err
	}
	if err := requireEOF(decoder); err != nil {
		return value, err
	}
	verifyResult := verifyFridayAuthenticatedDKGResultV2(anchor.ExpectedManifestDigest, value)
	if anchor.DeploymentID == fridayR20DeploymentID {
		verifyResult = verifyFridayAuthenticatedDKGResultV2ForRoot(anchor.ExpectedManifestDigest, fridayR20DKGRoot, value)
	}
	if anchor.DeploymentID == fridaySeparatedDeploymentID {
		verifyResult = verifyFridayAuthenticatedDKGResultV2ForRoot(anchor.ExpectedManifestDigest, fridaySeparatedDKGRoot, value)
	}
	if hashBytes(raw) != anchor.FROSTFinalPackageSHA256 || verifyResult != nil ||
		value.ManifestDigest != anchor.ExpectedManifestDigest || value.Manifest.DeploymentID != anchor.DeploymentID ||
		value.RunID != anchor.ApplicationRunID || !strings.HasPrefix(value.CommitteePublicKey, "02") {
		return value, errors.New("Friday FROST authenticated V2 result is invalid or differs from the owner anchor")
	}
	for index, participant := range value.Participants {
		anchorEntry := anchor.Roster[index]
		if participant.ParticipantID != index+1 || participant.HostID != anchorEntry.HostID ||
			participant.FIPSULA != anchorEntry.FIPSULA || participant.SignerIdentity != anchorEntry.SignerIdentity {
			return value, errors.New("Friday FROST public result participant roster differs from the owner-approved FIPS roster")
		}
	}
	return value, nil
}

func loadFridayFundingAbortBootstrap(path string, anchor FridayCometDeploymentAnchorV1, frost FridayFROSTFinalPackageV1) (FundingAbortBootstrapV1, error) {
	var value FundingAbortBootstrapV1
	raw, err := os.ReadFile(path)
	if err != nil {
		return value, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, err
	}
	if err := requireEOF(decoder); err != nil {
		return value, err
	}
	if hashBytes(raw) != anchor.FundingAbortBootstrapSHA256 || validateFundingAbortBootstrap(value) != nil ||
		value.ActiveKeysetID != anchor.ActiveKeysetID || value.CommitteeKeysetID != frost.CommitteeKeysetID ||
		value.CommitteeKeysetVersion != frost.CommitteeKeysetVersion || value.DKGRunID != frost.DKGRunID ||
		value.PublicKeyPackageSHA256 != frost.PublicKeyPackageSHA256 || value.SignerRosterDigest != frost.SignerRosterDigest {
		return value, errors.New("Friday funding-abort bootstrap differs from authenticated DKG authority")
	}
	return value, nil
}

func fridayDescriptorSigningBytes(value FridayCometValidatorPublicV1) ([]byte, error) {
	value.DescriptorDigest = ""
	value.ValidatorSignature = ""
	return fridayDomainJSON(fridayCometDescriptorDomain, value)
}

func signFridayDescriptor(value *FridayCometValidatorPublicV1, private cmted25519.PrivKey) error {
	message, err := fridayDescriptorSigningBytes(*value)
	if err != nil {
		return err
	}
	value.DescriptorDigest = hashBytes(message)
	signature, err := private.Sign(message)
	if err != nil {
		return err
	}
	value.ValidatorSignature = hex.EncodeToString(signature)
	return nil
}

func exactFridayValidatorPublic(value FridayCometValidatorPublicV1) error {
	if value.Schema != fridayCometValidatorPublicSchema || !validOperationID(value.DeploymentID) ||
		!validFridayChainID(value.ChainID) || value.ValidatorRosterVersion != fridayValidatorRosterVersion ||
		!validOperationID(value.HostID) || !validLowerHex(value.DeploymentAnchorSHA256, sha256.Size) ||
		value.Validator.Slot < 1 || value.Validator.Slot > 4 ||
		value.Validator.Moniker != fmt.Sprintf("plebeian-friday-validator-%d", value.Validator.Slot) ||
		!validLowerHex(value.Validator.NodeID, 20) ||
		len(value.Validator.ValidatorAddress) != 40 || strings.ToUpper(value.Validator.ValidatorAddress) != value.Validator.ValidatorAddress ||
		!validLowerHex(strings.ToLower(value.Validator.ValidatorAddress), 20) ||
		!validLowerHex(value.ValidatorPublicKey, ed25519.PublicKeySize) ||
		!validLowerHex(value.DescriptorDigest, sha256.Size) ||
		!validLowerHex(value.ValidatorSignature, ed25519.SignatureSize) ||
		value.Validator.P2PExternal == "" || value.Validator.P2PListen != value.Validator.P2PExternal ||
		value.Validator.RPCListen != "tcp://127.0.0.1:27657" {
		return errors.New("Friday Comet validator public descriptor is malformed")
	}
	if _, err := canonicalFridayGenesisTime(value.GenesisTime); err != nil {
		return err
	}
	endpoint, err := url.Parse(value.Validator.P2PExternal)
	if err != nil || endpoint.Scheme != "tcp" || endpoint.User != nil || endpoint.Path != "" || endpoint.RawQuery != "" || endpoint.Fragment != "" || endpoint.Port() != "27656" {
		return errors.New("Friday Comet public descriptor has an unsafe P2P endpoint")
	}
	ula, err := canonicalFridayULA(endpoint.Hostname())
	if err != nil || value.Validator.P2PExternal != fridayCometEndpoint(ula) {
		return errors.New("Friday Comet public descriptor has an unsafe P2P endpoint")
	}
	publicRaw, _ := hex.DecodeString(value.ValidatorPublicKey)
	public := cmted25519.PubKey(publicRaw)
	if strings.ToUpper(hex.EncodeToString(public.Address())) != value.Validator.ValidatorAddress {
		return errors.New("Friday Comet validator public key differs from its address")
	}
	message, err := fridayDescriptorSigningBytes(value)
	if err != nil || hashBytes(message) != value.DescriptorDigest {
		return errors.New("Friday Comet validator descriptor digest is invalid")
	}
	signature, _ := hex.DecodeString(value.ValidatorSignature)
	if !ed25519.Verify(ed25519.PublicKey(publicRaw), message, signature) {
		return errors.New("Friday Comet validator descriptor signature is invalid")
	}
	return nil
}

// InitFridayCometValidator creates exactly one host's Comet node and validator
// keys. The destination network root must not exist, and the returned/public
// descriptor is the only ceremony output suitable for collection.
func InitFridayCometValidator(root string, input FridayCometValidatorInit) (FridayCometValidatorPublicV1, error) {
	return initFridayCometValidator(root, input, randomFridayCometKeys)
}

func initFridayCometValidator(root string, input FridayCometValidatorInit, keys fridayCometKeySource) (FridayCometValidatorPublicV1, error) {
	if strings.TrimSpace(root) == "" || strings.TrimSpace(input.DeploymentAnchorPath) == "" ||
		!validLowerHex(input.OwnerApprovalPublicKey, ed25519.PublicKeySize) || input.Slot < 1 || input.Slot > 4 {
		return FridayCometValidatorPublicV1{}, errors.New("Friday Comet validator initialization arguments are invalid")
	}
	anchor, anchorSHA256, err := loadFridayDeploymentAnchor(input.DeploymentAnchorPath, input.OwnerApprovalPublicKey)
	if err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	entry := anchor.Roster[input.Slot-1]
	ula := entry.FIPSULA
	root, err = filepath.Abs(root)
	if err != nil || root == string(filepath.Separator) {
		return FridayCometValidatorPublicV1{}, errors.New("Friday Comet network root must be a safe absolute path")
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		return FridayCometValidatorPublicV1{}, fmt.Errorf("create fresh Friday Comet network root: %w", err)
	}
	nodeRoot := filepath.Join(root, fmt.Sprintf("validator-%d", input.Slot))
	configDir, dataDir := filepath.Join(nodeRoot, "config"), filepath.Join(nodeRoot, "data")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	if err := os.Mkdir(dataDir, 0o700); err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	nodePrivate, validatorPrivate, err := keys()
	if err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	nodeEd25519, nodeOK := nodePrivate.(cmted25519.PrivKey)
	validatorEd25519, validatorOK := validatorPrivate.(cmted25519.PrivKey)
	if !nodeOK || !validatorOK || len(nodeEd25519) != cmted25519.PrivateKeySize || len(validatorEd25519) != cmted25519.PrivateKeySize {
		return FridayCometValidatorPublicV1{}, errors.New("Friday Comet keys must be distinct Ed25519 key values")
	}
	if bytes.Equal(nodeEd25519, validatorEd25519) {
		return FridayCometValidatorPublicV1{}, errors.New("Friday Comet node and validator keys must be distinct")
	}
	nodeKey := &p2p.NodeKey{PrivKey: nodeEd25519}
	validatorKeyPath := filepath.Join(configDir, "priv_validator_key.json")
	validatorStatePath := filepath.Join(dataDir, "priv_validator_state.json")
	pv := privval.NewFilePV(validatorEd25519, validatorKeyPath, validatorStatePath)
	nodeRaw, err := marshalJSON(nodeKey, true)
	if err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	validatorRaw, err := marshalJSON(pv.Key, true)
	if err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	stateRaw, err := marshalJSON(pv.LastSignState, true)
	if err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	if err := writeExclusive(filepath.Join(configDir, "node_key.json"), nodeRaw, 0o600); err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	if err := writeExclusive(validatorKeyPath, validatorRaw, 0o600); err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	if err := writeExclusive(validatorStatePath, stateRaw, 0o600); err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	validatorPublic := validatorEd25519.PubKey()
	descriptor := FridayCometValidatorPublicV1{
		Schema: fridayCometValidatorPublicSchema, DeploymentID: anchor.DeploymentID, ChainID: anchor.ChainID,
		ValidatorRosterVersion: fridayValidatorRosterVersion, GenesisTime: anchor.GenesisTime,
		HostID: entry.HostID, DeploymentAnchorSHA256: anchorSHA256,
		ValidatorPublicKey: hex.EncodeToString(validatorPublic.Bytes()),
		Validator: ValidatorManifest{Slot: input.Slot, Moniker: fmt.Sprintf("plebeian-friday-validator-%d", input.Slot),
			NodeID: string(nodeKey.ID()), ValidatorAddress: strings.ToUpper(hex.EncodeToString(validatorPublic.Address())),
			P2PListen: fridayCometEndpoint(ula), P2PExternal: fridayCometEndpoint(ula), RPCListen: "tcp://127.0.0.1:27657"},
	}
	if err := signFridayDescriptor(&descriptor, validatorEd25519); err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	if err := exactFridayValidatorPublic(descriptor); err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	publicRaw, err := marshalJSON(descriptor, false)
	if err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	if err := writeExclusive(filepath.Join(root, "validator-public.json"), publicRaw, 0o644); err != nil {
		return FridayCometValidatorPublicV1{}, err
	}
	return descriptor, nil
}

func publicDescriptors(paths []string) ([]FridayCometValidatorPublicV1, error) {
	if len(paths) != 4 {
		return nil, errors.New("Friday Comet genesis assembly requires exactly four public validator descriptors")
	}
	values := make([]FridayCometValidatorPublicV1, 0, 4)
	for _, path := range paths {
		var value FridayCometValidatorPublicV1
		if err := readStrictJSON(path, &value); err != nil {
			return nil, fmt.Errorf("read Friday Comet validator public descriptor: %w", err)
		}
		if err := exactFridayValidatorPublic(value); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	sort.Slice(values, func(i, j int) bool { return values[i].Validator.Slot < values[j].Validator.Slot })
	first := values[0]
	nodes, validators, endpoints := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for index, value := range values {
		if value.Validator.Slot != index+1 || value.DeploymentID != first.DeploymentID || value.ChainID != first.ChainID ||
			value.ValidatorRosterVersion != first.ValidatorRosterVersion || value.GenesisTime != first.GenesisTime ||
			nodes[value.Validator.NodeID] || validators[value.Validator.ValidatorAddress] || endpoints[value.Validator.P2PExternal] {
			return nil, errors.New("Friday Comet descriptors do not form one distinct ordered four-validator roster")
		}
		nodes[value.Validator.NodeID], validators[value.Validator.ValidatorAddress], endpoints[value.Validator.P2PExternal] = true, true, true
	}
	return values, nil
}

func hashBytes(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func fridayBundleDigest(value FridayCometGenesisBundleV1) (string, error) {
	value.BundleDigest = ""
	message, err := fridayDomainJSON(fridayCometBundleDomain, value)
	if err != nil {
		return "", err
	}
	return hashBytes(message), nil
}

// validateFridayGenesisPolicy allows only the reviewed funding pair to be
// selected at genesis. Comparing the whole struct also pins future fields.
func validateFridayGenesisPolicy(policy Policy) error {
	if err := policy.Validate(); err != nil || policy.FaucetCap > 50_000 {
		return errors.New("Friday Comet funding policy is invalid or exceeds the reviewed browser payment bound")
	}
	reviewed := DefaultPolicy()
	reviewed.FaucetAmount, reviewed.FaucetCap = policy.FaucetAmount, policy.FaucetCap
	if policy != reviewed {
		return errors.New("Friday Comet non-funding policy differs from DefaultPolicy")
	}
	return nil
}

// AssembleFridayCometGenesis consumes public inputs only and writes one common,
// deterministic genesis/network/facts bundle. The bundle root must not exist.
func AssembleFridayCometGenesis(root string, descriptorPaths []string, input FridayCometGenesisAssembly) (FridayCometGenesisBundleV1, error) {
	if !validLowerHex(input.OwnerApprovalPublicKey, ed25519.PublicKeySize) {
		return FridayCometGenesisBundleV1{}, errors.New("Friday Comet owner approval public key is invalid")
	}
	if err := validateFridayGenesisPolicy(input.Policy); err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	anchor, anchorSHA256, err := loadFridayDeploymentAnchor(input.DeploymentAnchorPath, input.OwnerApprovalPublicKey)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	frost, err := loadFridayFROSTFinalPackage(input.FROSTFinalPackagePath, anchor)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	r20Binding, r20BindingRaw, err := loadFridayR20RuntimeBinding(input.R20RuntimeBindingPath, anchor, frost)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	var separatedRaw []byte
	if anchor.DeploymentID == fridaySeparatedDeploymentID {
		_, separatedRaw, err = loadSeparatedRuntime(input.SeparatedRuntimeBindingPath, anchor, frost)
		if err != nil {
			return FridayCometGenesisBundleV1{}, err
		}
	} else if input.SeparatedRuntimeBindingPath != "" {
		return FridayCometGenesisBundleV1{}, errors.New("non-separated assembly supplied fresh runtime")
	}
	bootstrap, err := loadFridayFundingAbortBootstrap(input.FundingAbortBootstrapPath, anchor, frost)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	descriptors, err := publicDescriptors(descriptorPaths)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	for index, descriptor := range descriptors {
		entry := anchor.Roster[index]
		if descriptor.DeploymentID != anchor.DeploymentID || descriptor.ChainID != anchor.ChainID ||
			descriptor.GenesisTime != anchor.GenesisTime || descriptor.DeploymentAnchorSHA256 != anchorSHA256 ||
			descriptor.HostID != entry.HostID || descriptor.Validator.Slot != entry.Slot ||
			descriptor.Validator.P2PExternal != fridayCometEndpoint(entry.FIPSULA) {
			return FridayCometGenesisBundleV1{}, errors.New("Friday Comet validator descriptor differs from the owner-approved roster")
		}
	}
	if anchor.DeploymentID == fridaySeparatedDeploymentID && input.CashuMintURL != "https://139.162.161.233" {
		return FridayCometGenesisBundleV1{}, errors.New("separated genesis requires exact owner-pinned app mint origin")
	}
	if validateFakeMoneyEndpoint(input.MintURL, "/test-mint") != nil || validateCashuMintIdentity(input.CashuMintURL) != nil {
		return FridayCometGenesisBundleV1{}, errors.New("Friday Comet public application identity is invalid")
	}
	genesisTime, _ := canonicalFridayGenesisTime(descriptors[0].GenesisTime)
	genesisValidators := make([]cmttypes.GenesisValidator, 0, 4)
	validators := make([]ValidatorManifest, 0, 4)
	for _, descriptor := range descriptors {
		publicRaw, _ := hex.DecodeString(descriptor.ValidatorPublicKey)
		public := cmted25519.PubKey(publicRaw)
		genesisValidators = append(genesisValidators, cmttypes.GenesisValidator{Address: public.Address(), PubKey: public,
			Power: 1, Name: descriptor.Validator.Moniker})
		validators = append(validators, descriptor.Validator)
	}
	params := cmttypes.DefaultConsensusParams()
	params.Feature.PbtsEnableHeight = 1
	params.Feature.VoteExtensionsEnableHeight = 0
	params.Synchrony.Precision = time.Second
	params.Synchrony.MessageDelay = 10 * time.Second
	genesis := &cmttypes.GenesisDoc{GenesisTime: genesisTime, ChainID: descriptors[0].ChainID, InitialHeight: 1,
		ConsensusParams: params, Validators: genesisValidators}
	if err := genesis.ValidateAndComplete(); err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	genesisIdentity, err := fundingAbortGenesisIdentity(genesis)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	pins := FundingAbortPinsV1{AuthNetworkID: anchor.ChainID, ChainID: anchor.ChainID,
		GenesisSHA256: genesisIdentity, MintURL: input.CashuMintURL, ActiveKeysetID: bootstrap.ActiveKeysetID,
		CommitteePublicKey: frost.CommitteePublicKey, CommitteeKeysetID: bootstrap.CommitteeKeysetID,
		CommitteeKeysetVersion: bootstrap.CommitteeKeysetVersion, DKGRunID: bootstrap.DKGRunID,
		PublicKeyPackageSHA256: bootstrap.PublicKeyPackageSHA256, SignerRosterDigest: bootstrap.SignerRosterDigest}
	mintPublic, err := DeriveFrostCashuLegacyNotePublicPin(pins)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	empty, err := NewStateWithFrostFundingAbortPins(anchor.ChainID, mintPublic,
		frost.CommitteePublicKey, input.MintURL, input.CashuMintURL, pins)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	appHash, err := empty.CanonicalHash()
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	genesis.AppHash = cmtbytes.HexBytes(appHash[:])
	genesisRaw, err := marshalJSON(genesis, true)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	if _, err := cmttypes.GenesisDocFromJSON(genesisRaw); err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	manifest := NetworkManifest{Schema: "PlebeianAuctionsPOCNetworkV4", Mode: "remote",
		ApplicationAuthority: ApplicationAuthorityFrostCashu,
		ChainID:              descriptors[0].ChainID, CreatedAt: descriptors[0].GenesisTime, GenesisTime: descriptors[0].GenesisTime,
		MintURL: input.MintURL, MintPublicKey: hex.EncodeToString(mintPublic), CashuMintURL: input.CashuMintURL,
		CommitteePublicKey: frost.CommitteePublicKey, Policy: input.Policy, Validators: validators,
		FundingAbortPins:          &pins,
		R20RuntimeBindingDigest:   anchor.R20RuntimeBindingDigest,
		R20PredecessorAbortDigest: anchor.R20PredecessorAbortDigest,
		R20RuntimeBindingSHA256:   anchor.R20RuntimeBindingSHA256,
		SeparatedBootstrapDigest:  anchor.SeparatedBootstrapDigest, SeparatedRuntimeBindingDigest: anchor.SeparatedRuntimeBindingDigest, SeparatedRuntimeBindingSHA256: anchor.SeparatedRuntimeBindingSHA256}
	if anchor.DeploymentID == fridayR20DeploymentID || anchor.DeploymentID == fridaySeparatedDeploymentID {
		manifest.DeploymentID = anchor.DeploymentID
		manifest.ApplicationRunID = anchor.ApplicationRunID
	}
	manifestRaw, err := marshalJSON(manifest, false)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	validatorSet := make([]*cmttypes.Validator, 0, 4)
	for _, validator := range genesis.Validators {
		validatorSet = append(validatorSet, cmttypes.NewValidator(validator.PubKey, validator.Power))
	}
	facts := NetworkFacts{Schema: "PlebeianAuctionsPOCNetworkFactsV1", ChainID: manifest.ChainID,
		GenesisSHA256: genesisIdentity, ValidatorsHash: strings.ToLower(hex.EncodeToString(cmttypes.NewValidatorSet(validatorSet).Hash())),
		CommitteePublicKey: frost.CommitteePublicKey, ValidatorRosterVersion: fridayValidatorRosterVersion}
	factsRaw, err := marshalJSON(facts, false)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	rosterRaw, err := marshalJSON(descriptors, false)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	anchorRaw, err := os.ReadFile(input.DeploymentAnchorPath)
	if err != nil || hashBytes(anchorRaw) != anchorSHA256 {
		return FridayCometGenesisBundleV1{}, errors.New("Friday Comet deployment anchor changed during assembly")
	}
	frostRaw, err := os.ReadFile(input.FROSTFinalPackagePath)
	if err != nil || hashBytes(frostRaw) != anchor.FROSTFinalPackageSHA256 {
		return FridayCometGenesisBundleV1{}, errors.New("Friday FROST public result changed during assembly")
	}
	bootstrapRaw, err := os.ReadFile(input.FundingAbortBootstrapPath)
	if err != nil || hashBytes(bootstrapRaw) != anchor.FundingAbortBootstrapSHA256 {
		return FridayCometGenesisBundleV1{}, errors.New("Friday funding-abort bootstrap changed during assembly")
	}
	receipt := FridayCometGenesisBundleV1{Schema: fridayCometGenesisBundleSchema,
		DeploymentID: descriptors[0].DeploymentID, ChainID: manifest.ChainID,
		ValidatorRosterVersion: fridayValidatorRosterVersion, GenesisTime: descriptors[0].GenesisTime,
		GenesisSHA256: facts.GenesisSHA256, GenesisFileSHA256: hashBytes(genesisRaw), ValidatorsHash: facts.ValidatorsHash,
		ValidatorRosterSHA256: hashBytes(rosterRaw), NetworkManifestSHA256: hashBytes(manifestRaw),
		NetworkFactsSHA256: hashBytes(factsRaw), DeploymentAnchorSHA256: anchorSHA256,
		FROSTFinalPackageSHA256: anchor.FROSTFinalPackageSHA256, OwnerApprovalPublicKey: anchor.OwnerApprovalPublicKey,
		FROSTManifestDigest: frost.ManifestDigest, FROSTPublicSummaryDigest: frost.PublicSummaryDigest,
		FundingAbortBootstrapSHA256: anchor.FundingAbortBootstrapSHA256,
		R20RuntimeBindingDigest:     anchor.R20RuntimeBindingDigest,
		R20PredecessorAbortDigest:   anchor.R20PredecessorAbortDigest,
		R20RuntimeBindingSHA256:     anchor.R20RuntimeBindingSHA256,
		SeparatedBootstrapDigest:    anchor.SeparatedBootstrapDigest, SeparatedRuntimeBindingDigest: anchor.SeparatedRuntimeBindingDigest, SeparatedRuntimeBindingSHA256: anchor.SeparatedRuntimeBindingSHA256,
		CommitteePublicKey: frost.CommitteePublicKey, MintPublicKey: hex.EncodeToString(mintPublic), FundingAbortPins: pins}
	if anchor.DeploymentID == fridayR20DeploymentID && r20Binding.BindingDigest != anchor.R20RuntimeBindingDigest {
		return FridayCometGenesisBundleV1{}, errors.New("Friday R20 runtime binding differs during genesis assembly")
	}
	receipt.BundleDigest, err = fridayBundleDigest(receipt)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	receiptRaw, err := marshalJSON(receipt, false)
	if err != nil {
		return FridayCometGenesisBundleV1{}, err
	}
	root, err = filepath.Abs(root)
	if err != nil || root == string(filepath.Separator) {
		return FridayCometGenesisBundleV1{}, errors.New("Friday Comet bundle root must be a safe absolute path")
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		return FridayCometGenesisBundleV1{}, fmt.Errorf("create fresh Friday Comet public bundle root: %w", err)
	}
	files := []struct {
		name string
		raw  []byte
		mode os.FileMode
	}{{"genesis.json", genesisRaw, 0o644}, {"network.json", manifestRaw, 0o600},
		{"network-facts.json", factsRaw, 0o600}, {"validator-roster.json", rosterRaw, 0o644},
		{"deployment-anchor.json", anchorRaw, 0o644}, {"frost-final-public.json", frostRaw, 0o644},
		{"funding-abort-bootstrap.json", bootstrapRaw, 0o644},
		{"comet-genesis-bundle.json", receiptRaw, 0o644}}
	if anchor.DeploymentID == fridayR20DeploymentID {
		files = append(files, struct {
			name string
			raw  []byte
			mode os.FileMode
		}{"r20-runtime-binding.json", r20BindingRaw, 0o644})
	}
	if anchor.DeploymentID == fridaySeparatedDeploymentID {
		files = append(files, struct {
			name string
			raw  []byte
			mode os.FileMode
		}{"separated-runtime-binding.json", separatedRaw, 0o644})
	}
	for _, file := range files {
		if err := writeExclusive(filepath.Join(root, file.name), file.raw, file.mode); err != nil {
			return FridayCometGenesisBundleV1{}, err
		}
	}
	return receipt, nil
}

type cometValidatorKeyFile struct {
	Address cmtcrypto.Address `json:"address"`
	PubKey  cmtcrypto.PubKey  `json:"pub_key"`
	PrivKey cmtcrypto.PrivKey `json:"priv_key"`
}

func validateLocalFridayCometKeys(root string, descriptor FridayCometValidatorPublicV1) (cmted25519.PrivKey, error) {
	for slot := 1; slot <= 4; slot++ {
		if slot == descriptor.Validator.Slot {
			continue
		}
		if _, err := os.Lstat(filepath.Join(root, fmt.Sprintf("validator-%d", slot))); !errors.Is(err, os.ErrNotExist) {
			return nil, errors.New("Friday Comet host contains another validator slot directory")
		}
	}
	nodeRoot := filepath.Join(root, fmt.Sprintf("validator-%d", descriptor.Validator.Slot))
	nodeKey, err := p2p.LoadNodeKey(filepath.Join(nodeRoot, "config", "node_key.json"))
	if err != nil || string(nodeKey.ID()) != descriptor.Validator.NodeID {
		return nil, errors.New("Friday Comet local node key differs from its public descriptor")
	}
	keyRaw, err := os.ReadFile(filepath.Join(nodeRoot, "config", "priv_validator_key.json"))
	if err != nil {
		return nil, err
	}
	var key cometValidatorKeyFile
	if err := cmtjson.Unmarshal(keyRaw, &key); err != nil || key.PrivKey == nil || key.PubKey == nil ||
		!bytes.Equal(key.PrivKey.PubKey().Bytes(), key.PubKey.Bytes()) || !bytes.Equal(key.PubKey.Address(), key.Address) ||
		hex.EncodeToString(key.PubKey.Bytes()) != descriptor.ValidatorPublicKey ||
		strings.ToUpper(hex.EncodeToString(key.Address)) != descriptor.Validator.ValidatorAddress {
		return nil, errors.New("Friday Comet local validator key differs from its public descriptor")
	}
	private, ok := key.PrivKey.(cmted25519.PrivKey)
	if !ok {
		return nil, errors.New("Friday Comet local validator key is not Ed25519")
	}
	stateRaw, err := os.ReadFile(filepath.Join(nodeRoot, "data", "priv_validator_state.json"))
	if err != nil {
		return nil, err
	}
	var state freshPrivValidatorState
	decoder := json.NewDecoder(bytes.NewReader(stateRaw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil || requireEOF(decoder) != nil || state.Height != "0" || state.Round != 0 || state.Step != 0 || state.Signature != "" || state.SignBytes != "" {
		return nil, errors.New("Friday Comet local validator signing state is not fresh")
	}
	return private, nil
}

func validateFridayCometBundle(root string) (FridayCometGenesisBundleV1, NetworkManifest, NetworkFacts, error) {
	var receipt FridayCometGenesisBundleV1
	if err := readStrictJSON(filepath.Join(root, "comet-genesis-bundle.json"), &receipt); err != nil {
		return receipt, NetworkManifest{}, NetworkFacts{}, err
	}
	if receipt.Schema != fridayCometGenesisBundleSchema || !validOperationID(receipt.DeploymentID) ||
		!validFridayChainID(receipt.ChainID) || receipt.ValidatorRosterVersion != fridayValidatorRosterVersion ||
		!validCompressedPublicKey(receipt.CommitteePublicKey) || !strings.HasPrefix(receipt.CommitteePublicKey, "02") ||
		!validLowerHex(receipt.MintPublicKey, ed25519.PublicKeySize) ||
		!validLowerHex(receipt.GenesisSHA256, sha256.Size) || !validLowerHex(receipt.GenesisFileSHA256, sha256.Size) ||
		!validLowerHex(receipt.ValidatorsHash, sha256.Size) ||
		!validLowerHex(receipt.ValidatorRosterSHA256, sha256.Size) || !validLowerHex(receipt.NetworkManifestSHA256, sha256.Size) ||
		!validLowerHex(receipt.NetworkFactsSHA256, sha256.Size) || !validLowerHex(receipt.DeploymentAnchorSHA256, sha256.Size) ||
		!validLowerHex(receipt.FROSTFinalPackageSHA256, sha256.Size) ||
		!validLowerHex(receipt.FROSTManifestDigest, sha256.Size) ||
		!validLowerHex(receipt.FROSTPublicSummaryDigest, sha256.Size) ||
		!validLowerHex(receipt.FundingAbortBootstrapSHA256, sha256.Size) ||
		!validLowerHex(receipt.OwnerApprovalPublicKey, ed25519.PublicKeySize) || !validLowerHex(receipt.BundleDigest, sha256.Size) {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet genesis bundle receipt is malformed")
	}
	if receipt.DeploymentID == fridaySeparatedDeploymentID {
		if !validLowerHex(receipt.SeparatedBootstrapDigest, 32) || !validLowerHex(receipt.SeparatedRuntimeBindingDigest, 32) || !validLowerHex(receipt.SeparatedRuntimeBindingSHA256, 32) {
			return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("separated bundle lacks fresh pins")
		}
	} else if receipt.SeparatedBootstrapDigest != "" || receipt.SeparatedRuntimeBindingDigest != "" || receipt.SeparatedRuntimeBindingSHA256 != "" {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("non-separated receipt carries fresh authority")
	}
	if receipt.DeploymentID == fridayR20DeploymentID {
		if !validLowerHex(receipt.R20RuntimeBindingDigest, sha256.Size) ||
			!validLowerHex(receipt.R20PredecessorAbortDigest, sha256.Size) ||
			!validLowerHex(receipt.R20RuntimeBindingSHA256, sha256.Size) {
			return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday R20 bundle receipt lacks its runtime binding")
		}
	} else if receipt.R20RuntimeBindingDigest != "" || receipt.R20PredecessorAbortDigest != "" || receipt.R20RuntimeBindingSHA256 != "" {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("non-R20 Friday bundle carries R20 runtime authority")
	}
	if _, err := canonicalFridayGenesisTime(receipt.GenesisTime); err != nil {
		return receipt, NetworkManifest{}, NetworkFacts{}, err
	}
	computedBundleDigest, err := fridayBundleDigest(receipt)
	if err != nil || computedBundleDigest != receipt.BundleDigest {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet genesis bundle digest is invalid")
	}
	genesisRaw, err := os.ReadFile(filepath.Join(root, "genesis.json"))
	if err != nil || hashBytes(genesisRaw) != receipt.GenesisFileSHA256 {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet genesis differs from bundle receipt")
	}
	manifestRaw, err := os.ReadFile(filepath.Join(root, "network.json"))
	if err != nil || hashBytes(manifestRaw) != receipt.NetworkManifestSHA256 {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet network manifest differs from bundle receipt")
	}
	factsRaw, err := os.ReadFile(filepath.Join(root, "network-facts.json"))
	if err != nil || hashBytes(factsRaw) != receipt.NetworkFactsSHA256 {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet network facts differ from bundle receipt")
	}
	rosterRaw, err := os.ReadFile(filepath.Join(root, "validator-roster.json"))
	if err != nil || hashBytes(rosterRaw) != receipt.ValidatorRosterSHA256 {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet validator roster differs from bundle receipt")
	}
	var descriptors []FridayCometValidatorPublicV1
	decoder := json.NewDecoder(bytes.NewReader(rosterRaw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&descriptors); err != nil || requireEOF(decoder) != nil || len(descriptors) != 4 {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet validator roster is malformed")
	}
	anchor, anchorSHA256, err := loadFridayDeploymentAnchor(filepath.Join(root, "deployment-anchor.json"), receipt.OwnerApprovalPublicKey)
	if err != nil || anchorSHA256 != receipt.DeploymentAnchorSHA256 {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet deployment anchor differs from bundle receipt")
	}
	frost, err := loadFridayFROSTFinalPackage(filepath.Join(root, "frost-final-public.json"), anchor)
	if err != nil || anchor.FROSTFinalPackageSHA256 != receipt.FROSTFinalPackageSHA256 {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday FROST public result differs from bundle receipt")
	}
	var r20Binding FridayR20RuntimeDKGBindingV1
	if anchor.DeploymentID == fridayR20DeploymentID {
		r20Binding, _, err = loadFridayR20RuntimeBinding(filepath.Join(root, "r20-runtime-binding.json"), anchor, frost)
		if err != nil || r20Binding.BindingDigest != receipt.R20RuntimeBindingDigest {
			return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday R20 runtime binding differs from bundle receipt")
		}
	}
	if anchor.DeploymentID == fridaySeparatedDeploymentID {
		if _, _, err := loadSeparatedRuntime(filepath.Join(root, "separated-runtime-binding.json"), anchor, frost); err != nil {
			return receipt, NetworkManifest{}, NetworkFacts{}, err
		}
	}
	bootstrap, err := loadFridayFundingAbortBootstrap(filepath.Join(root, "funding-abort-bootstrap.json"), anchor, frost)
	if err != nil || anchor.FundingAbortBootstrapSHA256 != receipt.FundingAbortBootstrapSHA256 {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday funding-abort bootstrap differs from bundle receipt")
	}
	if anchor.DeploymentID != receipt.DeploymentID || anchor.ChainID != receipt.ChainID || anchor.GenesisTime != receipt.GenesisTime ||
		anchor.R20RuntimeBindingDigest != receipt.R20RuntimeBindingDigest ||
		anchor.R20PredecessorAbortDigest != receipt.R20PredecessorAbortDigest ||
		anchor.R20RuntimeBindingSHA256 != receipt.R20RuntimeBindingSHA256 ||
		anchor.SeparatedBootstrapDigest != receipt.SeparatedBootstrapDigest || anchor.SeparatedRuntimeBindingDigest != receipt.SeparatedRuntimeBindingDigest || anchor.SeparatedRuntimeBindingSHA256 != receipt.SeparatedRuntimeBindingSHA256 ||
		anchor.ExpectedManifestDigest != receipt.FROSTManifestDigest ||
		frost.ManifestDigest != receipt.FROSTManifestDigest || frost.PublicSummaryDigest != receipt.FROSTPublicSummaryDigest ||
		frost.CommitteePublicKey != receipt.CommitteePublicKey || frost.DKGRunID != receipt.FundingAbortPins.DKGRunID ||
		frost.CommitteeKeysetID != receipt.FundingAbortPins.CommitteeKeysetID ||
		frost.CommitteeKeysetVersion != receipt.FundingAbortPins.CommitteeKeysetVersion ||
		frost.PublicKeyPackageSHA256 != receipt.FundingAbortPins.PublicKeyPackageSHA256 ||
		frost.SignerRosterDigest != receipt.FundingAbortPins.SignerRosterDigest ||
		anchor.ActiveKeysetID != receipt.FundingAbortPins.ActiveKeysetID ||
		bootstrap.ActiveKeysetID != receipt.FundingAbortPins.ActiveKeysetID {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet bundle authority differs from its authenticated public inputs")
	}
	for index, descriptor := range descriptors {
		entry := anchor.Roster[index]
		if err := exactFridayValidatorPublic(descriptor); err != nil || descriptor.Validator.Slot != index+1 ||
			descriptor.DeploymentID != receipt.DeploymentID || descriptor.ChainID != receipt.ChainID ||
			descriptor.GenesisTime != receipt.GenesisTime || descriptor.DeploymentAnchorSHA256 != receipt.DeploymentAnchorSHA256 ||
			descriptor.HostID != entry.HostID || descriptor.Validator.P2PExternal != fridayCometEndpoint(entry.FIPSULA) {
			return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet signed validator roster differs from owner approval")
		}
	}
	manifest, err := LoadNetworkManifest(root)
	if err != nil {
		return receipt, NetworkManifest{}, NetworkFacts{}, err
	}
	computedFacts, err := LoadNetworkFacts(root)
	if err != nil {
		return receipt, NetworkManifest{}, NetworkFacts{}, err
	}
	var storedFacts NetworkFacts
	if err := readStrictJSON(filepath.Join(root, "network-facts.json"), &storedFacts); err != nil {
		return receipt, NetworkManifest{}, NetworkFacts{}, err
	}
	if err := validateFridayGenesisPolicy(manifest.Policy); err != nil {
		return receipt, NetworkManifest{}, NetworkFacts{}, err
	}
	if manifest.Schema != "PlebeianAuctionsPOCNetworkV4" || manifest.Mode != "remote" ||
		manifest.ApplicationAuthority != ApplicationAuthorityFrostCashu ||
		manifest.ChainID != receipt.ChainID || manifest.CreatedAt != receipt.GenesisTime || manifest.GenesisTime != receipt.GenesisTime ||
		manifest.CommitteePublicKey != receipt.CommitteePublicKey ||
		manifest.FundingAbortPins == nil || *manifest.FundingAbortPins != receipt.FundingAbortPins ||
		storedFacts != computedFacts || storedFacts.ChainID != receipt.ChainID || storedFacts.GenesisSHA256 != receipt.GenesisSHA256 ||
		storedFacts.ValidatorsHash != receipt.ValidatorsHash || storedFacts.CommitteePublicKey != receipt.CommitteePublicKey ||
		manifest.MintPublicKey != receipt.MintPublicKey ||
		manifest.R20RuntimeBindingDigest != receipt.R20RuntimeBindingDigest ||
		manifest.R20PredecessorAbortDigest != receipt.R20PredecessorAbortDigest ||
		manifest.R20RuntimeBindingSHA256 != receipt.R20RuntimeBindingSHA256 ||
		manifest.SeparatedBootstrapDigest != receipt.SeparatedBootstrapDigest || manifest.SeparatedRuntimeBindingDigest != receipt.SeparatedRuntimeBindingDigest || manifest.SeparatedRuntimeBindingSHA256 != receipt.SeparatedRuntimeBindingSHA256 ||
		((receipt.DeploymentID == fridayR20DeploymentID || receipt.DeploymentID == fridaySeparatedDeploymentID) && manifest.DeploymentID != receipt.DeploymentID) ||
		(receipt.DeploymentID == fridayR20DeploymentID && manifest.ApplicationRunID != fridayR20ApplicationRunID) ||
		(receipt.DeploymentID == fridaySeparatedDeploymentID && manifest.ApplicationRunID != fridaySeparatedApplicationRunID) {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet bundle chain, roster, or hash binding differs")
	}
	genesis, err := cmttypes.GenesisDocFromJSON(genesisRaw)
	if err != nil || len(genesis.Validators) != 4 || len(manifest.Validators) != 4 {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet genesis roster is not exactly four validators")
	}
	genesisTime, _ := canonicalFridayGenesisTime(receipt.GenesisTime)
	genesisIdentity, err := fundingAbortGenesisIdentity(genesis)
	if err != nil || genesisIdentity != receipt.GenesisSHA256 || receipt.FundingAbortPins.GenesisSHA256 != genesisIdentity {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet non-circular genesis identity differs from deployment pins")
	}
	mintPublic, err := DeriveFrostCashuLegacyNotePublicPin(receipt.FundingAbortPins)
	if err != nil || manifest.MintPublicKey != hex.EncodeToString(mintPublic) {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet FROST/Cashu disabled legacy-note pin is invalid")
	}
	empty, err := NewStateWithFrostFundingAbortPins(receipt.ChainID, mintPublic,
		receipt.CommitteePublicKey, manifest.MintURL, manifest.CashuMintURL, receipt.FundingAbortPins)
	if err != nil {
		return receipt, NetworkManifest{}, NetworkFacts{}, err
	}
	expectedAppHash, err := empty.CanonicalHash()
	if err != nil {
		return receipt, NetworkManifest{}, NetworkFacts{}, err
	}
	expectedParams := cmttypes.DefaultConsensusParams()
	expectedParams.Feature.PbtsEnableHeight = 1
	expectedParams.Feature.VoteExtensionsEnableHeight = 0
	expectedParams.Synchrony.Precision = time.Second
	expectedParams.Synchrony.MessageDelay = 10 * time.Second
	actualParamsRaw, actualParamsErr := cmtjson.Marshal(genesis.ConsensusParams)
	expectedParamsRaw, expectedParamsErr := cmtjson.Marshal(expectedParams)
	if genesis.GenesisTime != genesisTime || genesis.InitialHeight != 1 || !bytes.Equal(genesis.AppHash, expectedAppHash[:]) ||
		actualParamsErr != nil || expectedParamsErr != nil || !bytes.Equal(actualParamsRaw, expectedParamsRaw) {
		return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet genesis application or consensus parameters differ from the public manifest")
	}
	for index, validator := range manifest.Validators {
		genesisValidator := genesis.Validators[index]
		descriptor := descriptors[index]
		if validator != descriptor.Validator || genesisValidator.Name != validator.Moniker || genesisValidator.Power != 1 ||
			!bytes.Equal(genesisValidator.Address, genesisValidator.PubKey.Address()) ||
			strings.ToUpper(hex.EncodeToString(genesisValidator.Address)) != validator.ValidatorAddress ||
			hex.EncodeToString(genesisValidator.PubKey.Bytes()) != descriptor.ValidatorPublicKey {
			return receipt, NetworkManifest{}, NetworkFacts{}, errors.New("Friday Comet genesis validators differ from network manifest")
		}
	}
	return receipt, manifest, storedFacts, nil
}

// FinalizeFridayCometValidator validates that this host owns exactly the named
// slot and installs only the common public files. No private key is copied.
func FinalizeFridayCometValidator(root, bundleRoot string, slot int) (FridayCometValidatorFinalizeV1, error) {
	if slot < 1 || slot > 4 {
		return FridayCometValidatorFinalizeV1{}, errors.New("Friday Comet finalization slot must be 1..4")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return FridayCometValidatorFinalizeV1{}, err
	}
	bundleRoot, err = filepath.Abs(bundleRoot)
	if err != nil || root == bundleRoot {
		return FridayCometValidatorFinalizeV1{}, errors.New("Friday Comet local and public bundle roots must be distinct")
	}
	var local FridayCometValidatorPublicV1
	if err := readStrictJSON(filepath.Join(root, "validator-public.json"), &local); err != nil {
		return FridayCometValidatorFinalizeV1{}, err
	}
	if err := exactFridayValidatorPublic(local); err != nil {
		return FridayCometValidatorFinalizeV1{}, err
	}
	if local.Validator.Slot != slot {
		return FridayCometValidatorFinalizeV1{}, errors.New("Friday Comet finalization refused another slot's local key bundle")
	}
	private, err := validateLocalFridayCometKeys(root, local)
	if err != nil {
		return FridayCometValidatorFinalizeV1{}, err
	}
	if _, err := os.Lstat(filepath.Join(root, "validator-final-ack.json")); !errors.Is(err, os.ErrNotExist) {
		return FridayCometValidatorFinalizeV1{}, errors.New("Friday Comet validator is already finalized")
	}
	receipt, manifest, facts, err := validateFridayCometBundle(bundleRoot)
	if err != nil {
		return FridayCometValidatorFinalizeV1{}, err
	}
	var roster []FridayCometValidatorPublicV1
	rosterRaw, err := os.ReadFile(filepath.Join(bundleRoot, "validator-roster.json"))
	if err != nil || json.Unmarshal(rosterRaw, &roster) != nil || len(roster) != 4 {
		return FridayCometValidatorFinalizeV1{}, errors.New("Friday Comet common signed roster is unavailable")
	}
	if receipt.DeploymentID != local.DeploymentID || receipt.ChainID != local.ChainID || receipt.GenesisTime != local.GenesisTime ||
		receipt.ValidatorRosterVersion != local.ValidatorRosterVersion || manifest.Validators[slot-1] != local.Validator {
		return FridayCometValidatorFinalizeV1{}, errors.New("Friday Comet common bundle differs from this host's public descriptor")
	}
	if roster[slot-1] != local {
		return FridayCometValidatorFinalizeV1{}, errors.New("Friday Comet common signed roster differs from this host's exact descriptor")
	}
	receiptRaw, err := marshalJSON(receipt, false)
	if err != nil {
		return FridayCometValidatorFinalizeV1{}, err
	}
	expectedHashes := map[string]string{"genesis.json": receipt.GenesisFileSHA256,
		"network.json": receipt.NetworkManifestSHA256, "network-facts.json": receipt.NetworkFactsSHA256,
		"validator-roster.json": receipt.ValidatorRosterSHA256, "deployment-anchor.json": receipt.DeploymentAnchorSHA256,
		"frost-final-public.json":      receipt.FROSTFinalPackageSHA256,
		"funding-abort-bootstrap.json": receipt.FundingAbortBootstrapSHA256}
	fileNames := []string{"genesis.json", "network.json", "network-facts.json", "validator-roster.json",
		"deployment-anchor.json", "frost-final-public.json", "funding-abort-bootstrap.json", "comet-genesis-bundle.json"}
	if receipt.DeploymentID == fridayR20DeploymentID {
		expectedHashes["r20-runtime-binding.json"] = receipt.R20RuntimeBindingSHA256
		fileNames = append(fileNames, "r20-runtime-binding.json")
	}
	if receipt.DeploymentID == fridaySeparatedDeploymentID {
		expectedHashes["separated-runtime-binding.json"] = receipt.SeparatedRuntimeBindingSHA256
		fileNames = append(fileNames, "separated-runtime-binding.json")
	}
	for _, name := range fileNames {
		raw, err := os.ReadFile(filepath.Join(bundleRoot, name))
		if err != nil {
			return FridayCometValidatorFinalizeV1{}, err
		}
		if expected, ok := expectedHashes[name]; ok {
			if hashBytes(raw) != expected {
				return FridayCometValidatorFinalizeV1{}, errors.New("Friday Comet public bundle changed during finalization")
			}
		} else if !bytes.Equal(raw, receiptRaw) {
			return FridayCometValidatorFinalizeV1{}, errors.New("Friday Comet public bundle receipt changed during finalization")
		}
		mode := os.FileMode(0o600)
		if name == "genesis.json" || name == "comet-genesis-bundle.json" {
			mode = 0o644
		}
		if err := installFridayExact(filepath.Join(root, name), raw, mode); err != nil {
			return FridayCometValidatorFinalizeV1{}, err
		}
	}
	ack := FridayCometValidatorFinalizeV1{Schema: fridayCometFinalizeSchema, DeploymentID: local.DeploymentID,
		ChainID: local.ChainID, Slot: slot, HostID: local.HostID, NodeID: local.Validator.NodeID,
		ValidatorAddress: local.Validator.ValidatorAddress, GenesisSHA256: facts.GenesisSHA256,
		ValidatorsHash: facts.ValidatorsHash, DeploymentAnchorSHA256: receipt.DeploymentAnchorSHA256,
		BundleDigest: receipt.BundleDigest, DescriptorDigest: local.DescriptorDigest}
	message, err := fridayFinalAckSigningBytes(ack)
	if err != nil {
		return FridayCometValidatorFinalizeV1{}, err
	}
	signature, err := private.Sign(message)
	if err != nil {
		return FridayCometValidatorFinalizeV1{}, err
	}
	ack.ValidatorSignature = hex.EncodeToString(signature)
	if err := exactFridayFinalAck(ack, local, receipt); err != nil {
		return FridayCometValidatorFinalizeV1{}, err
	}
	ackRaw, err := marshalJSON(ack, false)
	if err != nil {
		return FridayCometValidatorFinalizeV1{}, err
	}
	if err := writeExclusive(filepath.Join(root, "validator-final-ack.json"), ackRaw, 0o644); err != nil {
		return FridayCometValidatorFinalizeV1{}, err
	}
	return ack, nil
}

func installFridayExact(path string, raw []byte, mode os.FileMode) error {
	err := writeExclusive(path, raw, mode)
	if err == nil {
		return nil
	}
	if !errors.Is(err, os.ErrExist) {
		return err
	}
	existing, readErr := os.ReadFile(path)
	if readErr != nil || !bytes.Equal(existing, raw) {
		return errors.New("Friday Comet partial finalization contains a conflicting file")
	}
	return nil
}

func fridayFinalAckSigningBytes(value FridayCometValidatorFinalizeV1) ([]byte, error) {
	value.ValidatorSignature = ""
	return fridayDomainJSON(fridayCometFinalAckDomain, value)
}

func exactFridayFinalAck(value FridayCometValidatorFinalizeV1, descriptor FridayCometValidatorPublicV1, receipt FridayCometGenesisBundleV1) error {
	if value.Schema != fridayCometFinalizeSchema || value.DeploymentID != receipt.DeploymentID ||
		value.ChainID != receipt.ChainID || value.Slot != descriptor.Validator.Slot || value.HostID != descriptor.HostID ||
		value.NodeID != descriptor.Validator.NodeID || value.ValidatorAddress != descriptor.Validator.ValidatorAddress ||
		value.GenesisSHA256 != receipt.GenesisSHA256 || value.ValidatorsHash != receipt.ValidatorsHash ||
		value.DeploymentAnchorSHA256 != receipt.DeploymentAnchorSHA256 || value.BundleDigest != receipt.BundleDigest ||
		value.DescriptorDigest != descriptor.DescriptorDigest || !validLowerHex(value.ValidatorSignature, ed25519.SignatureSize) {
		return errors.New("Friday Comet final acknowledgement differs from the exact validator or bundle")
	}
	message, err := fridayFinalAckSigningBytes(value)
	if err != nil {
		return err
	}
	publicRaw, _ := hex.DecodeString(descriptor.ValidatorPublicKey)
	signatureRaw, _ := hex.DecodeString(value.ValidatorSignature)
	if !ed25519.Verify(ed25519.PublicKey(publicRaw), message, signatureRaw) {
		return errors.New("Friday Comet final acknowledgement signature is invalid")
	}
	return nil
}

// SealFridayCometLaunch writes a public launch seal only after validating one
// exact final acknowledgement from every owner-approved validator slot.
func SealFridayCometLaunch(bundleRoot string, ackPaths []string) (FridayCometLaunchSealV1, error) {
	if len(ackPaths) != 4 {
		return FridayCometLaunchSealV1{}, errors.New("Friday Comet launch requires exactly four final acknowledgement files")
	}
	receipt, _, _, err := validateFridayCometBundle(bundleRoot)
	if err != nil {
		return FridayCometLaunchSealV1{}, err
	}
	var roster []FridayCometValidatorPublicV1
	raw, err := os.ReadFile(filepath.Join(bundleRoot, "validator-roster.json"))
	if err != nil || json.Unmarshal(raw, &roster) != nil || len(roster) != 4 {
		return FridayCometLaunchSealV1{}, errors.New("Friday Comet signed validator roster is unavailable")
	}
	acks := make([]FridayCometValidatorFinalizeV1, 0, 4)
	for _, path := range ackPaths {
		var ack FridayCometValidatorFinalizeV1
		if err := readStrictJSON(path, &ack); err != nil {
			return FridayCometLaunchSealV1{}, err
		}
		acks = append(acks, ack)
	}
	sort.Slice(acks, func(i, j int) bool { return acks[i].Slot < acks[j].Slot })
	for index, ack := range acks {
		if ack.Slot != index+1 {
			return FridayCometLaunchSealV1{}, errors.New("Friday Comet launch acknowledgements have a missing or duplicate slot")
		}
		if err := exactFridayFinalAck(ack, roster[index], receipt); err != nil {
			return FridayCometLaunchSealV1{}, err
		}
	}
	seal := FridayCometLaunchSealV1{Schema: fridayCometLaunchSealSchema, DeploymentID: receipt.DeploymentID,
		ChainID: receipt.ChainID, DeploymentAnchorSHA256: receipt.DeploymentAnchorSHA256,
		BundleDigest: receipt.BundleDigest, Acknowledgements: acks}
	sealRaw, err := marshalJSON(seal, false)
	if err != nil {
		return FridayCometLaunchSealV1{}, err
	}
	if err := writeExclusive(filepath.Join(bundleRoot, "comet-launch.json"), sealRaw, 0o644); err != nil {
		return FridayCometLaunchSealV1{}, err
	}
	return seal, nil
}

func validateFridayCometLaunch(root string) (FridayCometLaunchSealV1, error) {
	receipt, _, _, err := validateFridayCometBundle(root)
	if err != nil {
		return FridayCometLaunchSealV1{}, err
	}
	var roster []FridayCometValidatorPublicV1
	raw, err := os.ReadFile(filepath.Join(root, "validator-roster.json"))
	if err != nil || json.Unmarshal(raw, &roster) != nil || len(roster) != 4 {
		return FridayCometLaunchSealV1{}, errors.New("Friday Comet signed validator roster is unavailable")
	}
	var seal FridayCometLaunchSealV1
	if err := readStrictJSON(filepath.Join(root, "comet-launch.json"), &seal); err != nil {
		return seal, err
	}
	if seal.Schema != fridayCometLaunchSealSchema || seal.DeploymentID != receipt.DeploymentID ||
		seal.ChainID != receipt.ChainID || seal.DeploymentAnchorSHA256 != receipt.DeploymentAnchorSHA256 ||
		seal.BundleDigest != receipt.BundleDigest || len(seal.Acknowledgements) != 4 {
		return seal, errors.New("Friday Comet launch seal differs from the exact public bundle")
	}
	for index, ack := range seal.Acknowledgements {
		if ack.Slot != index+1 {
			return seal, errors.New("Friday Comet launch seal acknowledgement order is invalid")
		}
		if err := exactFridayFinalAck(ack, roster[index], receipt); err != nil {
			return seal, err
		}
	}
	return seal, nil
}

// InstallFridayCometLaunch installs only a verified four-validator launch seal
// and requires this host's locally produced acknowledgement to be included.
func InstallFridayCometLaunch(root, bundleRoot string, slot int) (FridayCometLaunchSealV1, error) {
	if slot < 1 || slot > 4 {
		return FridayCometLaunchSealV1{}, errors.New("Friday Comet launch installation slot must be 1..4")
	}
	bundleSeal, err := validateFridayCometLaunch(bundleRoot)
	if err != nil {
		return FridayCometLaunchSealV1{}, err
	}
	localReceipt, _, _, err := validateFridayCometBundle(root)
	if err != nil || localReceipt.BundleDigest != bundleSeal.BundleDigest {
		return FridayCometLaunchSealV1{}, errors.New("Friday Comet local public bundle differs from the launch seal")
	}
	var localAck FridayCometValidatorFinalizeV1
	if err := readStrictJSON(filepath.Join(root, "validator-final-ack.json"), &localAck); err != nil {
		return FridayCometLaunchSealV1{}, err
	}
	if localAck != bundleSeal.Acknowledgements[slot-1] {
		return FridayCometLaunchSealV1{}, errors.New("Friday Comet launch seal does not contain this host's exact final acknowledgement")
	}
	raw, err := os.ReadFile(filepath.Join(bundleRoot, "comet-launch.json"))
	if err != nil {
		return FridayCometLaunchSealV1{}, err
	}
	if err := writeExclusive(filepath.Join(root, "comet-launch.json"), raw, 0o644); err != nil {
		return FridayCometLaunchSealV1{}, err
	}
	return bundleSeal, nil
}

// RequireFridayCometLaunch is the seed-free RunValidatorNode startup gate.
// RunValidatorNode calls this before loading private keys, constructing the
// application, or opening any listener. The CLI also calls it as an early
// diagnostic, but the runtime boundary is authoritative.
func RequireFridayCometLaunch(root string, slot int) error {
	if slot < 1 || slot > 4 {
		return errors.New("Friday Comet launch slot must be 1..4")
	}
	seal, err := validateFridayCometLaunch(root)
	if err != nil {
		return err
	}
	var local FridayCometValidatorPublicV1
	if err := readStrictJSON(filepath.Join(root, "validator-public.json"), &local); err != nil {
		return err
	}
	if err := exactFridayValidatorPublic(local); err != nil {
		return err
	}
	var roster []FridayCometValidatorPublicV1
	rosterRaw, err := os.ReadFile(filepath.Join(root, "validator-roster.json"))
	if err != nil || json.Unmarshal(rosterRaw, &roster) != nil || len(roster) != 4 {
		return errors.New("Friday Comet local signed validator roster is unavailable")
	}
	var localAck FridayCometValidatorFinalizeV1
	if err := readStrictJSON(filepath.Join(root, "validator-final-ack.json"), &localAck); err != nil {
		return err
	}
	if local.Validator.Slot != slot || roster[slot-1] != local || localAck != seal.Acknowledgements[slot-1] {
		return errors.New("Friday Comet launch seal does not authorize this local validator slot")
	}
	return nil
}
