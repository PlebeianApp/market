package poc

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"strings"
)

const (
	fridayR20RuntimeBindingSchema = "PLEBEIAN_FRIDAY_R20_RUNTIME_DKG_BINDING_V1"
	fridayR20DeploymentID         = "friday-demo-20261023-r20"
	fridayR20ApplicationRunID     = "friday-demo-20261023-r20-run1"
	fridayR20DKGRunID             = "friday-demo-20261023-r20-dkg2"
	fridayR20KeysetID             = "friday-demo-frost-keyset-v2"
	fridayR20KeysetVersion        = "2"
	fridayR20DKGRoot              = "/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2"
	fridayR20CoordinatorRoot      = "/var/lib/plebeian-auctions-friday/coordinator-v2"
)

type FridayR20RuntimeDKGBindingV1 struct {
	Schema                      string                         `json:"schema"`
	ValueProfile                string                         `json:"valueProfile"`
	DeploymentID                string                         `json:"deploymentId"`
	ApplicationRunID            string                         `json:"applicationRunId"`
	DKGRunID                    string                         `json:"dkgRunId"`
	CommitteeKeysetID           string                         `json:"committeeKeysetId"`
	CommitteeKeysetVersion      string                         `json:"committeeKeysetVersion"`
	DKGRoot                     string                         `json:"dkgRoot"`
	CoordinatorRoot             string                         `json:"coordinatorRoot"`
	PredecessorManifestDigest   string                         `json:"predecessorManifestDigest"`
	PredecessorAbortDigest      string                         `json:"predecessorAbortDigest"`
	AbortAcknowledgementsDigest string                         `json:"abortAcknowledgementsDigest"`
	ManifestDigest              string                         `json:"manifestDigest"`
	BindingDigest               string                         `json:"bindingDigest"`
	Result                      FridayAuthenticatedDKGResultV2 `json:"result"`
}

func fridayR20RuntimeBindingDigest(value FridayR20RuntimeDKGBindingV1) (string, error) {
	return fridayDKGDigest(fridayR20RuntimeBindingSchema, value.ValueProfile, value.DeploymentID,
		value.ApplicationRunID, value.DKGRunID, value.CommitteeKeysetID, value.CommitteeKeysetVersion,
		value.DKGRoot, value.CoordinatorRoot, value.PredecessorManifestDigest,
		value.PredecessorAbortDigest, value.AbortAcknowledgementsDigest, value.ManifestDigest,
		value.Result.PublicKeyPackageSHA256, value.Result.SignerRosterDigest, value.Result.CommitteePublicKey)
}

func verifyFridayR20RuntimeDKGBinding(expectedBindingDigest, expectedPredecessorAbortDigest string,
	value FridayR20RuntimeDKGBindingV1) error {
	if !validLowerHex(expectedBindingDigest, sha256.Size) ||
		!validLowerHex(expectedPredecessorAbortDigest, sha256.Size) ||
		value.Schema != fridayR20RuntimeBindingSchema || value.ValueProfile != "FAKE_MONEY_ONLY" ||
		value.DeploymentID != fridayR20DeploymentID || value.ApplicationRunID != fridayR20ApplicationRunID ||
		value.DKGRunID != fridayR20DKGRunID || value.CommitteeKeysetID != fridayR20KeysetID ||
		value.CommitteeKeysetVersion != fridayR20KeysetVersion || value.DKGRoot != fridayR20DKGRoot ||
		value.CoordinatorRoot != fridayR20CoordinatorRoot ||
		!validLowerHex(value.PredecessorManifestDigest, sha256.Size) ||
		value.PredecessorAbortDigest != expectedPredecessorAbortDigest ||
		!validLowerHex(value.AbortAcknowledgementsDigest, sha256.Size) ||
		!validLowerHex(value.ManifestDigest, sha256.Size) || value.BindingDigest != expectedBindingDigest {
		return errors.New("Friday R20 runtime DKG profile or external predecessor binding differs")
	}
	manifest := value.Result.Manifest
	if manifest.DeploymentID != fridayR20DeploymentID || manifest.ApplicationRunID != fridayR20ApplicationRunID ||
		manifest.DKGRunID != fridayR20DKGRunID || manifest.CommitteeKeysetID != fridayR20KeysetID ||
		manifest.CommitteeKeysetVersion != fridayR20KeysetVersion || value.Result.ManifestDigest != value.ManifestDigest {
		return errors.New("Friday R20 runtime result is from a different run or keyset")
	}
	if err := verifyFridayAuthenticatedDKGResultV2ForRoot(value.ManifestDigest, fridayR20DKGRoot, value.Result); err != nil {
		return err
	}
	digest, err := fridayR20RuntimeBindingDigest(value)
	if err != nil || digest != value.BindingDigest {
		return errors.New("Friday R20 runtime binding digest is invalid")
	}
	return nil
}

func parseAndVerifyFridayR20RuntimeDKGBinding(raw []byte, expectedBindingDigest,
	expectedPredecessorAbortDigest string) (FridayR20RuntimeDKGBindingV1, error) {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	var value FridayR20RuntimeDKGBindingV1
	if err := decoder.Decode(&value); err != nil {
		return FridayR20RuntimeDKGBindingV1{}, err
	}
	if err := requireEOF(decoder); err != nil {
		return FridayR20RuntimeDKGBindingV1{}, err
	}
	if err := verifyFridayR20RuntimeDKGBinding(expectedBindingDigest, expectedPredecessorAbortDigest, value); err != nil {
		return FridayR20RuntimeDKGBindingV1{}, err
	}
	return value, nil
}
