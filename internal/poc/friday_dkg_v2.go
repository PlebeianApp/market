package poc

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

const (
	fridayAuthenticatedDKGResultV2Schema = "PLEBEIAN_FRIDAY_AUTHENTICATED_DKG_RESULT_V2"
	fridayDKGManifestV1Schema            = "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1"
	fridayDKGEnrollmentV1Schema          = "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ENROLLMENT_V1"
	fridayDKGFinalAttestationV2Schema    = "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_FINAL_ATTESTATION_V2"
	fridayDKGRoot                        = "/var/lib/plebeian-auctions-friday/frost/keyset-v1"
	fridayDKGPairwisePurpose             = "COCO_DEMO_FROST_DKG_ROUND2_PAIRWISE_KEY_V1"
)

var (
	fridayDKGIdentifierPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	fridayDKGHostPattern       = regexp.MustCompile(`^linode-[1-9][0-9]{5,11}$`)
	fridayDKGNpubPattern       = regexp.MustCompile(`^npub1[023456789acdefghjklmnpqrstuvwxyz]{58}$`)
)

type FridayDKGManifestParticipantV1 struct {
	ParticipantID           int    `json:"participantId"`
	HostID                  string `json:"hostId"`
	UnderlayIPv4            string `json:"underlayIpv4"`
	FIPSNpub                string `json:"fipsNpub"`
	FIPSULA                 string `json:"fipsUla"`
	DKGIdentity             string `json:"dkgIdentity"`
	SignerIdentity          string `json:"signerIdentity"`
	KEXPublicKey            string `json:"kexPublicKey"`
	SignerEndpoint          string `json:"signerEndpoint"`
	ParticipantBinarySHA256 string `json:"participantBinarySha256"`
	InspectorBinarySHA256   string `json:"inspectorBinarySha256"`
	ConfigPath              string `json:"configPath"`
	StateDirectory          string `json:"stateDirectory"`
}

type FridayDKGManifestV1 struct {
	Schema                   string                           `json:"schema"`
	ValueProfile             string                           `json:"valueProfile"`
	DeploymentID             string                           `json:"deploymentId"`
	ApplicationRunID         string                           `json:"applicationRunId"`
	DKGRunID                 string                           `json:"dkgRunId"`
	CommitteeKeysetID        string                           `json:"committeeKeysetId"`
	CommitteeKeysetVersion   string                           `json:"committeeKeysetVersion"`
	Roster                   []int                            `json:"roster"`
	RosterDigest             string                           `json:"rosterDigest"`
	CoordinatorParticipantID int                              `json:"coordinatorParticipantId"`
	CoordinatorIdentity      string                           `json:"coordinatorIdentity"`
	Participants             []FridayDKGManifestParticipantV1 `json:"participants"`
}

type FridayDKGEnrollmentV1 struct {
	Schema         string `json:"schema"`
	ManifestDigest string `json:"manifestDigest"`
	RosterDigest   string `json:"rosterDigest"`
	ParticipantID  int    `json:"participantId"`
	DKGIdentity    string `json:"dkgIdentity"`
	Signature      string `json:"signature"`
}

type FridayDKGFinalAttestationV2 struct {
	Schema                  string `json:"schema"`
	ManifestDigest          string `json:"manifestDigest"`
	RosterDigest            string `json:"rosterDigest"`
	Round1TranscriptDigest  string `json:"round1TranscriptDigest"`
	ParticipantID           int    `json:"participantId"`
	DKGIdentity             string `json:"dkgIdentity"`
	SignerIdentity          string `json:"signerIdentity"`
	SignerEndpoint          string `json:"signerEndpoint"`
	ParticipantBinarySHA256 string `json:"participantBinarySha256"`
	InspectorBinarySHA256   string `json:"inspectorBinarySha256"`
	PackageBytesSHA256      string `json:"packageBytesSha256"`
	InspectionPackageSHA256 string `json:"inspectionPackageSha256"`
	CommitteePublicKey      string `json:"committeePublicKey"`
	VerifyingSharesDigest   string `json:"verifyingSharesDigest"`
	PublicSummaryDigest     string `json:"publicSummaryDigest"`
	Signature               string `json:"signature"`
}

type FridayAuthenticatedDKGParticipantV2 struct {
	FridayDKGManifestParticipantV1
	VerifyingShare string `json:"verifyingShare"`
}

