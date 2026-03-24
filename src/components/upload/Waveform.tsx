// Amber waveform visualization — renders audio peaks as SVG bars

interface WaveformProps {
  peaks: number[] | null;
  width?: number;
  height?: number;
  className?: string;
}

const BAR_WIDTH = 2;
const BAR_GAP = 1;

export function Waveform({
  peaks,
  width = 300,
  height = 48,
  className = "",
}: WaveformProps) {
  if (!peaks || peaks.length === 0) {
    return (
      <div
        className={`bg-[var(--bg-tertiary)] border border-border flex items-center justify-center ${className}`}
        style={{ width, height }}
      >
        <span className="font-small text-muted-foreground">
          generating waveform...
        </span>
      </div>
    );
  }

  // Downsample peaks to fit the width
  const barCount = Math.floor(width / (BAR_WIDTH + BAR_GAP));
  const step = peaks.length / barCount;
  const bars: number[] = [];

  for (let i = 0; i < barCount; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    let max = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      if (peaks[j] > max) max = peaks[j];
    }
    bars.push(max);
  }

  const midY = height / 2;

  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox={`0 0 ${width} ${height}`}
    >
      {bars.map((peak, i) => {
        const barHeight = Math.max(2, peak * (height - 4));
        const x = i * (BAR_WIDTH + BAR_GAP);
        const y = midY - barHeight / 2;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={BAR_WIDTH}
            height={barHeight}
            fill="var(--amber)"
            opacity={0.6 + peak * 0.4}
          />
        );
      })}
    </svg>
  );
}
