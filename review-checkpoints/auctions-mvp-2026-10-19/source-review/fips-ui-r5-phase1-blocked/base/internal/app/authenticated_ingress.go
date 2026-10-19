package app

import (
	"bytes"
	"fmt"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/bidauth"
	abci "github.com/cometbft/cometbft/abci/types"
)

const (
	authCandidateRawLimit  = uint64(76512)
	authSelectedRawLimit   = uint64(38256)
	authSelectedProtoLimit = int64(38304)
)

func exactGenesisBytes(received, expected []byte) bool { return bytes.Equal(received, expected) }

type AuthenticatedConfig struct {
	Profile         bidauth.Profile
	Verifier        bidauth.SignatureVerifier
	GenesisAppState []byte
}

func (config AuthenticatedConfig) Validate(policy auction.Policy) error {
	if err := config.Profile.Validate(); err != nil {
		return err
	}
	if policy.MaxCommandBytes != bidauth.DemoMaxCommandBytes || policy.MaxCandidateCount != 32 || policy.MaxCandidateBytes != 65536 || policy.MaxProposalCount != 16 || policy.MaxProposalBytes != 32768 {
		return fmt.Errorf("app: auction policy does not match DEMO_AUTH_V1 budgets")
	}
	if config.Verifier == nil {
		return fmt.Errorf("app: signature verifier is unavailable")
	}
	if len(config.GenesisAppState) == 0 || len(config.GenesisAppState) > 16*1024 {
		return fmt.Errorf("app: exact authenticated genesis app_state bytes are required")
	}
	return nil
}

type authenticatedTransaction struct {
	bid              bidauth.VerifiedBid
	command          auction.Command
	raw              []byte
	consensusSeconds int64
}

func NewAuthenticatedApplication(policy auction.Policy, config AuthenticatedConfig, genesis auction.State, store *DurableStore) (*Application, error) {
	if err := config.Validate(policy); err != nil {
		return nil, err
	}
	if store == nil {
		return nil, fmt.Errorf("app: DEMO_AUTH_V1 requires a durable store")
	}
	if err := auction.ValidateState(genesis, policy); err != nil {
		return nil, fmt.Errorf("app: invalid authenticated genesis: %w", err)
	}
	if genesis.LastConsensusSeconds != 0 || len(genesis.Auctions) != 1 || len(genesis.Reservations) != 0 || len(genesis.Operations) != 0 || genesis.LastServedBidAuction != "" || len(genesis.LastServedBidder) != 0 || genesis.LastServedCreator != "" {
		return nil, fmt.Errorf("app: authenticated V2 requires one fresh auction and empty consensus history")
	}
	for _, initialAuction := range genesis.Auctions {
		if initialAuction.Status != auction.AuctionOpen || initialAuction.ClosedSeconds != 0 || len(initialAuction.Bids) != 0 || initialAuction.BidSequence != 0 || initialAuction.LeaderBidID != "" || initialAuction.WinnerBidID != "" || initialAuction.CloseOutcome != "" {
			return nil, fmt.Errorf("app: authenticated V2 genesis auction must be open and bid-free")
		}
	}
	hash, err := auction.CanonicalHash(genesis, policy)
	if err != nil {
		return nil, err
	}
	if store.genesisHash != hash {
		return nil, fmt.Errorf("app: durable store genesis hash mismatch")
	}
	config.GenesisAppState = append([]byte(nil), config.GenesisAppState...)
	application := &Application{policy: policy, limits: AdapterLimits{MaxRawTransactionBytes: bidauth.DemoMaxRawBytes, MaxRawCandidateBytes: authCandidateRawLimit, MaxRawProposalBytes: authSelectedRawLimit}, committed: genesis, committedHash: hash, auth: &config, store: store}
	if state, _, recoveredHash, height, ok := store.Recovered(); ok {
		application.committed = state
		application.committedHash = recoveredHash
		application.committedHeight = height
		application.hasCommitted = true
	}
	return application, nil
}

