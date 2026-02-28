import { TestCard } from './test-card';

interface TestType {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  questionCount: number;
  estimatedMinutes: number;
  isFeatured: boolean;
  reportPrice: string;
}

export function TestGrid({ tests }: { tests: TestType[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {tests.map((test) => (
        <TestCard key={test.id} {...test} />
      ))}
    </div>
  );
}
