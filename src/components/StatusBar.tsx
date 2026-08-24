import { memo } from "react";
import type { IdentityInfo } from "../types/streaming";
import { Wordmark } from "./Wordmark";

interface StatusBarProps {
  trackCount: number;
  identity: IdentityInfo | null;
  onSignIn: () => void;
}

export const StatusBar = memo(function StatusBar({
  trackCount,
  identity,
  onSignIn,
}: StatusBarProps) {
  return (
    <div className="shrink-0 h-8 flex items-center px-4 gap-4 border-b border-border bg-background">
      <Wordmark size={12} className="text-foreground" />
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
    </div>
  );
});
