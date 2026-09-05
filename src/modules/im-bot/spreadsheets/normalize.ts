// cspell:ignore wwgroup
import { datetimeStringToMs, isDatetimeString } from './field-types';

/**
 * 平台原始单元格值 → 统一的逻辑值。
 *
 * 为什么需要这一层：`SpreadsheetRecord.fields` 以前把各平台的原始值原样透传，
 * 于是下游三处各自猜形状 ——
 * - `core/field-render.ts` 猜「数组里有 text 就取 text」
 * - `spreadsheets/record-filter.ts` 直接 `String(member)`
 * - `core/dispatcher.ts` 的 toNumeric 只认数字和字符串
 *
 * 猜错的代价是静默给错答案：飞书文本字段返回的是
 * `[{"text":"门户","type":"text"}]`，record-filter 把它 `String()` 成
 * `"[object Object]"`，于是**飞书残差过滤在任何文本列上恒返回 0 条**；
 * 关联字段 `{"link_record_ids":[...]}` 则被 field-render 渲染成原始 JSON
 * 丢进群里。根因是形状不统一，所以修在读路径的入口，而不是每个下游各打一个补丁。
 *
 * 三个 adapter 的读路径都过这里，之后 fields 里的值是：
 * - 标量：string | number | boolean（日期一律是**毫秒数**）
 * - 多值单元格（多选 / 多人员 / 关联）：string[]
 * - 认不出的复合值：**原样交回**（对象或对象数组），由 field-render 的
 *   JSON 兜底渲染。宁可保留原形，也不在这里编一个字符串误导用户。
 */

/** 复合值里可能承载「显示文本」的键，按优先级排 */
const TEXT_KEYS = ['text', 'name', 'userName', 'title'] as const;
/** 老版类型化单元格（企微早期写入格式）里的标量键 */
const SCALAR_KEYS = ['number', 'date', 'checkbox'] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 从一个复合值里取出标量显示值。取不到返回 null。
 *
 * 导出是因为 record-filter 与 field-render 各自手抄过一份键列表（前者认
 * text/name/userName，后者只认 text/name），于是同一个 `[{title,fileUrl}]`
 * 附件单元格在「筛选」和「展示」上给出不同答案。共用一份键列表 = 两处
 * 永远一致，新增键只改这里。
 *
 * 非普通对象（标量、数组、null）一律返回 null —— 调用方各有各的处理。
 */
export function scalarOf(v: unknown): string | number | boolean | null {
  if (!isPlainObject(v)) return null;
  for (const k of TEXT_KEYS) {
    const s = v[k];
    if (typeof s === 'string') return s;
  }
  for (const k of SCALAR_KEYS) {
    const s = v[k];
    if (typeof s === 'number' || typeof s === 'boolean') return s;
  }
  return null;
}

/**
 * 该元素是不是「有身份的条目」（选项 / 人员 / 关联记录 / 附件 / 群），
 * 而不是一段文本。
 *
 * 区分它是为了决定多元素时拼成一个字符串还是保留成数组：
 * - 文本字段的多个段（正文 + @提及）语义上是**一句话**，要拼起来
 * - 多选 / 多人员 / 多附件是**多个成员**，拼起来之后 `{域:'门户'}` 这种
 *   成员筛选就再也命中不了了（record-filter 对数组走成员命中）
 *
 * 键名取自企微智能表格官方 CellValue 契约：select `{id,text}`、
 * user `{userId,userName}`、image/attachment `{id,title,fileUrl}`、
 * reference `{record_id}`、wwgroup `{chat_id}`；飞书附件另有 `file_token`。
 */
const IDENTITY_KEYS = [
  'id',
  'userId',
  'record_id',
  'chat_id',
  'file_token',
] as const;

function hasIdentity(o: Record<string, unknown>): boolean {
  return IDENTITY_KEYS.some((k) => k in o);
}

/**
 * 数组成员 → 展示字符串。
 *
 * 认不出的对象走 `JSON.stringify` 而不是 `String` —— 后者拍成
 * `"[object Object]"`，等于把「认不出」变成「认成了一个恒不命中的常量」：
 * 两个不同的附件会被判定相等，筛选和分组都静默给错答案。JSON 至少保住了
 * 原始信息，用户在群里也一眼看得出「这列机器人没认出来」。
 */
function memberText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return '';
    }
  }
  return String(v);
}

