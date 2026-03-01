import 'server-only';

export type ScoringInput = {
  answers: Array<{
    questionId: string;
    selectedValue: string;
    dimension?: string | null;
    options: Array<{ value: string; score?: number; dimension?: string }>;
  }>;
  scoringStrategy: 'dimension' | 'category' | 'scale' | 'composite';
  scoringConfig: Record<string, unknown>;
  resultDefinitions: Record<string, unknown>;
};

export type ScoringOutput = {
  resultCode: string;
  resultLabel: string;
  dimensionScores: Record<string, number>;
  summary: string;
};

function getSelectedOption(answer: ScoringInput['answers'][number]) {
  return answer.options.find((o) => o.value === answer.selectedValue);
}

/**
 * Dimension strategy (e.g. MBTI).
 * scoringConfig.dimensions is an array of [sideA, sideB] pairs, e.g. [["E","I"],["S","N"],["T","F"],["J","P"]].
 * Each option's dimension field indicates which side it contributes to, and score is the magnitude.
 */
function scoreDimension(input: ScoringInput): ScoringOutput {
  const rawDimensions = (input.scoringConfig.dimensions ?? []) as Array<
    [string, string] | { id: string; labels: string[] }
  >;

  // Normalize dimensions to [sideA, sideB] pairs
  // MBTI dimension IDs like "EI" get split into ["E", "I"]
  const dimensions: Array<[string, string]> = rawDimensions.map((d) => {
    if (Array.isArray(d)) return d as [string, string];
    // Object format: { id: "EI", labels: [...] } - split id into sides
    const id = d.id;
    return [id[0] ?? '', id[1] ?? ''] as [string, string];
  });

  const dimScores: Record<string, number> = {};

  // Initialize all sides to 0
  for (const [a, b] of dimensions) {
    dimScores[a] = 0;
    dimScores[b] = 0;
  }

  // Accumulate scores
  for (const answer of input.answers) {
    const selected = getSelectedOption(answer);
    if (!selected) continue;
    // Prefer the option-level dimension, then question-level, then fall back to selectedValue
    const dim = selected.dimension ?? answer.dimension ?? answer.selectedValue;
    if (dim && dim in dimScores) {
      dimScores[dim] = (dimScores[dim] ?? 0) + (selected.score ?? 1);
    }
  }

  // Determine winner for each dimension pair
  let resultCode = '';
  for (const [a, b] of dimensions) {
    resultCode += (dimScores[a] ?? 0) >= (dimScores[b] ?? 0) ? a : b;
  }

  const def = input.resultDefinitions[resultCode] as
    | { label?: string; summary?: string; description?: string }
    | undefined;

  return {
    resultCode,
    resultLabel: def?.label ?? resultCode,
    dimensionScores: dimScores,
    summary: def?.summary ?? def?.description ?? `Your type is ${resultCode}.`,
  };
}

/**
 * Category strategy (e.g. Enneagram, DISC).
 * Each option has a dimension field indicating the category it belongs to.
 * The category with the highest total score wins.
 */
function scoreCategory(input: ScoringInput): ScoringOutput {
  const categoryScores: Record<string, number> = {};

  for (const answer of input.answers) {
    const selected = getSelectedOption(answer);
    if (!selected) continue;
    const cat = selected.dimension ?? answer.dimension ?? 'default';
    categoryScores[cat] = (categoryScores[cat] ?? 0) + (selected.score ?? 1);
  }

  // Find highest category
  let topCategory = '';
  let topScore = -Infinity;
  for (const [cat, score] of Object.entries(categoryScores)) {
    if (score > topScore) {
      topScore = score;
      topCategory = cat;
    }
  }

  const resultCode = topCategory;
  const def = input.resultDefinitions[resultCode] as
    | { label?: string; summary?: string; description?: string }
    | undefined;

  return {
    resultCode,
    resultLabel: def?.label ?? resultCode,
    dimensionScores: categoryScores,
    summary:
      def?.summary ?? def?.description ?? `Your primary type is ${resultCode}.`,
  };
}

/**
 * Scale strategy (e.g. Big Five, Dark Triad).
 * scoringConfig.scales defines dimension names and their min/max or thresholds.
 * Calculate average score per dimension and produce a level rating.
 */
