// Surfaces LDK payment events (received payments, keysend confirmations,
// failures) as transient notifications. Listening itself is free — this is
// for real money movement: sales, withdrawals, zaps.

import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { PaymentEvent } from "../components/PaymentNotification";

export function usePaymentEvents(): PaymentEvent | null {
  const [paymentEvent, setPaymentEvent] = useState<PaymentEvent | null>(null);

  useEffect(() => {
    const unlisten = listen<{
      event_type: string;
      payment_hash: string | null;
      amount_msat: number | null;
      fee_paid_msat: number | null;
      close_reason: string | null;
    }>("ldk-event", (event) => {
      const payload = event.payload;
      const amountSats = payload.amount_msat ? Math.round(payload.amount_msat / 1000) : 0;

      switch (payload.event_type) {
        case "payment_successful":
          setPaymentEvent({
            type: "sent",
            amount_sats: amountSats,
            message: payload.fee_paid_msat
              ? `Fee: ${payload.fee_paid_msat} msat`
              : "Payment confirmed",
            timestamp: Date.now(),
          });
          break;

        case "payment_failed":
          setPaymentEvent({
            type: "failed",
            amount_sats: 0,
            message: payload.close_reason || "Routing or channel error",
            timestamp: Date.now(),
          });
          break;

        case "payment_received":
          setPaymentEvent({
            type: "received",
            amount_sats: amountSats,
            message: "Incoming payment",
            timestamp: Date.now(),
          });
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return paymentEvent;
}
