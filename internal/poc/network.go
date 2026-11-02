package poc

import (
	"context"
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
	"strconv"
	"strings"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	cmtcfg "github.com/cometbft/cometbft/config"
	cmtcrypto "github.com/cometbft/cometbft/crypto"
	cmted25519 "github.com/cometbft/cometbft/crypto/ed25519"
	cmtbytes "github.com/cometbft/cometbft/libs/bytes"
	"github.com/cometbft/cometbft/libs/log"
	cmtnode "github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	"github.com/cometbft/cometbft/proxy"
	cmttypes "github.com/cometbft/cometbft/types"
)

var localPorts = [4][2]int{{28656, 28657}, {28756, 28757}, {28856, 28857}, {28956, 28957}}

type ValidatorManifest struct {
	Slot             int    `json:"slot"`
	Moniker          string `json:"moniker"`
	NodeID           string `json:"node_id"`
	ValidatorAddress string `json:"validator_address"`
	P2PListen        string `json:"p2p_listen"`
	P2PExternal      string `json:"p2p_external,omitempty"`
	RPCListen        string `json:"rpc_listen"`
}

type NetworkManifest struct {
	Schema                        string              `json:"schema"`
	Mode                          string              `json:"mode,omitempty"`
	ApplicationAuthority          string              `json:"application_authority,omitempty"`
	DeploymentID                  string              `json:"deployment_id,omitempty"`
	ApplicationRunID              string              `json:"application_run_id,omitempty"`
	ChainID                       string              `json:"chain_id"`
	CreatedAt                     string              `json:"created_at"`
	GenesisTime                   string              `json:"genesis_time"`
	MintURL                       string              `json:"mint_url"`
	MintPublicKey                 string              `json:"mint_public_key"`
	CashuMintURL                  string              `json:"cashu_mint_url"`
	CommitteePublicKey            string              `json:"committee_public_key"`
	Policy                        Policy              `json:"policy"`
	Validators                    []ValidatorManifest `json:"validators"`
	FundingAbortPins              *FundingAbortPinsV1 `json:"funding_abort_pins,omitempty"`
	R20RuntimeBindingDigest       string              `json:"r20_runtime_binding_digest,omitempty"`
	R20PredecessorAbortDigest     string              `json:"r20_predecessor_abort_digest,omitempty"`
	R20RuntimeBindingSHA256       string              `json:"r20_runtime_binding_sha256,omitempty"`
	SeparatedBootstrapDigest      string              `json:"separated_bootstrap_digest,omitempty"`
	SeparatedRuntimeBindingDigest string              `json:"separated_runtime_binding_digest,omitempty"`
	SeparatedRuntimeBindingSHA256 string              `json:"separated_runtime_binding_sha256,omitempty"`
}

// FundingAbortBootstrapV1 contains only authority that cannot be derived from
// the fresh network itself. Chain, genesis identity, mint and committee keys
// are derived from the already-created manifest/genesis and cannot be supplied
// by the activation request.
type FundingAbortBootstrapV1 struct {
	Schema                 string `json:"schema"`
	ActiveKeysetID         string `json:"activeKeysetId"`
	CommitteeKeysetID      string `json:"committeeKeysetId"`
	CommitteeKeysetVersion string `json:"committeeKeysetVersion"`
	DKGRunID               string `json:"dkgRunId"`
	PublicKeyPackageSHA256 string `json:"publicKeyPackageSha256"`
	SignerRosterDigest     string `json:"signerRosterDigest"`
}

type NetworkFacts struct {
	Schema                 string `json:"schema"`
	ChainID                string `json:"chain_id"`
	GenesisSHA256          string `json:"genesis_sha256"`
	ValidatorsHash         string `json:"validators_hash"`
	CommitteePublicKey     string `json:"committee_public_key"`
	ValidatorRosterVersion string `json:"validator_roster_version"`
}

type RemoteNetworkOptions struct {
	P2PPort      int
	RPCPort      int
	MintURL      string
	CashuMintURL string
}

func DefaultRemoteNetworkOptions() RemoteNetworkOptions {
	return RemoteNetworkOptions{P2PPort: 26656, RPCPort: 26657, MintURL: TestMintURL, CashuMintURL: CashuMintURL}
}

func (options RemoteNetworkOptions) validate() error {
	if options.P2PPort < 1024 || options.P2PPort > 65535 || options.RPCPort < 1024 || options.RPCPort > 65535 || options.P2PPort == options.RPCPort {
		return errors.New("remote P2P/RPC ports must be distinct unprivileged ports")
	}
	if err := validateFakeMoneyEndpoint(options.MintURL, "/test-mint"); err != nil {
		return err
	}
	return validateCashuMintIdentity(options.CashuMintURL)
}

func fundingAbortGenesisIdentity(genesis *cmttypes.GenesisDoc) (string, error) {
	if genesis == nil {
		return "", errors.New("genesis identity is absent")
	}
	identity := *genesis
	// AppHash contains FundingAbortPins, so hashing it would be circular. The
	// binding still covers chain ID, genesis time, height, validator roster and
	// consensus parameters; activation separately verifies the final AppHash.
	identity.AppHash = nil
	raw, err := json.Marshal(identity)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:]), nil
}

