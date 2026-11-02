package poc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
)

type ScenarioEvidence struct {
	Schema                    string       `json:"schema"`
	StartedAt                 string       `json:"started_at"`
	CompletedAt               string       `json:"completed_at"`
	BaseURL                   string       `json:"base_url"`
	AuctionID                 string       `json:"auction_id"`
	Seller                    string       `json:"seller"`
	BidderA                   string       `json:"bidder_a"`
	BidderB                   string       `json:"bidder_b"`
	CreateHeight              int64        `json:"create_height"`
	BidAHeight                int64        `json:"bid_a_height"`
	BidBHeight                int64        `json:"bid_b_height"`
	CloseHeight               int64        `json:"close_height"`
	RefundHeight              int64        `json:"refund_height"`
	InvalidBidHTTPStatus      int          `json:"invalid_bid_http_status"`
	InvalidBidError           string       `json:"invalid_bid_error"`
	SellerSpendableAfterClose int64        `json:"seller_spendable_after_close"`
	LoserSpendableAfterRefund int64        `json:"loser_spendable_after_refund"`
	WinnerSpendableAfterClose int64        `json:"winner_spendable_after_close"`
	Winner                    string       `json:"winner"`
	PaymentNoteID             string       `json:"payment_note_id"`
	RefundNoteID              string       `json:"refund_note_id"`
	ValidatorsBeforeOffline   []NodeStatus `json:"validators_before_offline"`
	ValidatorsAfterOffline    []NodeStatus `json:"validators_after_offline"`
	FinalAppHash              string       `json:"final_app_hash"`
	Passed                    bool         `json:"passed"`
	Notes                     []string     `json:"notes"`
}

type scenarioClient struct {
	base string
	http *http.Client
}

