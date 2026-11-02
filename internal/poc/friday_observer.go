package poc

// The application observer is a full replica, never a fifth voting slot.
// Comet and the existing ABCI Application authenticate/replay the pinned chain.
// No validator signing key or participant private material is read or created.
import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	cmtproto "github.com/cometbft/cometbft/api/cometbft/types/v1"
	cmtcfg "github.com/cometbft/cometbft/config"
	cmtcrypto "github.com/cometbft/cometbft/crypto"
	cmted25519 "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	cmtnode "github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/proxy"
	cmttypes "github.com/cometbft/cometbft/types"
)

const fridayObserverSchema = "PLEBEIAN_FRIDAY_NONVOTING_OBSERVER_V1"
const fridayObserverRPC = "tcp://127.0.0.1:27657"

// signingDisabledObserver has public material only. Even accidental consensus
// invocation cannot sign a vote/proposal/extension/arbitrary byte string.
type signingDisabledObserver struct{ public cmtcrypto.PubKey }

func (v signingDisabledObserver) GetPubKey() (cmtcrypto.PubKey, error) { return v.public, nil }
func (signingDisabledObserver) SignVote(string, *cmtproto.Vote, bool) error {
	return errors.New("observer cannot sign votes")
}
func (signingDisabledObserver) SignProposal(string, *cmtproto.Proposal) error {
	return errors.New("observer cannot sign proposals")
}
func (signingDisabledObserver) SignBytes([]byte) ([]byte, error) {
	return nil, errors.New("observer cannot sign bytes")
}

var _ cmttypes.PrivValidator = signingDisabledObserver{}

type FridayObserverReceipt struct {
	Schema                 string `json:"schema"`
	Role                   string `json:"role"`
	DeploymentID           string `json:"deployment_id"`
	ChainID                string `json:"chain_id"`
	BundleDigest           string `json:"bundle_digest"`
	OwnerApprovalPublicKey string `json:"owner_approval_public_key"`
	GenesisFileSHA256      string `json:"genesis_file_sha256"`
	ValidatorsHash         string `json:"validators_hash"`
	NodeID                 string `json:"node_id"`
	PublicKey              string `json:"public_key"`
	P2PListen              string `json:"p2p_listen"`
	RPCListen              string `json:"rpc_listen"`
}

func observerNonmember(public cmtcrypto.PubKey, genesis *cmttypes.GenesisDoc) error {
	if public == nil || genesis == nil || len(genesis.Validators) != 4 {
		return errors.New("observer requires exactly four pinned voters")
	}
	if _, ok := public.(cmted25519.PubKey); !ok || len(public.Bytes()) != 32 {
		return errors.New("observer public identity must be Ed25519")
	}
	seen := map[string]bool{}
	for _, validator := range genesis.Validators {
		if validator.PubKey == nil || validator.Power != 1 {
			return errors.New("observer requires four distinct equal-power voters")
		}
		address := hex.EncodeToString(validator.PubKey.Address())
		if seen[address] || address == hex.EncodeToString(public.Address()) {
			return errors.New("observer identity belongs to voting set or roster duplicates")
		}
		seen[address] = true
	}
	return nil
}

func observerP2P(value string) error {
	host, port, err := net.SplitHostPort(strings.TrimPrefix(value, "tcp://"))
	ip := net.ParseIP(host)
	if err != nil || !strings.HasPrefix(value, "tcp://") || ip == nil || ip.To4() != nil ||
		!ip.IsPrivate() || port != "27656" || value != "tcp://"+net.JoinHostPort(ip.String(), port) {
		return errors.New("observer P2P must bind exact private FIPS IPv6 port27656")
	}
	return nil
}