function normalizeArray(arr: unknown[]): unknown {
  if (arr.length === 0) return '';

  if (arr.every(isPlainObject)) {
    const items = arr as Record<string, unknown>[];
    // 取到的标量再过一次 normalizeCell：企微 `[{text:"2026-05-11 00:00:00"}]`
    // 这种「日期被塞进复合值」的形态也要收口成毫秒
    const texts = items.map((o) => {
      const s = scalarOf(o);
      return normalizeCell(s === null ? o : s);
    });

    // 有身份的条目**一律保留数组**，单个也不降标量。
    //
    // 以前 length===1 时降成标量，于是企微 `[{id,text:'门户'}]` 归一成
    // '门户'、飞书同一列的 `['门户']` 归一成 ['门户'] —— 同一个多选列换个
    // 平台，`{业务域:'门户'}` 一边命中一边不命中。统一成数组后两边一致，
    // record-filter 的 matchesValue 对数组 actual 走成员命中，单成员数组
    // 与标量的筛选结果相同。
    if (items.some(hasIdentity)) return texts.map(memberText);

    // 单段文本保留标量**原类型**：`[{type:'number',number:42}]` 要还是
    // 数字 42，走 join 会拍成字符串 '42'，dispatcher 的 toNumeric 还得再猜
    if (texts.length === 1) return texts[0];

    // url 字段是 `[{text,link}]` 的数组，多条 url 是**多个条目**；
    // 而文本字段的多段（正文 + @提及）是同一句话被平台切开的结果。
    // 前者用「、」分隔更像人话，后者拼空格才还原成原句。
    const sep = items.some((o) => 'link' in o) ? '、' : ' ';
    return texts
      .map(memberText)
      .filter((t) => t !== '')
      .join(sep);
  }

  // 标量数组（飞书多选就是 string[]）：逐元素归一化后**保留数组形态**，
  // 成员筛选与聚合都依赖它。
  const normalized = arr.map((item) => normalizeCell(item));
  // 唯一的例外是单元素的**数字 / 布尔**数组：那不是多选，而是公式 / lookup
  // 列的返回形状（`{type:2,value:[26.612]}` 展开后就是 `[26.612]`）。
  // 留成数组的话 toNumeric 拿不到数，SUM/AVG 会把整列跳过并报"无数据"。
  // 字符串不在此列 —— `['门户']` 就是只选了一项的多选，降标量会让它跟
  // 上面的对象数组分支再次不一致。
  const only = normalized[0];
  if (
    normalized.length === 1 &&
    (typeof only === 'number' || typeof only === 'boolean')
  ) {
    return only;
  }
  return normalized;
}

/**
 * 归一化一个平台原始单元格值。纯函数，不认识任何平台。
 *
 * 已核实的输入形态（飞书 records/search 官方响应示例 + 企微
 * smartsheet 记录值参考 + 钉钉多维表裸值）：
 * - 文本：`[{"text":"…","type":"text"}]`（可能混有 mention 段）
 * - 单选：字符串；多选：字符串数组
 * - 选项对象：`[{"id":"opt…","text":"门户"}]`（企微 select）
 * - 人员：`[{"id":…,"name":…}]`（飞书）/ `[{"userId":…,"userName":…}]`（企微）
 * - 关联：`{"link_record_ids":["rec…"]}`
 * - 公式 / lookup：`{"type":…,"value":[…]}`
 * - 日期：毫秒数（飞书 / 钉钉）或 `"YYYY-MM-DD HH:mm:ss"` 串（企微）
 * - 数字：数字；复选框：布尔
 */
export function normalizeCell(v: unknown): unknown {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    // 企微 date 字段读回的是 `"2026-05-11 00:00:00"`，而飞书/钉钉是裸毫秒。
    // 不在这里收口的话，record-filter 的 actualMs 只认数字和纯 YYYY-MM-DD，
    // 企微上**任何按日期的等值 / >= / between 都恒 0 条**，field-render 也
    // 会把它原样渲染成带 00:00:00 的串。
    //
    // 只转「带 HH:mm 时间部分」的串：归一化层拿不到 displayType，分不清
    // 纯 `"2026-05-11"` 是日期列还是文本列里合法的期号（field-types 的
    // treatsValueAsDate 是靠 displayType 判的）。带时间部分的串不会是人手
    // 填进文本列的内容，转换是安全的；纯日期串交给下游按列声明处理
    // —— record-filter 的 actualMs 本来就认它。
    return isDatetimeString(v) ? (datetimeStringToMs(v) ?? v) : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return normalizeArray(v);
  if (!isPlainObject(v)) return v;

  // 飞书关联字段。官方 search 响应示例里**只给 link_record_ids**（要显示值
  // 得再打一次子表的 batch_get），但字段配置不同的表实测会带上 `text` /
  // `text_arr`。有显示值就优先用它 —— 群里看到「督导2.0」远好过一串 record_id；
  // 这是防御性兼容，取不到时仍退回 record_id 数组：至少 `contains` 能按
  // record_id 命中，而且不会出现一坨原始 JSON。
  if (Array.isArray(v.link_record_ids)) {
    if (Array.isArray(v.text_arr)) {
      const texts = v.text_arr
        .filter((t) => typeof t === 'string')
        .filter((t) => t !== '');
      if (texts.length > 0) return texts;
    }
    if (typeof v.text === 'string' && v.text !== '') return v.text;
    return v.link_record_ids.map((id) => String(id));
  }
  if (Array.isArray(v.value)) return normalizeCell(v.value);

  const scalar = scalarOf(v);
  if (scalar !== null) return normalizeCell(scalar);

  // 认不出来的复合值原样交回：field-render 的兜底会把它 JSON 化，
  // 总比在这里编一个字符串误导用户强
  return v;
}

/** 整行归一化，读路径的三个 adapter 共用 */
export function normalizeFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = normalizeCell(v);
  return out;
}