func RunScenario(ctx context.Context, baseURL, evidencePath string) error {
	started := time.Now().UTC()
	client := scenarioClient{base: strings.TrimRight(baseURL, "/"), http: &http.Client{Timeout: 25 * time.Second}}
	if err := client.waitReady(ctx); err != nil {
		return err
	}
	sellerKey, err := btcec.NewPrivateKey()
	if err != nil {
		return err
	}
	bidderAKey, err := btcec.NewPrivateKey()
	if err != nil {
		return err
	}
	bidderBKey, err := btcec.NewPrivateKey()
	if err != nil {
		return err
	}
	seller := actorForKey(sellerKey)
	bidderA := actorForKey(bidderAKey)
	bidderB := actorForKey(bidderBKey)
	for _, actor := range []string{bidderA, bidderB} {
		status, body, err := client.post(ctx, "/api/interim/faucet", map[string]string{"actor": actor})
		if err != nil || status != http.StatusOK {
			return fmt.Errorf("faucet %s: status=%d body=%v err=%w", actor[:8], status, body, err)
		}
	}
	auctionID := fmt.Sprintf("wednesday-%d", time.Now().UTC().UnixNano())
	createdAt := time.Now().UTC().Unix()
	createBody, _ := json.Marshal(createContent{AuctionID: auctionID, Title: "Wednesday POC item", Duration: 6, StartingBid: 100, Reserve: 150})
	createEvent, err := SignNostrEvent(sellerKey, createdAt, KindCreate, [][]string{{"t", "plebeian-auctions-poc"}, {"auction", auctionID}}, string(createBody))
	if err != nil {
		return err
	}
	createHeight, err := client.postEvent(ctx, createEvent)
	if err != nil {
		return err
	}
	stateA, err := client.state(ctx, bidderA)
	if err != nil || len(stateA.Wallet.Notes) != 1 {
		return fmt.Errorf("bidder A faucet note: notes=%d err=%w", len(stateA.Wallet.Notes), err)
	}
	firstAInput := stateA.Wallet.Notes[0].ID
	bidABody, _ := json.Marshal(bidContent{AuctionID: auctionID, Amount: 120, Inputs: []string{firstAInput}})
	bidAEvent, err := SignNostrEvent(bidderAKey, time.Now().UTC().Unix(), KindBid, [][]string{{"auction", auctionID}}, string(bidABody))
	if err != nil {
		return err
	}
	bidAHeight, err := client.postEvent(ctx, bidAEvent)
	if err != nil {
		return err
	}
	stateB, err := client.state(ctx, bidderB)
	if err != nil || len(stateB.Wallet.Notes) != 1 {
		return fmt.Errorf("bidder B faucet note: notes=%d err=%w", len(stateB.Wallet.Notes), err)
	}
	bidBBody, _ := json.Marshal(bidContent{AuctionID: auctionID, Amount: 180, Inputs: []string{stateB.Wallet.Notes[0].ID}})
	bidBEvent, err := SignNostrEvent(bidderBKey, time.Now().UTC().Unix(), KindBid, [][]string{{"auction", auctionID}}, string(bidBBody))
	if err != nil {
		return err
	}
	bidBHeight, err := client.postEvent(ctx, bidBEvent)
	if err != nil {
		return err
	}
	invalidBody, _ := json.Marshal(bidContent{AuctionID: auctionID, Amount: 220, Inputs: []string{firstAInput}})
	invalidEvent, err := SignNostrEvent(bidderAKey, time.Now().UTC().Unix(), KindBid, [][]string{{"auction", auctionID}}, string(invalidBody))
	if err != nil {
		return err
	}
	invalidStatus, invalidResponse, invalidErr := client.post(ctx, "/api/event", invalidEvent)
	if invalidErr != nil {
		return invalidErr
	}
	if invalidStatus != http.StatusUnprocessableEntity {
		return fmt.Errorf("unfunded spent-note bid was not rejected: status=%d body=%v", invalidStatus, invalidResponse)
	}
	invalidMessage, _ := invalidResponse["error"].(string)
	validatorsBefore, err := client.validators(ctx)
	if err != nil {
		return err
	}
	if err := assertValidators(validatorsBefore, 4); err != nil {
		return err
	}
	state, err := client.state(ctx, seller)
	if err != nil {
		return err
	}
	auction := state.State.Auctions[auctionID]
	for time.Now().UTC().Unix() <= auction.EndTime {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
	offlineStatus, offlineBody, err := client.post(ctx, "/api/admin/offline", map[string]int{"slot": 4})
	if err != nil || offlineStatus != http.StatusOK {
		return fmt.Errorf("take validator 4 offline: status=%d body=%v err=%w", offlineStatus, offlineBody, err)
	}
	closeStatus, closeBody, err := client.post(ctx, "/api/close", map[string]string{"auction_id": auctionID})
	if err != nil || closeStatus != http.StatusOK {
		return fmt.Errorf("close with validator 4 offline: status=%d body=%v err=%w", closeStatus, closeBody, err)
	}
	closeHeight := numberField(closeBody, "height")
	stateSeller, err := client.state(ctx, seller)
	if err != nil {
		return err
	}
	closed := stateSeller.State.Auctions[auctionID]
	if stateSeller.Wallet.Spendable != 180 || closed.Winner != bidderB || closed.PaymentNoteID == "" {
		return fmt.Errorf("seller payout mismatch: balance=%d winner=%s payment=%s", stateSeller.Wallet.Spendable, closed.Winner, closed.PaymentNoteID)
	}
	refundBody, _ := json.Marshal(refundContent{BidID: bidAEvent.ID})
	refundEvent, err := SignNostrEvent(bidderAKey, time.Now().UTC().Unix(), KindRefund, [][]string{{"auction", auctionID}, {"bid", bidAEvent.ID}}, string(refundBody))
	if err != nil {
		return err
	}
	refundHeight, err := client.postEvent(ctx, refundEvent)
	if err != nil {
		return err
	}
	loser, err := client.state(ctx, bidderA)
	if err != nil {
		return err
	}
	winner, err := client.state(ctx, bidderB)
	if err != nil {
		return err
	}
	if loser.Wallet.Spendable != 10_000 || loser.Wallet.Refundable != 0 {
		return fmt.Errorf("loser recovery mismatch: spendable=%d refundable=%d", loser.Wallet.Spendable, loser.Wallet.Refundable)
	}
	if winner.Wallet.Spendable != 9_820 || winner.Wallet.Locked != 0 {
		return fmt.Errorf("winner payment mismatch: spendable=%d locked=%d", winner.Wallet.Spendable, winner.Wallet.Locked)
	}
	refundNoteID := loser.State.Locks[bidAEvent.ID].OutputNoteID
	if refundNoteID == "" {
		return errors.New("loser refund did not create a signed output note")
	}
	if err := waitForHeightAfter(ctx, client, refundHeight); err != nil {
		return err
	}
	validatorsAfter, err := client.validators(ctx)
	if err != nil {
		return err
	}
	if err := assertValidators(validatorsAfter, 3); err != nil {
		return err
	}
	if validatorsAfter[3].Online {
		return errors.New("validator 4 still reports online")
	}
	final, err := client.state(ctx, seller)
	if err != nil {
		return err
	}
	evidence := ScenarioEvidence{
		Schema: "PlebeianAuctionsPOCScenarioEvidenceV1", StartedAt: started.Format(time.RFC3339Nano), CompletedAt: time.Now().UTC().Format(time.RFC3339Nano), BaseURL: client.base,
		AuctionID: auctionID, Seller: seller, BidderA: bidderA, BidderB: bidderB, CreateHeight: createHeight, BidAHeight: bidAHeight, BidBHeight: bidBHeight,
		CloseHeight: closeHeight, RefundHeight: refundHeight, InvalidBidHTTPStatus: invalidStatus, InvalidBidError: invalidMessage,
		SellerSpendableAfterClose: stateSeller.Wallet.Spendable, LoserSpendableAfterRefund: loser.Wallet.Spendable, WinnerSpendableAfterClose: winner.Wallet.Spendable,
		Winner: closed.Winner, PaymentNoteID: closed.PaymentNoteID, RefundNoteID: refundNoteID, ValidatorsBeforeOffline: validatorsBefore, ValidatorsAfterOffline: validatorsAfter,
		FinalAppHash: final.AppHash, Passed: true,
		Notes: []string{"fresh private Nostr keys were generated in process and were not persisted", "validator 4 was stopped before close and refund", "test-mint notes carry real Ed25519 signatures from the documented shared application key"},
	}
	return writeEvidenceExclusive(evidencePath, evidence)
}

func actorForKey(key *btcec.PrivateKey) string {
	event, _ := SignNostrEvent(key, 1, KindBid, nil, "{}")
	return event.PubKey
}

func (client scenarioClient) waitReady(ctx context.Context) error {
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for {
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, client.base+"/api/config", nil)
		response, err := client.http.Do(request)
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (client scenarioClient) postEvent(ctx context.Context, event SignedEvent) (int64, error) {
	status, body, err := client.post(ctx, "/api/event", event)
	if err != nil || status != http.StatusOK {
		return 0, fmt.Errorf("post signed event kind %d: status=%d body=%v err=%w", event.Kind, status, body, err)
	}
	return numberField(body, "height"), nil
}

func (client scenarioClient) post(ctx context.Context, path string, value any) (int, map[string]any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return 0, nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.base+path, bytes.NewReader(raw))
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.http.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	limited, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return 0, nil, err
	}
	body := map[string]any{}
	if err := json.Unmarshal(limited, &body); err != nil {
		return response.StatusCode, nil, fmt.Errorf("decode %s response: %w", path, err)
	}
	return response.StatusCode, body, nil
}