func validateFundingAbortBootstrap(bootstrap FundingAbortBootstrapV1) error {
	if bootstrap.Schema != "PLEBEIAN_FRIDAY_FUNDING_ABORT_BOOTSTRAP_V1" ||
		!validOperationID(bootstrap.ActiveKeysetID) ||
		!validOperationID(bootstrap.CommitteeKeysetID) ||
		!validOperationID(bootstrap.CommitteeKeysetVersion) ||
		!validOperationID(bootstrap.DKGRunID) ||
		!validLowerHex(bootstrap.PublicKeyPackageSHA256, sha256.Size) ||
		!validLowerHex(bootstrap.SignerRosterDigest, sha256.Size) {
		return errors.New("funding-abort bootstrap is malformed")
	}
	return nil
}

type freshPrivValidatorState struct {
	Height    string `json:"height"`
	Round     int32  `json:"round"`
	Step      int8   `json:"step"`
	Signature string `json:"signature,omitempty"`
	SignBytes string `json:"signbytes,omitempty"`
}

func requireUnusedValidatorData(root string) error {
	for slot := 1; slot <= 4; slot++ {
		dataDir := filepath.Join(root, fmt.Sprintf("validator-%d", slot), "data")
		entries, err := os.ReadDir(dataDir)
		if err != nil {
			return fmt.Errorf("inspect validator %d data: %w", slot, err)
		}
		for _, entry := range entries {
			if entry.Name() != "priv_validator_state.json" {
				return fmt.Errorf("validator %d has already-created consensus or application data", slot)
			}
		}
		raw, err := os.ReadFile(filepath.Join(dataDir, "priv_validator_state.json"))
		if err != nil {
			return fmt.Errorf("read validator %d signing state: %w", slot, err)
		}
		decoder := json.NewDecoder(strings.NewReader(string(raw)))
		decoder.DisallowUnknownFields()
		var state freshPrivValidatorState
		if err := decoder.Decode(&state); err != nil {
			return fmt.Errorf("decode validator %d signing state: %w", slot, err)
		}
		if err := requireEOF(decoder); err != nil {
			return fmt.Errorf("decode validator %d signing state: %w", slot, err)
		}
		if state.Height != "0" || state.Round != 0 || state.Step != 0 || state.Signature != "" || state.SignBytes != "" {
			return fmt.Errorf("validator %d has already signed consensus data", slot)
		}
	}
	return nil
}

func writePreparedFile(path string, mode os.FileMode, write func(string) error) (string, error) {
	temporary, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".funding-abort-*")
	if err != nil {
		return "", err
	}
	temporaryPath := temporary.Name()
	if err := temporary.Close(); err != nil {
		_ = os.Remove(temporaryPath)
		return "", err
	}
	if err := os.Chmod(temporaryPath, mode); err != nil {
		_ = os.Remove(temporaryPath)
		return "", err
	}
	if err := write(temporaryPath); err != nil {
		_ = os.Remove(temporaryPath)
		return "", err
	}
	return temporaryPath, nil
}

// EnableFundingAbort upgrades only a fresh, never-started network. All values
// that identify the chain, mint and committee are derived from the existing
// genesis/manifest, while the supplied bootstrap contributes only the DKG and
// keyset authority that cannot be derived locally. A partial two-file rename is
// deliberately fail-closed: validators will reject an app-hash/pin mismatch.
func EnableFundingAbort(root string, bootstrap FundingAbortBootstrapV1) (NetworkManifest, error) {
	if err := validateFundingAbortBootstrap(bootstrap); err != nil {
		return NetworkManifest{}, err
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return NetworkManifest{}, fmt.Errorf("resolve network root: %w", err)
	}
	manifest, err := LoadNetworkManifest(root)
	if err != nil {
		return NetworkManifest{}, err
	}
	if manifest.FundingAbortPins != nil {
		return NetworkManifest{}, errors.New("funding-abort authority is already enabled")
	}
	if err := requireUnusedValidatorData(root); err != nil {
		return NetworkManifest{}, err
	}
	genesisPath := filepath.Join(root, "genesis.json")
	genesis, err := cmttypes.GenesisDocFromFile(genesisPath)
	if err != nil {
		return NetworkManifest{}, err
	}
	if genesis.ChainID != manifest.ChainID || len(genesis.Validators) != 4 {
		return NetworkManifest{}, errors.New("genesis differs from the four-validator manifest")
	}
	genesisIdentity, err := fundingAbortGenesisIdentity(genesis)
	if err != nil {
		return NetworkManifest{}, err
	}
	pins := FundingAbortPinsV1{
		AuthNetworkID: manifest.ChainID, ChainID: manifest.ChainID,
		GenesisSHA256: genesisIdentity, MintURL: manifest.CashuMintURL,
		ActiveKeysetID: bootstrap.ActiveKeysetID, CommitteePublicKey: manifest.CommitteePublicKey,
		CommitteeKeysetID: bootstrap.CommitteeKeysetID, CommitteeKeysetVersion: bootstrap.CommitteeKeysetVersion,
		DKGRunID: bootstrap.DKGRunID, PublicKeyPackageSHA256: bootstrap.PublicKeyPackageSHA256,
		SignerRosterDigest: bootstrap.SignerRosterDigest,
	}
	var state State
	if manifestApplicationAuthority(manifest) == ApplicationAuthorityFrostCashu {
		mintPublic, deriveErr := DeriveFrostCashuLegacyNotePublicPin(pins)
		if deriveErr != nil || manifest.MintPublicKey != hex.EncodeToString(mintPublic) {
			return NetworkManifest{}, errors.New("FROST/Cashu manifest legacy-note authority pin differs")
		}
		state, err = NewStateWithFrostFundingAbortPins(manifest.ChainID, mintPublic,
			manifest.CommitteePublicKey, manifest.MintURL, manifest.CashuMintURL, pins)
	} else {
		seed, seedErr := loadCommitteeSeed(root, manifest.MintPublicKey)
		if seedErr != nil {
			return NetworkManifest{}, seedErr
		}
		state, err = NewStateWithFundingAbortPins(manifest.ChainID, ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey),
			manifest.CommitteePublicKey, manifest.MintURL, manifest.CashuMintURL, pins)
	}
	if err != nil {
		return NetworkManifest{}, err
	}
	appHash, err := state.CanonicalHash()
	if err != nil {
		return NetworkManifest{}, err
	}
	genesis.AppHash = cmtbytes.HexBytes(appHash[:])
	manifest.FundingAbortPins = &pins

	preparedGenesis, err := writePreparedFile(genesisPath, 0o644, genesis.SaveAs)
	if err != nil {
		return NetworkManifest{}, err
	}
	defer os.Remove(preparedGenesis)
	manifestPath := filepath.Join(root, "network.json")
	preparedManifest, err := writePreparedFile(manifestPath, 0o600, func(path string) error {
		raw, marshalErr := json.MarshalIndent(manifest, "", "  ")
		if marshalErr != nil {
			return marshalErr
		}
		return os.WriteFile(path, append(raw, '\n'), 0o600)
	})
	if err != nil {
		return NetworkManifest{}, err
	}
	defer os.Remove(preparedManifest)
	if err := os.Rename(preparedGenesis, genesisPath); err != nil {
		return NetworkManifest{}, err
	}
	if err := os.Rename(preparedManifest, manifestPath); err != nil {
		return NetworkManifest{}, fmt.Errorf("install funding-abort manifest after genesis (network is fail-closed until repaired): %w", err)
	}
	return LoadNetworkManifest(root)
}