// MarshalJSON preserves the exact flat TypeScript result shape instead of
// nesting the embedded manifest participant.
func (value FridayAuthenticatedDKGParticipantV2) MarshalJSON() ([]byte, error) {
	type flat struct {
		ParticipantID           int    `json:"participantId"`
		HostID                  string `json:"hostId"`
		UnderlayIPv4            string `json:"underlayIpv4"`
		FIPSNpub                string `json:"fipsNpub"`
		FIPSULA                 string `json:"fipsUla"`
		DKGIdentity             string `json:"dkgIdentity"`
		SignerIdentity          string `json:"signerIdentity"`
		KEXPublicKey            string `json:"kexPublicKey"`
		SignerEndpoint          string `json:"signerEndpoint"`
		ParticipantBinarySHA256 string `json:"participantBinarySha256"`
		InspectorBinarySHA256   string `json:"inspectorBinarySha256"`
		ConfigPath              string `json:"configPath"`
		StateDirectory          string `json:"stateDirectory"`
		VerifyingShare          string `json:"verifyingShare"`
	}
	participant := value.FridayDKGManifestParticipantV1
	return json.Marshal(flat{participant.ParticipantID, participant.HostID, participant.UnderlayIPv4,
		participant.FIPSNpub, participant.FIPSULA, participant.DKGIdentity, participant.SignerIdentity,
		participant.KEXPublicKey, participant.SignerEndpoint, participant.ParticipantBinarySHA256,
		participant.InspectorBinarySHA256, participant.ConfigPath, participant.StateDirectory, value.VerifyingShare})
}

