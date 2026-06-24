import { describe, expect, it } from 'vitest';

import {
  calculateScore,
  type ScoringInput,
} from '@/modules/soulscope/services/scoring';

// ---------------------------------------------------------------------------
// dimension 策略（MBTI）
// 种子契约：option = { value: 'E', dimension: 'EI' }（dimension 存的是“维度对 id”）
// 期望：累加按单边 value 生效，不同作答得到不同结果（而非恒定 ESTJ）。
// ---------------------------------------------------------------------------
const MBTI_CONFIG: ScoringInput['scoringConfig'] = {
  dimensions: [
    { id: 'EI', label: '内外向' },
    { id: 'SN', label: '感觉直觉' },
    { id: 'TF', label: '思考情感' },
    { id: 'JP', label: '判断知觉' },
  ],
};
const MBTI_DEFS: ScoringInput['resultDefinitions'] = {
  ESTJ: { label: '总经理' },
  INFP: { label: '调停者' },
};

function mbtiAnswer(
  pair: string,
  side: string,
): ScoringInput['answers'][number] {
  const [a, b] = [pair[0] as string, pair[1] as string];
  return {
    questionId: `${pair}-${side}`,
    selectedValue: side,
    dimension: pair,
    options: [
      { value: a, dimension: pair },
      { value: b, dimension: pair },
    ],
  };
}

describe('calculateScore - dimension (MBTI)', () => {
  it('全选 E/S/T/J 得到 ESTJ', () => {
    const out = calculateScore({
      scoringStrategy: 'dimension',
      scoringConfig: MBTI_CONFIG,
      resultDefinitions: MBTI_DEFS,
      answers: [
        mbtiAnswer('EI', 'E'),
        mbtiAnswer('SN', 'S'),
        mbtiAnswer('TF', 'T'),
        mbtiAnswer('JP', 'J'),
      ],
    });
    expect(out.resultCode).toBe('ESTJ');
    expect(out.resultLabel).toBe('总经理');
  });

  it('全选 I/N/F/P 得到 INFP（证明累加生效、结果非恒定）', () => {
    const out = calculateScore({
      scoringStrategy: 'dimension',
      scoringConfig: MBTI_CONFIG,
      resultDefinitions: MBTI_DEFS,
      answers: [
        mbtiAnswer('EI', 'I'),
        mbtiAnswer('SN', 'N'),
        mbtiAnswer('TF', 'F'),
        mbtiAnswer('JP', 'P'),
      ],
    });
    expect(out.resultCode).toBe('INFP');
    expect(out.resultLabel).toBe('调停者');
  });
});

// ---------------------------------------------------------------------------
// scale 策略（多维度 high/low，如大五人格）
// 种子契约：scoringConfig.dimensions = [{id,min,max}]，resultDefinitions = high_X/low_X
// 期望：resultLabel 映射到可读标签，而非退化为数值串。
// ---------------------------------------------------------------------------
const BIGFIVE_CONFIG: ScoringInput['scoringConfig'] = {
  dimensions: [
    { id: 'O', label: '开放性', min: 1, max: 5 },
    { id: 'C', label: '尽责性', min: 1, max: 5 },
  ],
};
const BIGFIVE_DEFS: ScoringInput['resultDefinitions'] = {
  high_O: { label: '高开放性', description: '富有创造力' },
  low_O: { label: '低开放性', description: '务实传统' },
  high_C: { label: '高尽责性', description: '自律有条理' },
  low_C: { label: '低尽责性', description: '灵活随性' },
};

function scaleAnswer(
  dim: string,
  score: number,
): ScoringInput['answers'][number] {
  return {
    questionId: `${dim}-${score}`,
    selectedValue: String(score),
    dimension: dim,
    options: [{ value: String(score), score, dimension: dim }],
  };
}

describe('calculateScore - scale (大五人格 high/low)', () => {
  it('高 O / 低 C 映射到可读标签，而非数值串', () => {
    const out = calculateScore({
      scoringStrategy: 'scale',
      scoringConfig: BIGFIVE_CONFIG,
      resultDefinitions: BIGFIVE_DEFS,
      answers: [
        scaleAnswer('O', 5),
        scaleAnswer('O', 4),
        scaleAnswer('C', 1),
        scaleAnswer('C', 2),
      ],
    });
    // dimensionScores 仍是每维平均分（供雷达图使用）
    expect(out.dimensionScores.O).toBeCloseTo(4.5);
    expect(out.dimensionScores.C).toBeCloseTo(1.5);
    // resultLabel 必须是可读标签，不能是纯数值串
    expect(out.resultLabel).toContain('高开放性');
    expect(out.resultLabel).toContain('低尽责性');
    expect(out.resultLabel).not.toMatch(/^[\d.,:OC ]+$/);
  });
});

// ---------------------------------------------------------------------------
// scale 策略（单维有序桶，如心理年龄）
// 种子契约：单维 mentalAge，resultDefinitions 有序 teen→senior，无 high/low_ 键
// 期望：低分映射到 teen，高分映射到 senior，结果可读且不同。
// ---------------------------------------------------------------------------
const MENTAL_AGE_CONFIG: ScoringInput['scoringConfig'] = {
  dimensions: [{ id: 'mentalAge', label: '心理年龄', min: 1, max: 5 }],
};
const MENTAL_AGE_DEFS: ScoringInput['resultDefinitions'] = {
  teen: { label: '少年心态' },
  young_adult: { label: '青年心态' },
  adult: { label: '成熟心态' },
  senior: { label: '智者心态' },
};

describe('calculateScore - scale (心理年龄 有序桶)', () => {
  it('低分映射到少年心态', () => {
    const out = calculateScore({
      scoringStrategy: 'scale',
      scoringConfig: MENTAL_AGE_CONFIG,
      resultDefinitions: MENTAL_AGE_DEFS,
      answers: [scaleAnswer('mentalAge', 1), scaleAnswer('mentalAge', 1)],
    });
    expect(out.resultLabel).toBe('少年心态');
  });

  it('高分映射到智者心态，且与低分结果不同', () => {
    const out = calculateScore({
      scoringStrategy: 'scale',
      scoringConfig: MENTAL_AGE_CONFIG,
      resultDefinitions: MENTAL_AGE_DEFS,
      answers: [scaleAnswer('mentalAge', 5), scaleAnswer('mentalAge', 5)],
    });
    expect(out.resultLabel).toBe('智者心态');
  });
});
