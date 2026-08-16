// Node status panel — shows LDK node health and channel info

import type { NodeInfo, BalanceInfo } from "./types";

interface NodeStatusProps {
  nodeInfo: NodeInfo | null;
  balance: BalanceInfo | null;
  onStartNode: () => void;
  onStopNode: () => void;
}

export function NodeStatus({ nodeInfo, balance, onStartNode, onStopNode }: NodeStatusProps) {
  const isRunning = nodeInfo?.is_running ?? false;

  return (
    <div className="border border-border">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider">
          Node
        </span>
        <span
          className={`inline-block w-2 h-2 ${
            isRunning ? "bg-[var(--success)]" : "bg-muted-foreground"
          }`}
        />
        <span className={`font-small ${isRunning ? "text-[var(--success)]" : "text-muted-foreground"}`}>
          {isRunning ? "Running" : "Stopped"}
        </span>

        <button
          className="ml-auto h-5 px-2 border border-border text-secondary-foreground font-label-mono text-[10px] uppercase tracking-wider hover:text-foreground hover:border-[var(--text-muted)] transition-all"
          onClick={isRunning ? onStopNode : onStartNode}
        >
          {isRunning ? "Stop" : "Start"}
        </button>
      </div>

      {nodeInfo && (
        <div className="p-3 flex flex-col gap-1.5">
          {/* Node ID (truncated) */}
          <div className="flex items-baseline gap-2">
            <span className="font-label-mono text-muted-foreground w-16 shrink-0">ID</span>
            <span className="font-small text-secondary-foreground truncate">
              {nodeInfo.node_id.slice(0, 20)}...
            </span>
          </div>

          {/* Network */}
          <div className="flex items-baseline gap-2">
            <span className="font-label-mono text-muted-foreground w-16 shrink-0">Net</span>
            <span className="font-small text-secondary-foreground">
              {nodeInfo.network}
            </span>
          </div>

          {/* Channels */}
          <div className="flex items-baseline gap-2">
            <span className="font-label-mono text-muted-foreground w-16 shrink-0">Chans</span>
            <span className="font-small text-secondary-foreground">
              {nodeInfo.num_channels} channels, {nodeInfo.num_peers} peers
            </span>
          </div>

          {/* Mode */}
          <div className="flex items-baseline gap-2">
            <span className="font-label-mono text-muted-foreground w-16 shrink-0">Mode</span>
            <span className="font-small text-secondary-foreground">
              {nodeInfo.artist_mode ? "Artist" : "Listener"}
            </span>
          </div>

          {/* Balance */}
          {balance && (
            <>
              <div className="border-t border-border my-1" />
              <div className="flex items-baseline gap-2">
                <span className="font-label-mono text-muted-foreground w-16 shrink-0">LN</span>
                <span className="font-body-mono text-amber tabular-nums">
                  ⚡ {balance.total_lightning_sats.toLocaleString()} sats
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-label-mono text-muted-foreground w-16 shrink-0">Chain</span>
                <span className="font-small text-secondary-foreground tabular-nums">
                  {balance.total_onchain_sats.toLocaleString()} sats
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-label-mono text-muted-foreground w-16 shrink-0">In</span>
                <span className="font-small text-secondary-foreground tabular-nums">
                  {balance.inbound_capacity_sats.toLocaleString()} sats inbound
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-label-mono text-muted-foreground w-16 shrink-0">Out</span>
                <span className="font-small text-secondary-foreground tabular-nums">
                  {balance.outbound_capacity_sats.toLocaleString()} sats outbound
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {!nodeInfo && (
        <div className="p-3">
          <span className="font-body-mono text-muted-foreground">
            Start the node to see status
          </span>
        </div>
      )}
    </div>
  );
}