func (value *FridayAuthenticatedDKGParticipantV2) UnmarshalJSON(raw []byte) error {
	type flat struct {
		ParticipantID           int    `json:"participantId"`
		HostID                  string `json:"hostId"`
		UnderlayIPv4            string `json:"underlayIpv4"`
		FIPSNpub                string `json:"fipsNpub"`
		FIPSULA                 string `json:"fipsUla"`
		DKGIdentity             string `json:"dkgIdentity"`
		SignerIdentity          string `json:"signerIdentity"`
		KEXPublicKey            string `json:"kexPublicKey"`
		SignerEndpoint          string `json:"signerEndpoint"`
		ParticipantBinarySHA256 string `json:"participantBinarySha256"`
		InspectorBinarySHA256   string `json:"inspectorBinarySha256"`
		ConfigPath              string `json:"configPath"`
		StateDirectory          string `json:"stateDirectory"`
		VerifyingShare          string `json:"verifyingShare"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	var decoded flat
	if err := decoder.Decode(&decoded); err != nil {
		return err
	}
	if err := requireEOF(decoder); err != nil {
		return err
	}
	value.FridayDKGManifestParticipantV1 = FridayDKGManifestParticipantV1{
		ParticipantID: decoded.ParticipantID, HostID: decoded.HostID, UnderlayIPv4: decoded.UnderlayIPv4,
		FIPSNpub: decoded.FIPSNpub, FIPSULA: decoded.FIPSULA, DKGIdentity: decoded.DKGIdentity,
		SignerIdentity: decoded.SignerIdentity, KEXPublicKey: decoded.KEXPublicKey,
		SignerEndpoint: decoded.SignerEndpoint, ParticipantBinarySHA256: decoded.ParticipantBinarySHA256,
		InspectorBinarySHA256: decoded.InspectorBinarySHA256, ConfigPath: decoded.ConfigPath,
		StateDirectory: decoded.StateDirectory,
	}
	value.VerifyingShare = decoded.VerifyingShare
	return nil
}

type FridayAuthenticatedDKGResultV2 struct {
	Schema                           string                                `json:"schema"`
	Manifest                         FridayDKGManifestV1                   `json:"manifest"`
	ManifestDigest                   string                                `json:"manifestDigest"`
	RosterDigest                     string                                `json:"rosterDigest"`
	Round1TranscriptDigest           string                                `json:"round1TranscriptDigest"`
	PublicSummaryDigest              string                                `json:"publicSummaryDigest"`
	Enrollments                      []FridayDKGEnrollmentV1               `json:"enrollments"`
	FinalAttestations                []FridayDKGFinalAttestationV2         `json:"finalAttestations"`
	RunID                            string                                `json:"runId"`
	DKGRunID                         string                                `json:"dkgRunId"`
	CommitteeKeysetID                string                                `json:"committeeKeysetId"`
	CommitteeKeysetVersion           string                                `json:"committeeKeysetVersion"`
	PublicKeyPackagePath             string                                `json:"publicKeyPackagePath"`
	PublicKeyPackageHex              string                                `json:"publicKeyPackageHex"`
	PublicKeyPackageSHA256           string                                `json:"publicKeyPackageSha256"`
	InspectionPublicKeyPackageSHA256 string                                `json:"inspectionPublicKeyPackageSha256"`
	SignerRosterDigest               string                                `json:"signerRosterDigest"`
	CommitteePublicKey               string                                `json:"committeePublicKey"`
	CoordinatorIdentity              string                                `json:"coordinatorIdentity"`
	Participants                     []FridayAuthenticatedDKGParticipantV2 `json:"participants"`
}

type fridayDKGVerifyingShare struct {
	ParticipantID     int    `json:"participant_id"`
	VerifyingShareHex string `json:"verifying_share_hex"`
}

func fridayDKGDigest(domain string, fields ...any) (string, error) {
	framed := make([]any, 0, len(fields)+1)
	framed = append(framed, domain)
	framed = append(framed, fields...)
	raw, err := json.Marshal(framed)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:]), nil
}

func fridayDKGParticipantFields(value FridayDKGManifestParticipantV1) []any {
	return []any{value.ParticipantID, value.HostID, value.UnderlayIPv4, value.FIPSNpub, value.FIPSULA,
		value.DKGIdentity, value.SignerIdentity, value.KEXPublicKey, value.SignerEndpoint,
		value.ParticipantBinarySHA256, value.InspectorBinarySHA256, value.ConfigPath, value.StateDirectory}
}

func validateFridayDKGManifestParticipantForRoot(value FridayDKGManifestParticipantV1, expectedID int, expectedRoot string) error {
	underlay := net.ParseIP(value.UnderlayIPv4)
	ula := net.ParseIP(value.FIPSULA)
	expectedEndpoint := "http://" + net.JoinHostPort(value.FIPSULA, "39101") + "/v1/frost"
	if value.ParticipantID != expectedID || !fridayDKGHostPattern.MatchString(value.HostID) ||
		underlay == nil || underlay.To4() == nil || underlay.String() != value.UnderlayIPv4 ||
		!fridayDKGNpubPattern.MatchString(value.FIPSNpub) || ula == nil || ula.To4() != nil ||
		(value.FIPSULA[:2] != "fc" && value.FIPSULA[:2] != "fd") || ula.String() != value.FIPSULA ||
		!validLowerHex(value.DKGIdentity, 32) || !validLowerHex(value.SignerIdentity, 32) ||
		!validLowerHex(value.KEXPublicKey, 32) || strings.Trim(value.KEXPublicKey, "0") == "" ||
		value.SignerEndpoint != expectedEndpoint || !validLowerHex(value.ParticipantBinarySHA256, sha256.Size) ||
		!validLowerHex(value.InspectorBinarySHA256, sha256.Size) ||
		value.ConfigPath != expectedRoot+"/participant.config.json" || value.StateDirectory != expectedRoot+"/state" {
		return errors.New("Friday authenticated DKG manifest participant is invalid")
	}
	return nil
}

func validateFridayDKGManifestParticipant(value FridayDKGManifestParticipantV1, expectedID int) error {
	return validateFridayDKGManifestParticipantForRoot(value, expectedID, fridayDKGRoot)
}

func fridayDKGRosterDigestForRoot(participants []FridayDKGManifestParticipantV1, expectedRoot string) (string, error) {
	if len(participants) != 4 {
		return "", errors.New("Friday authenticated DKG roster must contain four participants")
	}
	fields := make([]any, 0, 4)
	for index, participant := range participants {
		if err := validateFridayDKGManifestParticipantForRoot(participant, index+1, expectedRoot); err != nil {
			return "", err
		}
		fields = append(fields, fridayDKGParticipantFields(participant))
	}
	return fridayDKGDigest("PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ROSTER_V1", fields...)
}

func fridayDKGRosterDigest(participants []FridayDKGManifestParticipantV1) (string, error) {
	return fridayDKGRosterDigestForRoot(participants, fridayDKGRoot)
}

func validateFridayDKGManifestForRoot(value FridayDKGManifestV1, expectedRoot string) (string, error) {
	if value.Schema != fridayDKGManifestV1Schema || value.ValueProfile != "FAKE_MONEY_ONLY" ||
		!fridayDKGIdentifierPattern.MatchString(value.DeploymentID) ||
		!fridayDKGIdentifierPattern.MatchString(value.ApplicationRunID) ||
		!fridayDKGIdentifierPattern.MatchString(value.DKGRunID) ||
		!fridayDKGIdentifierPattern.MatchString(value.CommitteeKeysetID) ||
		!fridayDKGIdentifierPattern.MatchString(value.CommitteeKeysetVersion) ||
		len(value.Roster) != 4 || value.CoordinatorParticipantID != 1 ||
		!validLowerHex(value.CoordinatorIdentity, 32) || len(value.Participants) != 4 {
		return "", errors.New("Friday authenticated DKG manifest is malformed")
	}
	seen := map[string]bool{value.CoordinatorIdentity: true}
	for index, rosterID := range value.Roster {
		if rosterID != index+1 {
			return "", errors.New("Friday authenticated DKG manifest roster is not ordered 1..4")
		}
	}
	for index, participant := range value.Participants {
		if err := validateFridayDKGManifestParticipantForRoot(participant, index+1, expectedRoot); err != nil {
			return "", err
		}
		for _, identity := range []string{participant.DKGIdentity, participant.SignerIdentity} {
			if seen[identity] {
				return "", errors.New("Friday authenticated DKG manifest has duplicate Schnorr identities")
			}
			seen[identity] = true
		}
	}
	for _, field := range []func(FridayDKGManifestParticipantV1) string{
		func(value FridayDKGManifestParticipantV1) string { return value.HostID },
		func(value FridayDKGManifestParticipantV1) string { return value.UnderlayIPv4 },
		func(value FridayDKGManifestParticipantV1) string { return value.FIPSNpub },
		func(value FridayDKGManifestParticipantV1) string { return value.FIPSULA },
		func(value FridayDKGManifestParticipantV1) string { return value.KEXPublicKey },
	} {
		values := map[string]bool{}
		for _, participant := range value.Participants {
			current := field(participant)
			if values[current] {
				return "", errors.New("Friday authenticated DKG manifest roster contains duplicate host authority")
			}
			values[current] = true
		}
	}
	rosterDigest, err := fridayDKGRosterDigestForRoot(value.Participants, expectedRoot)
	if err != nil || rosterDigest != value.RosterDigest {
		return "", errors.New("Friday authenticated DKG manifest roster digest is invalid")
	}
	participantFields := make([]any, 0, 4)
	for _, participant := range value.Participants {
		participantFields = append(participantFields, fridayDKGParticipantFields(participant))
	}
	return fridayDKGDigest("PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1", value.Schema, value.ValueProfile,
		value.DeploymentID, value.ApplicationRunID, value.DKGRunID, value.CommitteeKeysetID,
		value.CommitteeKeysetVersion, value.Roster, value.RosterDigest, value.CoordinatorParticipantID,
		value.CoordinatorIdentity, participantFields)
}

func validateFridayDKGManifest(value FridayDKGManifestV1) (string, error) {
	return validateFridayDKGManifestForRoot(value, fridayDKGRoot)
}

func fridayDKGEnrollmentDigest(manifest FridayDKGManifestV1, manifestDigest string, participantID int) (string, error) {
	participant := manifest.Participants[participantID-1]
	return fridayDKGDigest("PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ENROLLMENT_V1", manifest.Schema,
		manifest.DKGRunID, manifest.CommitteeKeysetID, manifest.CommitteeKeysetVersion, manifest.RosterDigest,
		manifestDigest, participantID, participant.DKGIdentity, participant.KEXPublicKey, fridayDKGPairwisePurpose)
}

func verifyFridaySchnorr(publicHex, digestHex, signatureHex string) error {
	if !validLowerHex(publicHex, 32) || !validLowerHex(digestHex, sha256.Size) || !validLowerHex(signatureHex, 64) {
		return errors.New("Friday authenticated DKG Schnorr material is malformed")
	}
	publicRaw, _ := hex.DecodeString(publicHex)
	digestRaw, _ := hex.DecodeString(digestHex)
	signatureRaw, _ := hex.DecodeString(signatureHex)
	public, err := schnorr.ParsePubKey(publicRaw)
	if err != nil {
		return err
	}
	signature, err := schnorr.ParseSignature(signatureRaw)
	if err != nil || !signature.Verify(digestRaw, public) {
		return errors.New("Friday authenticated DKG Schnorr signature is invalid")
	}
	return nil
}

func verifyFridayDKGEnrollments(manifest FridayDKGManifestV1, manifestDigest string, values []FridayDKGEnrollmentV1) error {
	if len(values) != 4 {
		return errors.New("Friday authenticated DKG result requires four enrollments")
	}
	for index, value := range values {
		participant := manifest.Participants[index]
		digest, err := fridayDKGEnrollmentDigest(manifest, manifestDigest, index+1)
		if err != nil || value.Schema != fridayDKGEnrollmentV1Schema || value.ManifestDigest != manifestDigest ||
			value.RosterDigest != manifest.RosterDigest || value.ParticipantID != index+1 ||
			value.DKGIdentity != participant.DKGIdentity || verifyFridaySchnorr(participant.DKGIdentity, digest, value.Signature) != nil {
			return errors.New("Friday authenticated DKG enrollment signature is invalid")
		}
	}
	return nil
}

func fridayDKGVerifyingSharesDigest(shares []fridayDKGVerifyingShare) (string, error) {
	fields := make([]any, 0, len(shares))
	for _, share := range shares {
		fields = append(fields, []any{share.ParticipantID, share.VerifyingShareHex})
	}
	return fridayDKGDigest("PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_VERIFYING_SHARES_V2", fields...)
}

func fridayDKGPublicSummaryDigest(result FridayAuthenticatedDKGResultV2, manifestDigest string, shares []fridayDKGVerifyingShare) (string, error) {
	participantFields := make([]any, 0, 4)
	for _, participant := range result.Manifest.Participants {
		participantFields = append(participantFields, fridayDKGParticipantFields(participant))
	}
	shareFields := make([]any, 0, 4)
	for _, share := range shares {
		shareFields = append(shareFields, []any{share.ParticipantID, share.VerifyingShareHex})
	}
	return fridayDKGDigest("PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_FINAL_SUMMARY_V2", manifestDigest,
		result.Manifest.RosterDigest, result.Manifest.DKGRunID, result.Manifest.CommitteeKeysetID,
		result.Manifest.CommitteeKeysetVersion, result.Round1TranscriptDigest, result.PublicKeyPackageHex,
		result.PublicKeyPackageSHA256, result.InspectionPublicKeyPackageSHA256, result.CommitteePublicKey,
		3, 4, shareFields, participantFields)
}

func fridayDKGSignerRosterDigest(result FridayAuthenticatedDKGResultV2, shares []fridayDKGVerifyingShare) (string, error) {
	return fridayDKGDigest("COCO_DEMO_FROST_SIGNER_ROSTER_V1", result.DKGRunID, result.CommitteeKeysetID,
		result.CommitteeKeysetVersion, result.PublicKeyPackageSHA256, result.CommitteePublicKey, 3, 4, shares)
}

func fridayDKGFinalAttestationDigest(value FridayDKGFinalAttestationV2) (string, error) {
	return fridayDKGDigest("PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_FINAL_ATTESTATION_V2", value.Schema,
		value.ManifestDigest, value.RosterDigest, value.Round1TranscriptDigest, value.ParticipantID,
		value.DKGIdentity, value.SignerIdentity, value.SignerEndpoint, value.ParticipantBinarySHA256,
		value.InspectorBinarySHA256, value.PackageBytesSHA256, value.InspectionPackageSHA256,
		value.CommitteePublicKey, value.VerifyingSharesDigest, value.PublicSummaryDigest)
}

func verifyFridayAuthenticatedDKGResultV2ForRoot(expectedManifestDigest, expectedRoot string, result FridayAuthenticatedDKGResultV2) error {
	if !validLowerHex(expectedManifestDigest, sha256.Size) || result.Schema != fridayAuthenticatedDKGResultV2Schema ||
		result.ManifestDigest != expectedManifestDigest {
		return errors.New("Friday authenticated DKG result schema or external manifest binding differs")
	}
	manifestDigest, err := validateFridayDKGManifestForRoot(result.Manifest, expectedRoot)
	if err != nil || manifestDigest != expectedManifestDigest {
		return errors.New("Friday authenticated DKG manifest differs from the external digest")
	}
	if err := verifyFridayDKGEnrollments(result.Manifest, manifestDigest, result.Enrollments); err != nil {
		return err
	}
	if result.RosterDigest != result.Manifest.RosterDigest || !validLowerHex(result.Round1TranscriptDigest, sha256.Size) ||
		!validLowerHex(result.PublicSummaryDigest, sha256.Size) || result.RunID != result.Manifest.ApplicationRunID ||
		result.DKGRunID != result.Manifest.DKGRunID || result.CommitteeKeysetID != result.Manifest.CommitteeKeysetID ||
		result.CommitteeKeysetVersion != result.Manifest.CommitteeKeysetVersion || len(result.PublicKeyPackageHex) == 0 ||
		len(result.PublicKeyPackageHex) > 131072 || len(result.PublicKeyPackageHex)%2 != 0 ||
		!validLowerHex(result.PublicKeyPackageHex, len(result.PublicKeyPackageHex)/2) ||
		!validLowerHex(result.PublicKeyPackageSHA256, sha256.Size) ||
		result.InspectionPublicKeyPackageSHA256 != result.PublicKeyPackageSHA256 ||
		!validCompressedPublicKey(result.CommitteePublicKey) || len(result.Participants) != 4 ||
		len(result.FinalAttestations) != 4 || result.CoordinatorIdentity != result.Manifest.CoordinatorIdentity ||
		result.PublicKeyPackagePath != filepath.Join(expectedRoot, "exchange", result.DKGRunID, "participant-1.public.json") {
		return errors.New("Friday authenticated DKG result public binding is invalid")
	}
	packageRaw, _ := hex.DecodeString(result.PublicKeyPackageHex)
	packageDigest := sha256.Sum256(packageRaw)
	if hex.EncodeToString(packageDigest[:]) != result.PublicKeyPackageSHA256 {
		return errors.New("Friday authenticated DKG package bytes differ from their inspection hash")
	}
	shares := make([]fridayDKGVerifyingShare, 0, 4)
	seenShares := map[string]bool{}
	for index, participant := range result.Participants {
		manifestParticipant := result.Manifest.Participants[index]
		if participant.FridayDKGManifestParticipantV1 != manifestParticipant ||
			!validCompressedPublicKey(participant.VerifyingShare) || seenShares[participant.VerifyingShare] {
			return errors.New("Friday authenticated DKG result participant differs from the pinned manifest")
		}
		seenShares[participant.VerifyingShare] = true
		shares = append(shares, fridayDKGVerifyingShare{ParticipantID: index + 1, VerifyingShareHex: participant.VerifyingShare})
	}
	sharesDigest, err := fridayDKGVerifyingSharesDigest(shares)
	if err != nil {
		return err
	}
	summaryDigest, err := fridayDKGPublicSummaryDigest(result, manifestDigest, shares)
	if err != nil || summaryDigest != result.PublicSummaryDigest {
		return errors.New("Friday authenticated DKG public summary digest is invalid")
	}
	signerRosterDigest, err := fridayDKGSignerRosterDigest(result, shares)
	if err != nil || signerRosterDigest != result.SignerRosterDigest {
		return errors.New("Friday authenticated DKG signer roster digest is invalid")
	}
	for index, attestation := range result.FinalAttestations {
		participant := result.Manifest.Participants[index]
		if attestation.Schema != fridayDKGFinalAttestationV2Schema || attestation.ManifestDigest != manifestDigest ||
			attestation.RosterDigest != result.Manifest.RosterDigest ||
			attestation.Round1TranscriptDigest != result.Round1TranscriptDigest || attestation.ParticipantID != index+1 ||
			attestation.DKGIdentity != participant.DKGIdentity || attestation.SignerIdentity != participant.SignerIdentity ||
			attestation.SignerEndpoint != participant.SignerEndpoint ||
			attestation.ParticipantBinarySHA256 != participant.ParticipantBinarySHA256 ||
			attestation.InspectorBinarySHA256 != participant.InspectorBinarySHA256 ||
			attestation.PackageBytesSHA256 != result.PublicKeyPackageSHA256 ||
			attestation.InspectionPackageSHA256 != result.InspectionPublicKeyPackageSHA256 ||
			attestation.CommitteePublicKey != result.CommitteePublicKey ||
			attestation.VerifyingSharesDigest != sharesDigest || attestation.PublicSummaryDigest != summaryDigest {
			return errors.New("Friday authenticated DKG final attestation differs from the canonical public result")
		}
		digest, err := fridayDKGFinalAttestationDigest(attestation)
		if err != nil || verifyFridaySchnorr(participant.DKGIdentity, digest, attestation.Signature) != nil {
			return errors.New("Friday authenticated DKG final attestation signature is invalid")
		}
	}
	return nil
}

func verifyFridayAuthenticatedDKGResultV2(expectedManifestDigest string, result FridayAuthenticatedDKGResultV2) error {
	return verifyFridayAuthenticatedDKGResultV2ForRoot(expectedManifestDigest, fridayDKGRoot, result)
}
