# Phase 1 Payment System Test Plan

Network: **Signet (Mutinynet)**
LDK Node: **ldk-node 0.7** via Tauri commands
LSP: **LTBL (Let There Be Lightning)** — `0371d6fd7d75de2d0372d03ea00e8bacdacb50c27d0eaea0a76a0622eff1f5ef2b` @ `44.228.24.253:9735`

## Prerequisites

1. **Signet faucet access** — Mutinynet faucet at https://faucet.mutinynet.com for funding the on-chain wallet
2. **LTBL LSP availability** — The LSPS2 endpoint at `44.228.24.253:9735` must be reachable
3. **Esplora endpoint** — At least one of these must be healthy:
   - `https://mutinynet.ltbl.io/api` (primary)
   - `https://mutinynet.com/api` (fallback)
   - `https://mempool.space/signet/api` (fallback)
4. **Two instances** — Tests require both a listener node and an artist node. Run two app instances or use a second LDK node via the Rust test harness.
5. **Test audio file** — Any MP3 in `test-data/keypair/` (e.g., `dev_null.mp3`)

## Area 1: Streaming Payment End-to-End (P1)

### Test 1.1 — Create identity and start LDK node

**Steps:**
1. Call `identity_create` with `displayName: "Test Listener"`
2. Verify returned `IdentityInfo` has `npub`, `pubkey_hex`, and `has_nsec: true`
3. Call `ldk_start` with `artistMode: false`
4. Verify returned `NodeInfo`:
   - `network` is `"signet"`
   - `is_running` is `true`
   - `node_id` is a 66-char hex string (33-byte compressed pubkey)
   - `artist_mode` is `false`

**Expected:** Node starts on signet, connects to LTBL LSP via LSPS2, begins chain sync via Esplora.

**Pass criteria:** `ldk_get_info` returns `is_running: true` with a valid `node_id`.

### Test 1.2 — Fund the on-chain wallet

**Steps:**
1. Call `ldk_new_address` to get a signet receive address
2. Send signet BTC from the Mutinynet faucet to this address (minimum 50,000 sats recommended)
3. Wait for confirmation (~30 seconds on Mutinynet)
4. Poll `ldk_get_balance` until `spendable_onchain_sats > 0`

**Expected:** On-chain balance reflects the faucet deposit.

**Pass criteria:** `ldk_get_balance` returns `spendable_onchain_sats >= 50000`.

### Test 1.3 — LSPS2 channel from LSP

**Steps:**
1. The LSPS2 JIT channel is created automatically on first inbound payment attempt, or when the node needs inbound liquidity
2. Listen for `ldk-event` with `event_type: "channel_pending"` where `counterparty_node_id` matches the LTBL LSP node ID
3. Wait for `event_type: "channel_ready"`
4. Call `ldk_list_channels` and verify at least one channel exists with:
   - `peer_node_id` matching `0371d6fd7d75de2d0372d03ea00e8bacdacb50c27d0eaea0a76a0622eff1f5ef2b`
   - `is_usable: true`
   - `is_channel_ready: true`

**Expected:** LSPS2 JIT channel is opened by the LSP, providing inbound liquidity.

**Pass criteria:** `ldk_list_channels` shows at least one usable channel with the LSP.

**Note:** LSPS2 channels are opened on-demand. If no channel appears after funding, trigger a small inbound payment to provoke the JIT open.

### Test 1.4 — Streaming payment fires (keysend with custom TLV)

**Preconditions:** Artist node running in `artist_mode: true` with a known `node_id`. Listener has a funded channel.

**Steps:**
1. Call `stream_start` with:
   - `trackId`: any string (e.g., `"test-track-001"`)
   - `artistPubkey`: the artist's Nostr hex pubkey
   - `lightningNodeId`: the artist's 66-char Lightning node_id
   - `artistDirect`: `true`
2. Verify returned `StreamSession` has `is_playing: true`, `intervals_paid: 0`
3. Wait 60 seconds, then call `stream_tick`
4. Verify returned `IntervalResult`:
   - `artist_sats` is `100` (direct, no rake)
   - `platform_sats` is `0`
   - `listener_sats` is `100`
   - `credits_depleted` is `false`
   - `session.intervals_paid` is `1`

**Expected:** Keysend of 100,000 msat (100 sats) sent to the artist's node with TLV records attached.