// LoadNetworkFacts derives the participant trust pins from the stored genesis,
// not from a coordinator-supplied current status response.
func LoadNetworkFacts(root string) (NetworkFacts, error) {
	manifest, err := LoadNetworkManifest(root)
	if err != nil {
		return NetworkFacts{}, err
	}
	genesisPath := filepath.Join(root, "genesis.json")
	raw, err := os.ReadFile(genesisPath)
	if err != nil {
		return NetworkFacts{}, err
	}
	genesis, err := cmttypes.GenesisDocFromFile(genesisPath)
	if err != nil {
		return NetworkFacts{}, err
	}
	if genesis.ChainID != manifest.ChainID || len(genesis.Validators) != 4 {
		return NetworkFacts{}, errors.New("genesis differs from the four-validator manifest")
	}
	validators := make([]*cmttypes.Validator, 0, len(genesis.Validators))
	for _, validator := range genesis.Validators {
		validators = append(validators, cmttypes.NewValidator(validator.PubKey, validator.Power))
	}
	validatorSet := cmttypes.NewValidatorSet(validators)
	digest := sha256.Sum256(raw)
	genesisIdentity := hex.EncodeToString(digest[:])
	if manifest.FundingAbortPins != nil {
		genesisIdentity, err = fundingAbortGenesisIdentity(genesis)
		if err != nil {
			return NetworkFacts{}, err
		}
		if manifest.FundingAbortPins.GenesisSHA256 != genesisIdentity {
			return NetworkFacts{}, errors.New("funding-abort pins differ from genesis identity")
		}
	}
	return NetworkFacts{
		Schema:                 "PlebeianAuctionsPOCNetworkFactsV1",
		ChainID:                manifest.ChainID,
		GenesisSHA256:          genesisIdentity,
		ValidatorsHash:         strings.ToLower(hex.EncodeToString(validatorSet.Hash())),
		CommitteePublicKey:     manifest.CommitteePublicKey,
		ValidatorRosterVersion: "genesis-v1",
	}, nil
}

// InitRemoteNetwork creates the same four distinct consensus identities as the
// loopback constructor, then writes an explicit one-node-per-host topology.
// RPC remains loopback-only on every host. P2P is the only cross-host listener.
func InitRemoteNetwork(root string, policy Policy, hosts []string) (NetworkManifest, error) {
	return initRemoteNetwork(root, policy, hosts, "", DefaultRemoteNetworkOptions())
}

// InitRemoteNetworkWithCommittee creates the isolated one-node-per-namespace
// topology with a pre-provisioned threshold public key. It deliberately writes
// no corresponding scalar: the private authority remains split across the
// separately provisioned FROST participant state directories.
func InitRemoteNetworkWithCommittee(root string, policy Policy, hosts []string, committeePublicKey string) (NetworkManifest, error) {
	if !validCompressedPublicKey(committeePublicKey) || !strings.HasPrefix(committeePublicKey, "02") {
		return NetworkManifest{}, errors.New("threshold committee public key must be an even-Y compressed secp256k1 key")
	}
	return initRemoteNetwork(root, policy, hosts, committeePublicKey, DefaultRemoteNetworkOptions())
}

