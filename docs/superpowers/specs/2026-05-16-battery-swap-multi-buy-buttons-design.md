# 换电套餐——卡片底部多按钮配置 设计文档

- 日期：2026-05-16
- 涉及模块：`src/modules/battery-swap`
- 涉及表：`battery_swap_package`

## 背景

当前换电套餐卡片底部固定渲染 **一个**「立即购买」按钮，文案为 `立即购买 ¥xx 起`，跳转链接由 `batterySwapPackages.purchaseLink` 单字段提供（`src/modules/battery-swap/components/package-card.tsx:210`）。

运营希望同一个套餐能在底部并排展示多个按钮，每个按钮可独立配置 **文案** 与 **跳转链接**（例如「立即购买」+「联系客服」+「查看详情」）。

## 需求确认（取舍记录）

| 决策点 | 选择 | 备注 |
| --- | --- | --- |
| 按钮语义 | 完全自由配置，按运营顺序平铺，不区分主/次 | 所有按钮视觉等价 |
| 数量上限 | 最多 4 个；1–2 个一行平分，3–4 个折为 2 行 | 即 `grid-cols-2`，特殊处理 1 个与 3 个的跨列 |
| 文案模板变量 | 不支持，纯静态，运营自己写 | 不再做 `¥xx 起` 自动拼接 |
| 旧数据迁移 | 一次性迁移到新字段并删除旧字段 | 保留老数据语义：每个老套餐自动生成一个文案为「立即购买」的按钮 |
| Admin 行排序 | 支持拖拽 | 顺序即前台 2×2 的阅读顺序，重要 |
| 按钮颜色 | 沿用卡片 `accent`（按 `cardBgColor` 计算），全部同色 | 不增加运营配色负担 |

显式 **不做** 的事（YAGNI）：

- 不保留 `purchaseLink` 兼容列、不写 fallback 双读逻辑
- 不引入文案模板变量（`{salePrice}` 等）
- 不允许按钮单独配色
- admin 表格不新增「按钮」列（在编辑 Modal 内查看即可）

## 数据模型

### Schema 变更

`src/modules/battery-swap/schema/index.ts`：

- **删除** 列：`purchaseLink: d.text()`
- **新增** 列：`buttons: jsonb<PackageButton[]>().notNull().default([])`
- **新增** 导出类型：

```ts
export type PackageButton = {
  label: string; // 按钮文案
  link: string;  // 跳转链接
};
```

### 约束（zod + admin 校验）

| 字段 | 约束 |
| --- | --- |
| `buttons.length` | 0 ≤ n ≤ 4 |
| `label` | `min(1).max(20)`（>12 admin 软提示，不强禁） |
| `link` | `min(1)`（沿用现状，不强校验 URL 格式） |

数组允许为空：保存时不阻止，但 admin 给 toast 提醒「未配置任何按钮，前台将无法跳转」。

### 数据库迁移

通过 `drizzle-kit generate` 出迁移文件，将自动生成的 `ALTER TABLE` 调整为以下三步（保证老数据不丢）：

```sql
ALTER TABLE battery_swap_package
  ADD COLUMN buttons jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE battery_swap_package
   SET buttons = jsonb_build_array(
         jsonb_build_object('label', '立即购买', 'link', purchase_link)
       )
 WHERE purchase_link IS NOT NULL AND purchase_link <> '';

ALTER TABLE battery_swap_package DROP COLUMN purchase_link;
```

## Admin 编辑形态

文件：`src/modules/battery-swap/admin/packages.tsx`

替换现有「购买跳转链接」单 Input（752 行附近），改为动态行列表，形态与同文件「套餐规格」节一致，但额外支持拖拽。

### 布局示意

```
购买按钮（最多 4 个）
┌──────────────────────────────────────────────────────────────┐
│ ⋮⋮ [文案: 立即购买        ] [链接: https://...        ] [×] │
│ ⋮⋮ [文案: 联系客服        ] [链接: https://...        ] [×] │
│ [+ 添加按钮]   (length >= 4 时禁用)                          │
└──────────────────────────────────────────────────────────────┘
```

### 状态结构

`EditingPackage` 调整：

```ts
type EditingPackage = {
  // ...其余字段不变
  buttons: { label: string; link: string }[]; // 替换原 purchaseLink: string
};
```

`DEFAULT_EDITING.buttons`：`[{ label: '立即购买', link: '' }]`（新建时给一个空链接占位行）。

`rowToEditing(r)`：`buttons: r.buttons ?? []`。

### Helper 函数

- `addButton()`：`buttons.length < 4` 时 push `{label:'', link:''}`
- `removeButton(idx)`：移除某行（不强制最少 1 行）
- `updateButton(idx, field, value)`：更新某行某字段
- `moveButton(from, to)`：dnd-kit 拖拽完触发

### 拖拽实现

复用文件顶部已有的 `SortableRow`/`useSortable` 模式，新增独立的 `<SortableContext id="battery-swap-buttons">`，行 key 用稳定 id（建议保存时为每行附 `nanoid()` 仅在前端用于 key，提交时丢弃；或直接用 idx 但拖拽后会闪烁——优先 nanoid 方案）。