**Pass criteria:** `stream_tick` returns successfully. Artist node receives `payment_received` event with `amount_msat: 100000`.

### Test 1.5 — Verify TLV records in keysend

**Steps:**
1. On the artist node, listen for `ldk-event` with `event_type: "payment_received"`
2. Inspect the `custom_records` on the artist side (requires Rust-level inspection, see validation script)
3. Verify TLV records contain:
   - Type `696969` (TLV_TRACK_ID) — value decodes to the track_id string
   - Type `696971` (TLV_LISTENER_PUBKEY) — value decodes to the listener's Nostr pubkey
   - Type `696973` (TLV_TIMESTAMP) — value decodes to a recent Unix timestamp (within 5 seconds of send time)

**Expected:** All three TLV types are present and contain valid data.

**Pass criteria:** All three TLV records are present, parseable, and semantically correct.

**Note:** The frontend `ldk-event` listener does not currently expose `custom_records`. This verification requires either Rust-level test code or adding custom_records to the `LdkEventPayload`.

### Test 1.6 — Credits deduction and keysend failure rollback

**Steps:**
1. Call `credits_info` and note `remaining_sats`
2. Call `stream_tick` — verify `credits_remaining` decreased by 100
3. Stop the LDK node (`ldk_stop`) while a stream session is active
4. Call `stream_tick` again — the keysend should fail because the node is down
5. Verify `credits_remaining` is refunded (increased by 100 back to pre-tick value)

**Expected:** Credits are deducted optimistically before keysend. On keysend failure, credits are refunded.

**Pass criteria:**
- After successful tick: `credits_remaining = previous - 100`
- After failed keysend: `credits_remaining = previous` (refund applied)

### Test 1.7 — Mirror rake split

**Steps:**
1. Call `stream_start` with `artistDirect: false`
2. Call `stream_tick`
3. Verify `IntervalResult`:
   - `artist_sats` is `90`
   - `platform_sats` is `10`
   - `listener_sats` is `100`

**Expected:** 10% rake to platform when content served from mirror.

**Pass criteria:** Split sums to 100 sats. Artist gets 90, platform gets 10.


## Area 2: Artist Withdrawal (P2)

### Test 2.1 — Artist receives keysend payments

**Preconditions:** Artist node running in `artist_mode: true` with a usable channel.

**Steps:**
1. From the listener node, execute `stream_tick` to send a keysend to the artist
2. On the artist node, listen for `ldk-event` with `event_type: "payment_received"`
3. Verify `amount_msat` is `100000` (100 sats)
4. Send 5 more `stream_tick` calls (total 6 intervals)

**Expected:** Artist accumulates 600 sats from 6 streaming intervals.

**Pass criteria:** `ldk_get_balance` on artist node shows `total_lightning_sats >= 600`.

### Test 2.2 — Check balance via `ldk_get_balance`

