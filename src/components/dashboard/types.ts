// Dashboard types

export interface NodeInfo {
  node_id: string;
  network: string;
  listening_addresses: string[];
  num_channels: number;
  num_peers: number;
  is_running: boolean;
  artist_mode: boolean;
}

export interface BalanceInfo {
  total_onchain_sats: number;
  spendable_onchain_sats: number;
  total_lightning_sats: number;
  outbound_capacity_sats: number;
  inbound_capacity_sats: number;
}

export interface EarningsEntry {
  type: "received" | "sent";
  amount_sats: number;
  payment_hash: string | null;
  timestamp: number;
}
