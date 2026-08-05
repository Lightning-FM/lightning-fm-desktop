import { memo } from "react";
import type { CreditsInfo, IdentityInfo } from "../types/streaming";

interface StatusBarProps {
  trackCount: number;
  identity: IdentityInfo | null;
  credits: CreditsInfo | null;
  satsPaid: number;
  hasSession: boolean;
  onSignIn: () => void;
}

export const StatusBar = memo(function StatusBar({
  trackCount,
  identity,
  satsPaid,
  hasSession,
  onSignIn,
}: StatusBarProps) {
  return (
    <div className="shrink-0 h-8 flex items-center px-4 gap-4 border-b border-border bg-background">
      <span className="font-label-mono text-amber">&#9889; Lightning FM</span>
      <span className="font-small text-muted-foreground">
        {trackCount} tracks
      </span>
      {identity ? (
        <span className="font-small text-muted-foreground">
          &middot; {identity.npub.slice(0, 12)}...
        </span>
      ) : (
        <span
          className="font-small text-amber cursor-pointer hover:underline"
          onClick={onSignIn}
        >
          Sign In
        </span>
      )}
      {/* Streaming-credits balance intentionally not shown: listening is
          free (decision:lfm_pivot_free_listening_monetize_goods) and the
          1,000-sat welcome-credits figure was simulation-era noise. */}
      {hasSession && (
        <span className="font-small text-amber ml-auto">
          &#9889; {satsPaid} sats paid
        </span>
      )}
    </div>
  );
});
