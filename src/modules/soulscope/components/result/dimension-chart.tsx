'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function DimensionChart({ scores }: { scores: Record<string, number> }) {
  const entries = Object.entries(scores);
  if (entries.length === 0) return null;

  const maxScore = Math.max(...entries.map(([, v]) => v), 1);

  const data = entries.map(([dimension, score]) => ({
    dimension,
    score: typeof score === 'number' ? Number(score.toFixed(1)) : score,
    fullMark: maxScore,
  }));

  if (entries.length >= 3) {
    return (
      <div className="space-y-3">
        <h3 className="font-medium text-gray-900">维度得分</h3>
        <ResponsiveContainer height={300} width="100%">
          <RadarChart cx="50%" cy="50%" data={data} outerRadius="75%">
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{ fill: '#6b7280', fontSize: 12 }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, maxScore]}
              tick={{ fill: '#9ca3af', fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
              }}
            />
            <Radar
              dataKey="score"
              fill="#7c3aed"
              fillOpacity={0.3}
              name="得分"
              stroke="#7c3aed"
              strokeWidth={2}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-gray-900">维度得分</h3>
      <ResponsiveContainer height={entries.length * 60 + 40} width="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid horizontal={false} strokeDasharray="3 3" />
          <XAxis domain={[0, maxScore]} type="number" />
          <YAxis
            dataKey="dimension"
            tick={{ fill: '#6b7280', fontSize: 12 }}
            type="category"
            width={80}
          />
          <Tooltip
            contentStyle={{
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
            }}
          />
          <Bar
            barSize={20}
            dataKey="score"
            fill="#7c3aed"
            name="得分"
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