func InitRemoteNetworkWithCommitteeAndOptions(root string, policy Policy, hosts []string, committeePublicKey string, options RemoteNetworkOptions) (NetworkManifest, error) {
	if !validCompressedPublicKey(committeePublicKey) || !strings.HasPrefix(committeePublicKey, "02") {
		return NetworkManifest{}, errors.New("threshold committee public key must be an even-Y compressed secp256k1 key")
	}
	return initRemoteNetwork(root, policy, hosts, committeePublicKey, options)
}

func initRemoteNetwork(root string, policy Policy, hosts []string, committeePublicKey string, options RemoteNetworkOptions) (NetworkManifest, error) {
	if len(hosts) != 4 {
		return NetworkManifest{}, errors.New("remote network requires exactly four hosts")
	}
	if err := options.validate(); err != nil {
		return NetworkManifest{}, err
	}
	custom := options != DefaultRemoteNetworkOptions()
	seen := map[string]bool{}
	for _, host := range hosts {
		ip := net.ParseIP(host)
		if ip == nil || ip.IsLoopback() || ip.IsUnspecified() || seen[ip.String()] {
			return NetworkManifest{}, errors.New("remote hosts must be four distinct non-loopback IP addresses")
		}
		if custom && (!ip.IsPrivate() || ip.To4() != nil) {
			return NetworkManifest{}, errors.New("custom Friday P2P hosts must be private IPv6 FIPS addresses")
		}
		seen[ip.String()] = true
	}
	manifest, err := initLocalNetworkWithEndpoints(root, policy, committeePublicKey, options.MintURL, options.CashuMintURL)
	if err != nil {
		return NetworkManifest{}, err
	}
	manifest.Schema = "PlebeianAuctionsPOCNetworkV3"
	if custom {
		manifest.Schema = "PlebeianAuctionsPOCNetworkV4"
	}
	manifest.Mode = "remote"
	for index := range manifest.Validators {
		listenHost := "0.0.0.0"
		if custom {
			// Friday's transport boundary is the exact per-host FIPS ULA.
			// A wildcard IPv6 listener would also accept clearnet/public IPv6.
			listenHost = hosts[index]
		} else if net.ParseIP(hosts[index]).To4() == nil {
			listenHost = "::"
		}
		p2pPort := strconv.Itoa(options.P2PPort)
		manifest.Validators[index].P2PListen = "tcp://" + net.JoinHostPort(listenHost, p2pPort)
		manifest.Validators[index].P2PExternal = "tcp://" + net.JoinHostPort(hosts[index], p2pPort)
		manifest.Validators[index].RPCListen = "tcp://" + net.JoinHostPort("127.0.0.1", strconv.Itoa(options.RPCPort))
	}
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return NetworkManifest{}, err
	}
	if err := os.WriteFile(filepath.Join(root, "network.json"), append(raw, '\n'), 0o600); err != nil {
		return NetworkManifest{}, err
	}
	return manifest, nil
}

func InitLocalNetwork(root string, policy Policy) (NetworkManifest, error) {
	return initLocalNetwork(root, policy, "")
}

// InitLocalNetworkWithCommittee creates the isolated four-node loopback
// network with an already-provisioned even-Y threshold public key.  It writes
// no corresponding scalar because a real FROST group has only participant
// shares.  This is used only by the local fake-money interoperability harness.
func InitLocalNetworkWithCommittee(root string, policy Policy, committeePublicKey string) (NetworkManifest, error) {
	if !validCompressedPublicKey(committeePublicKey) || !strings.HasPrefix(committeePublicKey, "02") {
		return NetworkManifest{}, errors.New("threshold committee public key must be an even-Y compressed secp256k1 key")
	}
	return initLocalNetwork(root, policy, committeePublicKey)
}

func initLocalNetwork(root string, policy Policy, suppliedCommitteePublicKey string) (NetworkManifest, error) {
	return initLocalNetworkWithEndpoints(root, policy, suppliedCommitteePublicKey, TestMintURL, CashuMintURL)
}

