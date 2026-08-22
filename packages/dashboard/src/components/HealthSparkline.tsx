import { useEffect, useState } from 'react';

interface HealthPoint {
  timestamp: string;
  matchRate: number;
  rowCount: number;
}

interface HealthSparklineProps {
  collectorId: string;
  width?: number;
  height?: number;
}

const API_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3001';

export function HealthSparkline({
  collectorId,
  width = 120,
  height = 32,
}: HealthSparklineProps) {
  const [points, setPoints] = useState<HealthPoint[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch(
          `${API_URL}/api/collectors/${encodeURIComponent(collectorId)}/health?limit=20`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (active) {
          setPoints(data.reverse());
        }
      } catch {
        // silently fail
      }
    }
    load();
    const interval = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [collectorId]);

  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-text-muted text-[9px] font-mono"
        style={{ width, height }}
      >
        —
      </div>
    );
  }

  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;

  const pathData = points
    .map((p, i) => {
      const x = padding + (i / (points.length - 1)) * w;
      const y = padding + h - p.matchRate * h;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const lastX = padding + w;
  const firstX = padding;
  const bottom = padding + h;
  const areaPath = `${pathData} L ${lastX.toFixed(1)} ${bottom} L ${firstX.toFixed(1)} ${bottom} Z`;

  const latestRate = points[points.length - 1].matchRate;
  const isHealthy = latestRate >= 0.8;
  const strokeColor = isHealthy ? '#32D74B' : '#FF453A';
  const fillColor = isHealthy ? 'rgba(50, 215, 75, 0.12)' : 'rgba(255, 69, 58, 0.12)';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
      aria-label={`Health sparkline: ${(latestRate * 100).toFixed(0)}% match rate`}
    >
      <path d={areaPath} fill={fillColor} />
      <path
        d={pathData}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={padding + w}
        cy={padding + h - latestRate * h}
        r="2.5"
        fill={strokeColor}
      />
    </svg>
  );
}
