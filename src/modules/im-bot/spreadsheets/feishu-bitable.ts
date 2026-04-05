import { feishuTokenManager } from '../auth/feishu-token';
import type { SpreadsheetRecord, SpreadsheetTableConfig } from '../core/types';
import type { SpreadsheetAdapter } from './types';

async function feishuApi(path: string, method: string, body?: unknown) {
  const token = await feishuTokenManager.getToken();
  const res = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const data = (await res.json()) as {
    code: number;
    data?: unknown;
    msg?: string;
  };
  if (data.code !== 0) {
    throw new Error(`飞书 Bitable API 错误: ${data.msg ?? data.code}`);
  }
  return data.data;
}

function mapFields(
  fields: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [logicalKey, value] of Object.entries(fields)) {
    const platformKey = mapping[logicalKey] ?? logicalKey;
    result[platformKey] = value;
  }
  return result;
}

function reverseMapFields(
  fields: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const reverse = Object.fromEntries(
    Object.entries(mapping).map(([k, v]) => [v, k]),
  );
  const result: Record<string, unknown> = {};
  for (const [platformKey, value] of Object.entries(fields)) {
    const logicalKey = reverse[platformKey] ?? platformKey;
    result[logicalKey] = value;
  }
  return result;
}

export class FeishuBitableAdapter implements SpreadsheetAdapter {
  readonly platform = 'feishu' as const;

  async createRecord(
    config: SpreadsheetTableConfig,
    fields: Record<string, unknown>,
  ): Promise<SpreadsheetRecord> {
    const data = (await feishuApi(
      `/apps/${config.workspaceId}/tables/${config.tableId}/records`,
      'POST',
      { fields: mapFields(fields, config.fieldMapping) },
    )) as { record: { record_id: string; fields: Record<string, unknown> } };
    return {
      recordId: data.record.record_id,
      fields: reverseMapFields(data.record.fields, config.fieldMapping),
    };
  }

  async updateRecord(
    config: SpreadsheetTableConfig,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<SpreadsheetRecord> {
    const data = (await feishuApi(
      `/apps/${config.workspaceId}/tables/${config.tableId}/records/${recordId}`,
      'PUT',
      { fields: mapFields(fields, config.fieldMapping) },
    )) as { record: { record_id: string; fields: Record<string, unknown> } };
    return {
      recordId: data.record.record_id,
      fields: reverseMapFields(data.record.fields, config.fieldMapping),
    };
  }

  async queryRecords(
    config: SpreadsheetTableConfig,
    filters: Record<string, unknown>,
  ): Promise<SpreadsheetRecord[]> {
    const conditions = Object.entries(filters).map(([key, value]) => {
      const platformKey = config.fieldMapping[key] ?? key;
      // 飞书日期字段 filter value 必须是毫秒时间戳
      const coerced =
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? new Date(value).getTime()
          : value;
      return {
        field_name: platformKey,
        operator: 'is',
        value: [coerced],
      };
    });

    const body: Record<string, unknown> = {};
    if (conditions.length > 0) {
      body.filter = { conjunction: 'and', conditions };
    }

    const data = (await feishuApi(
      `/apps/${config.workspaceId}/tables/${config.tableId}/records/search`,
      'POST',
      body,
    )) as {
      items?: Array<{ record_id: string; fields: Record<string, unknown> }>;
    };

    return (data.items ?? []).map((item) => ({
      recordId: item.record_id,
      fields: reverseMapFields(item.fields, config.fieldMapping),
    }));
  }

  async deleteRecord(
    config: SpreadsheetTableConfig,
    recordId: string,
  ): Promise<void> {
    await feishuApi(
      `/apps/${config.workspaceId}/tables/${config.tableId}/records/${recordId}`,
      'DELETE',
    );
  }
}
