"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";

export interface SparklineProps {
  /** Ordered series of values (oldest -> newest). */
  data: number[];
  /** Any CSS colour, e.g. `var(--gate-accent)`. */
  color: string;
  /** Chart height in px. */
  height?: number;
}

/**
 * Internal sparkline. Loaded lazily by StatCard so recharts stays out of the
 * main bundle for consumers that never render a sparkline.
 */
export default function Sparkline({ data, color, height = 40 }: SparklineProps) {
  const chartData = data.map((value, index) => ({ index, value }));

  return (
    <div style={{ height }} className="w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
        >
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
