import { DimensionChart } from './dimension-chart';

interface ResultSummaryProps {
  testName: string;
  resultCode: string;
  resultLabel: string;
  dimensionScores: Record<string, number>;
  summary: string;
}

export function ResultSummary({
  testName,
  resultCode,
  resultLabel,
  dimensionScores,
  summary,
}: ResultSummaryProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="mb-2 text-gray-500 text-sm">{testName}</p>
        <div className="mb-2 inline-block rounded-full bg-gradient-to-r from-purple-100 to-pink-100 px-6 py-2">
          <span className="font-bold text-2xl text-purple-700">
            {resultCode}
          </span>
        </div>
        <h2 className="font-semibold text-gray-900 text-xl">{resultLabel}</h2>
      </div>

      <DimensionChart scores={dimensionScores} />

      <div className="rounded-xl bg-gray-50 p-6">
        <h3 className="mb-3 font-medium text-gray-900">结果概要</h3>
        <p className="text-gray-600 leading-relaxed">{summary}</p>
      </div>
    </div>
  );
}
