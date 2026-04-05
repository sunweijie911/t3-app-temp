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
    const conditions = Object.entries(filters).flatMap(([key, value]) => {
      const platformKey = config.fieldMapping[key] ?? key;
      // 日期字段（YYYY-MM-DD）转为当天 CST 范围查询，避免 is 精确匹配失败
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const start = new Date(`${value}T00:00:00+08:00`).getTime();
        const end = new Date(`${value}T23:59:59+08:00`).getTime();
        return [
          {
            field_name: platformKey,
            operator: 'isGreaterEqual',
            value: [start],
          },
          { field_name: platformKey, operator: 'isLessEqual', value: [end] },
        ];
      }
      return [{ field_name: platformKey, operator: 'is', value: [value] }];
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

    const logicalKeys = Object.keys(config.fieldMapping);
    return (data.items ?? []).map((item) => {
      const mapped = reverseMapFields(item.fields, config.fieldMapping);
      // 以 fieldMapping 配置的字段为基准，空值填 '' 而非缺失，保证表头完整
      const fields: Record<string, unknown> = Object.fromEntries(
        logicalKeys.map((k) => [k, mapped[k] ?? '']),
      );
      // 保留未在 mapping 中定义的额外字段
      for (const [k, v] of Object.entries(mapped)) {
        if (!(k in fields)) fields[k] = v;
      }
      return { recordId: item.record_id, fields };
    });
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
