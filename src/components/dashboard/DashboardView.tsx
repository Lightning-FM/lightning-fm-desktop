// Artist earnings dashboard — real-time sat accumulation, payment feed, node status

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { NodeInfo, BalanceInfo, EarningsEntry } from "./types";
import { StatCard } from "./StatCard";
import { EarningsFeed } from "./EarningsFeed";
import { NodeStatus } from "./NodeStatus";
import { WithdrawPanel } from "./WithdrawPanel";
import { ReceivePanel } from "./ReceivePanel";

export function DashboardView() {
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [earnings, setEarnings] = useState<EarningsEntry[]>([]);
  const [totalEarned, setTotalEarned] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);
  const [sessionStart] = useState(Date.now());
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

  // Listen for payment events to build the earnings feed
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
        const entry: EarningsEntry = {
          type: "received",
          amount_sats: amountSats,
          payment_hash: payload.payment_hash,
          timestamp: Date.now(),
        };
        setEarnings((prev) => [entry, ...prev]); // newest first
        setTotalEarned((prev) => prev + amountSats);
        refreshBalance();
      }

      if (payload.event_type === "payment_successful" && amountSats > 0) {
        const entry: EarningsEntry = {
          type: "sent",
          amount_sats: amountSats,
          payment_hash: payload.payment_hash,
          timestamp: Date.now(),
        };
        setEarnings((prev) => [entry, ...prev]);
        setTotalSpent((prev) => prev + amountSats);
        refreshBalance();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  async function refreshNodeInfo() {
    try {
      const info = await invoke<NodeInfo>("ldk_get_info");
      setNodeInfo(info);
    } catch {
      setNodeInfo(null);
    }
  }

  async function refreshBalance() {
    try {
      const bal = await invoke<BalanceInfo>("ldk_get_balance");
      setBalance(bal);
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

  // Computed stats
  const sessionMinutes = Math.max(1, Math.round((Date.now() - sessionStart) / 60000));
  const earningsRate =
    totalEarned > 0 ? Math.round(totalEarned / sessionMinutes) : 0;
  const netBalance = totalEarned - totalSpent;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 h-8 flex items-center px-4 border-b border-border">
        <span className="font-label-mono text-amber uppercase tracking-wider">
          Dashboard
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <StatCard
            label="Total Earned"
            value={`⚡ ${totalEarned.toLocaleString()}`}
            subValue="sats received"
            accent
          />
          <StatCard
            label="Total Spent"
            value={`⚡ ${totalSpent.toLocaleString()}`}
            subValue="sats sent to artists"
          />
          <StatCard
            label="Net"
            value={`⚡ ${netBalance >= 0 ? "+" : ""}${netBalance.toLocaleString()}`}
            subValue="sats this session"
            accent={netBalance > 0}
          />
          <StatCard
            label="Rate"
            value={earningsRate > 0 ? `${earningsRate}` : "—"}
            subValue="sats/min avg"
          />
        </div>

        {/* Two-column: feed + node status */}
        <div className="flex gap-3 min-h-0" style={{ height: "calc(100% - 120px)" }}>
          {/* Earnings feed (left, wider) */}
          <div className="flex-1 min-h-0 flex flex-col">
            <EarningsFeed entries={earnings} />
          </div>

          {/* Right column: node status + withdraw */}
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
      </div>
    </div>
  );
}
