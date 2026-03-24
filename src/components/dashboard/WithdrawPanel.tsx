// Withdrawal panel — pay a Lightning invoice or send on-chain

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type WithdrawMethod = "lightning" | "onchain";
type WithdrawStatus = "idle" | "sending" | "success" | "error";

interface PaymentResult {
  payment_id: string;
  amount_msat: number | null;
}

interface OnchainResult {
  txid: string;
}

export function WithdrawPanel() {
  const [method, setMethod] = useState<WithdrawMethod>("lightning");
  const [input, setInput] = useState("");
  const [amountSats, setAmountSats] = useState("");
  const [status, setStatus] = useState<WithdrawStatus>("idle");
  const [message, setMessage] = useState("");

  async function handleWithdraw() {
    if (!input.trim()) return;

    setStatus("sending");
    setMessage("");

    try {
      if (method === "lightning") {
        const result = await invoke<PaymentResult>("withdraw_lightning", {
          invoice: input.trim(),
        });
        const sats = result.amount_msat
          ? Math.round(result.amount_msat / 1000)
          : 0;
        setStatus("success");
        setMessage(
          `Payment sent${sats > 0 ? `: ${sats.toLocaleString()} sats` : ""}`
        );
        setInput("");
      } else {
        const sats = amountSats.trim()
          ? parseInt(amountSats.trim())
          : undefined;
        const result = await invoke<OnchainResult>("withdraw_onchain", {
          address: input.trim(),
          amountSats: sats || undefined,
        });
        setStatus("success");
        setMessage(`Sent — txid: ${result.txid.slice(0, 16)}...`);
        setInput("");
        setAmountSats("");
      }
    } catch (e) {
      setStatus("error");
      setMessage(String(e));
    }
  }

  return (
    <div className="border border-border">
      <div className="px-3 py-2 border-b border-border">
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider">
          Withdraw
        </span>
      </div>

      <div className="p-3 flex flex-col gap-3">
        {/* Method toggle */}
        <div className="flex border border-border">
          <button
            className={`h-6 px-2 flex-1 font-label-mono text-[10px] uppercase tracking-wider transition-all ${
              method === "lightning"
                ? "bg-amber/10 text-amber border-r border-border"
                : "text-muted-foreground hover:text-foreground border-r border-border"
            }`}
            onClick={() => {
              setMethod("lightning");
              setInput("");
              setStatus("idle");
              setMessage("");
            }}
          >
            ⚡ Lightning
          </button>
          <button
            className={`h-6 px-2 flex-1 font-label-mono text-[10px] uppercase tracking-wider transition-all ${
              method === "onchain"
                ? "bg-amber/10 text-amber"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => {
              setMethod("onchain");
              setInput("");
              setStatus("idle");
              setMessage("");
            }}
          >
            ₿ On-chain
          </button>
        </div>

        {/* Input */}
        <div>
          <label className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
            {method === "lightning" ? "Paste invoice" : "Bitcoin address"}
          </label>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              method === "lightning"
                ? "lnbc..."
                : "tb1... or bc1..."
            }
            className="w-full h-7 px-2 mt-1 bg-transparent border border-border text-foreground font-small focus:border-amber focus:outline-none transition-colors"
          />
        </div>

        {/* Amount (on-chain only — Lightning invoices have amount embedded) */}
        {method === "onchain" && (
          <div>
            <label className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
              Amount (sats) — leave blank for all
            </label>
            <input
              type="text"
              value={amountSats}
              onChange={(e) =>
                setAmountSats(e.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder="All funds"
              className="w-full h-7 px-2 mt-1 bg-transparent border border-border text-foreground font-small focus:border-amber focus:outline-none transition-colors tabular-nums"
            />
          </div>
        )}

        {/* Send button */}
        <button
          className="h-7 px-4 border border-amber text-amber font-label-mono uppercase tracking-wider text-[11px] hover:bg-amber/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleWithdraw}
          disabled={!input.trim() || status === "sending"}
        >
          {status === "sending" ? "Sending..." : "Withdraw"}
        </button>

        {/* Status message */}
        {message && (
          <div
            className={`font-small px-2 py-1 border ${
              status === "success"
                ? "border-[var(--success)]/30 text-[var(--success)]"
                : "border-error/30 text-error"
            }`}
          >
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
