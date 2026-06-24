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
    // option.dimension/answer.dimension 通常存的是“维度对 id”（如 "EI"），
    // 并非单边键。只有当它本身就是某一边（已在 dimScores 中）时才直接用，
    // 否则回退到选项 value（'E'/'I' 才是真正的累加边）。
    const dimHint = selected.dimension ?? answer.dimension;
    const side =
      dimHint && dimHint in dimScores ? dimHint : answer.selectedValue;
    if (side in dimScores) {
      dimScores[side] = (dimScores[side] ?? 0) + (selected.score ?? 1);
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

type ResultDef = { label?: string; summary?: string; description?: string };
type ScaleDimDef = { id: string; min?: number; max?: number };

/**
 * Scale strategy (e.g. Big Five, Dark Triad, Mental Age).
 *
 * scoringConfig 形态（与种子数据契约一致）：
 *   - dimensions: [{ id, min, max }]  —— 每个维度的取值范围（默认 1~5）
 *   - （兼容旧）scales: { dim: { levels: [{ min, max, label }] } }
 *
 * 两类 resultDefinitions：
 *   1. 多维 high/low（大五、暗黑三联）：键为 `high_<dim>` / `low_<dim>`，
 *      按维度均分相对中点（(min+max)/2）判定高/低，resultLabel 由各维标签拼成。
 *   2. 单维有序桶（心理年龄）：无 high/low_ 键，resultDefinitions 按从低到高顺序排列，
 *      用主维度均分在 [min,max] 中的归一化位置落入对应桶。
 *
 * resultCode 始终保留“维度名:均分”的数值画像（schema 注释已说明，供报告/雷达图复用），
 * resultLabel 才是给用户看的可读标签。
 */
function scoreScale(input: ScoringInput): ScoringOutput {
  const dimensionDefs = (input.scoringConfig.dimensions ?? []) as ScaleDimDef[];
  const legacyScales = (input.scoringConfig.scales ?? {}) as Record<
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

  // 维度顺序优先取配置；配置缺失时退回作答中出现的维度
  const dimIds = dimensionDefs.length
    ? dimensionDefs.map((d) => d.id)
    : Object.keys(dimTotals);

  const dimensionScores: Record<string, number> = {};
  const codeParts: string[] = [];
  const matchedLabels: string[] = [];
  const matchedSummaries: string[] = [];

  for (const dim of dimIds) {
    const count = dimCounts[dim] ?? 0;
    if (count === 0) continue; // 该维度没有作答，跳过
    const avg = (dimTotals[dim] ?? 0) / count;
    const rounded = Math.round(avg * 100) / 100;
    dimensionScores[dim] = rounded;
    codeParts.push(`${dim}:${rounded}`);

    const def = dimensionDefs.find((d) => d.id === dim);
    const min = def?.min ?? 1;
    const max = def?.max ?? 5;

    // 兼容旧 scales.levels：显式区间命中
    const legacyLevels = legacyScales[dim]?.levels;
    if (legacyLevels) {
      const lvl = legacyLevels.find((l) => avg >= l.min && avg <= l.max);
      if (lvl) {
        const rd = input.resultDefinitions[lvl.label] as ResultDef | undefined;
        matchedLabels.push(rd?.label ?? lvl.label);
        if (rd?.summary ?? rd?.description) {
          matchedSummaries.push(rd?.summary ?? rd?.description ?? '');
        }
      }
      continue;
    }

    // high/low 分类：相对中点判定，映射到 `high_<dim>` / `low_<dim>`
    const level = avg >= (min + max) / 2 ? 'high' : 'low';
    const rd = input.resultDefinitions[`${level}_${dim}`] as
      | ResultDef
      | undefined;
    if (rd?.label) {
      matchedLabels.push(rd.label);
      if (rd.summary ?? rd.description) {
        matchedSummaries.push(rd.summary ?? rd.description ?? '');
      }
    }
  }

  const resultCode = codeParts.join(',');

  // 情况 1：多维 high/low profile（大五、暗黑三联）
  if (matchedLabels.length > 0) {
    return {
      resultCode,
      resultLabel: matchedLabels.join(' · '),
      dimensionScores,
      summary: matchedSummaries.length
        ? matchedSummaries.join(' ')
        : `Your scale profile: ${resultCode}.`,
    };
  }

  // 情况 2：单维有序桶映射（心理年龄等无 high/low_ 键的量表）
  const defKeys = Object.keys(input.resultDefinitions);
  const primary = dimIds.find((d) => dimensionScores[d] !== undefined);
  if (defKeys.length > 0 && primary) {
    const def = dimensionDefs.find((d) => d.id === primary);
    const min = def?.min ?? 1;
    const max = def?.max ?? 5;
    const avg = dimensionScores[primary] ?? min;
    const ratio = max > min ? (avg - min) / (max - min) : 0;
    const idx = Math.min(
      defKeys.length - 1,
      Math.max(0, Math.floor(ratio * defKeys.length)),
    );
    const key = defKeys[idx] as string;
    const rd = input.resultDefinitions[key] as ResultDef | undefined;
    return {
      resultCode,
      resultLabel: rd?.label ?? key,
      dimensionScores,
      summary:
        rd?.summary ?? rd?.description ?? `Your scale profile: ${resultCode}.`,
    };
  }

  // 兜底：无法映射时退回数值画像
  return {
    resultCode,
    resultLabel: resultCode,
    dimensionScores,
    summary: `Your scale scores: ${resultCode}.`,
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
