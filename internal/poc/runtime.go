package poc

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const Version = "2026.10.23-friday-tier1"

type repeatedPathFlag []string

func (values *repeatedPathFlag) String() string { return strings.Join(*values, ",") }
func (values *repeatedPathFlag) Set(value string) error {
	if strings.TrimSpace(value) == "" {
		return errors.New("path is empty")
	}
	*values = append(*values, value)
	return nil
}

func RunCLI(arguments []string) error {
	if len(arguments) == 0 {
		return errors.New("usage: plebeian-auctions-poc {init|init-remote|init-observer|observer|render-friday-comet-authority|init-friday-comet-validator|assemble-friday-comet|finalize-friday-comet-validator|seal-friday-comet-launch|install-friday-comet-launch|enable-funding-abort|network-facts|node|serve|local-demo|scenario|version}")
	}
	switch arguments[0] {
	case "init-observer":
		flags := flag.NewFlagSet("init-observer", flag.ContinueOnError)
		home := flags.String("home", "", "fresh application observer root")
		bundle := flags.String("bundle", "", "completed authenticated public genesis bundle")
		digest := flags.String("expected-bundle-digest", "", "independent owner-approved bundle digest")
		owner := flags.String("owner-approval-public-key", "", "independent owner public key")
		listen := flags.String("fips-p2p-listen", "", "exact private observer FIPS P2P listener")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *home == "" || *bundle == "" || flags.NArg() != 0 {
			return errors.New("init-observer requires exact home, bundle, owner/digest and FIPS listener pins")
		}
		receipt, err := InitFridayObserver(*home, *bundle, *digest, *owner, *listen)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(receipt)
	case "observer":
		flags := flag.NewFlagSet("observer", flag.ContinueOnError)
		home := flags.String("home", "", "initialized application observer root")
		digest := flags.String("expected-observer-receipt-sha256", "", "independent owner-approved initialized receipt digest")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *home == "" || flags.NArg() != 0 {
			return errors.New("observer requires exact home and receipt digest")
		}
		ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer cancel()
		return RunFridayObserver(ctx, *home, *digest)
	case "version":
		return json.NewEncoder(os.Stdout).Encode(map[string]string{"version": Version, "value_profile": "FAKE_MONEY_ONLY"})
	case "init":
		flags := flag.NewFlagSet("init", flag.ContinueOnError)
		home := flags.String("home", "", "new POC network directory")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *home == "" || flags.NArg() != 0 {
			return errors.New("init requires --home and no positional arguments")
		}
		manifest, err := InitLocalNetwork(*home, DefaultPolicy())
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(manifest)
	case "init-remote":
		flags := flag.NewFlagSet("init-remote", flag.ContinueOnError)
		home := flags.String("home", "", "new POC network directory")
		hosts := flags.String("hosts", "", "four comma-separated validator IP addresses")
		committeePublicKey := flags.String("committee-public-key", "", "optional even-Y threshold public key for a fresh isolated network")
		p2pPort := flags.Int("p2p-port", 26656, "remote validator P2P port")
		rpcPort := flags.Int("rpc-port", 26657, "loopback validator RPC port")
		mintURL := flags.String("test-mint-url", TestMintURL, "private test-mint endpoint recorded in consensus state")
		cashuMintURL := flags.String("cashu-mint-url", CashuMintURL, "private fake Cashu mint origin recorded in consensus state")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		remoteHosts := strings.Split(*hosts, ",")
		if *home == "" || *hosts == "" || len(remoteHosts) != 4 || flags.NArg() != 0 {
			return errors.New("init-remote requires --home and exactly four comma-separated --hosts")
		}
		var manifest NetworkManifest
		var err error
		if *committeePublicKey == "" && (*p2pPort != 26656 || *rpcPort != 26657 || *mintURL != TestMintURL || *cashuMintURL != CashuMintURL) {
			return errors.New("custom remote endpoints require an explicit threshold committee public key")
		} else if *committeePublicKey == "" {
			manifest, err = InitRemoteNetwork(*home, DefaultPolicy(), remoteHosts)
		} else {
			manifest, err = InitRemoteNetworkWithCommitteeAndOptions(*home, DefaultPolicy(), remoteHosts, *committeePublicKey, RemoteNetworkOptions{
				P2PPort: *p2pPort, RPCPort: *rpcPort, MintURL: *mintURL, CashuMintURL: *cashuMintURL,
			})
		}
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(manifest)
	case "render-friday-comet-authority":
		flags := flag.NewFlagSet("render-friday-comet-authority", flag.ContinueOnError)
		outputRoot := flags.String("output-root", "", "fresh public authority output directory")
		frostFinalPublic := flags.String("frost-final-public", "", "authenticated V2 final public DKG result")
		expectedManifestDigest := flags.String("expected-manifest-digest", "", "externally pinned initial DKG manifest digest")
		ownerPrivateKey := flags.String("owner-approval-private-key", "", "existing mode-0600 Ed25519 seed file")
		chainID := flags.String("chain-id", "", "new Friday Comet chain identity")
		genesisTime := flags.String("genesis-time", "", "canonical UTC genesis time")
		activeKeysetID := flags.String("active-keyset-id", "", "controlled NUT-12 fake mint keyset identity")
		separatedBootstrap := flags.String("separated-bootstrap", "", "owner-signed public four-rebuilt-host bootstrap")
		separatedRuntime := flags.String("separated-runtime-binding", "", "completed authenticated separated DKG runtime")
		predecessor := flags.String("predecessor-manifest", "", "preserved public predecessor provenance only")
		bootstrapDigest := flags.String("expected-separated-bootstrap-digest", "", "independent owner bootstrap digest")
		runtimeDigest := flags.String("expected-separated-runtime-digest", "", "independent completed DKG binding digest")
		mintReceipt := flags.String("mint-conformance-receipt", "", "completed owner-reviewed fake-mint conformance receipt")
		mintReceiptDigest := flags.String("mint-conformance-receipt-sha256", "", "independent conformance receipt hash")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *outputRoot == "" || *frostFinalPublic == "" || *expectedManifestDigest == "" || *ownerPrivateKey == "" ||
			*chainID == "" || *genesisTime == "" || *activeKeysetID == "" || flags.NArg() != 0 {
			return errors.New("render-friday-comet-authority requires --output-root --frost-final-public --expected-manifest-digest --owner-approval-private-key --chain-id --genesis-time and --active-keyset-id")
		}
		receipt, err := RenderFridayCometAuthority(FridayCometAuthorityRender{OutputRoot: *outputRoot,
			FROSTFinalPackagePath: *frostFinalPublic, ExpectedManifestDigest: *expectedManifestDigest,
			OwnerPrivateKeyPath: *ownerPrivateKey, ChainID: *chainID, GenesisTime: *genesisTime,
			ActiveKeysetID: *activeKeysetID, SeparatedBootstrapPath: *separatedBootstrap, SeparatedRuntimeBindingPath: *separatedRuntime, PredecessorManifestPath: *predecessor,
			ExpectedSeparatedBootstrapDigest: *bootstrapDigest, ExpectedSeparatedRuntimeDigest: *runtimeDigest, MintConformanceReceiptPath: *mintReceipt, MintConformanceReceiptSHA256: *mintReceiptDigest})
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(receipt)
	case "init-friday-comet-validator":
		flags := flag.NewFlagSet("init-friday-comet-validator", flag.ContinueOnError)
		home := flags.String("home", "", "fresh per-host Friday network directory")
		deploymentAnchor := flags.String("deployment-anchor", "", "owner-signed Friday deployment and roster anchor")
		ownerPublicKey := flags.String("owner-approval-public-key", "", "pinned owner Ed25519 approval public key")
		slot := flags.Int("slot", 0, "this host's validator slot 1..4")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *home == "" || *deploymentAnchor == "" || *ownerPublicKey == "" || *slot < 1 || *slot > 4 || flags.NArg() != 0 {
			return errors.New("init-friday-comet-validator requires --home --deployment-anchor --owner-approval-public-key --slot 1..4")
		}
		public, err := InitFridayCometValidator(*home, FridayCometValidatorInit{DeploymentAnchorPath: *deploymentAnchor,
			OwnerApprovalPublicKey: *ownerPublicKey, Slot: *slot})
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(public)
	case "assemble-friday-comet":
		flags := flag.NewFlagSet("assemble-friday-comet", flag.ContinueOnError)
		bundle := flags.String("bundle", "", "fresh common public bundle directory")
		deploymentAnchor := flags.String("deployment-anchor", "", "owner-signed Friday deployment and roster anchor")
		frostFinalPublic := flags.String("frost-final-public", "", "authenticated A1 final public DKG result")
		fundingAbortBootstrap := flags.String("funding-abort-bootstrap", "", "owner-bound public FundingAbort bootstrap")
		ownerPublicKey := flags.String("owner-approval-public-key", "", "pinned owner Ed25519 approval public key")
		mintURL := flags.String("test-mint-url", "", "reviewed fake test-mint endpoint")
		cashuMintURL := flags.String("cashu-mint-url", "", "reviewed canonical fake Cashu mint identity")
		separatedRuntime := flags.String("separated-runtime-binding", "", "completed owner-bound separated DKG public result")
		fundingMaxPerRequest := flags.Int64("fake-funding-max-per-request", 0, "reviewed browser fake-funding request maximum")
		fundingMaxResultingBalance := flags.Int64("fake-funding-max-resulting-balance", 0, "reviewed browser-wallet advisory resulting-balance maximum")
		var descriptors repeatedPathFlag
		flags.Var(&descriptors, "validator-public", "one public validator descriptor; repeat exactly four times")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *bundle == "" || *deploymentAnchor == "" || *frostFinalPublic == "" || *fundingAbortBootstrap == "" || *ownerPublicKey == "" ||
			*mintURL == "" || *cashuMintURL == "" || *fundingMaxPerRequest < 1 || *fundingMaxResultingBalance < 1 ||
			len(descriptors) != 4 || flags.NArg() != 0 {
			return errors.New("assemble-friday-comet requires --bundle, four --validator-public paths, --deployment-anchor, --frost-final-public, --funding-abort-bootstrap, --owner-approval-public-key, --test-mint-url, --cashu-mint-url, --fake-funding-max-per-request and --fake-funding-max-resulting-balance")
		}
		policy := DefaultPolicy()
		policy.FaucetAmount, policy.FaucetCap = *fundingMaxPerRequest, *fundingMaxResultingBalance
		receipt, err := AssembleFridayCometGenesis(*bundle, descriptors, FridayCometGenesisAssembly{
			DeploymentAnchorPath: *deploymentAnchor, FROSTFinalPackagePath: *frostFinalPublic,
			FundingAbortBootstrapPath: *fundingAbortBootstrap, OwnerApprovalPublicKey: *ownerPublicKey,
			SeparatedRuntimeBindingPath: *separatedRuntime,
			MintURL:                     *mintURL, CashuMintURL: *cashuMintURL, Policy: policy,
		})
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(receipt)
	case "finalize-friday-comet-validator":
		flags := flag.NewFlagSet("finalize-friday-comet-validator", flag.ContinueOnError)
		home := flags.String("home", "", "this host's initialized Friday network directory")
		bundle := flags.String("bundle", "", "reviewed common public bundle directory")
		slot := flags.Int("slot", 0, "this host's validator slot 1..4")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *home == "" || *bundle == "" || *slot < 1 || *slot > 4 || flags.NArg() != 0 {
			return errors.New("finalize-friday-comet-validator requires --home --bundle --slot 1..4")
		}
		result, err := FinalizeFridayCometValidator(*home, *bundle, *slot)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	case "seal-friday-comet-launch":
		flags := flag.NewFlagSet("seal-friday-comet-launch", flag.ContinueOnError)
		bundle := flags.String("bundle", "", "reviewed common public bundle directory")
		var acknowledgements repeatedPathFlag
		flags.Var(&acknowledgements, "validator-ack", "one validator final acknowledgement; repeat exactly four times")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *bundle == "" || len(acknowledgements) != 4 || flags.NArg() != 0 {
			return errors.New("seal-friday-comet-launch requires --bundle and four --validator-ack paths")
		}
		seal, err := SealFridayCometLaunch(*bundle, acknowledgements)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(seal)
	case "install-friday-comet-launch":
		flags := flag.NewFlagSet("install-friday-comet-launch", flag.ContinueOnError)
		home := flags.String("home", "", "this host's finalized Friday network directory")
		bundle := flags.String("bundle", "", "reviewed common public bundle containing the four-ack launch seal")
		slot := flags.Int("slot", 0, "this host's validator slot 1..4")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *home == "" || *bundle == "" || *slot < 1 || *slot > 4 || flags.NArg() != 0 {
			return errors.New("install-friday-comet-launch requires --home --bundle --slot 1..4")
		}
		seal, err := InstallFridayCometLaunch(*home, *bundle, *slot)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(seal)
	case "node":
		flags := flag.NewFlagSet("node", flag.ContinueOnError)
		home := flags.String("home", "", "POC network directory")
		slot := flags.Int("slot", 0, "validator slot 1..4")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *home == "" || *slot < 1 || *slot > 4 || flags.NArg() != 0 {
			return errors.New("node requires --home and --slot 1..4")
		}
		manifest, err := LoadNetworkManifest(*home)
		if err != nil {
			return err
		}
		if manifest.ApplicationAuthority == ApplicationAuthorityFrostCashu {
			if err := RequireFridayCometLaunch(*home, *slot); err != nil {
				return err
			}
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		return RunValidatorNode(ctx, *home, *slot)
	case "enable-funding-abort":
		flags := flag.NewFlagSet("enable-funding-abort", flag.ContinueOnError)
		home := flags.String("home", "", "fresh, never-started POC network directory")
		bootstrapPath := flags.String("bootstrap", "", "strict FundingAbort bootstrap JSON")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *home == "" || *bootstrapPath == "" || flags.NArg() != 0 {
			return errors.New("enable-funding-abort requires --home and --bootstrap")
		}
		raw, err := os.ReadFile(*bootstrapPath)
		if err != nil {
			return err
		}
		decoder := json.NewDecoder(strings.NewReader(string(raw)))
		decoder.DisallowUnknownFields()
		var bootstrap FundingAbortBootstrapV1
		if err := decoder.Decode(&bootstrap); err != nil {
			return err
		}
		if err := requireEOF(decoder); err != nil {
			return err
		}
		manifest, err := EnableFundingAbort(*home, bootstrap)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(manifest)
	case "network-facts":
		flags := flag.NewFlagSet("network-facts", flag.ContinueOnError)
		home := flags.String("home", "", "POC network directory")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *home == "" || flags.NArg() != 0 {
			return errors.New("network-facts requires --home")
		}
		facts, err := LoadNetworkFacts(*home)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(facts)
	case "serve":
		flags := flag.NewFlagSet("serve", flag.ContinueOnError)
		home := flags.String("home", "", "POC network directory")
		listen := flags.String("listen", "127.0.0.1:8080", "loopback site/API listen address")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *home == "" || flags.NArg() != 0 {
			return errors.New("serve requires --home")
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		return RunSite(ctx, *home, *listen)
	case "local-demo":
		flags := flag.NewFlagSet("local-demo", flag.ContinueOnError)
		home := flags.String("home", "", "fresh or existing POC network directory")
		listen := flags.String("listen", "127.0.0.1:8080", "loopback web listen address")
		committeePublicKey := flags.String("committee-public-key", "", "optional even-Y threshold public key for a fresh isolated network")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *home == "" || flags.NArg() != 0 {
			return errors.New("local-demo requires --home")
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		return RunLocalDemo(ctx, *home, *listen, *committeePublicKey)
	case "scenario":
		if os.Getenv("POC_ENABLE_LEGACY_INTERIM") != "true" {
			return errors.New("scenario is the retired Wednesday interim-note harness; set POC_ENABLE_LEGACY_INTERIM=true only in an isolated historical run, or use the Friday site acceptance harness")
		}
		flags := flag.NewFlagSet("scenario", flag.ContinueOnError)
		baseURL := flags.String("base-url", "http://127.0.0.1:8080", "POC site base URL")
		evidence := flags.String("evidence", "", "new evidence JSON output")
		if err := flags.Parse(arguments[1:]); err != nil {
			return err
		}
		if *evidence == "" || flags.NArg() != 0 {
			return errors.New("scenario requires --evidence")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		return RunScenario(ctx, *baseURL, *evidence)
	default:
		return fmt.Errorf("unknown command %q", arguments[0])
	}
}

func RunSite(ctx context.Context, root, listen string) error {
	host, _, err := net.SplitHostPort(listen)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return errors.New("site/API listener must be loopback; use a separately configured TLS reverse proxy")
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolve network root: %w", err)
	}
	manifest, err := LoadNetworkManifest(root)
	if err != nil {
		return err
	}
	api, err := NewAPIServer(manifest, nil)
	if err != nil {
		return err
	}
	closeTriggerEnabled, err := requireR20CloseTriggerActivation(root, listen, manifest, api)
	if err != nil {
		return err
	}
	wanted := 4
	if manifest.Mode == "remote" {
		wanted = 3 // keep the site available during the required one-node fault
	}
	if err := waitForValidators(ctx, api, wanted, 35*time.Second); err != nil {
		return err
	}
	handler, err := api.Handler()
	if err != nil {
		return err
	}
	httpServer := &http.Server{Addr: listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	if closeTriggerEnabled {
		port, err := newR20CloseHTTPPort(listen)
		if err != nil {
			return err
		}
		trigger := newR20CloseTrigger(port, time.Now)
		go runR20CloseTrigger(ctx, trigger, func(category string) {
			// Every category originates from the fixed allowlist in the trigger;
			// no response bodies, auction identifiers, or arbitrary error text are
			// emitted by this background maintenance path.
			fmt.Fprintf(os.Stderr, "FRIDAY_R20_CLOSE_TRIGGER|%s\n", category)
		})
	}
	serverErrors := make(chan error, 1)
	go func() {
		fmt.Fprintf(os.Stdout, "POC_SITE_READY http://%s chain=%s mode=%s fake_money_only=true\n", listen, manifest.ChainID, manifest.Mode)
		serverErrors <- httpServer.ListenAndServe()
	}()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdownCtx)
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

type validatorProcess struct {
	slot int
	cmd  *exec.Cmd
	log  *os.File
	done chan error
}

type localSupervisor struct {
	mu        sync.Mutex
	processes map[int]*validatorProcess
}

func RunLocalDemo(ctx context.Context, root, listen, committeePublicKey string) error {
	host, _, err := net.SplitHostPort(listen)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return errors.New("local-demo web listener must be loopback; use a separately reviewed reverse proxy for remote access")
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolve network root: %w", err)
	}
	if _, err := os.Stat(root); errors.Is(err, os.ErrNotExist) {
		if committeePublicKey == "" {
			_, err = InitLocalNetwork(root, DefaultPolicy())
		} else {
			_, err = InitLocalNetworkWithCommittee(root, DefaultPolicy(), committeePublicKey)
		}
		if err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else if committeePublicKey != "" {
		return errors.New("committee-public-key is accepted only when creating a fresh local-demo network")
	}
	manifest, err := LoadNetworkManifest(root)
	if err != nil {
		return err
	}
	reservations, err := reserveLocalPorts(manifest, listen)
	if err != nil {
		return err
	}
	for _, listener := range reservations {
		if err := listener.Close(); err != nil {
			return err
		}
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	logsDir := filepath.Join(root, "logs")
	if err := os.MkdirAll(logsDir, 0o700); err != nil {
		return err
	}
	supervisor := &localSupervisor{processes: map[int]*validatorProcess{}}
	for slot := 1; slot <= 4; slot++ {
		logFile, err := os.OpenFile(filepath.Join(logsDir, "validator-"+strconv.Itoa(slot)+".log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			supervisor.stopAll()
			return err
		}
		command := exec.Command(executable, "node", "--home", root, "--slot", strconv.Itoa(slot))
		command.Stdout = logFile
		command.Stderr = logFile
		command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		if err := command.Start(); err != nil {
			_ = logFile.Close()
			supervisor.stopAll()
			return fmt.Errorf("start validator %d: %w", slot, err)
		}
		process := &validatorProcess{slot: slot, cmd: command, log: logFile, done: make(chan error, 1)}
		supervisor.processes[slot] = process
		go func(current *validatorProcess) {
			waitErr := current.cmd.Wait()
			_ = current.log.Close()
			current.done <- waitErr
		}(process)
	}
	defer supervisor.stopAll()
	api, err := NewAPIServer(manifest, supervisor.stop)
	if err != nil {
		return err
	}
	if err := waitForValidators(ctx, api, 4, 35*time.Second); err != nil {
		return err
	}
	handler, err := api.Handler()
	if err != nil {
		return err
	}
	httpServer := &http.Server{Addr: listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	serverErrors := make(chan error, 1)
	go func() {
		fmt.Fprintf(os.Stdout, "POC_READY http://%s chain=%s validators=4 fake_money_only=true\n", listen, manifest.ChainID)
		serverErrors <- httpServer.ListenAndServe()
	}()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdownCtx)
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (supervisor *localSupervisor) stop(slot int) error {
	supervisor.mu.Lock()
	process := supervisor.processes[slot]
	if process == nil {
		supervisor.mu.Unlock()
		return errors.New("validator is already offline")
	}
	delete(supervisor.processes, slot)
	supervisor.mu.Unlock()
	if process.cmd.Process == nil {
		return errors.New("validator process was not started")
	}
	if err := syscall.Kill(-process.cmd.Process.Pid, syscall.SIGTERM); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	select {
	case <-process.done:
		return nil
	case <-time.After(10 * time.Second):
		_ = syscall.Kill(-process.cmd.Process.Pid, syscall.SIGKILL)
		return errors.New("validator required forced termination after bounded shutdown")
	}
}

func (supervisor *localSupervisor) stopAll() {
	supervisor.mu.Lock()
	slots := make([]int, 0, len(supervisor.processes))
	for slot := range supervisor.processes {
		slots = append(slots, slot)
	}
	supervisor.mu.Unlock()
	for _, slot := range slots {
		_ = supervisor.stop(slot)
	}
}

func waitForValidators(ctx context.Context, api *APIServer, count int, timeout time.Duration) error {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for {
		online := 0
		if api.manifest.Mode == "remote" {
			statuses, err := api.remoteValidatorStatuses(ctx)
			if err == nil {
				for _, status := range statuses {
					if status.Online && status.Height >= 1 && !status.CatchingUp {
						online++
					}
				}
			}
		} else {
			for index, client := range api.clients {
				checkCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
				status := api.nodeStatus(checkCtx, index, client)
				cancel()
				if status.Online && status.Height >= 1 && !status.CatchingUp {
					online++
				}
			}
		}
		if online >= count {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return fmt.Errorf("only %d of %d validators became ready", online, count)
		case <-ticker.C:
		}
	}
}
