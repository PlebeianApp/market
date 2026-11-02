package poc

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
)

const fridaySeparatedDeploymentID = "friday-demo-20261030-separated-v1"
const fridaySeparatedApplicationRunID = fridaySeparatedDeploymentID + "-run1"
const fridaySeparatedDKGRunID = fridaySeparatedDeploymentID + "-dkg1"
const fridaySeparatedDKGRoot = "/var/lib/plebeian-auctions-friday/frost-v3/keyset-v3"
const fridaySeparatedKeysetID = "friday-demo-frost-keyset-separated-v1"
const fridaySeparatedRuntimeSchema = "PLEBEIAN_FRIDAY_SEPARATED_RUNTIME_V1"

// Owner-authenticated public rebuild provenance is verified independently of
// the completed DKG. Its digest is then signed into the final deployment anchor.
func verifySeparatedBootstrapPacket(raw []byte, expected, owner string, predecessor FridayDKGManifestV1) (map[string]any, error) {
	fail := func() (map[string]any, error) {
		return nil, errors.New("separated bootstrap/owner/rebuild pins invalid")
	}
	if len(raw) > 65536 || !validLowerHex(expected, 32) || !validLowerHex(owner, 32) {
		return fail()
	}
	var packet map[string]any
	if json.Unmarshal(raw, &packet) != nil {
		return fail()
	}
	fields := func(value map[string]any, keys ...string) bool {
		if len(value) != len(keys) {
			return false
		}
		for _, key := range keys {
			if _, ok := value[key]; !ok {
				return false
			}
		}
		return true
	}
	text := func(value any) string { v, _ := value.(string); return v }
	if !fields(packet, "schema", "valueProfile", "stage", "deploymentId", "applicationRunId", "dkgRunId", "predecessorManifestDigest", "application", "validators", "participantBinarySha256", "inspectorBinarySha256", "ownerSignature") || packet["schema"] != "PLEBEIAN_FRIDAY_SEPARATED_BOOTSTRAP_V1" || packet["valueProfile"] != "FAKE_MONEY_ONLY" || packet["stage"] != "PRE_DKG" || packet["deploymentId"] != fridaySeparatedDeploymentID || packet["applicationRunId"] != fridaySeparatedApplicationRunID || packet["dkgRunId"] != fridaySeparatedDKGRunID {
		return fail()
	}
	previousDigest, err := validateFridayDKGManifestForRoot(predecessor, fridayDKGRoot)
	if err != nil || packet["predecessorManifestDigest"] != previousDigest {
		return fail()
	}
	app, ok := packet["application"].(map[string]any)
	if !ok || !fields(app, "role", "hostId", "underlayIpv4", "fipsNpub", "fipsUla", "coordinatorRpcIdentity", "publicOrigin", "mintOrigin") || app["role"] != "APPLICATION" || app["hostId"] != "linode-109290386" || app["underlayIpv4"] != "139.162.161.233" || app["publicOrigin"] != "https://139.162.161.233" || app["mintOrigin"] != app["publicOrigin"] {
		return fail()
	}
	oldFips, oldULAs, oldAuthority := map[string]bool{}, map[string]bool{}, map[string]bool{predecessor.CoordinatorIdentity: true}
	for _, p := range predecessor.Participants {
		oldFips[p.FIPSNpub] = true
		oldULAs[p.FIPSULA] = true
		oldAuthority[p.DKGIdentity] = true
		oldAuthority[p.SignerIdentity] = true
		oldAuthority[p.KEXPublicKey] = true
	}
	fips, ulas, authority := map[string]bool{}, map[string]bool{}, map[string]bool{}
	transport := func(value map[string]any) bool {
		n, u := text(value["fipsNpub"]), text(value["fipsUla"])
		canonical, e := canonicalFridayULA(u)
		if e != nil || canonical != u || !validSeparatedNpub(n) || oldFips[n] || fips[n] || oldULAs[u] || ulas[u] {
			return false
		}
		fips[n] = true
		ulas[u] = true
		return true
	}
	auth := func(value any) bool {
		k := text(value)
		if !validLowerHex(k, 32) || authority[k] || oldAuthority[k] {
			return false
		}
		authority[k] = true
		return true
	}
	if !transport(app) || !auth(app["coordinatorRpcIdentity"]) {
		return fail()
	}
	validators, ok := packet["validators"].([]any)
	if !ok || len(validators) != 4 {
		return fail()
	}
	hosts := []string{"linode-108175009", "linode-108236985", "linode-108237290", "linode-108237424"}
	ips := []string{"172.105.64.142", "172.105.95.57", "172.104.240.217", "172.104.253.247"}
	for index, value := range validators {
		p, ok := value.(map[string]any)
		if !ok || !fields(p, "participantId", "role", "hostId", "underlayIpv4", "fipsNpub", "fipsUla", "dkgIdentity", "signerIdentity", "kexPublicKey", "rebuild") || p["participantId"] != float64(index+1) || p["role"] != "VALIDATOR_SIGNER" || p["hostId"] != hosts[index] || p["underlayIpv4"] != ips[index] || !transport(p) || !auth(p["dkgIdentity"]) || !auth(p["signerIdentity"]) || !auth(p["kexPublicKey"]) {
			return fail()
		}
		rebuild, ok := p["rebuild"].(map[string]any)
		if !ok || !fields(rebuild, "providerEventDigest", "imageDigest", "sshHostKeyDigest", "abandonmentDecisionDigest", "emptyStateObservationDigest") {
			return fail()
		}
		for _, v := range rebuild {
			if !validLowerHex(text(v), 32) {
				return fail()
			}
		}
	}
	if !validLowerHex(text(packet["participantBinarySha256"]), 32) || !validLowerHex(text(packet["inspectorBinarySha256"]), 32) || !validLowerHex(text(packet["ownerSignature"]), 64) {
		return fail()
	}
	canonical, err := separatedCanonical(packet)
	if err != nil || hashBytes(canonical) != expected {
		return fail()
	}
	signature, _ := hex.DecodeString(text(packet["ownerSignature"]))
	body := map[string]any{}
	for k, v := range packet {
		if k != "ownerSignature" {
			body[k] = v
		}
	}
	message, err := separatedCanonical([]any{"PLEBEIAN_FRIDAY_SEPARATED_BOOTSTRAP_OWNER_APPROVAL_V1", body})
	public, _ := hex.DecodeString(owner)
	if err != nil || !ed25519.Verify(ed25519.PublicKey(public), message, signature) {
		return fail()
	}
	return packet, nil
}

