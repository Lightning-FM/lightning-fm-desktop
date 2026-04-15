import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LibraryTrack } from "../components/library";
import type { PaymentEvent } from "../components/PaymentNotification";
import type { CreditsInfo, StreamSession, IntervalResult, IdentityInfo } from "../types/streaming";

export interface StreamingState {
  session: StreamSession | null;
  satsPaid: number;
  credits: CreditsInfo | null;
  paymentEvent: PaymentEvent | null;
}

export interface StreamingActions {
  startStreamSession: (track: LibraryTrack, identity: IdentityInfo | null) => Promise<void>;
  loadCredits: () => Promise<void>;
}

export interface UseStreamingReturn {
  state: StreamingState;
  actions: StreamingActions;
}

export function useStreaming(
  isPlaying: boolean,
  audioRef: React.RefObject<HTMLAudioElement | null>,
  setIsPlaying: (playing: boolean) => void,
): UseStreamingReturn {
  const [session, setSession] = useState<StreamSession | null>(null);
  const [satsPaid, setSatsPaid] = useState(0);
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [paymentEvent, setPaymentEvent] = useState<PaymentEvent | null>(null);
  const intervalRef = useRef<number | null>(null);

  // Ref for stable callback access to session
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Listen for LDK payment events from the Rust backend
  useEffect(() => {
    const unlisten = listen<{
      event_type: string;
      payment_hash: string | null;
      amount_msat: number | null;
      fee_paid_msat: number | null;
      close_reason: string | null;
    }>("ldk-event", (event) => {
      const payload = event.payload;
      const amountSats = payload.amount_msat ? Math.round(payload.amount_msat / 1000) : 0;

      switch (payload.event_type) {
        case "payment_successful":
          setPaymentEvent({
            type: "sent",
            amount_sats: amountSats,
            message: payload.fee_paid_msat
              ? `Fee: ${payload.fee_paid_msat} msat`
              : "Keysend confirmed",
            timestamp: Date.now(),
          });
          break;

        case "payment_failed":
          setPaymentEvent({
            type: "failed",
            amount_sats: 0,
            message: payload.close_reason || "Routing or channel error",
            timestamp: Date.now(),
          });
          break;

        case "payment_received":
          setPaymentEvent({
            type: "received",
            amount_sats: amountSats,
            message: "Incoming payment",
            timestamp: Date.now(),
          });
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Streaming payment timer — tick every 60 seconds while playing
  useEffect(() => {
    if (isPlaying && session) {
      intervalRef.current = window.setInterval(async () => {
        try {
          const result = await invoke<IntervalResult>("stream_tick");
          setSession(result.session);
          setSatsPaid(result.session.total_listener_sats);
          setCredits(prev => prev ? { ...prev, remaining_sats: result.credits_remaining, can_stream: !result.credits_depleted } : null);

          if (result.credits_depleted) {
            audioRef.current?.pause();
            setIsPlaying(false);
          }
        } catch (e) {
          console.error("Stream tick failed:", e);
        }
      }, 60000);
    }

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, session, audioRef, setIsPlaying]);

  const loadCredits = useCallback(async () => {
    try {
      const info = await invoke<CreditsInfo>("credits_info");
      setCredits(info);
    } catch {}
  }, []);

  const startStreamSession = useCallback(async (track: LibraryTrack, identity: IdentityInfo | null) => {
    setSatsPaid(0);

    if (sessionRef.current) {
      try { await invoke("stream_stop"); } catch {}
    }

    if (identity) {
      try {
        const newSession = await invoke<StreamSession>("stream_start", {
          trackId: track.hash,
          artistPubkey: track.artistPubkey || "test-artist-" + track.artist.toLowerCase().replace(/\s+/g, "-"),
          lightningNodeId: track.lightningNodeId || undefined,
          artistDirect: track.artistDirect,
        });
        setSession(newSession);
      } catch (e) {
        console.error("Failed to start stream:", e);
      }
    }
  }, []);

  const actions = useMemo(() => ({ startStreamSession, loadCredits }), [startStreamSession, loadCredits]);

  return {
    state: { session, satsPaid, credits, paymentEvent },
    actions,
  };
}
