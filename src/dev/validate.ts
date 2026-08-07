// Lightning FM — automated payment validation runner (dev only).
//
// Drives the phase-1 test plan (docs/phase-1-test-plan.md) end-to-end inside
// the running app, against whatever network the node is configured for
// (regtest dev-cluster via `make dev-regtest`, or signet).
//
// Activation: start the dev server with VITE_LFM_VALIDATE=1 (see main.tsx).
// Progress and results are POSTed as JSON lines to the Vite middleware at
// /__lfm-validate-report (see vite.config.ts), which appends them to the
// file named by LFM_VALIDATE_OUT — so an orchestrator outside the webview
// can pay invoices mid-run and read the final results.
//
// Env knobs (all VITE_-prefixed so Vite exposes them to the client):
//   VITE_LFM_ARTIST_NODE_ID — Lightning node_id keysends are sent to (test 1.4)
//   VITE_LFM_TOPUP_SATS     — receive/bridge test amount (default 5000)

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface TestResult {
  test: string;
  pass: boolean;
  detail: string;
}

interface LdkEvent {
  event_type: string;
  amount_msat: number | null;
  payment_hash: string | null;
  _at: number;
}

const results: TestResult[] = [];
const events: LdkEvent[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(payload: Record<string, unknown>) {
  try {
    await fetch("/__lfm-validate-report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _ts: new Date().toISOString(), ...payload }),
    });
  } catch (e) {
    console.error("[validate] report POST failed:", e);
  }
}

function record(test: string, pass: boolean, detail = "") {
  results.push({ test, pass, detail });
  console.log(`[validate] ${test}: ${pass ? "PASS" : "FAIL"} ${detail}`);
  void post({ kind: "progress", test, pass, detail });
}

async function credits(): Promise<number> {
  const info = await invoke<{ remaining_sats: number }>("credits_info");
  return info.remaining_sats;
}

async function startSession(
  trackId: string,
  lightningNodeId: string | null,
  artistDirect: boolean,
) {
  return invoke("stream_start", {
    trackId,
    artistPubkey: "validate-artist-pubkey",
    lightningNodeId,
    artistDirect,
  });
}