func (client scenarioClient) state(ctx context.Context, actor string) (StateView, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, client.base+"/api/state?actor="+actor, nil)
	response, err := client.http.Do(request)
	if err != nil {
		return StateView{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return StateView{}, fmt.Errorf("state HTTP %d: %s", response.StatusCode, raw)
	}
	var view StateView
	if err := json.NewDecoder(response.Body).Decode(&view); err != nil {
		return StateView{}, err
	}
	return view, nil
}

func (client scenarioClient) validators(ctx context.Context) ([]NodeStatus, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, client.base+"/api/validators", nil)
	response, err := client.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var value struct {
		Validators []NodeStatus `json:"validators"`
	}
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		return nil, err
	}
	return value.Validators, nil
}

func assertValidators(statuses []NodeStatus, expectedOnline int) error {
	if len(statuses) != 4 {
		return fmt.Errorf("validator status count = %d", len(statuses))
	}
	nodes := map[string]bool{}
	validators := map[string]bool{}
	online := 0
	var hash string
	for _, status := range statuses {
		if !status.Online {
			continue
		}
		online++
		if nodes[status.NodeID] || validators[status.ValidatorAddress] || status.NodeID == "" || status.ValidatorAddress == "" {
			return errors.New("validator consensus identities are missing or duplicated")
		}
		nodes[status.NodeID] = true
		validators[status.ValidatorAddress] = true
		if hash == "" {
			hash = status.AppHash
		} else if status.AppHash != hash {
			return errors.New("online validators disagree on application hash")
		}
	}
	if online != expectedOnline {
		return fmt.Errorf("online validators = %d, want %d", online, expectedOnline)
	}
	return nil
}

func waitForHeightAfter(ctx context.Context, client scenarioClient, height int64) error {
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for {
		statuses, err := client.validators(ctx)
		if err == nil {
			ready := 0
			for _, status := range statuses {
				if status.Online && status.Height >= height+2 && status.CommitSignatures >= 3 {
					ready++
				}
			}
			if ready == 3 {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func numberField(value map[string]any, key string) int64 {
	number, _ := value[key].(float64)
	return int64(number)
}

func writeEvidenceExclusive(path string, evidence ScenarioEvidence) error {
	raw, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(append(raw, '\n')); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}