### 保存校验

`handleSave` 在现有校验之后增加：

- 任一按钮 `label` 或 `link` 为空 → `toast.error('请补齐所有按钮的文案与链接')` 并 `return`
- `buttons.length === 0` → 不阻止保存，但 `toast.warning('未配置任何按钮，前台将无法跳转')`

`upsertMutation.mutate` payload：去掉 `purchaseLink`，加 `buttons: editing.buttons.map(b => ({ label: b.label.trim(), link: b.link.trim() }))`。

### 不变的部分

- admin 表格列定义（`columns`）不新增按钮相关列
- Banner 配置、拖拽排序套餐列表、上下架、删除 流程均不动

## tRPC 改动

文件：`src/modules/battery-swap/routers/admin.ts`

- `upsertInput`：
  - 删除字段 `purchaseLink: z.string().nullable().optional()`
  - 新增字段：
    ```ts
    buttons: z
      .array(z.object({
        label: z.string().min(1).max(20),
        link: z.string().min(1),
      }))
      .max(4)
      .default([]),
    ```
- `shared` 对象：删除 `purchaseLink: input.purchaseLink ?? null`，新增 `buttons: input.buttons`
- `routers/index.ts` 的 `list`/`bannerUrl` 无需变更（`select()` 返回行级全字段，新列自然带上）

## 前台渲染

文件：`src/modules/battery-swap/components/package-card.tsx`

### Props 变更

```ts
export type PackageCardProps = {
  // ...其余字段不变
  buttons: PackageButton[]; // 替换原 purchaseLink: string | null
  onBuy: (link: string) => void; // 签名保持不变
};
```

### 渲染逻辑（替换 210–221 行的单 button 块）

```tsx
{buttons.length > 0 && (
  <div className="mt-4 grid grid-cols-2 gap-2">
    {buttons.map((b, i) => (
      <button
        key={i}
        type="button"
        title={b.label}
        onClick={() => onBuy(b.link)}
        className={`flex items-center justify-center rounded-xl py-2.5 px-2 truncate font-bold text-sm text-white ${
          buttons.length === 1 ? 'col-span-2' : ''
        } ${buttons.length === 3 && i === 2 ? 'col-span-2' : ''}`}
        style={{
          backgroundColor: accent,
          boxShadow: `0 10px 15px -3px ${hexToRgba(accent, 0.2)}`,
        }}
      >
        {b.label}
      </button>
    ))}
  </div>
)}
```

布局规则（`grid grid-cols-2 gap-2`）：

| 数量 | 布局 |
| --- | --- |
| 0 | 整个按钮区不渲染 |
| 1 | 独占整行（`col-span-2`，视觉接近现状） |
| 2 | 一行平分 |
| 3 | 前 2 个一行、第 3 个独占下行 |
| 4 | 2×2 |

文案过长：CSS `truncate` 截断，hover/长按由 `title={b.label}` 兜底。

### 调用方

文件：`src/modules/battery-swap/components/home.tsx`

`<PackageCard ... purchaseLink={pkg.purchaseLink}>` → `<PackageCard ... buttons={pkg.buttons}>`，`handleBuy` 与 `onBuy` 签名保持不变。

## 测试

`src/modules/battery-swap` 现有单测中涉及 `purchaseLink` 的 case 调整为 `buttons: [{ label: '立即购买', link: '...' }]`。

新增 admin upsert 单测：

- `buttons.length > 4` → 抛 zod 校验错误
- `label` 为空 → 抛 zod 校验错误
- `link` 为空 → 抛 zod 校验错误
- `buttons: []` 允许保存
- 老数据迁移路径：插入一行包含 `buttons:[{label:'立即购买',link:'x'}]`，`list` 返回结构正确

## 影响面清单

`grep -r purchaseLink src/modules/battery-swap` 应只剩以下文件需要改：

- `src/modules/battery-swap/schema/index.ts`
- `src/modules/battery-swap/routers/admin.ts`
- `src/modules/battery-swap/admin/packages.tsx`
- `src/modules/battery-swap/components/home.tsx`
- `src/modules/battery-swap/components/package-card.tsx`
- 数据库迁移文件（`drizzle/` 下新生成的 `.sql`）
- 相关单测文件

外部消费方：无（`routers/index.ts` 的 `list` publicProcedure 是 select-all，下游只有 `home.tsx`）。

## 落地步骤

1. schema：删 `purchaseLink`、加 `buttons` 列与类型导出
2. drizzle migration：generate 后改写为段「数据库迁移」的三步 SQL
3. tRPC：替换 `upsertInput` 字段与 `shared` 对象
4. admin UI：`EditingPackage` 改字段、加 helper、Modal 内动态行 + 拖拽
5. 前台：`PackageCardProps` 改字段、`home.tsx` 传参替换、`package-card.tsx` 渲染逻辑替换
6. 测试：调整既有 case + 新增 5 个 zod/迁移 case

无回滚兼容路径，迁移与代码替换在同一 PR 内完成。
