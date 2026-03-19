import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./globals.css";

// Identity info returned from Rust backend
interface IdentityInfo {
  npub: string;
  pubkey_hex: string;
  has_nsec: boolean;
  display_name: string | null;
}

// Node info returned from Rust backend
interface NodeInfo {
  node_id: string;
  network: string;
  listening_addresses: string[];
  num_channels: number;
  num_peers: number;
  is_running: boolean;
}

// App states: loading → onboarding (no identity) or home (identity found)
type AppScreen = "loading" | "onboarding" | "home";

function App() {
  const [screen, setScreen] = useState<AppScreen>("loading");
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // First-launch detection: check keychain for existing identity
  useEffect(() => {
    async function checkIdentity() {
      try {
        const existing = await invoke<IdentityInfo | null>("identity_check");
        if (existing) {
          setIdentity(existing);
          setScreen("home");
        } else {
          setScreen("onboarding");
        }
      } catch (e) {
        setError(`Identity check failed: ${e}`);
        setScreen("onboarding");
      }
    }
    checkIdentity();
  }, []);

  if (screen === "loading") return <LoadingScreen />;
  if (screen === "onboarding") {
    return (
      <OnboardingScreen
        error={error}
        onIdentityCreated={(info) => {
          setIdentity(info);
          setError(null);
          setScreen("home");
        }}
      />
    );
  }
  return (
    <HomeScreen
      identity={identity!}
      nodeInfo={nodeInfo}
      onNodeStarted={setNodeInfo}
      onLogout={() => {
        setIdentity(null);
        setNodeInfo(null);
        setScreen("onboarding");
      }}
    />
  );
}

// ─── Loading Screen ─────────────────────────────────────────

function LoadingScreen() {
  return (
    <main className="screen screen-loading">
      <div className="loading-content">
        <h1>Lightning FM</h1>
        <p className="loading-sub">the music channel nobody can shut down</p>
        <div className="spinner" />
      </div>
    </main>
  );
}

// ─── Onboarding Screen ──────────────────────────────────────

function OnboardingScreen({
  error,
  onIdentityCreated,
}: {
  error: string | null;
  onIdentityCreated: (info: IdentityInfo) => void;
}) {
  const [mode, setMode] = useState<"choose" | "import">("choose");
  const [nsecInput, setNsecInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function createNew() {
    setLoading(true);
    setLocalError(null);
    try {
      const info = await invoke<IdentityInfo>("identity_create");
      onIdentityCreated(info);
    } catch (e) {
      setLocalError(`${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function importExisting() {
    if (!nsecInput.trim()) return;
    setLoading(true);
    setLocalError(null);
    try {
      const info = await invoke<IdentityInfo>("identity_import", {
        nsec: nsecInput.trim(),
      });
      onIdentityCreated(info);
    } catch (e) {
      setLocalError(`${e}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="screen screen-onboarding">
      <div className="onboarding-content">
        <h1>Lightning FM</h1>
        <p className="onboarding-sub">the music channel nobody can shut down</p>

        {(error || localError) && (
          <div className="error-msg">{localError || error}</div>
        )}

        {mode === "choose" ? (
          <div className="onboarding-actions">
            <button
              className="btn btn-primary"
              onClick={createNew}
              disabled={loading}
            >
              {loading ? "Creating..." : "Create New Identity"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setMode("import")}
              disabled={loading}
            >
              I Have a Nostr Identity
            </button>
          </div>
        ) : (
          <div className="onboarding-import">
            <p className="import-label">Paste your nsec or hex secret key</p>
            <input
              type="password"
              className="nsec-input"
              value={nsecInput}
              onChange={(e) => setNsecInput(e.target.value)}
              placeholder="nsec1... or hex"
              autoFocus
            />
            <div className="import-actions">
              <button
                className="btn btn-primary"
                onClick={importExisting}
                disabled={loading || !nsecInput.trim()}
              >
                {loading ? "Importing..." : "Import"}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setMode("choose");
                  setNsecInput("");
                  setLocalError(null);
                }}
                disabled={loading}
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Home Screen ────────────────────────────────────────────

function HomeScreen({
  identity,
  nodeInfo,
  onNodeStarted,
  onLogout,
}: {
  identity: IdentityInfo;
  nodeInfo: NodeInfo | null;
  onNodeStarted: (info: NodeInfo) => void;
  onLogout: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startNode() {
    setLoading(true);
    setError(null);
    try {
      const info = await invoke<NodeInfo>("ldk_start");
      onNodeStarted(info);
    } catch (e) {
      setError(`${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      // Stop node if running
      try { await invoke("ldk_stop"); } catch {}
      await invoke("identity_delete");
      onLogout();
    } catch (e) {
      setError(`${e}`);
    }
  }

  // Truncate npub for display
  const npubShort = identity.npub.slice(0, 12) + "..." + identity.npub.slice(-6);

  return (
    <main className="screen screen-home">
      <div className="home-header">
        <h1>Lightning FM</h1>
        <div className="identity-badge">
          <span className="npub">{npubShort}</span>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="home-content">
        {!nodeInfo ? (
          <div className="node-start">
            <p>Your Nostr identity is ready. Start your Lightning node to begin.</p>
            <button
              className="btn btn-primary"
              onClick={startNode}
              disabled={loading}
            >
              {loading ? "Starting Node..." : "Start Lightning Node"}
            </button>
          </div>
        ) : (
          <div className="node-info">
            <div className="info-row">
              <span className="info-label">Node ID</span>
              <span className="info-value mono">
                {nodeInfo.node_id.slice(0, 16)}...{nodeInfo.node_id.slice(-8)}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Network</span>
              <span className="info-value">{nodeInfo.network}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Channels</span>
              <span className="info-value">{nodeInfo.num_channels}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Peers</span>
              <span className="info-value">{nodeInfo.num_peers}</span>
            </div>
            <div className="status-badge running">Node Running</div>
          </div>
        )}
      </div>

      <div className="home-footer">
        <button className="btn btn-danger" onClick={handleLogout}>
          Delete Identity & Logout
        </button>
      </div>
    </main>
  );
}

export default App;
