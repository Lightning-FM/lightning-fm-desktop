// Payment notification — amber pulse when sats flow, error flash on failure

import { useState, useEffect } from "react";

export interface PaymentEvent {
  type: "sent" | "received" | "failed";
  amount_sats: number;
  message: string;
  timestamp: number;
}

interface PaymentNotificationProps {
  event: PaymentEvent | null;
}

export function PaymentNotification({ event }: PaymentNotificationProps) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<PaymentEvent | null>(null);

  useEffect(() => {
    if (!event) return;

    setCurrent(event);
    setVisible(true);

    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [event]);

  if (!visible || !current) return null;

  const isError = current.type === "failed";

  return (
    <div
      className={`fixed top-12 right-4 z-50 border px-4 py-2 transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      } ${
        isError
          ? "border-error bg-error/10 text-error"
          : "border-amber bg-amber/10 text-amber amber-glow-subtle"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-body-mono">
          {current.type === "sent" && "⚡"}
          {current.type === "received" && "⚡"}
          {current.type === "failed" && "✕"}
        </span>
        <span className="font-body-mono">
          {current.type === "sent" && `${current.amount_sats} sats sent`}
          {current.type === "received" && `${current.amount_sats} sats received`}
          {current.type === "failed" && "Payment failed"}
        </span>
      </div>
      {current.message && (
        <div className="font-small text-secondary-foreground mt-0.5">
          {current.message}
        </div>
      )}
    </div>
  );
}
