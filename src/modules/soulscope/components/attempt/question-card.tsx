'use client';

interface Option {
  value: string;
  label: string;
}

interface QuestionCardProps {
  questionIndex: number;
  totalQuestions: number;
  text: string;
  description?: string | null;
  options: Option[];
  selectedValue?: string;
  onSelect: (value: string) => void;
}

export function QuestionCard({
  questionIndex,
  totalQuestions,
  text,
  description,
  options,
  selectedValue,
  onSelect,
}: QuestionCardProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 text-gray-400 text-sm">
        第 {questionIndex + 1} / {totalQuestions} 题
      </div>
      <h2 className="mb-3 font-semibold text-gray-900 text-xl">{text}</h2>
      {description && (
        <p className="mb-6 text-gray-500 text-sm">{description}</p>
      )}
      <div className="space-y-3">
        {options.map((option) => (
          <button
            className={`w-full rounded-xl border-2 p-4 text-left transition-all ${
              selectedValue === option.value
                ? 'border-purple-500 bg-purple-50 text-purple-700'
                : 'border-gray-200 bg-white text-gray-700 hover:border-purple-200 hover:bg-purple-50/50'
            }`}
            key={option.value}
            onClick={() => onSelect(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
