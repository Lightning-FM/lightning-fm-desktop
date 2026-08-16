// Dashboard — scenario-aware.
//
// Three audiences (mirrors the pricing page):
//   listener       — no identity: purchases summary + become-an-artist CTA
//   hosted artist  — sells via the gate (lfm_sell_via != "node"): payout
//                    address + listings; no node UI — their money never
//                    touches this app
//   self-hosted    — sells via own node: node status, balance, receive,
//                    withdraw, live payment feed
//
// The old Total Spent / Net / Rate cards were streaming-era (listeners no
// longer pay per minute) and session-scoped — retired with the free-listening
// pivot (decision:lfm_pivot_free_listening_monetize_goods).

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { NodeInfo, BalanceInfo, EarningsEntry } from "./types";
import type { IdentityInfo, ProductInfo, PurchaseRecord } from "../../types/streaming";
import { StatCard } from "./StatCard";
import { EarningsFeed } from "./EarningsFeed";
import { NodeStatus } from "./NodeStatus";
import { WithdrawPanel } from "./WithdrawPanel";
import { ReceivePanel } from "./ReceivePanel";

interface DashboardViewProps {
  identity: IdentityInfo | null;
  onNavigate: (view: "settings" | "upload" | "library") => void;
}

export function DashboardView({ identity, onNavigate }: DashboardViewProps) {
  const sellVia = localStorage.getItem("lfm_sell_via") === "node" ? "node" : "gate";

  const [lud16, setLud16] = useState<string | null>(null);
  const [listings, setListings] = useState<ProductInfo[] | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRecord[] | null>(null);

  useEffect(() => {
    invoke<PurchaseRecord[]>("purchases_list")
      .then(setPurchases)
      .catch(() => setPurchases([]));
    if (!identity) return;
    invoke<{ lud16: string | null } | null>("profile_fetch")
      .then((p) => setLud16(p?.lud16?.trim() || null))
      .catch(() => setLud16(null));
    invoke<ProductInfo[]>("product_list_mine")
      .then(setListings)
      .catch(() => setListings([]));
  }, [identity]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 h-8 flex items-center px-4 border-b border-border">
        <span className="font-label-mono text-amber uppercase tracking-wider">
          Dashboard
        </span>
        {identity && (
          <span className="font-small text-muted-foreground ml-3">
            {sellVia === "node" ? "selling via your own node" : "selling via hosted gate"}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!identity ? (
          <ListenerDashboard purchases={purchases} onNavigate={onNavigate} />
        ) : sellVia === "node" ? (
          <NodeArtistDashboard listings={listings} lud16={lud16} />
        ) : (
          <HostedArtistDashboard
            listings={listings}
            lud16={lud16}
            onNavigate={onNavigate}
          />
        )}
      </div>
    </div>
  );
}

// ─── Listener (no identity) ─────────────────────────────────

function ListenerDashboard({
  purchases,
  onNavigate,
}: {
  purchases: PurchaseRecord[] | null;
  onNavigate: DashboardViewProps["onNavigate"];
}) {
  const spent = (purchases ?? []).reduce((sum, p) => sum + p.amount_sats, 0);
  return (
    <div className="max-w-xl">
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard
          label="Your downloads"
          value={`${(purchases ?? []).length}`}
          subValue="tracks purchased"
        />
        <StatCard
          label="Sent to artists"
          value={`⚡ ${spent.toLocaleString()}`}
          subValue="sats, straight to their wallets"
          accent={spent > 0}
        />
      </div>

      <div className="border border-border p-4 mb-4">
        <span className="font-label-mono text-amber uppercase tracking-wider text-[10px]">
          Listening is free
        </span>
        <p className="font-body-mono text-[12px] text-secondary-foreground mt-1">
          Stream anything in the library at no cost. When you buy a download,
          you pay the artist&apos;s wallet directly — your purchases live in
          Library → Purchases.
        </p>
        <button
          className="h-7 px-3 mt-3 border border-border text-secondary-foreground font-label-mono text-[10px] uppercase tracking-wider hover:text-foreground transition-all"
          onClick={() => onNavigate("library")}
        >
          Open Library
        </button>
      </div>

      <div className="border border-amber/40 p-4">
        <span className="font-label-mono text-amber uppercase tracking-wider text-[10px]">
          Are you an artist?
        </span>
        <p className="font-body-mono text-[12px] text-secondary-foreground mt-1">
          Create an identity to publish tracks and sell downloads. Your catalog
          is signed by your key, buyers pay your wallet, and leaving costs
          nothing.
        </p>
        <button
          className="h-7 px-3 mt-3 border border-amber text-amber font-label-mono text-[10px] uppercase tracking-wider hover:bg-amber/10 transition-all"
          onClick={() => onNavigate("settings")}
        >
          Create identity
        </button>
      </div>
    </div>
  );
}

// ─── Hosted artist (gate seller) ────────────────────────────

function HostedArtistDashboard({
  listings,
  lud16,
  onNavigate,
}: {
  listings: ProductInfo[] | null;
  lud16: string | null;
  onNavigate: DashboardViewProps["onNavigate"];
}) {
  const active = (listings ?? []).filter((l) => l.status === "active");
  return (
    <div className="max-w-2xl">
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard
          label="Active listings"
          value={`${listings === null ? "—" : active.length}`}
          subValue="tracks for sale"
          accent={active.length > 0}
        />
        <StatCard
          label="Payout address"
          value={lud16 ? "✓ set" : "not set"}
          subValue={lud16 ?? "sales need a Lightning address"}
          accent={!!lud16}
        />
      </div>

      {!lud16 && (
        <div className="border border-[var(--error)]/60 p-4 mb-4">
          <span className="font-label-mono text-[var(--error)] uppercase tracking-wider text-[10px]">
            No payout address
          </span>
          <p className="font-body-mono text-[12px] text-secondary-foreground mt-1">
            Buyers pay your Lightning address directly. Without one, nothing
            can sell. Coinos and Alby support payment confirmation (LUD-21),
            which the hosted gate requires.
          </p>
          <button
            className="h-7 px-3 mt-3 border border-amber text-amber font-label-mono text-[10px] uppercase tracking-wider hover:bg-amber/10 transition-all"
            onClick={() => onNavigate("settings")}
          >
            Add in Settings
          </button>
        </div>
      )}

      <div className="border border-border p-4 mb-4">
        <span className="font-label-mono text-amber uppercase tracking-wider text-[10px]">
          Where your money is
        </span>
        <p className="font-body-mono text-[12px] text-secondary-foreground mt-1">
          Sales settle buyer → your wallet{lud16 ? ` (${lud16})` : ""} without
          touching Lightning FM. Your wallet&apos;s own history is the ledger —
          an in-app sales feed for hosted sellers is coming.
        </p>
      </div>

      {listings !== null && active.length === 0 && (
        <div className="border border-border p-4">
          <span className="font-label-mono text-amber uppercase tracking-wider text-[10px]">
            Nothing for sale yet
          </span>
          <p className="font-body-mono text-[12px] text-secondary-foreground mt-1">
            Enable Sell on an upload to list a download. You keep 100% of every
            sale — structurally, not as policy.
          </p>
          <button
            className="h-7 px-3 mt-3 border border-amber text-amber font-label-mono text-[10px] uppercase tracking-wider hover:bg-amber/10 transition-all"
            onClick={() => onNavigate("upload")}
          >
            Go to Upload
          </button>
        </div>
      )}

      {active.length > 0 && (
        <div className="border border-border">
          <div className="px-3 py-2 border-b border-border">
            <span className="font-label-mono text-muted-foreground uppercase tracking-wider">
              Listings
            </span>
          </div>
          {active.map((l) => (
            <div
              key={l.event_id}
              className="flex items-center gap-3 px-3 py-1.5 border-b border-border last:border-b-0"
            >
              <span className="font-body-mono text-foreground truncate flex-1">
                {l.title}
              </span>
              <span className="font-body-mono text-amber tabular-nums shrink-0">
                ⚡ {l.price_sats.toLocaleString()} sats
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Self-hosted artist (node seller) ───────────────────────

function NodeArtistDashboard({
  listings,
  lud16,
}: {
  listings: ProductInfo[] | null;
  lud16: string | null;
}) {
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [earnings, setEarnings] = useState<EarningsEntry[]>([]);
  const [receivedSession, setReceivedSession] = useState(0);
  const [channelOpening, setChannelOpening] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  // Poll node info and balance every 10 seconds
  useEffect(() => {
    refreshNodeInfo();
    refreshBalance();

    const interval = setInterval(() => {
      refreshNodeInfo();
      refreshBalance();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Listen for payment events to build the activity feed
  useEffect(() => {
    const unlisten = listen<{
      event_type: string;
      payment_hash: string | null;
      amount_msat: number | null;
    }>("ldk-event", (event) => {
      const payload = event.payload;
      const amountSats = payload.amount_msat
        ? Math.round(payload.amount_msat / 1000)
        : 0;

      if (payload.event_type === "payment_received" && amountSats > 0) {
        setEarnings((prev) => [
          {
            type: "received",
            amount_sats: amountSats,
            payment_hash: payload.payment_hash,
            timestamp: Date.now(),
          },
          ...prev,
        ]);
        setReceivedSession((prev) => prev + amountSats);
        refreshBalance();
      }

      if (payload.event_type === "payment_successful" && amountSats > 0) {
        setEarnings((prev) => [
          {
            type: "sent",
            amount_sats: amountSats,
            payment_hash: payload.payment_hash,
            timestamp: Date.now(),
          },
          ...prev,
        ]);
        refreshBalance();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  async function refreshNodeInfo() {
    try {
      setNodeInfo(await invoke<NodeInfo>("ldk_get_info"));
    } catch {
      setNodeInfo(null);
    }
  }

  async function refreshBalance() {
    try {
      setBalance(await invoke<BalanceInfo>("ldk_get_balance"));
    } catch {}
  }

  async function handleStartNode() {
    try {
      const info = await invoke<NodeInfo>("ldk_start", { artistMode: true });
      setNodeInfo(info);
      refreshBalance();
    } catch (e) {
      console.error("Failed to start node:", e);
    }
  }

  async function handleStopNode() {
    try {
      await invoke("ldk_stop");
      setNodeInfo(null);
      setBalance(null);
    } catch (e) {
      console.error("Failed to stop node:", e);
    }
  }

  const active = (listings ?? []).filter((l) => l.status === "active");

  return (
    <>
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard
          label="Spendable"
          value={`⚡ ${(balance?.total_lightning_sats ?? 0).toLocaleString()}`}
          subValue="sats on Lightning"
          accent={(balance?.total_lightning_sats ?? 0) > 0}
        />
        <StatCard
          label="Received"
          value={`⚡ ${receivedSession.toLocaleString()}`}
          subValue="sats this session"
          accent={receivedSession > 0}
        />
        <StatCard
          label="Listings"
          value={`${listings === null ? "—" : active.length}`}
          subValue={lud16 ? `fallback payout: ${lud16}` : "tracks for sale"}
        />
      </div>

      {/* Two-column: feed + node status */}
      <div className="flex gap-3 min-h-0" style={{ height: "calc(100% - 120px)" }}>
        {/* Activity feed (left, wider) */}
        <div className="flex-1 min-h-0 flex flex-col">
          <EarningsFeed entries={earnings} />
        </div>

        {/* Right column: node status + receive + withdraw */}
        <div className="w-64 shrink-0 flex flex-col gap-3">
          <NodeStatus
            nodeInfo={nodeInfo}
            balance={balance}
            onStartNode={handleStartNode}
            onStopNode={handleStopNode}
          />
          {/* Bootstrap: open channel to LSP when node is running but has 0 channels */}
          {nodeInfo?.is_running && nodeInfo?.num_channels === 0 && (balance?.spendable_onchain_sats ?? 0) > 0 && (
            <div className="border border-border p-3">
              <span className="font-label-mono text-[10px] text-amber uppercase tracking-wider">Bootstrap Channel</span>
              <p className="font-body-mono text-[11px] text-secondary-foreground mt-1 mb-2">
                Open a channel to the LSP to enable Lightning payments.
              </p>
              {channelError && (
                <p className="font-body-mono text-[10px] text-red-400 mb-2">{channelError}</p>
              )}
              <button
                className="w-full py-1.5 border border-amber text-amber font-label-mono text-[11px] uppercase tracking-wider hover:bg-amber/10 transition-all disabled:opacity-50"
                disabled={channelOpening}
                onClick={async () => {
                  setChannelOpening(true);
                  setChannelError(null);
                  try {
                    // Peer omitted — backend targets the resolved LSP
                    // (LFM_LSP_* env or Mutinynet default)
                    await invoke("ldk_open_channel", {
                      amountSats: 500000,
                    });
                    refreshNodeInfo();
                    refreshBalance();
                  } catch (e) {
                    console.error("Failed to open channel:", e);
                    setChannelError(String(e));
                  } finally {
                    setChannelOpening(false);
                  }
                }}
              >
                {channelOpening ? "Opening..." : "Open 500k Channel to LSP"}
              </button>
            </div>
          )}
          <ReceivePanel nodeRunning={nodeInfo?.is_running ?? false} />
          <WithdrawPanel />
        </div>
      </div>
    </>
  );
}
