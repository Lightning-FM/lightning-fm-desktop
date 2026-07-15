// Receive panel — generate on-chain address and Lightning invoices for deposits

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

type ReceiveTab = "lightning" | "onchain";
type InvoiceStatus = "idle" | "generating" | "success" | "error";

interface InvoiceResult {
  bolt11: string;
  amount_sats: number;
  expiry_secs: number;
}

export function ReceivePanel({ nodeRunning }: { nodeRunning: boolean }) {
  const [tab, setTab] = useState<ReceiveTab>("lightning");

  // On-chain state
  const [signetAddress, setSignetAddress] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);

  // Lightning invoice state
  const [amountSats, setAmountSats] = useState("");
  const [description, setDescription] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus>("idle");
  const [invoiceResult, setInvoiceResult] = useState<InvoiceResult | null>(
    null
  );
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceCopied, setInvoiceCopied] = useState(false);

  // Fetch signet address once when node is running
  const fetchAddress = useCallback(async () => {
    if (!nodeRunning || signetAddress) return;
    try {
      const addr = await invoke<string>("ldk_new_address");
      setSignetAddress(addr);
      setAddressError(null);
    } catch (e) {
      setAddressError(String(e));
    }
  }, [nodeRunning, signetAddress]);

  useEffect(() => {
    fetchAddress();
  }, [fetchAddress]);

  async function handleGenerateInvoice() {
    const sats = parseInt(amountSats.trim());
    if (!sats || sats <= 0) return;

    setInvoiceStatus("generating");
    setInvoiceError(null);
    setInvoiceResult(null);
    setInvoiceCopied(false);

    try {
      const result = await invoke<InvoiceResult>("ldk_create_invoice", {
        amountSats: sats,
        description: description.trim() || "Lightning FM deposit",
      });
      setInvoiceResult(result);
      setInvoiceStatus("success");
    } catch (e) {
      setInvoiceError(String(e));
      setInvoiceStatus("error");
    }
  }

  async function copyToClipboard(text: string, type: "address" | "invoice") {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "address") {
        setAddressCopied(true);
        setTimeout(() => setAddressCopied(false), 2000);
      } else {
        setInvoiceCopied(true);
        setTimeout(() => setInvoiceCopied(false), 2000);
      }
    } catch {
      // clipboard API may fail in some contexts
    }
  }

  if (!nodeRunning) return null;

  return (
    <div className="border border-border">
      <div className="px-3 py-2 border-b border-border">
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider">
          Receive
        </span>
      </div>

      <div className="p-3 flex flex-col gap-3">
        {/* Tab toggle */}
        <div className="flex border border-border">
          <button
            className={`h-6 px-2 flex-1 font-label-mono text-[10px] uppercase tracking-wider transition-all ${
              tab === "lightning"
                ? "bg-amber/10 text-amber border-r border-border"
                : "text-muted-foreground hover:text-foreground border-r border-border"
            }`}
            onClick={() => setTab("lightning")}
          >
            ⚡ Lightning
          </button>
          <button
            className={`h-6 px-2 flex-1 font-label-mono text-[10px] uppercase tracking-wider transition-all ${
              tab === "onchain"
                ? "bg-amber/10 text-amber"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab("onchain")}
          >
            ₿ On-chain
          </button>
        </div>

        {/* Lightning invoice tab */}
        {tab === "lightning" && (
          <>
            <div>
              <label className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
                Amount (sats)
              </label>
              <input
                type="text"
                value={amountSats}
                onChange={(e) =>
                  setAmountSats(e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="1000"
                className="w-full h-7 px-2 mt-1 bg-transparent border border-border text-foreground font-small focus:border-amber focus:outline-none transition-colors tabular-nums"
              />
            </div>

            <div>
              <label className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Lightning FM deposit"
                className="w-full h-7 px-2 mt-1 bg-transparent border border-border text-foreground font-small focus:border-amber focus:outline-none transition-colors"
              />
            </div>

            <button
              className="h-7 px-4 border border-amber text-amber font-label-mono uppercase tracking-wider text-[11px] hover:bg-amber/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleGenerateInvoice}
              disabled={
                !amountSats.trim() ||
                parseInt(amountSats) <= 0 ||
                invoiceStatus === "generating"
              }
            >
              {invoiceStatus === "generating"
                ? "Generating..."
                : "Generate Invoice"}
            </button>

            {invoiceResult && (
              <div className="flex flex-col gap-1">
                <label className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
                  BOLT11 Invoice
                </label>
                <div className="relative">
                  <div className="w-full px-2 py-1.5 bg-transparent border border-border text-foreground font-mono text-[10px] break-all select-all leading-tight max-h-20 overflow-y-auto">
                    {invoiceResult.bolt11}
                  </div>
                  <button
                    className="absolute top-1 right-1 h-5 px-1.5 border border-border text-muted-foreground font-label-mono text-[9px] uppercase tracking-wider hover:text-amber hover:border-amber transition-colors"
                    onClick={() =>
                      copyToClipboard(invoiceResult.bolt11, "invoice")
                    }
                  >
                    {invoiceCopied ? "Copied" : "Copy"}
                  </button>
                </div>
                <span className="font-label-mono text-muted-foreground text-[10px]">
                  {invoiceResult.amount_sats.toLocaleString()} sats — expires in{" "}
                  {Math.round(invoiceResult.expiry_secs / 3600)}h
                </span>
              </div>
            )}

            {invoiceError && (
              <div className="font-small px-2 py-1 border border-error/30 text-error">
                {invoiceError}
              </div>
            )}
          </>
        )}

        {/* On-chain tab */}
        {tab === "onchain" && (
          <>
            <div>
              <label className="font-label-mono text-muted-foreground uppercase tracking-wider text-[10px]">
                Signet Address
              </label>
              {signetAddress ? (
                <div className="relative mt-1">
                  <div className="w-full px-2 py-1.5 bg-transparent border border-border text-foreground font-mono text-[10px] break-all select-all leading-tight">
                    {signetAddress}
                  </div>
                  <button
                    className="absolute top-1 right-1 h-5 px-1.5 border border-border text-muted-foreground font-label-mono text-[9px] uppercase tracking-wider hover:text-amber hover:border-amber transition-colors"
                    onClick={() => copyToClipboard(signetAddress, "address")}
                  >
                    {addressCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : addressError ? (
                <div className="font-small px-2 py-1 mt-1 border border-error/30 text-error">
                  {addressError}
                </div>
              ) : (
                <div className="font-small px-2 py-1 mt-1 text-muted-foreground">
                  Loading address...
                </div>
              )}
            </div>

            <div className="font-label-mono text-muted-foreground text-[10px] uppercase tracking-wider">
              Send signet BTC to this address to fund your node
            </div>
          </>
        )}
      </div>
    </div>
  );
}
