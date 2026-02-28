import 'server-only';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/server/db';
import {
  aiReports,
  systemConfig,
  testResults,
  testTypes,
} from '@/server/db/schema';
import { getLLMConfig, streamCompletion } from './llm';

const DEFAULT_SYSTEM_PROMPT = `你是一位专业且温暖的心理咨询顾问。你擅长根据心理测试结果为用户提供深入、个性化的分析报告。

你的风格特点：
- 语言温暖、富有同理心，让用户感到被理解和接纳
- 分析专业严谨，引用相关心理学理论进行解释
- 注重用户的成长潜力，提供积极且实用的建议
- 使用 Markdown 格式输出，结构清晰、易于阅读`;

const DEFAULT_PROMPT_TEMPLATE = `## 测试信息

- 测试名称：{{testName}}
- 测试结果类型：{{resultCode}} ({{resultLabel}})
- 结果摘要：{{summary}}

## 维度得分

{{dimensionScores}}

## 要求

请根据以上测试结果，为用户撰写一份全面的个性化心理分析报告。报告应包含以下内容：

1. **结果概述**：简明解释该测试结果的含义
2. **维度详解**：逐一分析各维度得分的含义
3. **性格特征**：基于结果总结用户的核心性格特点
4. **优势与挑战**：分析该类型的优势领域和可能面临的挑战
5. **成长建议**：提供具体、可操作的个人发展建议
6. **人际关系**：在社交和工作中的互动风格分析

请使用 Markdown 格式输出报告。`;

async function getConfigString(key: string, fallback: string): Promise<string> {
  const row = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, key))
    .limit(1);
  if (row.length > 0 && row[0]?.value != null) {
    const v = row[0]?.value;
    return typeof v === 'string' ? v : String(v);
  }
  return fallback;
}

export async function getSystemPrompt(): Promise<string> {
  return getConfigString('report.system_prompt', DEFAULT_SYSTEM_PROMPT);
}

export async function getPromptTemplate(testTypeId: string): Promise<string> {
  return getConfigString(
    `report.prompt_template.${testTypeId}`,
    DEFAULT_PROMPT_TEMPLATE,
  );
}

export async function buildReportPrompt(resultId: string): Promise<{
  systemPrompt: string;
  userPrompt: string;
}> {
  // Load result with related data
  const result = await db
    .select()
    .from(testResults)
    .where(eq(testResults.id, resultId))
    .limit(1);

  if (result.length === 0) {
    throw new Error(`Test result not found: ${resultId}`);
  }

  const testResult = result[0]!;

  const testType = await db
    .select()
    .from(testTypes)
    .where(eq(testTypes.id, testResult.testTypeId))
    .limit(1);

  if (testType.length === 0) {
    throw new Error(`Test type not found: ${testResult.testTypeId}`);
  }

  const tt = testType[0]!;

  const [systemPrompt, promptTemplate] = await Promise.all([
    getSystemPrompt(),
    getPromptTemplate(tt.id),
  ]);

  // Format dimension scores
  const dimensionScoresStr = Object.entries(testResult.dimensionScores)
    .map(([dim, score]) => `- ${dim}: ${score}`)
    .join('\n');

  // Apply template substitutions
  const userPrompt = promptTemplate
    .replace(/\{\{testName\}\}/g, tt.name)
    .replace(/\{\{resultCode\}\}/g, testResult.resultCode)
    .replace(/\{\{resultLabel\}\}/g, testResult.resultLabel)
    .replace(/\{\{summary\}\}/g, testResult.summary)
    .replace(/\{\{dimensionScores\}\}/g, dimensionScoresStr);

  return { systemPrompt, userPrompt };
}

export async function* generateReport(
  resultId: string,
  userId: string,
): AsyncGenerator<string, string> {
  // Create or update the aiReport record (upsert to prevent race condition duplicates)
  const reportId = nanoid();
  const upsertResult = await db
    .insert(aiReports)
    .values({
      id: reportId,
      resultId,
      userId,
      status: 'generating',
    })
    .onConflictDoUpdate({
      target: aiReports.resultId,
      set: { status: 'generating', content: null, errorMessage: null },
    })
    .returning({ id: aiReports.id });

  const actualReportId = upsertResult[0]?.id ?? reportId;

  const startTime = Date.now();
  let fullContent = '';

  try {
    const { systemPrompt, userPrompt } = await buildReportPrompt(resultId);
    const config = await getLLMConfig();

    const stream = await streamCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullContent += content;
        yield content;
      }
    }

    const generationTimeMs = Date.now() - startTime;

    await db
      .update(aiReports)
      .set({
        status: 'completed',
        content: fullContent,
        modelUsed: config.model,
        generationTimeMs,
        completedAt: new Date(),
      })
      .where(eq(aiReports.id, actualReportId));
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    await db
      .update(aiReports)
      .set({
        status: 'failed',
        errorMessage,
      })
      .where(eq(aiReports.id, actualReportId));
    throw error;
  }

  return fullContent;
}
