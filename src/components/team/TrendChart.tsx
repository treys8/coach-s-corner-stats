"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = ["#FF4A00", "#0021A5", "#A7A8AA", "#001f6b"];

export interface TrendChartProps {
  data: Array<Record<string, string | number>>;
  keys: string[];
}

export default function TrendChart({ data, keys }: TrendChartProps) {
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <RTooltip
            contentStyle={{
              background: "hsl(var(--sa-blue-deep))",
              border: "1px solid hsl(var(--sa-orange))",
              color: "white",
              fontSize: 12,
            }}
          />
          {keys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
