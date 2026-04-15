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
  credits,
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
      {credits && (
        <span className="font-small text-muted-foreground ml-auto">
          &#9889; {credits.remaining_sats.toLocaleString()} sats
        </span>
      )}
      {hasSession && (
        <span className="font-small text-amber">
          &#9889; {satsPaid} sats paid
        </span>
      )}
    </div>
  );
});
