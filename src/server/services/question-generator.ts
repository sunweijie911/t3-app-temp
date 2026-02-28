import 'server-only';
import { nanoid } from 'nanoid';
import { completion } from './llm';

interface GeneratedQuestion {
  id: string;
  testTypeId: string;
  text: string;
  description: string | null;
  options: Array<{
    value: string;
    label: string;
    score?: number;
    dimension?: string;
  }>;
  dimension: string | null;
  weight: string;
  source: 'ai_generated';
  sortOrder: number;
  isActive: boolean;
}

export async function generateQuestions(
  testTypeId: string,
  count: number,
  topic?: string,
): Promise<GeneratedQuestion[]> {
  const topicInstruction = topic
    ? `The questions should be related to the trending topic: "${topic}". Adapt standard personality assessment questions to incorporate this theme while maintaining psychological validity.`
    : '';

  const response = await completion([
    {
      role: 'system',
      content: `You are a professional psychologist specialized in creating personality test questions. You create well-crafted, scientifically grounded questions for psychological assessments. Always respond with valid JSON.`,
    },
    {
      role: 'user',
      content: `Generate ${count} personality test questions for test type ID "${testTypeId}".
${topicInstruction}

Each question should have 2-5 options with score values and dimension labels.

Respond with a JSON array of objects, each with:
- "text": the question text (in Chinese)
- "description": optional description or null
- "options": array of { "value": "A"/"B"/etc, "label": "option text", "score": number, "dimension": "dimension_name" }
- "dimension": primary dimension this question measures, or null

Respond ONLY with the JSON array, no other text.`,
    },
  ]);

  const content = response.choices[0]?.message?.content ?? '[]';

  let parsed: Array<{
    text: string;
    description?: string | null;
    options: Array<{
      value: string;
      label: string;
      score?: number;
      dimension?: string;
    }>;
    dimension?: string | null;
  }>;

  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(jsonMatch?.[0] ?? '[]') as typeof parsed;
  } catch {
    parsed = [];
  }

  return parsed.map((q, index) => ({
    id: nanoid(),
    testTypeId,
    text: q.text,
    description: q.description ?? null,
    options: q.options,
    dimension: q.dimension ?? null,
    weight: '1.00',
    source: 'ai_generated' as const,
    sortOrder: index,
    isActive: true,
  }));
}
