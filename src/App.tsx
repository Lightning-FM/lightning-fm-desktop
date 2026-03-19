import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./globals.css";

interface IdentityInfo {
  npub: string;
  pubkey_hex: string;
  has_nsec: boolean;
  display_name: string | null;
}

interface NodeInfo {
  node_id: string;
  network: string;
  listening_addresses: string[];
  num_channels: number;
  num_peers: number;
  is_running: boolean;
}

type AppScreen = "loading" | "onboarding" | "home";

function App() {
  const [screen, setScreen] = useState<AppScreen>("loading");
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <main className="min-h-screen flex flex-col items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="font-display text-amber">⚡ Lightning FM</h1>
        <p className="font-body-mono text-muted-foreground mt-2 italic">
          the music channel nobody can shut down
        </p>
        <div className="mt-6 mx-auto w-5 h-5 border-2 border-border border-t-amber rounded-full animate-spin" />
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
    <main className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
      <div className="text-center max-w-sm w-full">
        <h1 className="font-display text-amber">⚡ Lightning FM</h1>
        <p className="font-body-mono text-muted-foreground mt-2 mb-8 italic">
          the music channel nobody can shut down
        </p>

        {(error || localError) && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive font-body-mono px-3 py-2 mb-4 text-left">
            {localError || error}
          </div>
        )}

        {mode === "choose" ? (
          <div className="flex flex-col gap-3">
            <button
              className="h-9 px-4 bg-primary text-primary-foreground font-mono text-sm font-medium transition-all hover:opacity-90 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none"
              onClick={createNew}
              disabled={loading}
            >
              {loading ? "Creating..." : "Create New Identity"}
            </button>
            <button
              className="h-9 px-4 border border-border bg-background text-secondary-foreground font-mono text-sm font-medium transition-all hover:bg-muted hover:text-foreground active:translate-y-px disabled:opacity-50 disabled:pointer-events-none"
              onClick={() => setMode("import")}
              disabled={loading}
            >
              I Have a Nostr Identity
            </button>
          </div>
        ) : (
          <div className="text-left">
            <p className="font-label-mono text-secondary-foreground uppercase tracking-wider mb-2">
              Paste your nsec or hex secret key
            </p>
            <input
              type="password"
              className="w-full h-9 px-3 bg-card border border-input text-foreground font-mono text-sm focus:border-ring focus:ring-1 focus:ring-ring/50 outline-none mb-3"
              value={nsecInput}
              onChange={(e) => setNsecInput(e.target.value)}
              placeholder="nsec1... or hex"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                className="h-9 px-4 bg-primary text-primary-foreground font-mono text-sm font-medium transition-all hover:opacity-90 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none"
                onClick={importExisting}
                disabled={loading || !nsecInput.trim()}
              >
                {loading ? "Importing..." : "Import"}
              </button>
              <button
                className="h-9 px-4 border border-border bg-background text-secondary-foreground font-mono text-sm font-medium transition-all hover:bg-muted hover:text-foreground active:translate-y-px disabled:opacity-50 disabled:pointer-events-none"
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
      try { await invoke("ldk_stop"); } catch {}
      await invoke("identity_delete");
      onLogout();
    } catch (e) {
      setError(`${e}`);
    }
  }

  const npubShort = identity.npub.slice(0, 12) + "..." + identity.npub.slice(-6);

  return (
    <main className="min-h-screen flex flex-col bg-background pt-12 px-6">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="font-heading-1 text-amber">⚡ Lightning FM</h1>
        <div className="mt-2">
          <span className="font-label-mono text-muted-foreground bg-card px-2 py-1 border border-border">
            {npubShort}
          </span>
        </div>
      </div>

      {error && (
        <div className="max-w-lg mx-auto w-full bg-destructive/10 border border-destructive/30 text-destructive font-body-mono px-3 py-2 mb-4">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="max-w-lg mx-auto w-full">
        {!nodeInfo ? (
          <div className="text-center">
            <p className="font-body-mono text-muted-foreground mb-5">
              Your Nostr identity is ready. Start your Lightning node to begin.
            </p>
            <button
              className="h-9 px-4 bg-primary text-primary-foreground font-mono text-sm font-medium transition-all hover:opacity-90 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none"
              onClick={startNode}
              disabled={loading}
            >
              {loading ? "Starting Node..." : "⚡ Start Lightning Node"}
            </button>
          </div>
        ) : (
          <div className="pane-border p-5">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="font-label-mono text-muted-foreground uppercase tracking-wider">Node ID</span>
              <span className="font-label-mono text-foreground">
                {nodeInfo.node_id.slice(0, 16)}...{nodeInfo.node_id.slice(-8)}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="font-label-mono text-muted-foreground uppercase tracking-wider">Network</span>
              <span className="font-body-mono text-foreground">{nodeInfo.network}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="font-label-mono text-muted-foreground uppercase tracking-wider">Channels</span>
              <span className="font-body-mono text-foreground">{nodeInfo.num_channels}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="font-label-mono text-muted-foreground uppercase tracking-wider">Peers</span>
              <span className="font-body-mono text-foreground">{nodeInfo.num_peers}</span>
            </div>
            <div className="mt-4 text-center">
              <span className="font-label-mono uppercase tracking-wider text-success bg-success/10 border border-success/30 px-3 py-1 inline-block">
                Node Running
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="fixed bottom-6 left-0 right-0 text-center">
        <button
          className="font-small text-muted-foreground border border-border px-3 py-1 transition-all hover:border-destructive hover:text-destructive"
          onClick={handleLogout}
        >
          Delete Identity & Logout
        </button>
      </div>
    </main>
  );
}

export default App;