export async function runValidation() {
  const artistNodeId =
    (import.meta.env.VITE_LFM_ARTIST_NODE_ID as string | undefined) ?? null;
  const topupSats = parseInt(
    (import.meta.env.VITE_LFM_TOPUP_SATS as string | undefined) ?? "5000",
    10,
  );

  await listen<Omit<LdkEvent, "_at">>("ldk-event", (e) => {
    events.push({ ...e.payload, _at: Date.now() });
  });

  await post({ kind: "start", artistNodeId, topupSats });

  try {
    // ── 1.1 — node starts (or is already running) ──────────────────────
    let info: { is_running: boolean; node_id: string; network: string };
    try {
      info = await invoke("ldk_start", { artistMode: false });
    } catch (e) {
      if (String(e).includes("already running")) {
        info = await invoke("ldk_get_info");
      } else {
        throw e;
      }
    }
    record(
      "1.1 node-start",
      info.is_running && info.node_id.length === 66,
      `network=${info.network} node_id=${info.node_id.slice(0, 12)}…`,
    );

    // ── wait for on-chain balance + usable LSP channel ─────────────────
    let funded = false;
    for (let i = 0; i < 30; i++) {
      const bal = await invoke<{ spendable_onchain_sats: number }>(
        "ldk_get_balance",
      );
      if (bal.spendable_onchain_sats > 0) {
        funded = true;
        record("1.2 funded", true, `${bal.spendable_onchain_sats} sats on-chain`);
        break;
      }
      await sleep(2000);
    }
    if (!funded) record("1.2 funded", false, "no on-chain balance after 60s");

    let channelUsable = false;
    for (let i = 0; i < 30; i++) {
      const channels = await invoke<{ is_usable: boolean }[]>(
        "ldk_list_channels",
      );
      if (channels.some((c) => c.is_usable)) {
        channelUsable = true;
        record("1.3 lsp-channel", true, `${channels.length} channel(s), usable`);
        break;
      }
      await sleep(2000);
    }
    if (!channelUsable) record("1.3 lsp-channel", false, "no usable channel after 60s");

    // ── receive + credits bridge (JIT invoice, paid by orchestrator) ───
    const creditsBefore = await credits();
    const invoice = await invoke<{ bolt11: string }>("ldk_create_invoice", {
      amountSats: topupSats,
      description: "validation top-up",
    });
    await post({ kind: "invoice", bolt11: invoice.bolt11, amountSats: topupSats });

    // The LSPS2 opening fee is skimmed from the payment, so credited sats
    // land below the invoice amount — accept anything above half.
    let bridged = false;
    for (let i = 0; i < 60; i++) {
      const now = await credits();
      if (now >= creditsBefore + topupSats / 2) {
        bridged = true;
        record(
          "receive-bridge",
          true,
          `credits ${creditsBefore} → ${now} (+${now - creditsBefore})`,
        );
        break;
      }
      await sleep(2000);
    }
    if (!bridged) {
      record("receive-bridge", false, `credits stuck at ${await credits()} after 120s`);
    }

    // ── 1.4 — streaming keysend with TLVs to the artist node ───────────
    if (artistNodeId) {
      let sent = false;
      let lastDetail = "";
      for (let attempt = 1; attempt <= 5 && !sent; attempt++) {
        await startSession(`validate-1.4-a${attempt}`, artistNodeId, true);
        const tick = await invoke<{
          artist_sats: number;
          credits_remaining: number;
        }>("stream_tick");
        lastDetail = `tick: artist_sats=${tick.artist_sats} credits=${tick.credits_remaining}`;

        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          if (
            events.some(
              (ev) =>
                ev.event_type === "payment_successful" &&
                ev.amount_msat === 100_000,
            )
          ) {
            sent = true;
            break;
          }
          if (events.some((ev) => ev.event_type === "payment_failed")) {
            lastDetail += " | payment_failed (gossip warm-up?) — retrying";
            break;
          }
          await sleep(1000);
        }
        await invoke("stream_stop");
        if (!sent && attempt < 5) await sleep(8000);
      }
      record("1.4 keysend", sent, lastDetail);
      // Bug-1 regression: the payment_successful event must carry amount_msat
      const ps = events.filter((e) => e.event_type === "payment_successful");
      record(
        "3.x amount_msat-on-success",
        ps.length > 0 && ps.every((e) => e.amount_msat != null),
        `${ps.length} payment_successful event(s)`,
      );
    } else {
      record("1.4 keysend", false, "no VITE_LFM_ARTIST_NODE_ID provided");
    }

    // ── 1.6a — plain credits deduction (no keysend) ────────────────────
    const beforeDeduct = await credits();
    await startSession("validate-1.6a", null, true);
    const t6 = await invoke<{ credits_remaining: number }>("stream_tick");
    await invoke("stream_stop");
    record(
      "1.6a deduct",
      t6.credits_remaining === beforeDeduct - 100,
      `${beforeDeduct} → ${t6.credits_remaining}`,
    );

    // ── 1.6b — refund when the node is down (bug-2 regression) ─────────
    try {
      await invoke("ldk_stop");
    } catch {
      /* already stopped */
    }
    const beforeRefund = await credits();
    await startSession("validate-1.6b", artistNodeId, true);
    await invoke("stream_tick");
    await invoke("stream_stop");
    const afterRefund = await credits();
    record(
      "1.6b refund-node-down",
      afterRefund === beforeRefund,
      `${beforeRefund} → ${afterRefund} (must be unchanged)`,
    );

    // restart the node for the remaining tests
    try {
      await invoke("ldk_start", { artistMode: false });
    } catch (e) {
      if (!String(e).includes("already running")) throw e;
    }

    // ── 1.7 — no rake on mirror-served tracks ──────────────────────────
    await startSession("validate-1.7", null, false);
    const t7 = await invoke<{
      artist_sats: number;
      listener_sats: number;
    }>("stream_tick");
    await invoke("stream_stop");
    record(
      "1.7 no-rake",
      t7.artist_sats === 100 && t7.listener_sats === 100,
      `${t7.artist_sats}/${t7.listener_sats}`,
    );

    // ── 2.4 — withdrawal address network validation ────────────────────
    let mainnetRejected = false;
    try {
      await invoke("withdraw_onchain", {
        address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        amountSats: 1000,
      });
    } catch (e) {
      mainnetRejected = /not valid|invalid/i.test(String(e));
    }
    let garbageRejected = false;
    try {
      await invoke("withdraw_onchain", { address: "not-an-address", amountSats: 1000 });
    } catch (e) {
      garbageRejected = /invalid/i.test(String(e));
    }
    record(
      "2.4 address-validation",
      mainnetRejected && garbageRejected,
      `mainnet=${mainnetRejected ? "rejected" : "ACCEPTED"} garbage=${garbageRejected ? "rejected" : "ACCEPTED"}`,
    );
  } catch (e) {
    record("runner", false, `aborted: ${String(e)}`);
  }

  await post({ kind: "results", results, events });
  console.log("[validate] complete", results);
}