func initLocalNetworkWithEndpoints(root string, policy Policy, suppliedCommitteePublicKey, mintURL, cashuMintURL string) (NetworkManifest, error) {
	if err := policy.Validate(); err != nil {
		return NetworkManifest{}, err
	}
	if strings.TrimSpace(root) == "" {
		return NetworkManifest{}, errors.New("network root is required")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return NetworkManifest{}, fmt.Errorf("resolve network root: %w", err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		return NetworkManifest{}, fmt.Errorf("create fresh network root: %w", err)
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(root)
		}
	}()
	seed := make([]byte, ed25519.SeedSize)
	if _, err := rand.Read(seed); err != nil {
		return NetworkManifest{}, err
	}
	if err := os.WriteFile(filepath.Join(root, "committee.seed"), []byte(hex.EncodeToString(seed)+"\n"), 0o600); err != nil {
		return NetworkManifest{}, err
	}
	committeePublicKey := suppliedCommitteePublicKey
	if committeePublicKey == "" {
		committeePrivate, err := btcec.NewPrivateKey()
		if err != nil {
			return NetworkManifest{}, err
		}
		if err := os.WriteFile(filepath.Join(root, "cashu-committee.key"), []byte(hex.EncodeToString(committeePrivate.Serialize())+"\n"), 0o600); err != nil {
			return NetworkManifest{}, err
		}
		committeePublicKey = hex.EncodeToString(committeePrivate.PubKey().SerializeCompressed())
	} else if err := os.WriteFile(filepath.Join(root, "cashu-committee.public"), []byte(committeePublicKey+"\n"), 0o600); err != nil {
		return NetworkManifest{}, err
	}
	chainID := "plebeian-poc-" + strconv.FormatInt(time.Now().UTC().Unix(), 10)
	genesisTime := time.Now().UTC().Add(3 * time.Second).Round(0)
	manifest := NetworkManifest{
		Schema:               "PlebeianAuctionsPOCNetworkV2",
		ApplicationAuthority: ApplicationAuthorityLegacy,
		ChainID:              chainID,
		CreatedAt:            time.Now().UTC().Format(time.RFC3339Nano),
		GenesisTime:          genesisTime.Format(time.RFC3339Nano),
		MintURL:              mintURL,
		MintPublicKey:        hex.EncodeToString(ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)),
		CashuMintURL:         cashuMintURL,
		CommitteePublicKey:   committeePublicKey,
		Policy:               policy,
	}
	genesisValidators := make([]cmttypes.GenesisValidator, 0, 4)
	for index := 0; index < 4; index++ {
		nodeRoot := filepath.Join(root, fmt.Sprintf("validator-%d", index+1))
		configDir := filepath.Join(nodeRoot, "config")
		dataDir := filepath.Join(nodeRoot, "data")
		if err := os.MkdirAll(configDir, 0o700); err != nil {
			return NetworkManifest{}, err
		}
		if err := os.MkdirAll(dataDir, 0o700); err != nil {
			return NetworkManifest{}, err
		}
		pv, err := privval.GenFilePV(filepath.Join(configDir, "priv_validator_key.json"), filepath.Join(dataDir, "priv_validator_state.json"), func() (cmtcrypto.PrivKey, error) {
			return cmted25519.GenPrivKey(), nil
		})
		if err != nil {
			return NetworkManifest{}, err
		}
		pv.Save()
		nodeKey, err := p2p.LoadOrGenNodeKey(filepath.Join(configDir, "node_key.json"))
		if err != nil {
			return NetworkManifest{}, err
		}
		publicKey, err := pv.GetPubKey()
		if err != nil {
			return NetworkManifest{}, err
		}
		genesisValidators = append(genesisValidators, cmttypes.GenesisValidator{Address: publicKey.Address(), PubKey: publicKey, Power: 1, Name: fmt.Sprintf("poc-validator-%d", index+1)})
		manifest.Validators = append(manifest.Validators, ValidatorManifest{
			Slot:             index + 1,
			Moniker:          fmt.Sprintf("poc-validator-%d", index+1),
			NodeID:           string(nodeKey.ID()),
			ValidatorAddress: strings.ToUpper(hex.EncodeToString(publicKey.Address())),
			P2PListen:        fmt.Sprintf("tcp://127.0.0.1:%d", localPorts[index][0]),
			RPCListen:        fmt.Sprintf("tcp://127.0.0.1:%d", localPorts[index][1]),
		})
	}
	empty, err := NewStateWithEndpoints(chainID, ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), committeePublicKey, mintURL, cashuMintURL)
	if err != nil {
		return NetworkManifest{}, err
	}
	appHash, err := empty.CanonicalHash()
	if err != nil {
		return NetworkManifest{}, err
	}
	params := cmttypes.DefaultConsensusParams()
	params.Feature.PbtsEnableHeight = 1
	params.Feature.VoteExtensionsEnableHeight = 0
	params.Synchrony.Precision = time.Second
	params.Synchrony.MessageDelay = 10 * time.Second
	genesis := &cmttypes.GenesisDoc{GenesisTime: genesisTime, ChainID: chainID, InitialHeight: 1, ConsensusParams: params, Validators: genesisValidators, AppHash: cmtbytes.HexBytes(appHash[:])}
	if err := genesis.ValidateAndComplete(); err != nil {
		return NetworkManifest{}, err
	}
	if err := genesis.SaveAs(filepath.Join(root, "genesis.json")); err != nil {
		return NetworkManifest{}, err
	}
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return NetworkManifest{}, err
	}
	if err := os.WriteFile(filepath.Join(root, "network.json"), append(raw, '\n'), 0o600); err != nil {
		return NetworkManifest{}, err
	}
	cleanup = false
	return manifest, nil
}

