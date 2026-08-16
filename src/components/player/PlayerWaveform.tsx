// Inline waveform for the player bar — true peaks of the playing track,
// rendered as amber bars with the played portion lit. Seekable like the
// progress bar. Peaks come from the same Rust generator Upload uses
// (waveform_generate), reading the playback cache file.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface PlayerWaveformProps {
  cachePath: string;
  trackHash: string;
  currentTime: number;
  duration: number;
  onSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const WIDTH = 180;
const HEIGHT = 28;
const BAR_COUNT = Math.floor(WIDTH / (BAR_WIDTH + BAR_GAP));

export function PlayerWaveform({
  cachePath,
  trackHash,
  currentTime,
  duration,
  onSeek,
}: PlayerWaveformProps) {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    setPeaks(null);
    if (!cachePath) return;
    let cancelled = false;
    invoke<{ peaks: number[] }>("waveform_generate", {
      filePath: cachePath,
      peakCount: BAR_COUNT,
    })
      .then((data) => {
        if (!cancelled) setPeaks(data.peaks);
      })
      .catch(() => {
        /* no waveform — the progress bar still tells the story */
      });
    return () => {
      cancelled = true;
    };
  }, [cachePath, trackHash]);

  if (!peaks) return null;

  const progress = duration > 0 ? currentTime / duration : 0;
  const playedBars = progress * BAR_COUNT;

  return (
    <div
      className="shrink-0 cursor-pointer"
      style={{ width: WIDTH, height: HEIGHT }}
      onClick={onSeek}
      title="Seek"
    >
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {peaks.slice(0, BAR_COUNT).map((peak, i) => {
          const barHeight = Math.max(2, peak * (HEIGHT - 4));
          const x = i * (BAR_WIDTH + BAR_GAP);
          const y = HEIGHT / 2 - barHeight / 2;
          const played = i < playedBars;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={BAR_WIDTH}
              height={barHeight}
              fill={played ? "var(--amber)" : "var(--amber-dim)"}
              opacity={played ? 0.9 : 0.35}
            />
          );
        })}
      </svg>
    </div>
  );
}
