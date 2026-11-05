# Live five-member acceptance — R36

Date: 2026-11-05 UTC

Scope: public HTTPS demo using disposable browser identities and fake test sats only.
No real funds, wallet secrets, bearer proofs, private keys, or Basic Auth
credentials are included in this record.

## Result

`PLEBEIAN_LIVE_FIVE_MEMBER_BROWSER_ACCEPTANCE_V1`: **PASS**

- Five distinct browser identities signed in.
- Each identity received 10,000 fake sats.
- Auction `auction-1793860304932` was created with seller approvals enabled.
- Threshold-backed bids of 100, 200, 300, and 400 sats were admitted.
- The auction closed automatically with a 400-sat winning bid.
- The three displaced bidders imported their certified outbid returns.
- The seller imported and acknowledged the 400-sat winner payout.
- Four validator signatures were observed.

Final browser-owned wallet balances:

| Role | Spendable | Locked | Pending |
| --- | ---: | ---: | ---: |
| Seller | 10,400 | 0 | 0 |
| Bidder A | 10,000 | 0 | 0 |
| Bidder B | 10,000 | 0 | 0 |
| Bidder C | 10,000 | 0 | 0 |
| Bidder D (winner) | 9,600 | 0 | 0 |

Total after settlement: 50,000 fake sats.

## Post-run reconciliation

- Observer, coordinator, authority, and site were active with zero restarts and
  successful main-process status.
- The four newest terminal exchange records were acknowledged: refunds of 100,
  200, and 300 sats, and a winner settlement of 400 sats.
- The matching coordinator records were all `completed` at revision 3.

## R36 artifact pins

- Authority: `0369e443008ee4527e186a3690c2e1d1c90d5263105eecb94d75bf19b009c5df`
- Coordinator: `34a91af63d4a86701daf2fdafaf5279c684c7c37c77cdf94523b307b68a80fb4`
- Terminal executor: `4598dac4336348878db61d8f4ea8f5e8e57b459ac2563fea0b5a2005ef46f222`

The R36 fixture verifier passed for both coordinator and authority targets.
The focused terminal/coordinator suite passed 46 tests with 205 expectations.