func LoadNetworkManifest(root string) (NetworkManifest, error) {
	var err error
	root, err = filepath.Abs(root)
	if err != nil {
		return NetworkManifest{}, fmt.Errorf("resolve network root: %w", err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "network.json"))
	if err != nil {
		return NetworkManifest{}, err
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	var manifest NetworkManifest
	if err := decoder.Decode(&manifest); err != nil {
		return NetworkManifest{}, err
	}
	if err := requireEOF(decoder); err != nil {
		return NetworkManifest{}, err
	}
	if (manifest.Schema != "PlebeianAuctionsPOCNetworkV2" && manifest.Schema != "PlebeianAuctionsPOCNetworkV3" && manifest.Schema != "PlebeianAuctionsPOCNetworkV4") || len(manifest.Validators) != 4 || !validCompressedPublicKey(manifest.CommitteePublicKey) || validateFakeMoneyEndpoint(manifest.MintURL, "/test-mint") != nil || validateCashuMintIdentity(manifest.CashuMintURL) != nil {
		return NetworkManifest{}, errors.New("invalid or unsafe POC network manifest")
	}
	if manifest.Mode != "" && manifest.Mode != "remote" {
		return NetworkManifest{}, errors.New("unsupported POC network mode")
	}
	authority := manifestApplicationAuthority(manifest)
	if authority != ApplicationAuthorityLegacy && authority != ApplicationAuthorityFrostCashu {
		return NetworkManifest{}, errors.New("unsupported application authority mode")
	}
	if authority == ApplicationAuthorityFrostCashu &&
		(manifest.Schema != "PlebeianAuctionsPOCNetworkV4" || manifest.Mode != "remote") {
		return NetworkManifest{}, errors.New("FROST/Cashu authority requires the explicit remote V4 topology")
	}
	if manifest.DeploymentID == fridaySeparatedDeploymentID {
		if manifest.ApplicationRunID != fridaySeparatedApplicationRunID || !validLowerHex(manifest.SeparatedBootstrapDigest, 32) || !validLowerHex(manifest.SeparatedRuntimeBindingDigest, 32) || !validLowerHex(manifest.SeparatedRuntimeBindingSHA256, 32) {
			return NetworkManifest{}, errors.New("separated network lacks fresh runtime authority")
		}
	} else if manifest.SeparatedBootstrapDigest != "" || manifest.SeparatedRuntimeBindingDigest != "" || manifest.SeparatedRuntimeBindingSHA256 != "" {
		return NetworkManifest{}, errors.New("non-separated network carries fresh authority")
	}
	if manifest.DeploymentID == fridayR20DeploymentID {
		if manifest.ApplicationRunID != fridayR20ApplicationRunID ||
			!validLowerHex(manifest.R20RuntimeBindingDigest, sha256.Size) ||
			!validLowerHex(manifest.R20PredecessorAbortDigest, sha256.Size) ||
			!validLowerHex(manifest.R20RuntimeBindingSHA256, sha256.Size) {
			return NetworkManifest{}, errors.New("Friday R20 network manifest lacks its owner-pinned runtime binding")
		}
	} else if (manifest.ApplicationRunID != "" && manifest.DeploymentID != fridaySeparatedDeploymentID) || manifest.R20RuntimeBindingDigest != "" ||
		manifest.R20PredecessorAbortDigest != "" || manifest.R20RuntimeBindingSHA256 != "" {
		return NetworkManifest{}, errors.New("non-R20 network manifest carries R20 runtime authority")
	}
	if err := manifest.Policy.Validate(); err != nil {
		return NetworkManifest{}, err
	}
	if manifest.FundingAbortPins != nil {
		pins := *manifest.FundingAbortPins
		if pins.AuthNetworkID != manifest.ChainID || pins.ChainID != manifest.ChainID ||
			pins.MintURL != manifest.CashuMintURL || pins.CommitteePublicKey != manifest.CommitteePublicKey ||
			!validLowerHex(pins.GenesisSHA256, sha256.Size) || !validOperationID(pins.ActiveKeysetID) ||
			!validOperationID(pins.CommitteeKeysetID) || !validOperationID(pins.CommitteeKeysetVersion) ||
			!validOperationID(pins.DKGRunID) || !validLowerHex(pins.PublicKeyPackageSHA256, sha256.Size) ||
			!validLowerHex(pins.SignerRosterDigest, sha256.Size) {
			return NetworkManifest{}, errors.New("invalid funding-abort authority in network manifest")
		}
		genesis, err := cmttypes.GenesisDocFromFile(filepath.Join(root, "genesis.json"))
		if err != nil {
			return NetworkManifest{}, err
		}
		identity, err := fundingAbortGenesisIdentity(genesis)
		if err != nil || identity != pins.GenesisSHA256 {
			return NetworkManifest{}, errors.New("funding-abort authority differs from genesis identity")
		}
	}
	seenNode := map[string]bool{}
	seenValidator := map[string]bool{}
	for index, validator := range manifest.Validators {
		if validator.Slot != index+1 || validator.NodeID == "" || seenNode[validator.NodeID] || validator.ValidatorAddress == "" || seenValidator[validator.ValidatorAddress] {
			return NetworkManifest{}, errors.New("validator identities are not four distinct ordered identities")
		}
		seenNode[validator.NodeID] = true
		seenValidator[validator.ValidatorAddress] = true
		if manifest.Mode == "remote" {
			external, err := url.Parse(validator.P2PExternal)
			listen, listenErr := url.Parse(validator.P2PListen)
			rpc, rpcErr := url.Parse(validator.RPCListen)
			if err != nil || external == nil || listenErr != nil || listen == nil || rpcErr != nil || rpc == nil {
				return NetworkManifest{}, errors.New("unsafe remote validator listener topology")
			}
			externalIP := net.ParseIP(external.Hostname())
			listenIP := net.ParseIP(listen.Hostname())
			rpcIP := net.ParseIP(rpc.Hostname())
			p2pPort, p2pErr := strconv.Atoi(external.Port())
			rpcPort, portErr := strconv.Atoi(rpc.Port())
			listenMatchesTopology := externalIP != nil && listenIP != nil && listenIP.IsUnspecified() &&
				(externalIP.To4() == nil) == (listenIP.To4() == nil)
			if manifest.Schema == "PlebeianAuctionsPOCNetworkV4" {
				listenMatchesTopology = externalIP != nil && listenIP != nil && listenIP.Equal(externalIP)
			}
			if external.Scheme != "tcp" || listen.Scheme != "tcp" || rpc.Scheme != "tcp" ||
				externalIP == nil || externalIP.IsLoopback() || externalIP.IsUnspecified() ||
				!listenMatchesTopology || listen.Port() != external.Port() ||
				rpcIP == nil || !rpcIP.IsLoopback() || p2pErr != nil || portErr != nil ||
				p2pPort < 1024 || p2pPort > 65535 || rpcPort < 1024 || rpcPort > 65535 || p2pPort == rpcPort ||
				(manifest.Schema == "PlebeianAuctionsPOCNetworkV3" && (p2pPort != 26656 || rpcPort != 26657)) ||
				(manifest.Schema == "PlebeianAuctionsPOCNetworkV4" && (!externalIP.IsPrivate() || externalIP.To4() != nil)) {
				return NetworkManifest{}, errors.New("unsafe remote validator listener topology")
			}
		}
	}
	return manifest, nil
}

func manifestApplicationAuthority(manifest NetworkManifest) string {
	if manifest.ApplicationAuthority == "" {
		return ApplicationAuthorityLegacy
	}
	return manifest.ApplicationAuthority
}

func RunValidatorNode(ctx context.Context, root string, slot int) error {
	return runValidatorNode(ctx, root, slot, fridayR20ProductionPredecessorSealProfile)
}

func runValidatorNode(ctx context.Context, root string, slot int, predecessorSeal fridayR20PredecessorSealProfile) error {
	var err error
	root, err = filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolve network root: %w", err)
	}
	manifest, err := LoadNetworkManifest(root)
	if err != nil {
		return err
	}
	if slot < 1 || slot > len(manifest.Validators) {
		return errors.New("validator slot must be 1..4")
	}
	authority := manifestApplicationAuthority(manifest)
	if manifest.Schema == "PlebeianAuctionsPOCNetworkV4" && authority != ApplicationAuthorityFrostCashu {
		return errors.New("Friday V4 network requires frost_cashu_v4 application authority")
	}
	// The CLI performs the same check as an early diagnostic, but it is not a
	// security boundary: tests and future embedders can call RunValidatorNode
	// directly.  Enforce the four-validator launch seal here, after the exact
	// manifest/slot have been validated and before reading private keys,
	// constructing the application, or opening any listener.
	if authority == ApplicationAuthorityFrostCashu {
		if err := RequireFridayCometLaunch(root, slot); err != nil {
			return err
		}
		if manifest.DeploymentID == fridayR20DeploymentID {
			if err := requireFridayR20PredecessorRevocation(root, slot, predecessorSeal); err != nil {
				return err
			}
		}
	}
	validator := manifest.Validators[slot-1]
	nodeRoot := filepath.Join(root, fmt.Sprintf("validator-%d", slot))
	config := validatorConfig(root, nodeRoot, manifest, validator)
	if err := config.ValidateBasic(); err != nil {
		return err
	}
	pv := privval.LoadFilePV(config.PrivValidatorKeyFile(), config.PrivValidatorStateFile())
	publicKey, err := pv.GetPubKey()
	if err != nil {
		return err
	}
	if strings.ToUpper(hex.EncodeToString(publicKey.Address())) != validator.ValidatorAddress {
		return errors.New("validator private key does not match manifest")
	}
	nodeKey, err := p2p.LoadNodeKey(config.NodeKeyFile())
	if err != nil {
		return err
	}
	if string(nodeKey.ID()) != validator.NodeID {
		return errors.New("node private key does not match manifest")
	}
	statePath := filepath.Join(nodeRoot, "data", "application-state.json")
	var application *Application
	if manifestApplicationAuthority(manifest) == ApplicationAuthorityFrostCashu {
		if manifest.FundingAbortPins == nil {
			return errors.New("FROST/Cashu validator requires pinned funding authority")
		}
		mintPublic, deriveErr := DeriveFrostCashuLegacyNotePublicPin(*manifest.FundingAbortPins)
		if deriveErr != nil || manifest.MintPublicKey != hex.EncodeToString(mintPublic) {
			return errors.New("FROST/Cashu validator disabled legacy-note authority pin is invalid")
		}
		application, err = NewApplicationWithFrostFundingAbortPins(manifest.ChainID, manifest.Policy,
			mintPublic, manifest.CommitteePublicKey, manifest.MintURL,
			manifest.CashuMintURL, statePath, *manifest.FundingAbortPins)
	} else {
		seed, seedErr := loadCommitteeSeed(root, manifest.MintPublicKey)
		if seedErr != nil {
			return seedErr
		}
		if manifest.FundingAbortPins == nil {
			application, err = NewApplicationWithEndpoints(manifest.ChainID, manifest.Policy, seed,
				manifest.CommitteePublicKey, manifest.MintURL, manifest.CashuMintURL, statePath)
		} else {
			application, err = NewApplicationWithFundingAbortPins(manifest.ChainID, manifest.Policy, seed,
				manifest.CommitteePublicKey, manifest.MintURL, manifest.CashuMintURL, statePath, *manifest.FundingAbortPins)
		}
	}
	if err != nil {
		return err
	}
	node, err := cmtnode.NewNode(ctx, config, pv, nodeKey, proxy.NewLocalClientCreator(application), cmtnode.DefaultGenesisDocProviderFunc(config), cmtcfg.DefaultDBProvider, cmtnode.DefaultMetricsProvider(config.Instrumentation), log.NewTMJSONLogger(log.NewSyncWriter(os.Stdout)))
	if err != nil {
		return err
	}
	if err := node.Start(); err != nil {
		return err
	}
	ready := map[string]any{"event": "validator_ready", "slot": slot, "node_id": validator.NodeID, "validator_address": validator.ValidatorAddress, "rpc": validator.RPCListen, "p2p": validator.P2PListen}
	_ = json.NewEncoder(os.Stdout).Encode(ready)
	<-ctx.Done()
	if err := node.Stop(); err != nil {
		return err
	}
	select {
	case <-node.Quit():
		return nil
	case <-time.After(8 * time.Second):
		return errors.New("validator did not stop within bounded shutdown window")
	}
}

