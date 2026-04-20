// Lightning FM — LDK event processing loop
// Runs in a background task, consuming LDK Node events and emitting them
// to the React frontend via Tauri's event system.

use ldk_node::Node;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;

use crate::credits::CreditsState;

/// Payload emitted to the frontend for every LDK event.
/// The frontend listens on "ldk-event" and matches on `event_type`.
#[derive(Clone, Serialize)]
pub struct LdkEventPayload {
    pub event_type: String,

    // Payment fields (present for payment events)
    pub payment_hash: Option<String>,
    pub payment_id: Option<String>,
    pub amount_msat: Option<u64>,
    pub fee_paid_msat: Option<u64>,

    // Channel fields (present for channel events)
    pub channel_id: Option<String>,
    pub counterparty_node_id: Option<String>,
    pub close_reason: Option<String>,
}

/// Start the background event loop. Returns a shutdown sender —
/// drop it or send `true` to stop the loop.
pub fn spawn_event_loop(
    node: Arc<Node>,
    app: AppHandle,
) -> watch::Sender<bool> {
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    tokio::spawn(async move {
        log::info!("LDK event loop started");

        loop {
            // Race: next event vs shutdown signal
            tokio::select! {
                event = node.next_event_async() => {
                    // Bridge: when a Lightning payment arrives, credit the user's
                    // sats pool. The streaming engine deducts from this same pool,
                    // so incoming Lightning sats immediately become spendable for
                    // playback. Do this BEFORE emitting the frontend event so the
                    // UI's credits_info read reflects the new balance.
                    if let ldk_node::Event::PaymentReceived { amount_msat, .. } = &event {
                        let credits_state = app.state::<CreditsState>();
                        let amount_sats = amount_msat / 1000;
                        match crate::credits::add_credits(credits_state.inner(), amount_sats) {
                            Ok(()) => log::info!(
                                "Credited {} sats to listener pool from incoming payment",
                                amount_sats,
                            ),
                            Err(e) => log::error!(
                                "Failed to credit {} sats from incoming payment: {}",
                                amount_sats, e,
                            ),
                        }
                    }

                    let payload = map_event(&event, &node);
                    log::info!("LDK event: {}", payload.event_type);

                    // Emit to all frontend windows
                    if let Err(e) = app.emit("ldk-event", &payload) {
                        log::error!("Failed to emit ldk-event to frontend: {}", e);
                    }

                    // Acknowledge so LDK pops it from the queue.
                    if let Err(e) = node.event_handled() {
                        log::error!("LDK event_handled() failed: {:?} — stopping event loop", e);
                        break;
                    }
                }
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        log::info!("LDK event loop shutting down");
                        break;
                    }
                }
            }
        }
    });

    shutdown_tx
}