func (app *Application) authenticate(raw []byte, consensusSeconds int64) (authenticatedTransaction, error) {
	if app.auth == nil {
		return authenticatedTransaction{}, fmt.Errorf("app: authenticated ingress is disabled")
	}
	signed, err := bidauth.DecodeWire(raw, app.auth.Profile)
	if err != nil {
		return authenticatedTransaction{}, err
	}
	bid, err := bidauth.VerifyProfileBid(signed, app.auth.Profile, consensusSeconds, app.policy, app.auth.Verifier)
	if err != nil {
		return authenticatedTransaction{}, err
	}
	command, err := auction.DecodeCommand(bid.CanonicalCommand(), app.policy)
	if err != nil {
		return authenticatedTransaction{}, err
	}
	if err := validateAuthenticatedBidNumericDomain(command); err != nil {
		return authenticatedTransaction{}, err
	}
	return authenticatedTransaction{bid: bid, command: command, raw: append([]byte(nil), raw...), consensusSeconds: consensusSeconds}, nil
}

func (app *Application) checkAuthenticated(raw []byte) error {
	if app.auth == nil {
		return fmt.Errorf("app: authenticated ingress disabled")
	}
	signed, err := bidauth.DecodeWire(raw, app.auth.Profile)
	if err != nil {
		return err
	}
	verified, err := bidauth.VerifyEvent(signed, bidauth.EventLimitsForProfile(), app.auth.Verifier)
	if err != nil {
		return err
	}
	if _, err = bidauth.ValidateProfileEvent(verified, app.auth.Profile, verified.CreatedAt()); err != nil {
		return err
	}
	bid, err := bidauth.BindCanonicalBid(verified, app.policy)
	if err != nil {
		return err
	}
	command, err := auction.DecodeCommand(bid.CanonicalCommand(), app.policy)
	if err != nil {
		return err
	}
	return validateAuthenticatedBidNumericDomain(command)
}

func validateAuthenticatedBidNumericDomain(command auction.Command) error {
	if command.Kind != auction.CommandBid {
		return fmt.Errorf("app: authenticated command is not a Bid")
	}
	var total int64
	for _, reservation := range command.Reservations {
		if reservation.Amount < 1 || reservation.Amount > bidauth.DemoMaxInteger {
			return fmt.Errorf("app: authenticated reservation amount exceeds shared safe-integer domain")
		}
		if total > bidauth.DemoMaxInteger-reservation.Amount {
			return fmt.Errorf("app: authenticated reservation sum exceeds shared safe-integer domain")
		}
		total += reservation.Amount
	}
	if command.Amount < 1 || command.Amount > bidauth.DemoMaxInteger {
		return fmt.Errorf("app: authenticated Bid amount exceeds shared safe-integer domain")
	}
	if total != command.Amount {
		return fmt.Errorf("app: authenticated reservation sum does not equal Bid amount")
	}
	return nil
}