type FridaySeparatedRuntime struct {
	Schema          string                         `json:"schema"`
	ValueProfile    string                         `json:"valueProfile"`
	DeploymentID    string                         `json:"deploymentId"`
	BootstrapDigest string                         `json:"bootstrapDigest"`
	ManifestDigest  string                         `json:"manifestDigest"`
	Result          FridayAuthenticatedDKGResultV2 `json:"result"`
	BindingDigest   string                         `json:"bindingDigest"`
}

func separatedCanonical(value any) ([]byte, error) {
	// These closed public schemas contain only strings and small integer IDs.
	// Round trip to maps gives the same recursive lexical key order as TS.
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var object any
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(object); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte{'\n'}), nil
}
func separatedRuntimeDigest(value FridaySeparatedRuntime) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return "", err
	}
	delete(body, "bindingDigest")
	canonical, err := separatedCanonical([]any{"PLEBEIAN_FRIDAY_SEPARATED_RUNTIME_BINDING_V1", body})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}

func verifySeparatedRuntime(value FridaySeparatedRuntime, bootstrapDigest, runtimeDigest, manifestDigest string) error {
	if !validLowerHex(bootstrapDigest, 32) || !validLowerHex(runtimeDigest, 32) || !validLowerHex(manifestDigest, 32) || value.Schema != fridaySeparatedRuntimeSchema || value.ValueProfile != "FAKE_MONEY_ONLY" || value.DeploymentID != fridaySeparatedDeploymentID || value.BootstrapDigest != bootstrapDigest || value.ManifestDigest != manifestDigest || value.BindingDigest != runtimeDigest {
		return errors.New("separated runtime external deployment pins differ")
	}
	result := value.Result
	if result.Manifest.DeploymentID != fridaySeparatedDeploymentID || result.RunID != fridaySeparatedApplicationRunID || result.DKGRunID != fridaySeparatedDKGRunID || result.CommitteeKeysetID != fridaySeparatedKeysetID || result.CommitteeKeysetVersion != "3" {
		return errors.New("separated runtime has wrong fresh DKG namespace")
	}
	if err := verifyFridayAuthenticatedDKGResultV2ForRoot(manifestDigest, fridaySeparatedDKGRoot, result); err != nil {
		return err
	}
	expectedHosts := []string{"linode-108175009", "linode-108236985", "linode-108237290", "linode-108237424"}
	expectedIPs := []string{"172.105.64.142", "172.105.95.57", "172.104.240.217", "172.104.253.247"}
	for index, p := range result.Participants {
		if p.HostID != expectedHosts[index] || p.UnderlayIPv4 != expectedIPs[index] {
			return errors.New("separated DKG participant is not a pinned validator host")
		}
	}
	actual, err := separatedRuntimeDigest(value)
	if err != nil || actual != runtimeDigest {
		return errors.New("separated runtime digest invalid")
	}
	return nil
}

func loadSeparatedRuntime(path string, anchor FridayCometDeploymentAnchorV1, frost FridayFROSTFinalPackageV1) (FridaySeparatedRuntime, []byte, error) {
	var value FridaySeparatedRuntime
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) > 1024*1024 || hashBytes(raw) != anchor.SeparatedRuntimeBindingSHA256 {
		return value, nil, errors.New("separated public runtime bytes differ from owner anchor")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, nil, err
	}
	if err := requireEOF(decoder); err != nil {
		return value, nil, err
	}
	if err := verifySeparatedRuntime(value, anchor.SeparatedBootstrapDigest, anchor.SeparatedRuntimeBindingDigest, anchor.ExpectedManifestDigest); err != nil {
		return value, nil, err
	}
	a, _ := json.Marshal(value.Result)
	b, _ := json.Marshal(frost)
	if !bytes.Equal(a, b) {
		return value, nil, errors.New("separated runtime differs from completed DKG package")
	}
	return value, raw, nil
}

func validSeparatedNpub(n string) bool {
	if len(n) != 63 || !strings.HasPrefix(n, "npub1") {
		return false
	}
	for _, c := range n[5:] {
		if !strings.ContainsRune("qpzry9x8gf2tvdw0s3jn54khce6mua7l", c) {
			return false
		}
	}
	return true
}