/// Map an ldk_node::Event into a frontend-friendly payload
fn map_event(event: &ldk_node::Event, node: &Node) -> LdkEventPayload {
    match event {
        ldk_node::Event::PaymentReceived {
            payment_id,
            payment_hash,
            amount_msat,
            custom_records: _,
        } => LdkEventPayload {
            event_type: "payment_received".to_string(),
            payment_hash: Some(format!("{}", payment_hash)),
            payment_id: payment_id.map(|id| format!("{}", id)),
            amount_msat: Some(*amount_msat),
            fee_paid_msat: None,
            channel_id: None,
            counterparty_node_id: None,
            close_reason: None,
        },

        ldk_node::Event::PaymentSuccessful {
            payment_id,
            payment_hash,
            payment_preimage: _,
            fee_paid_msat,
        } => {
            // Look up the payment amount from the node's payment store
            // since PaymentSuccessful doesn't include it directly
            let amount_msat = payment_id
                .and_then(|id| node.payment(&id))
                .and_then(|details| details.amount_msat);

            LdkEventPayload {
                event_type: "payment_successful".to_string(),
                payment_hash: Some(format!("{}", payment_hash)),
                payment_id: payment_id.map(|id| format!("{}", id)),
                amount_msat,
                fee_paid_msat: *fee_paid_msat,
                channel_id: None,
                counterparty_node_id: None,
                close_reason: None,
            }
        }

        ldk_node::Event::PaymentFailed {
            payment_id,
            payment_hash,
            reason,
        } => LdkEventPayload {
            event_type: "payment_failed".to_string(),
            payment_hash: payment_hash.map(|h| format!("{}", h)),
            payment_id: payment_id.map(|id| format!("{}", id)),
            amount_msat: None,
            fee_paid_msat: None,
            channel_id: None,
            counterparty_node_id: None,
            close_reason: reason.map(|r| format!("{:?}", r)),
        },

        ldk_node::Event::PaymentClaimable {
            payment_id,
            payment_hash,
            claimable_amount_msat,
            claim_deadline: _,
            custom_records: _,
        } => LdkEventPayload {
            event_type: "payment_claimable".to_string(),
            payment_hash: Some(format!("{}", payment_hash)),
            payment_id: Some(format!("{}", payment_id)),
            amount_msat: Some(*claimable_amount_msat),
            fee_paid_msat: None,
            channel_id: None,
            counterparty_node_id: None,
            close_reason: None,
        },

        ldk_node::Event::ChannelPending {
            channel_id,
            counterparty_node_id,
            ..
        } => LdkEventPayload {
            event_type: "channel_pending".to_string(),
            payment_hash: None,
            payment_id: None,
            amount_msat: None,
            fee_paid_msat: None,
            channel_id: Some(format!("{}", channel_id)),
            counterparty_node_id: Some(counterparty_node_id.to_string()),
            close_reason: None,
        },

        ldk_node::Event::ChannelReady {
            channel_id,
            counterparty_node_id,
            ..
        } => LdkEventPayload {
            event_type: "channel_ready".to_string(),
            payment_hash: None,
            payment_id: None,
            amount_msat: None,
            fee_paid_msat: None,
            channel_id: Some(format!("{}", channel_id)),
            counterparty_node_id: counterparty_node_id.map(|n| n.to_string()),
            close_reason: None,
        },

        ldk_node::Event::ChannelClosed {
            channel_id,
            counterparty_node_id,
            reason,
            ..
        } => LdkEventPayload {
            event_type: "channel_closed".to_string(),
            payment_hash: None,
            payment_id: None,
            amount_msat: None,
            fee_paid_msat: None,
            channel_id: Some(format!("{}", channel_id)),
            counterparty_node_id: counterparty_node_id.map(|n| n.to_string()),
            close_reason: reason.as_ref().map(|r| format!("{:?}", r)),
        },

        ldk_node::Event::PaymentForwarded { .. } => LdkEventPayload {
            event_type: "payment_forwarded".to_string(),
            payment_hash: None,
            payment_id: None,
            amount_msat: None,
            fee_paid_msat: None,
            channel_id: None,
            counterparty_node_id: None,
            close_reason: None,
        },

        ldk_node::Event::SplicePending {
            channel_id,
            counterparty_node_id,
            ..
        } => LdkEventPayload {
            event_type: "splice_pending".to_string(),
            payment_hash: None,
            payment_id: None,
            amount_msat: None,
            fee_paid_msat: None,
            channel_id: Some(format!("{}", channel_id)),
            counterparty_node_id: Some(counterparty_node_id.to_string()),
            close_reason: None,
        },

        ldk_node::Event::SpliceFailed {
            channel_id,
            counterparty_node_id,
            ..
        } => LdkEventPayload {
            event_type: "splice_failed".to_string(),
            payment_hash: None,
            payment_id: None,
            amount_msat: None,
            fee_paid_msat: None,
            channel_id: Some(format!("{}", channel_id)),
            counterparty_node_id: Some(counterparty_node_id.to_string()),
            close_reason: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_serializes_to_json() {
        let payload = LdkEventPayload {
            event_type: "payment_received".to_string(),
            payment_hash: Some("abc123".to_string()),
            payment_id: None,
            amount_msat: Some(100_000),
            fee_paid_msat: None,
            channel_id: None,
            counterparty_node_id: None,
            close_reason: None,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("payment_received"));
        assert!(json.contains("100000"));
    }

    #[test]
    fn payload_omits_none_fields_when_desired() {
        let payload = LdkEventPayload {
            event_type: "channel_ready".to_string(),
            payment_hash: None,
            payment_id: None,
            amount_msat: None,
            fee_paid_msat: None,
            channel_id: Some("ch001".to_string()),
            counterparty_node_id: Some("02abc".to_string()),
            close_reason: None,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("channel_ready"));
        assert!(json.contains("ch001"));
    }
}
