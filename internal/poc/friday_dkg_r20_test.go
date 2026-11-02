package poc

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteFridayR20RuntimeBindingGolden(t *testing.T) {
	path := os.Getenv("UPDATE_FRIDAY_R20_GOLDEN")
	if path == "" {
		t.Skip("set UPDATE_FRIDAY_R20_GOLDEN to refresh the public cross-language fixture")
	}
	value := literalFridayR20Binding(t)
	predecessor := value.Result.Manifest
	predecessor.Participants = append([]FridayDKGManifestParticipantV1(nil), value.Result.Manifest.Participants...)
	predecessor.DeploymentID = "friday-demo-r18"
	predecessor.ApplicationRunID = "friday-demo-r18-run1"
	predecessor.DKGRunID = "friday-demo-r18-dkg1"
	predecessor.CommitteeKeysetID = "friday-demo-frost-keyset-v1"
	predecessor.CommitteeKeysetVersion = "1"
	predecessor.CoordinatorIdentity = literalSchnorrIdentity(70)
	for index := range predecessor.Participants {
		predecessor.Participants[index].DKGIdentity = literalSchnorrIdentity(byte(71 + index))
		predecessor.Participants[index].SignerIdentity = literalSchnorrIdentity(byte(81 + index))
		predecessor.Participants[index].KEXPublicKey = strings.Repeat(hex.EncodeToString([]byte{byte(91 + index)}), 32)
		predecessor.Participants[index].ConfigPath = fridayDKGRoot + "/participant.config.json"
		predecessor.Participants[index].StateDirectory = fridayDKGRoot + "/state"
	}
	var err error
	predecessor.RosterDigest, err = fridayDKGRosterDigestForRoot(predecessor.Participants, fridayDKGRoot)
	if err != nil {
		t.Fatal(err)
	}
	value.PredecessorManifestDigest, err = validateFridayDKGManifestForRoot(predecessor, fridayDKGRoot)
	if err != nil {
		t.Fatal(err)
	}
	value.BindingDigest, err = fridayR20RuntimeBindingDigest(value)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.MarshalIndent(struct {
		PredecessorManifest FridayDKGManifestV1            `json:"predecessorManifest"`
		Binding            FridayR20RuntimeDKGBindingV1 `json:"binding"`
	}{PredecessorManifest: predecessor, Binding: value}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
}

func literalFridayR20Result(t *testing.T) FridayAuthenticatedDKGResultV2 {
	t.Helper()
	fixture := literalFridayAuthority(t, t.TempDir())
	result := fixture.frost
	result.Manifest.DeploymentID = fridayR20DeploymentID
	result.Manifest.ApplicationRunID = fridayR20ApplicationRunID
	result.Manifest.DKGRunID = fridayR20DKGRunID
	result.Manifest.CommitteeKeysetID = fridayR20KeysetID
	result.Manifest.CommitteeKeysetVersion = fridayR20KeysetVersion
	for index := range result.Manifest.Participants {
		result.Manifest.Participants[index].ConfigPath = fridayR20DKGRoot + "/participant.config.json"
		result.Manifest.Participants[index].StateDirectory = fridayR20DKGRoot + "/state"
	}
	var err error
	result.Manifest.RosterDigest, err = fridayDKGRosterDigestForRoot(result.Manifest.Participants, fridayR20DKGRoot)
	if err != nil {
		t.Fatal(err)
	}
	manifestDigest, err := validateFridayDKGManifestForRoot(result.Manifest, fridayR20DKGRoot)
	if err != nil {
		t.Fatal(err)
	}
	result.ManifestDigest = manifestDigest
	result.RosterDigest = result.Manifest.RosterDigest
	result.RunID = fridayR20ApplicationRunID
	result.DKGRunID = fridayR20DKGRunID
	result.CommitteeKeysetID = fridayR20KeysetID
	result.CommitteeKeysetVersion = fridayR20KeysetVersion
	result.PublicKeyPackagePath = filepath.Join(fridayR20DKGRoot, "exchange", fridayR20DKGRunID, "participant-1.public.json")
	result.Enrollments = nil
	result.Participants = nil
	shares := make([]fridayDKGVerifyingShare, 0, 4)
	for slot := 1; slot <= 4; slot++ {
		participant := result.Manifest.Participants[slot-1]
		enrollmentDigest, digestErr := fridayDKGEnrollmentDigest(result.Manifest, manifestDigest, slot)
		if digestErr != nil {
			t.Fatal(digestErr)
		}
		result.Enrollments = append(result.Enrollments, FridayDKGEnrollmentV1{
			Schema: fridayDKGEnrollmentV1Schema, ManifestDigest: manifestDigest,
			RosterDigest: result.Manifest.RosterDigest, ParticipantID: slot,
			DKGIdentity: participant.DKGIdentity,
			Signature:   literalSchnorrSignature(t, literalSchnorrPrivate(byte(10+slot)), enrollmentDigest, byte(90+slot)),
		})
		share := fridayDKGVerifyingShare{ParticipantID: slot,
			VerifyingShareHex: fixture.frost.Participants[slot-1].VerifyingShare}
		shares = append(shares, share)
		result.Participants = append(result.Participants, FridayAuthenticatedDKGParticipantV2{
			FridayDKGManifestParticipantV1: participant, VerifyingShare: share.VerifyingShareHex})
	}
	result.PublicSummaryDigest, err = fridayDKGPublicSummaryDigest(result, manifestDigest, shares)
	if err != nil {
		t.Fatal(err)
	}
	result.SignerRosterDigest, err = fridayDKGSignerRosterDigest(result, shares)
	if err != nil {
		t.Fatal(err)
	}
	sharesDigest, err := fridayDKGVerifyingSharesDigest(shares)
	if err != nil {
		t.Fatal(err)
	}
	result.FinalAttestations = nil
	for slot := 1; slot <= 4; slot++ {
		participant := result.Manifest.Participants[slot-1]
		attestation := FridayDKGFinalAttestationV2{
			Schema: fridayDKGFinalAttestationV2Schema, ManifestDigest: manifestDigest,
			RosterDigest: result.Manifest.RosterDigest, Round1TranscriptDigest: result.Round1TranscriptDigest,
			ParticipantID: slot, DKGIdentity: participant.DKGIdentity,
			SignerIdentity: participant.SignerIdentity, SignerEndpoint: participant.SignerEndpoint,
			ParticipantBinarySHA256: participant.ParticipantBinarySHA256,
			InspectorBinarySHA256:   participant.InspectorBinarySHA256,
			PackageBytesSHA256:      result.PublicKeyPackageSHA256,
			InspectionPackageSHA256: result.InspectionPublicKeyPackageSHA256,
			CommitteePublicKey:      result.CommitteePublicKey, VerifyingSharesDigest: sharesDigest,
			PublicSummaryDigest: result.PublicSummaryDigest,
		}
		digest, digestErr := fridayDKGFinalAttestationDigest(attestation)
		if digestErr != nil {
			t.Fatal(digestErr)
		}
		attestation.Signature = literalSchnorrSignature(t, literalSchnorrPrivate(byte(10+slot)), digest, byte(100+slot))
		result.FinalAttestations = append(result.FinalAttestations, attestation)
	}
	if err := verifyFridayAuthenticatedDKGResultV2ForRoot(manifestDigest, fridayR20DKGRoot, result); err != nil {
		t.Fatal(err)
	}
	return result
}

func literalFridayR20Binding(t *testing.T) FridayR20RuntimeDKGBindingV1 {
	t.Helper()
	result := literalFridayR20Result(t)
	value := FridayR20RuntimeDKGBindingV1{
		Schema: fridayR20RuntimeBindingSchema, ValueProfile: "FAKE_MONEY_ONLY",
		DeploymentID: fridayR20DeploymentID, ApplicationRunID: fridayR20ApplicationRunID,
		DKGRunID: fridayR20DKGRunID, CommitteeKeysetID: fridayR20KeysetID,
		CommitteeKeysetVersion: fridayR20KeysetVersion, DKGRoot: fridayR20DKGRoot,
		CoordinatorRoot: fridayR20CoordinatorRoot, PredecessorManifestDigest: strings.Repeat("1", 64),
		PredecessorAbortDigest: strings.Repeat("2", 64), AbortAcknowledgementsDigest: strings.Repeat("3", 64),
		ManifestDigest: result.ManifestDigest, Result: result,
	}
	var err error
	value.BindingDigest, err = fridayR20RuntimeBindingDigest(value)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func TestFridayR20RuntimeBindingAcceptsExactFreshProfile(t *testing.T) {
	value := literalFridayR20Binding(t)
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := parseAndVerifyFridayR20RuntimeDKGBinding(raw, value.BindingDigest, value.PredecessorAbortDigest)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.DKGRoot != fridayR20DKGRoot || parsed.Result.ManifestDigest != value.ManifestDigest {
		t.Fatal("R20 result lost its fixed root or manifest binding")
	}
}

func TestFridayR20RuntimeBindingRejectsCrossRunAndUnknownFields(t *testing.T) {
	base := literalFridayR20Binding(t)
	tests := []struct {
		name string
		edit func(*FridayR20RuntimeDKGBindingV1)
	}{
		{"v1-root", func(value *FridayR20RuntimeDKGBindingV1) { value.DKGRoot = fridayDKGRoot }},
		{"v1-keyset", func(value *FridayR20RuntimeDKGBindingV1) { value.CommitteeKeysetID = "friday-demo-frost-keyset-v1" }},
		{"old-run", func(value *FridayR20RuntimeDKGBindingV1) { value.DKGRunID = "friday-demo-20261023-r14-dkg1" }},
		{"changed-abort", func(value *FridayR20RuntimeDKGBindingV1) { value.PredecessorAbortDigest = strings.Repeat("4", 64) }},
		{"changed-manifest", func(value *FridayR20RuntimeDKGBindingV1) { value.ManifestDigest = strings.Repeat("5", 64) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value := base
			test.edit(&value)
			if err := verifyFridayR20RuntimeDKGBinding(base.BindingDigest, base.PredecessorAbortDigest, value); err == nil {
				t.Fatal("cross-run mutation was accepted")
			}
		})
	}
	raw, err := json.Marshal(base)
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw[:len(raw)-1], []byte(`,"unknown":true}`)...)
	if _, err := parseAndVerifyFridayR20RuntimeDKGBinding(raw, base.BindingDigest, base.PredecessorAbortDigest); err == nil {
		t.Fatal("unknown field was accepted")
	}
	if _, err := hex.DecodeString(base.BindingDigest); err != nil {
		t.Fatal(err)
	}
}