func validatorConfig(networkRoot, nodeRoot string, manifest NetworkManifest, validator ValidatorManifest) *cmtcfg.Config {
	config := cmtcfg.DefaultConfig().SetRoot(nodeRoot)
	config.Storage.ExperimentalKeyLayout = "v1"
	config.Moniker = validator.Moniker
	config.Genesis = filepath.Join(networkRoot, "genesis.json")
	config.DBBackend = "goleveldb"
	config.PrivValidatorListenAddr = ""
	config.RPC.ListenAddress = validator.RPCListen
	config.RPC.CORSAllowedOrigins = nil
	config.RPC.CORSAllowedMethods = nil
	config.RPC.CORSAllowedHeaders = nil
	config.RPC.Unsafe = false
	config.RPC.PprofListenAddress = ""
	config.GRPC.ListenAddress = ""
	config.GRPC.VersionService.Enabled = false
	config.GRPC.BlockService.Enabled = false
	config.GRPC.BlockResultsService.Enabled = false
	config.GRPC.Privileged.ListenAddress = ""
	config.GRPC.Privileged.PruningService.Enabled = false
	config.P2P.ListenAddress = validator.P2PListen
	config.P2P.ExternalAddress = validator.P2PExternal
	config.P2P.Seeds = ""
	config.P2P.PersistentPeers = persistentPeers(manifest, validator.Slot)
	config.P2P.AddrBook = filepath.Join("data", "addrbook.json")
	config.P2P.AddrBookStrict = false
	config.P2P.PexReactor = false
	config.P2P.SeedMode = false
	config.P2P.AllowDuplicateIP = true
	config.P2P.PrivatePeerIDs = ""
	config.P2P.UnconditionalPeerIDs = ""
	config.Mempool.WalPath = ""
	config.StateSync.Enable = false
	config.Consensus.WalPath = filepath.Join("data", "cs.wal", "wal")
	config.Consensus.CreateEmptyBlocks = true
	config.Consensus.CreateEmptyBlocksInterval = time.Second
	config.Instrumentation.Prometheus = false
	config.Instrumentation.PrometheusListenAddr = ""
	return config
}

