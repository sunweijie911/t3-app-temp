import type { SpreadsheetRecord } from '../core/types';

/**
 * 客户端侧记录过滤。
 *
 * 企微 get_records 与钉钉多维表 records 都没有等价于飞书 search 的服务端
 * filter，所以先拉取再在内存过滤。语义与飞书侧保持一致（含 `_conjunction`
 * 协议），代价是大表查询会多传数据 —— 等确认各自的服务端 filter 参数后可下推。
 */
export function filterRecords(
  records: SpreadsheetRecord[],
  filters: Record<string, unknown>,
): SpreadsheetRecord[] {
  const keys = Object.keys(filters).filter((k) => !k.startsWith('_'));
  if (keys.length === 0) return records;
  const useOr = filters._conjunction === 'or';

  const matchOne = (r: SpreadsheetRecord, key: string): boolean => {
    const expected = filters[key];
    const actual = r.fields[key];
    const actualStr = Array.isArray(actual)
      ? actual.map(String).join(' ')
      : String(actual ?? '');
    if (expected !== null && typeof expected === 'object') {
      const { op, value } = expected as { op?: string; value?: unknown };
      const v = String(value ?? '');
      switch ((op ?? '').toLowerCase()) {
        case 'contains':
        case '~':
          return actualStr.includes(v);
        case 'isempty':
          return actualStr === '';
        case 'isnotempty':
          return actualStr !== '';
        case '!=':
        case 'isnot':
          return actualStr !== v;
        case '>':
          return Number(actual) > Number(value);
        case '>=':
          return Number(actual) >= Number(value);
        case '<':
          return Number(actual) < Number(value);
        case '<=':
          return Number(actual) <= Number(value);
        default:
          return actualStr === v;
      }
    }
    return actualStr === String(expected ?? '');
  };

  return records.filter((r) =>
    useOr
      ? keys.some((k) => matchOne(r, k))
      : keys.every((k) => matchOne(r, k)),
  );
}