func (app *Application) prepareAuthenticated(request *abci.PrepareProposalRequest) (*abci.PrepareProposalResponse, AdapterMetrics, error) {
	if request == nil {
		return nil, AdapterMetrics{}, fmt.Errorf("app: nil PrepareProposal request")
	}
	seconds, err := consensusContext(request.Height, request.Time)
	if err != nil {
		return nil, AdapterMetrics{}, err
	}
	state, height, hasCommitted, _ := app.committedSnapshot()
	if err := validateNextHeight(request.Height, height, hasCommitted); err != nil {
		return nil, AdapterMetrics{}, err
	}
	if !hasCommitted && request.Height != app.auth.Profile.ActivationHeight {
		return nil, AdapterMetrics{}, fmt.Errorf("app: first authenticated height must be activation height 1")
	}
	advanced, err := auction.AdvanceConsensusTime(state, request.Height, seconds, app.policy)
	if err != nil {
		return nil, AdapterMetrics{}, fmt.Errorf("app: advance consensus time: %w", err)
	}
	state = advanced.State
	if request.MaxTxBytes <= 0 {
		return &abci.PrepareProposalResponse{}, AdapterMetrics{FullStateClones: advanced.FullStateClones}, nil
	}
	metrics := AdapterMetrics{}
	authenticated := make([]authenticatedTransaction, 0, app.policy.MaxCandidateCount)
	candidates := make([]auction.Candidate, 0, app.policy.MaxCandidateCount)
	for _, raw := range request.Txs {
		if metrics.Examined >= app.policy.MaxCandidateCount {
			break
		}
		next, ok := checkedAdd(metrics.RawBytes, uint64(len(raw)))
		if !ok || next > authCandidateRawLimit {
			break
		}
		metrics.Examined++
		metrics.RawBytes = next
		transaction, err := app.authenticate(raw, seconds)
		if err != nil {
			continue
		}
		nextCommand, ok := checkedAdd(metrics.PayloadBytes, uint64(len(transaction.bid.CanonicalCommand())))
		if !ok || nextCommand > app.policy.MaxCandidateBytes {
			break
		}
		metrics.PayloadBytes = nextCommand
		authenticated = append(authenticated, transaction)
		candidates = append(candidates, auction.Candidate{ActorID: transaction.bid.ActorID(), Raw: transaction.bid.CanonicalCommand()})
	}
	scheduled, err := auction.Schedule(state, candidates, seconds, app.policy)
	if err != nil {
		return nil, metrics, err
	}
	metrics.DomainExamined = scheduled.Metrics.Examined
	metrics.FullStateClones = advanced.FullStateClones + scheduled.Metrics.FullStateClones
	response := &abci.PrepareProposalResponse{Txs: make([][]byte, 0, len(scheduled.Proposal.Entries))}
	used := make([]bool, len(authenticated))
	var rawTotal uint64
	var protoTotal int64
	for _, entry := range scheduled.Proposal.Entries {
		index := -1
		for candidate := range authenticated {
			if !used[candidate] && authenticated[candidate].bid.ActorID() == entry.ActorID && bytes.Equal(authenticated[candidate].bid.CanonicalCommand(), entry.Payload) {
				index = candidate
				break
			}
		}
		if index < 0 {
			return nil, metrics, fmt.Errorf("app: authenticated scheduler mapping failed")
		}
		raw := authenticated[index].raw
		next, ok := checkedAdd(rawTotal, uint64(len(raw)))
		framed := cometProtoSizeForTxs([][]byte{raw})
		effective := request.MaxTxBytes
		if effective > authSelectedProtoLimit {
			effective = authSelectedProtoLimit
		}
		if !ok || next > authSelectedRawLimit || framed < 0 || protoTotal > effective-framed {
			break
		}
		used[index] = true
		response.Txs = append(response.Txs, raw)
		rawTotal = next
		protoTotal += framed
	}
	return response, metrics, nil
}

func (app *Application) decodeAuthenticatedProposal(rawTransactions [][]byte, seconds int64) (auction.Proposal, []authenticatedTransaction, AdapterMetrics, error) {
	metrics := AdapterMetrics{}
	if len(rawTransactions) > app.policy.MaxProposalCount {
		return auction.Proposal{}, nil, metrics, fmt.Errorf("app: proposal count exceeds authenticated limit")
	}
	proposal := auction.Proposal{ConsensusSeconds: seconds, Entries: make([]auction.ProposalEntry, 0, len(rawTransactions))}
	transactions := make([]authenticatedTransaction, 0, len(rawTransactions))
	for _, raw := range rawTransactions {
		metrics.Examined++
		next, ok := checkedAdd(metrics.RawBytes, uint64(len(raw)))
		if !ok || next > authSelectedRawLimit {
			return auction.Proposal{}, nil, metrics, fmt.Errorf("app: raw proposal bytes exceed authenticated limit")
		}
		metrics.RawBytes = next
		transaction, err := app.authenticate(raw, seconds)
		if err != nil {
			return auction.Proposal{}, nil, metrics, err
		}
		commandBytes := transaction.bid.CanonicalCommand()
		nextPayload, ok := checkedAdd(metrics.PayloadBytes, uint64(len(commandBytes)))
		if !ok || nextPayload > app.policy.MaxProposalBytes {
			return auction.Proposal{}, nil, metrics, fmt.Errorf("app: proposal command bytes exceed authenticated limit")
		}
		metrics.PayloadBytes = nextPayload
		transactions = append(transactions, transaction)
		proposal.Entries = append(proposal.Entries, auction.ProposalEntry{ActorID: transaction.bid.ActorID(), Payload: commandBytes})
	}
	if cometProtoSizeForTxs(rawTransactions) > authSelectedProtoLimit {
		return auction.Proposal{}, nil, metrics, fmt.Errorf("app: proposal protobuf bytes exceed authenticated limit")
	}
	return proposal, transactions, metrics, nil
}