**Steps:**
1. Call `ldk_get_balance` on the artist node
2. Verify:
   - `total_lightning_sats` reflects received keysend payments
   - `outbound_capacity_sats > 0` (artist can spend what they've received)
   - `inbound_capacity_sats > 0` (channel has room for more inbound)

**Expected:** Balance accurately reflects accumulated streaming payments.

**Pass criteria:** `total_lightning_sats >= 600` after 6 payments.

### Test 2.3 — On-chain withdrawal to signet address

**Steps:**
1. Generate a destination address (e.g., from the Mutinynet faucet return address or a second wallet)
2. Call `withdraw_onchain` with:
   - `address`: a valid signet address (must start with `tb1`)
   - `amountSats`: e.g., `500`
3. Verify returned `OnchainResult` has a `txid` (64-char hex string)
4. Wait for confirmation, then verify `ldk_get_balance` shows reduced `spendable_onchain_sats`

**Expected:** On-chain transaction created and broadcast.

**Pass criteria:** Valid `txid` returned. Balance decreases by at least the withdrawn amount.

### Test 2.4 — Address network validation (signet only)

**Steps:**
1. Call `withdraw_onchain` with a **mainnet** address (e.g., `bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4`)
2. Verify it returns an error containing `"not valid for signet"`
3. Call `withdraw_onchain` with a **testnet3** address (e.g., `tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx`)
4. Verify behavior (testnet3 and signet share the `tb1` prefix — this may succeed or fail depending on bech32 validation)
5. Call `withdraw_onchain` with garbage input (e.g., `"not-an-address"`)
6. Verify it returns an error containing `"Invalid Bitcoin address"`

**Expected:** Only signet-valid addresses are accepted. Mainnet addresses are rejected.

**Pass criteria:** Mainnet address is rejected with clear error. Invalid input is rejected.

### Test 2.5 — Lightning invoice withdrawal

**Steps:**
1. On a separate node, call `ldk_create_invoice` with `amountSats: 200`, `description: "test withdrawal"`
2. Copy the `bolt11` string
3. On the artist node, call `withdraw_lightning` with the invoice
4. Verify returned `PaymentResult` has a `payment_id` and `amount_msat: 200000`
5. Verify the receiving node gets `payment_received` event

**Expected:** BOLT 11 payment completes successfully.

**Pass criteria:** Payment settles. Receiving node confirms receipt.


## Area 3: Dashboard Verification (P2)

### Test 3.1 — Earnings display after payments flow

**Preconditions:** Artist node running. Several streaming payments have been sent.

**Steps:**
1. Open the DashboardView in the app
2. Verify the stats row shows:
   - **Total Earned**: sum of all `payment_received` amounts (in sats)
   - **Total Spent**: sum of all `payment_successful` amounts (in sats)
   - **Net**: earned minus spent
   - **Rate**: sats/min average since session start

**Expected:** All stat cards reflect actual payment activity.

**Pass criteria:** Numbers are non-zero and mathematically consistent (net = earned - spent).

### Test 3.2 — Payment history entries

**Steps:**
1. Trigger several payments (both sending and receiving)
2. Verify the EarningsFeed shows entries with:
   - Correct `type` (`"received"` or `"sent"`)
   - Correct `amount_sats`
   - Recent `timestamp`
   - Entries ordered newest-first

**Expected:** Each LDK payment event generates a corresponding feed entry.

**Pass criteria:** Feed entries match LDK events in count, type, and amount.

### Test 3.3 — LDK event rendering

**Steps:**
1. Trigger each event type and verify it appears in the dashboard:
   - `payment_received` — appears as "received" entry with correct sats
   - `payment_successful` — appears as "sent" entry with correct sats
   - `payment_failed` — should NOT create an earnings entry (verify no phantom entry)
2. Verify `payment_failed` events do NOT inflate the totalSpent counter

**Expected:** Only successful payments affect the earnings/spending totals.

**Pass criteria:**
- `payment_received` increments totalEarned
- `payment_successful` increments totalSpent
- `payment_failed` does not affect either counter

### Test 3.4 — Balance refresh after payments

**Steps:**
1. Note the balance shown in NodeStatus
2. Trigger a payment (send or receive)
3. Verify the balance updates within 10 seconds (the polling interval)
4. Alternatively, observe that the `refreshBalance()` call happens immediately after a payment event

**Expected:** Balance updates promptly after payments.

**Pass criteria:** NodeStatus balance reflects the payment within one polling cycle.


## Known Limitations

1. **Signet-only** — All tests run on Mutinynet signet. No mainnet testing.
2. **LSP dependency** — LSPS2 channel opening depends on LTBL availability. If the LSP is down, channel tests will fail.
3. **Two-node requirement** — Full e2e payment tests require both a listener and artist node. Running two Tauri instances simultaneously requires separate data dirs.
4. **TLV verification gap** — The `LdkEventPayload` emitted to the frontend omits `custom_records`. TLV verification (Test 1.5) requires Rust-level access or adding custom_records to the event payload.
5. **Credits-only funding** — The current implementation only supports welcome credits (1000 sats). No real Lightning wallet funding from credits. The keysend goes out via LDK, but the "credits" system is a local counter, not tied to actual sats in channels.
6. **Mutinynet block time** — Mutinynet produces blocks approximately every 30 seconds, which is faster than mainnet signet but still requires polling for confirmations.
7. **No automated CI** — These tests are manual. The Rust unit tests (`cargo test` in `src-tauri/`) cover pure logic but not the LDK node integration.
8. **payment_successful amount** — The `PaymentSuccessful` LDK event does not include `amount_msat` (it's `None` in the payload). The DashboardView listener checks `payload.amount_msat` for `payment_successful`, but this will always be 0 since the event only carries `fee_paid_msat`. This is a known bug — the dashboard will not track spending correctly until the amount is sourced from the payment store or the stream session.