func persistentPeers(manifest NetworkManifest, self int) string {
	peers := make([]string, 0, 3)
	for _, validator := range manifest.Validators {
		if validator.Slot == self {
			continue
		}
		address := strings.TrimPrefix(validator.P2PExternal, "tcp://")
		if address == "" {
			address = strings.TrimPrefix(validator.P2PListen, "tcp://")
		}
		peers = append(peers, validator.NodeID+"@"+address)
	}
	return strings.Join(peers, ",")
}

func loadCommitteeSeed(root, expectedPublic string) ([]byte, error) {
	raw, err := os.ReadFile(filepath.Join(root, "committee.seed"))
	if err != nil {
		return nil, err
	}
	seed, err := hex.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(seed) != ed25519.SeedSize {
		return nil, errors.New("invalid committee seed file")
	}
	if hex.EncodeToString(ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)) != expectedPublic {
		return nil, errors.New("committee seed does not match public manifest")
	}
	return seed, nil
}

func reserveLocalPorts(manifest NetworkManifest, webListen string) ([]net.Listener, error) {
	addresses := make([]string, 0, 9)
	for _, validator := range manifest.Validators {
		addresses = append(addresses, strings.TrimPrefix(validator.P2PListen, "tcp://"), strings.TrimPrefix(validator.RPCListen, "tcp://"))
	}
	addresses = append(addresses, webListen)
	listeners := make([]net.Listener, 0, len(addresses))
	for _, address := range addresses {
		listener, err := net.Listen("tcp", address)
		if err != nil {
			for _, acquired := range listeners {
				_ = acquired.Close()
			}
			return nil, fmt.Errorf("reserve %s: %w", address, err)
		}
		listeners = append(listeners, listener)
	}
	return listeners, nil
}