function scoreScale(input: ScoringInput): ScoringOutput {
  const scales = (input.scoringConfig.scales ?? {}) as Record<
    string,
    { levels?: Array<{ min: number; max: number; label: string }> }
  >;
  const dimTotals: Record<string, number> = {};
  const dimCounts: Record<string, number> = {};

  for (const answer of input.answers) {
    const selected = getSelectedOption(answer);
    if (!selected) continue;
    const dim = selected.dimension ?? answer.dimension ?? 'default';
    dimTotals[dim] = (dimTotals[dim] ?? 0) + (selected.score ?? 0);
    dimCounts[dim] = (dimCounts[dim] ?? 0) + 1;
  }

  const dimensionScores: Record<string, number> = {};
  const levelLabels: string[] = [];

  for (const dim of Object.keys(dimTotals)) {
    const avg = (dimTotals[dim] ?? 0) / (dimCounts[dim] ?? 1);
    dimensionScores[dim] = Math.round(avg * 100) / 100;

    const scaleConfig = scales[dim];
    if (scaleConfig?.levels) {
      const level = scaleConfig.levels.find(
        (l) => avg >= l.min && avg <= l.max,
      );
      levelLabels.push(`${dim}:${level?.label ?? 'medium'}`);
    } else {
      levelLabels.push(`${dim}:${dimensionScores[dim]}`);
    }
  }

  const resultCode = levelLabels.join(',');
  let def = input.resultDefinitions[resultCode] as
    | { label?: string; summary?: string; description?: string }
    | undefined;

  // Fallback: find best matching resultDefinition by dimension levels
  if (!def) {
    const currentLevels = new Map(
      levelLabels.map((l) => {
        const [dim, ...rest] = l.split(':');
        return [dim ?? '', rest.join(':')] as [string, string];
      }),
    );
    let bestKey: string | undefined;
    let bestMatchCount = 0;

    for (const key of Object.keys(input.resultDefinitions)) {
      const parts = key.split(',');
      let matchCount = 0;
      let allMatch = true;
      for (const part of parts) {
        const [dim, ...rest] = part.split(':');
        const level = rest.join(':');
        if (currentLevels.get(dim ?? '') === level) {
          matchCount++;
        } else {
          allMatch = false;
        }
      }
      if (allMatch && matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        bestKey = key;
      }
    }
    // If no full match, take the one with most matching dimensions
    if (!bestKey) {
      for (const key of Object.keys(input.resultDefinitions)) {
        const parts = key.split(',');
        let matchCount = 0;
        for (const part of parts) {
          const [dim, ...rest] = part.split(':');
          const level = rest.join(':');
          if (currentLevels.get(dim ?? '') === level) {
            matchCount++;
          }
        }
        if (matchCount > bestMatchCount) {
          bestMatchCount = matchCount;
          bestKey = key;
        }
      }
    }
    if (bestKey) {
      def = input.resultDefinitions[bestKey] as
        | { label?: string; summary?: string; description?: string }
        | undefined;
    }
  }

  return {
    resultCode,
    resultLabel: def?.label ?? resultCode,
    dimensionScores,
    summary:
      def?.summary ?? def?.description ?? `Your scale scores: ${resultCode}.`,
  };
}

/**
 * Composite strategy (e.g. Human Feeling).
 * Combines per-dimension scoring with an overall composite interpretation.
 */
function scoreComposite(input: ScoringInput): ScoringOutput {
  const dimTotals: Record<string, number> = {};
  const dimCounts: Record<string, number> = {};

  for (const answer of input.answers) {
    const selected = getSelectedOption(answer);
    if (!selected) continue;
    const dim = selected.dimension ?? answer.dimension ?? 'general';
    dimTotals[dim] = (dimTotals[dim] ?? 0) + (selected.score ?? 0);
    dimCounts[dim] = (dimCounts[dim] ?? 0) + 1;
  }

  const dimensionScores: Record<string, number> = {};
  for (const dim of Object.keys(dimTotals)) {
    dimensionScores[dim] =
      Math.round(((dimTotals[dim] ?? 0) / (dimCounts[dim] ?? 1)) * 100) / 100;
  }

  // Build composite code from sorted dimension keys
  const codeParts = Object.entries(dimensionScores)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dim, score]) => `${dim}:${score}`);
  const resultCode = codeParts.join(',');

  let def = input.resultDefinitions[resultCode] as
    | { label?: string; summary?: string; description?: string }
    | undefined;

  // If no exact match, find closest by dimension score distance
  if (!def) {
    let bestKey: string | undefined;
    let bestDistance = Infinity;

    for (const key of Object.keys(input.resultDefinitions)) {
      const parts = key.split(',');
      let distance = 0;
      let valid = true;
      for (const part of parts) {
        const [dim, scoreStr] = part.split(':');
        if (!dim || scoreStr === undefined) {
          valid = false;
          break;
        }
        const defScore = Number.parseFloat(scoreStr);
        const actualScore = dimensionScores[dim] ?? 0;
        if (Number.isNaN(defScore)) {
          valid = false;
          break;
        }
        distance += (actualScore - defScore) ** 2;
      }
      if (valid && distance < bestDistance) {
        bestDistance = distance;
        bestKey = key;
      }
    }
    if (bestKey) {
      def = input.resultDefinitions[bestKey] as
        | { label?: string; summary?: string; description?: string }
        | undefined;
    }
  }

  return {
    resultCode,
    resultLabel: def?.label ?? resultCode,
    dimensionScores,
    summary:
      def?.summary ??
      def?.description ??
      `Your composite profile: ${resultCode}.`,
  };
}

const strategies: Record<
  ScoringInput['scoringStrategy'],
  (input: ScoringInput) => ScoringOutput
> = {
  dimension: scoreDimension,
  category: scoreCategory,
  scale: scoreScale,
  composite: scoreComposite,
};

export function calculateScore(input: ScoringInput): ScoringOutput {
  const strategy = strategies[input.scoringStrategy];
  return strategy(input);
}