func observerConfig(root string, manifest NetworkManifest, receipt FridayObserverReceipt) (*cmtcfg.Config, error) {
	if receipt.RPCListen != fridayObserverRPC || receipt.Role != "NONVOTING_APPLICATION_OBSERVER" {
		return nil, errors.New("observer RPC/role differs")
	}
	if err := observerP2P(receipt.P2PListen); err != nil {
		return nil, err
	}
	nodeRoot := filepath.Join(root, "observer")
	// Slot0 is only a local config argument; it never enters the voter manifest.
	cfg := validatorConfig(root, nodeRoot, manifest, ValidatorManifest{Slot: 0, Moniker: "application-observer", P2PListen: receipt.P2PListen, P2PExternal: receipt.P2PListen, RPCListen: fridayObserverRPC})
	cfg.PrivValidatorKey = "config/forbidden-validator-key.json"
	cfg.PrivValidatorState = "data/forbidden-validator-state.json"
	if err := cfg.ValidateBasic(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// InitFridayObserver validates the completed public bundle before claiming a
// new root. Partial initialization is preserved; it is never retried/reset.
// The only generated key is a non-voting Comet P2P transport key.
func InitFridayObserver(root, bundleRoot, expectedBundleDigest, ownerPublic, p2pListen string) (FridayObserverReceipt, error) {
	return initFridayObserver(root, bundleRoot, expectedBundleDigest, ownerPublic, p2pListen, p2p.LoadOrGenNodeKey)
}
func initFridayObserver(root, bundleRoot, expectedBundleDigest, ownerPublic, p2pListen string, nodeKey func(string) (*p2p.NodeKey, error)) (FridayObserverReceipt, error) {
	empty := FridayObserverReceipt{}
	if !filepath.IsAbs(root) || filepath.Clean(root) != root || root == "/" || !validLowerHex(expectedBundleDigest, 32) || !validLowerHex(ownerPublic, 32) {
		return empty, errors.New("observer independent pins/root invalid")
	}
	if err := observerP2P(p2pListen); err != nil {
		return empty, err
	}
	receipt, manifest, facts, err := validateFridayCometBundle(bundleRoot)
	if err != nil {
		return empty, err
	}
	if receipt.BundleDigest != expectedBundleDigest || receipt.OwnerApprovalPublicKey != ownerPublic || manifestApplicationAuthority(manifest) != ApplicationAuthorityFrostCashu || len(manifest.Validators) != 4 || manifest.CashuMintURL != "https://139.162.161.233" {
		return empty, errors.New("observer public bundle differs from owner/role pins")
	}
	if manifest.DeploymentID != fridaySeparatedDeploymentID {
		return empty, errors.New("observer requires exact separated deployment")
	}
	anchor, _, err := loadFridayDeploymentAnchor(filepath.Join(bundleRoot, "deployment-anchor.json"), ownerPublic)
	if err != nil || p2pListen != fridayCometEndpoint(anchor.ApplicationFIPSULA) {
		return empty, errors.New("observer listener differs from owner application identity")
	}
	// Collect only explicit public files; never copy validator roots or DKG state.
	names := []string{"genesis.json", "network.json", "network-facts.json", "validator-roster.json", "deployment-anchor.json", "frost-final-public.json", "funding-abort-bootstrap.json", "comet-genesis-bundle.json"}
	if manifest.SeparatedRuntimeBindingSHA256 != "" {
		names = append(names, "separated-runtime-binding.json")
	}
	if manifest.R20RuntimeBindingSHA256 != "" {
		names = append(names, "r20-runtime-binding.json")
	}
	data := map[string][]byte{}
	for _, name := range names {
		raw, e := os.ReadFile(filepath.Join(bundleRoot, name))
		if e != nil {
			return empty, e
		}
		data[name] = raw
	}
	// Revalidate after holding bytes; immutable bundle is required operationally.
	after, _, _, err := validateFridayCometBundle(bundleRoot)
	if err != nil || after.BundleDigest != receipt.BundleDigest {
		return empty, errors.New("observer bundle changed during initialization")
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		return empty, err
	}
	for _, name := range names {
		if err := writeExclusive(filepath.Join(root, name), data[name], 0o600); err != nil {
			return empty, err
		}
	}
	copied, _, _, err := validateFridayCometBundle(root)
	if err != nil || copied.BundleDigest != expectedBundleDigest {
		return empty, errors.New("held observer public inputs did not validate after exclusive copy")
	}
	nodeRoot := filepath.Join(root, "observer")
	if err := os.MkdirAll(filepath.Join(nodeRoot, "config"), 0o700); err != nil {
		return empty, err
	}
	if err := os.MkdirAll(filepath.Join(nodeRoot, "data"), 0o700); err != nil {
		return empty, err
	}
	key, err := nodeKey(filepath.Join(nodeRoot, "config", "node_key.json"))
	if err != nil {
		return empty, err
	}
	genesis, err := cmttypes.GenesisDocFromJSON(data["genesis.json"])
	if err != nil {
		return empty, err
	}
	if err := observerNonmember(key.PrivKey.PubKey(), genesis); err != nil {
		return empty, err
	}
	result := FridayObserverReceipt{Schema: fridayObserverSchema, Role: "NONVOTING_APPLICATION_OBSERVER", DeploymentID: manifest.DeploymentID, ChainID: manifest.ChainID, BundleDigest: receipt.BundleDigest, OwnerApprovalPublicKey: ownerPublic, GenesisFileSHA256: receipt.GenesisFileSHA256, ValidatorsHash: facts.ValidatorsHash, NodeID: string(key.ID()), PublicKey: hex.EncodeToString(key.PrivKey.PubKey().Bytes()), P2PListen: p2pListen, RPCListen: fridayObserverRPC}
	if _, err := observerConfig(root, manifest, result); err != nil {
		return empty, err
	}
	raw, err := marshalJSON(result, false)
	if err != nil {
		return empty, err
	}
	if err := writeExclusive(filepath.Join(root, "observer.json"), raw, 0o600); err != nil {
		return empty, err
	}
	directory, err := os.Open(root)
	if err != nil {
		return empty, err
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return empty, err
	}
	return result, nil
}

func loadFridayObserver(root, expectedReceiptSHA string) (FridayObserverReceipt, NetworkManifest, *cmttypes.GenesisDoc, error) {
	empty := FridayObserverReceipt{}
	if !validLowerHex(expectedReceiptSHA, 32) {
		return empty, NetworkManifest{}, nil, errors.New("independent observer receipt digest required")
	}
	raw, err := os.ReadFile(filepath.Join(root, "observer.json"))
	if err != nil || len(raw) > 16384 || hashBytes(raw) != expectedReceiptSHA {
		return empty, NetworkManifest{}, nil, errors.New("observer receipt differs from owner pin")
	}
	var receipt FridayObserverReceipt
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&receipt); err != nil {
		return empty, NetworkManifest{}, nil, err
	}
	if err := requireEOF(decoder); err != nil {
		return empty, NetworkManifest{}, nil, err
	}
	if receipt.Schema != fridayObserverSchema || receipt.Role != "NONVOTING_APPLICATION_OBSERVER" {
		return empty, NetworkManifest{}, nil, errors.New("observer receipt role/schema differs")
	}
	bundle, manifest, facts, err := validateFridayCometBundle(root)
	if err != nil {
		return empty, NetworkManifest{}, nil, err
	}
	if bundle.BundleDigest != receipt.BundleDigest || bundle.OwnerApprovalPublicKey != receipt.OwnerApprovalPublicKey || bundle.GenesisFileSHA256 != receipt.GenesisFileSHA256 || manifest.DeploymentID != receipt.DeploymentID || manifest.ChainID != receipt.ChainID || facts.ValidatorsHash != receipt.ValidatorsHash {
		return empty, NetworkManifest{}, nil, errors.New("observer initialized bundle changed")
	}
	anchor, _, err := loadFridayDeploymentAnchor(filepath.Join(root, "deployment-anchor.json"), receipt.OwnerApprovalPublicKey)
	if err != nil || receipt.P2PListen != fridayCometEndpoint(anchor.ApplicationFIPSULA) || manifest.DeploymentID != fridaySeparatedDeploymentID {
		return empty, NetworkManifest{}, nil, errors.New("observer application listener/deployment differs from owner")
	}
	genesis, err := cmttypes.GenesisDocFromFile(filepath.Join(root, "genesis.json"))
	if err != nil {
		return empty, NetworkManifest{}, nil, err
	}
	return receipt, manifest, genesis, nil
}

func RunFridayObserver(ctx context.Context, root, expectedReceiptSHA string) error {
	receipt, manifest, genesis, err := loadFridayObserver(root, expectedReceiptSHA)
	if err != nil {
		return err
	}
	cfg, err := observerConfig(root, manifest, receipt)
	if err != nil {
		return err
	}
	if err := observerRejectSigningFiles(cfg); err != nil {
		return err
	}
	key, err := p2p.LoadNodeKey(cfg.NodeKeyFile())
	if err != nil {
		return err
	}
	if string(key.ID()) != receipt.NodeID || hex.EncodeToString(key.PrivKey.PubKey().Bytes()) != receipt.PublicKey {
		return errors.New("observer transport identity differs")
	}
	if err := observerNonmember(key.PrivKey.PubKey(), genesis); err != nil {
		return err
	}
	return runFridayObserverNode(ctx, root, manifest, cfg, key)
}

func observerRejectSigningFiles(cfg *cmtcfg.Config) error {
	for _, path := range []string{cfg.PrivValidatorKeyFile(), cfg.PrivValidatorStateFile(), filepath.Join(cfg.RootDir, "config", "priv_validator_key.json"), filepath.Join(cfg.RootDir, "data", "priv_validator_state.json")} {
		if _, e := os.Lstat(path); !errors.Is(e, os.ErrNotExist) {
			return errors.New("observer refuses any validator signing-state file")
		}
	}
	return nil
}

func runFridayObserverNode(ctx context.Context, root string, manifest NetworkManifest, cfg *cmtcfg.Config, key *p2p.NodeKey) error {
	if manifest.FundingAbortPins == nil || manifestApplicationAuthority(manifest) != ApplicationAuthorityFrostCashu {
		return errors.New("observer requires threshold Cashu application")
	}
	public, err := DeriveFrostCashuLegacyNotePublicPin(*manifest.FundingAbortPins)
	if err != nil {
		return err
	}
	application, err := NewApplicationWithFrostFundingAbortPins(manifest.ChainID, manifest.Policy, public, manifest.CommitteePublicKey, manifest.MintURL, manifest.CashuMintURL, filepath.Join(root, "observer", "data", "application-state.json"), *manifest.FundingAbortPins)
	if err != nil {
		return err
	}
	pv := signingDisabledObserver{public: key.PrivKey.PubKey()}
	node, err := cmtnode.NewNode(ctx, cfg, pv, key, proxy.NewLocalClientCreator(application), cmtnode.DefaultGenesisDocProviderFunc(cfg), cmtcfg.DefaultDBProvider, cmtnode.DefaultMetricsProvider(cfg.Instrumentation), log.NewTMJSONLogger(log.NewSyncWriter(os.Stdout)))
	if err != nil {
		return err
	}
	if err := node.Start(); err != nil {
		return err
	}
	// Startup is not readiness; clients require not-catching-up and advancing H/H+1.
	fmt.Fprintln(os.Stdout, "FRIDAY_OBSERVER_STARTED_NOT_READINESS")
	<-ctx.Done()
	if err := node.Stop(); err != nil {
		return err
	}
	select {
	case <-node.Quit():
		return nil
	case <-time.After(8 * time.Second):
		return errors.New("observer shutdown uncertain")
	}
}
