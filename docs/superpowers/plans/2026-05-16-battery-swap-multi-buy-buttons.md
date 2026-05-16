# 换电套餐多购买按钮配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把换电套餐卡片底部从单一「立即购买」按钮升级为运营可配置 0–4 个按钮（文案 + 链接 + 拖拽排序），并安全迁移旧数据。

**Architecture:** 单表字段升级（`purchaseLink: text` → `buttons: jsonb<PackageButton[]>`），一次性 SQL 迁移把旧 `purchase_link` 装进 `buttons` 数组后删除旧列。tRPC zod 校验数量与字段；admin 在编辑 Modal 内用 dnd-kit 行级排序；前台用 `grid-cols-2` 自适应 1/2/3/4 个按钮布局，颜色继续沿用卡片 `accent`。

**Tech Stack:** Next.js 16、TypeScript、Drizzle ORM (postgres)、tRPC v11、zod v4、Ant Design 6、@dnd-kit、vitest、Tailwind/UnoCSS。

**Spec:** [`docs/superpowers/specs/2026-05-16-battery-swap-multi-buy-buttons-design.md`](../specs/2026-05-16-battery-swap-multi-buy-buttons-design.md)

**项目惯例提醒：**
- 测试命令：`pnpm test`（vitest --run）、单文件：`pnpm test -- tests/...`
- 类型检查：`pnpm type-check`
- 生成迁移：`pnpm db:generate`
- husky pre-commit 自动跑 lint-staged + tsc + vitest，commit 一般会校验所有用例；如果只想跑某一文件，单独用 `pnpm test -- <path>`
- 提交规范：conventional commits（commitlint 强制）

---

## File Structure

| 文件 | 动作 | 责任 |
| --- | --- | --- |
| `src/modules/battery-swap/schema/index.ts` | 修改 | 删 `purchaseLink` 列，加 `buttons` 列与 `PackageButton` 类型 |
| `drizzle/0020_<auto-name>.sql` | 新建 + 手改 | 三步式迁移：加列 → 回填 → 删旧列 |
| `drizzle/meta/0020_snapshot.json` | 新建（自动） | drizzle-kit 自动生成，无需手改 |
| `drizzle/meta/_journal.json` | 修改（自动） | drizzle-kit 自动加新条目 |
| `src/modules/battery-swap/routers/admin.ts` | 修改 | 导出 `upsertInput` 供测试；`buttons` 替换 `purchaseLink` |
| `src/modules/battery-swap/admin/packages.tsx` | 修改 | `EditingPackage.buttons`、helpers、Modal 内动态行 + 拖拽 |
| `src/modules/battery-swap/components/home.tsx` | 修改 | 把 `purchaseLink` 传参换成 `buttons` |
| `src/modules/battery-swap/components/package-card.tsx` | 修改 | Props 改字段，按钮区改 `grid-cols-2` 渲染逻辑 |
| `tests/modules/battery-swap/admin/upsert-input.test.ts` | 新建 | zod 校验 buttons 数组 |

---

## Task 1：Schema 改字段

**Files:**
- Modify: `src/modules/battery-swap/schema/index.ts:6-9, 17-47`

- [ ] **Step 1.1：替换文件内容**

打开 `src/modules/battery-swap/schema/index.ts`，整体替换为下面内容（删 `purchaseLink` 列，加 `buttons` 列与 `PackageButton` 类型）：

```ts
import { index, jsonb } from 'drizzle-orm/pg-core';

import { createTable } from '@/server/db/table-creator';

// 套餐规格类型
export type PackageSpec = {
  model: string; // 电池型号，如 "48V 20Ah"
  price: number; // 该规格价格（分）
};

// 购买按钮类型
export type PackageButton = {
  label: string; // 按钮文案
  link: string; // 跳转链接
};

// 价格：分 → 元（展示用）
export function formatPrice(fen: number) {
  return (fen / 100).toFixed(2);
}

// batterySwapPackages — 换电套餐
export const batterySwapPackages = createTable(
  'battery_swap_package',
  (d) => ({
    id: d.varchar({ length: 36 }).primaryKey(),
    company: d.varchar({ length: 128 }).notNull(),
    title: d.varchar({ length: 256 }).notNull(),
    imageUrl: d.text(),
    detailImageUrl: d.text(), // 详情长图
    cardBgColor: d.varchar({ length: 32 }).default('#ffffff'), // 卡片背景色
    originalPrice: d.integer().notNull(), // 划线价（分）
    salePrice: d.integer().notNull(), // 最低销售价（分）
    specs: jsonb().$type<PackageSpec[]>().notNull(),
    depositMethod: d.varchar({ length: 128 }).default('芝麻信用抵押金'),
    regionLimit: d.text(),
    purchaseNotes: d.text(),
    validFrom: d.timestamp({ withTimezone: true }),
    validTo: d.timestamp({ withTimezone: true }),
    buttons: jsonb().$type<PackageButton[]>().notNull().default([]),
    sortOrder: d.integer().notNull().default(0),
    isActive: d.boolean().notNull().default(true),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index('battery_swap_pkg_active_idx').on(t.isActive),
    index('battery_swap_pkg_sort_idx').on(t.sortOrder),
  ],
);
```

- [ ] **Step 1.2：跑类型检查**

```
pnpm type-check
```

Expected：报错（如 `Property 'purchaseLink' does not exist on type ...`）—— 因为 router/UI 还在引用旧字段，符合预期。**不要 commit**，直接进入 Task 2 一起修。

---

## Task 2：生成并改写 Drizzle 迁移

**Files:**
- Create: `drizzle/0020_<auto-name>.sql`
- Auto-update: `drizzle/meta/0020_snapshot.json`, `drizzle/meta/_journal.json`

- [ ] **Step 2.1：生成迁移**

```
pnpm db:generate
```

Expected：在 `drizzle/` 下出现 `0020_<某英文形容词组合>.sql` 文件，内容大致是：

```sql
ALTER TABLE "pg-drizzle_battery_swap_package" ADD COLUMN "buttons" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "pg-drizzle_battery_swap_package" DROP COLUMN "purchaseLink";
```

（具体顺序/列名 quote 可能略有出入，以实际输出为准）

- [ ] **Step 2.2：在 ADD 与 DROP 之间插入 UPDATE 回填**

打开 Step 2.1 生成的 `drizzle/0020_*.sql` 文件，把内容整体替换为：

```sql
ALTER TABLE "pg-drizzle_battery_swap_package" ADD COLUMN "buttons" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "pg-drizzle_battery_swap_package"
   SET "buttons" = jsonb_build_array(
         jsonb_build_object('label', '立即购买', 'link', "purchaseLink")
       )
 WHERE "purchaseLink" IS NOT NULL AND "purchaseLink" <> '';
--> statement-breakpoint
ALTER TABLE "pg-drizzle_battery_swap_package" DROP COLUMN "purchaseLink";
```

注意：表名前缀 `pg-drizzle_` 来自 `table-creator`，以生成文件里的实际 quote 为准；`purchaseLink` 列名同理（不要写成 `purchase_link`，本项目 schema 不做 snake_case 转换）。

- [ ] **Step 2.3：不立即应用迁移**

这一步不跑 `pnpm db:migrate`，留到全部代码改完、走完测试再统一跑。继续 Task 3。

---

## Task 3：tRPC 导出 + zod 校验（TDD）

**Files:**
- Create: `tests/modules/battery-swap/admin/upsert-input.test.ts`
- Modify: `src/modules/battery-swap/routers/admin.ts:9-30`

- [ ] **Step 3.1：写失败测试**

新建 `tests/modules/battery-swap/admin/upsert-input.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { upsertInput } from '@/modules/battery-swap/routers/admin';

const baseValid = {
  company: '智租',
  title: '智租×申通月卡',
  originalPrice: 9900,
  salePrice: 6900,
  specs: [{ model: '48V 20Ah', price: 6900 }],
  buttons: [{ label: '立即购买', link: 'https://example.com' }],
};

describe('batterySwapAdminRouter.upsertInput.buttons', () => {
  it('接受 1 个合法按钮', () => {
    expect(() => upsertInput.parse(baseValid)).not.toThrow();
  });

  it('接受空数组（admin 端用 toast 提醒，不在 zod 强禁）', () => {
    expect(() =>
      upsertInput.parse({ ...baseValid, buttons: [] }),
    ).not.toThrow();
  });

  it('拒绝超过 4 个按钮', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      label: `B${i}`,
      link: 'https://x',
    }));
    expect(() =>
      upsertInput.parse({ ...baseValid, buttons: five }),
    ).toThrow();
  });

  it('拒绝空 label', () => {
    expect(() =>
      upsertInput.parse({
        ...baseValid,
        buttons: [{ label: '', link: 'https://x' }],
      }),
    ).toThrow();
  });

  it('拒绝 label 超过 20 字', () => {
    expect(() =>
      upsertInput.parse({
        ...baseValid,
        buttons: [{ label: 'x'.repeat(21), link: 'https://x' }],
      }),
    ).toThrow();
  });

  it('拒绝空 link', () => {
    expect(() =>
      upsertInput.parse({
        ...baseValid,
        buttons: [{ label: '立即购买', link: '' }],
      }),
    ).toThrow();
  });

  it('未传 buttons 时默认空数组', () => {
    const { buttons: _omit, ...withoutButtons } = baseValid;
    const parsed = upsertInput.parse(withoutButtons);
    expect(parsed.buttons).toEqual([]);
  });
});
```

- [ ] **Step 3.2：跑测试确认失败**

```
pnpm test -- tests/modules/battery-swap/admin/upsert-input.test.ts
```

Expected：报 `Cannot find module ... upsertInput is not exported` 或类似 import 失败。

- [ ] **Step 3.3：改 admin router**

打开 `src/modules/battery-swap/routers/admin.ts`，把头部到 `batterySwapAdminRouter` 之前（约 1–30 行）替换为：

```ts
import { TRPCError } from '@trpc/server';
import { asc, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { adminProcedure, createTRPCRouter } from '@/server/api/trpc';
import { batterySwapPackages } from '@/server/db/schema';

const specSchema = z.object({
  model: z.string().min(1),
  price: z.number().int().min(0),
});

const buttonSchema = z.object({
  label: z.string().min(1).max(20),
  link: z.string().min(1),
});

export const upsertInput = z.object({
  id: z.string().optional(),
  company: z.string().min(1),
  title: z.string().min(1),
  imageUrl: z.string().nullable().optional(),
  detailImageUrl: z.string().nullable().optional(),
  cardBgColor: z.string().nullable().optional(),
  originalPrice: z.number().int().min(0),
  salePrice: z.number().int().min(0),
  specs: z.array(specSchema).min(1),
  depositMethod: z.string().nullable().optional(),
  regionLimit: z.string().nullable().optional(),
  purchaseNotes: z.string().nullable().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  buttons: z.array(buttonSchema).max(4).default([]),
});
```

注意：把原来内部 `const upsertInput =` 升级为 `export const upsertInput =`，并删除 `purchaseLink: z.string().nullable().optional(),` 这一行。

- [ ] **Step 3.4：再跑测试确认通过**

```
pnpm test -- tests/modules/battery-swap/admin/upsert-input.test.ts
```

Expected：7 个 case 全过。

- [ ] **Step 3.5：改 upsert handler 内的 `shared` 对象**

继续在 `src/modules/battery-swap/routers/admin.ts` 里，找到 `upsert: adminProcedure...` 内的 `const shared = {` 块（原文 46–61 行），改为：

```ts
    const shared = {
      company: input.company,
      title: input.title,
      imageUrl: input.imageUrl ?? null,
      detailImageUrl: input.detailImageUrl ?? null,
      cardBgColor: input.cardBgColor ?? '#ffffff',
      originalPrice: input.originalPrice,
      salePrice: input.salePrice,
      specs: input.specs,
      depositMethod: input.depositMethod ?? '芝麻信用抵押金',
      regionLimit: input.regionLimit ?? null,
      purchaseNotes: input.purchaseNotes ?? null,
      validFrom: input.validFrom ? new Date(input.validFrom) : null,
      validTo: input.validTo ? new Date(input.validTo) : null,
      buttons: input.buttons,
    };
```

（即把 `purchaseLink: input.purchaseLink ?? null,` 整行替换为 `buttons: input.buttons,`）

- [ ] **Step 3.6：类型检查**

```
pnpm type-check
```

Expected：admin UI 与 home/package-card 还会报错（仍引用旧字段），属于预期，Task 4–6 修。

---

## Task 4：Admin Modal 内动态按钮行（不含拖拽）

**Files:**
- Modify: `src/modules/battery-swap/admin/packages.tsx`

- [ ] **Step 4.1：导入 nanoid**

打开 `src/modules/battery-swap/admin/packages.tsx`，在文件已有的 antd 导入下面新增一行（如已有则跳过）：

```ts
import { nanoid } from 'nanoid';
```

- [ ] **Step 4.2：改 `EditingPackage` 与 `PackageRow` 类型**

把 `EditingPackage`（90–105 行附近）替换为：

```ts
type EditingButton = {
  key: string; // 前端拖拽用稳定 key，提交时丢弃
  label: string;
  link: string;
};

type EditingPackage = {
  id?: string;
  company: string;
  title: string;
  imageUrl: string | null;
  detailImageUrl: string | null;
  cardBgColor: string;
  originalPrice: number; // 元
  salePrice: number; // 元
  specs: { model: string; price: number }[]; // price 是元
  depositMethod: string;
  regionLimit: string;
  purchaseNotes: string;
  timeRange: [Dayjs, Dayjs] | null;
  buttons: EditingButton[];
};
```

把 `PackageRow`（107–125 行）里 `purchaseLink: string | null;` 整行替换为：

```ts
  buttons: PackageButton[];
```

并在文件顶部，把现有的

```ts
import type { PackageSpec } from '@/modules/battery-swap/schema';
```

替换为：

```ts
import type { PackageButton, PackageSpec } from '@/modules/battery-swap/schema';
```

- [ ] **Step 4.3：改 `rowToEditing` 与 `DEFAULT_EDITING`**

把 `rowToEditing` 函数（127–145 行）替换为：

```ts
function rowToEditing(r: PackageRow): EditingPackage {
  return {
    id: r.id,
    company: r.company,
    title: r.title,
    imageUrl: r.imageUrl,
    detailImageUrl: r.detailImageUrl,
    cardBgColor: r.cardBgColor ?? '#ffffff',
    originalPrice: r.originalPrice / 100,
    salePrice: r.salePrice / 100,
    specs: r.specs.map((s) => ({ model: s.model, price: s.price / 100 })),
    depositMethod: r.depositMethod ?? '芝麻信用抵押金',
    regionLimit: r.regionLimit ?? '',
    purchaseNotes: r.purchaseNotes ?? '',
    timeRange:
      r.validFrom && r.validTo ? [dayjs(r.validFrom), dayjs(r.validTo)] : null,
    buttons: (r.buttons ?? []).map((b) => ({
      key: nanoid(),
      label: b.label,
      link: b.link,
    })),
  };
}
```

把 `DEFAULT_EDITING`（147–164 行）替换为：

```ts
const DEFAULT_EDITING: EditingPackage = {
  company: '',
  title: '',
  imageUrl: null,
  detailImageUrl: null,
  cardBgColor: '#ffffff',
  originalPrice: 0,
  salePrice: 0,
  specs: [
    { model: '', price: 0 },
    { model: '', price: 0 },
  ],
  depositMethod: '芝麻信用抵押金',
  regionLimit: '',
  purchaseNotes: '上海仅限48V，60V慎拍',
  timeRange: null,
  buttons: [{ key: nanoid(), label: '立即购买', link: '' }],
};
```

- [ ] **Step 4.4：新增 button helpers**

在 `removeSpec` 函数下方（约 311 行后），新增四个 helper：

```ts
  function updateButton(
    index: number,
    field: 'label' | 'link',
    value: string,
  ) {
    setEditing((prev) => {
      if (!prev) return prev;
      const buttons = [...prev.buttons];
      const current = buttons[index];
      if (current) buttons[index] = { ...current, [field]: value };
      return { ...prev, buttons };
    });
  }

  function addButton() {
    setEditing((prev) => {
      if (!prev || prev.buttons.length >= 4) return prev;
      return {
        ...prev,
        buttons: [...prev.buttons, { key: nanoid(), label: '', link: '' }],
      };
    });
  }

  function removeButton(index: number) {
    setEditing((prev) => {
      if (!prev) return prev;
      return { ...prev, buttons: prev.buttons.filter((_, i) => i !== index) };
    });
  }

  function moveButton(fromKey: string, toKey: string) {
    setEditing((prev) => {
      if (!prev || fromKey === toKey) return prev;
      const fromIdx = prev.buttons.findIndex((b) => b.key === fromKey);
      const toIdx = prev.buttons.findIndex((b) => b.key === toKey);
      if (fromIdx === -1 || toIdx === -1) return prev;
      return { ...prev, buttons: arrayMove(prev.buttons, fromIdx, toIdx) };
    });
  }
```

- [ ] **Step 4.5：改 `handleSave` 校验与 payload**

在 `handleSave` 内现有的 `if (editing.specs.some...) { ... }` 之后、`upsertMutation.mutate(...)` 之前，新增校验：

```ts
    if (
      editing.buttons.some(
        (b) => !b.label.trim() || !b.link.trim(),
      )
    ) {
      toast.error('请补齐所有按钮的文案与链接');
      return;
    }
    if (editing.buttons.length === 0) {
      toast.warning('未配置任何按钮，前台将无法跳转');
    }
```

然后把 `upsertMutation.mutate({...})` 内的 `purchaseLink: editing.purchaseLink || null,` 整行替换为：

```ts
      buttons: editing.buttons.map((b) => ({
        label: b.label.trim(),
        link: b.link.trim(),
      })),
```

- [ ] **Step 4.6：替换 Modal 内的「购买跳转链接」表单项（暂不含拖拽）**

找到 Modal 内的：

```tsx
            {/* 购买链接 */}
            <Form.Item label="购买跳转链接">
              <Input
                onChange={(e) =>
                  updateEditing({ purchaseLink: e.target.value })
                }
                placeholder="https://..."
                value={editing.purchaseLink}
              />
            </Form.Item>
```

整段替换为：

```tsx
            {/* 购买按钮（最多 4 个） */}
            <Form.Item label="购买按钮（最多 4 个，可拖拽排序）">
              {editing.buttons.map((btn, idx) => (
                <Space
                  align="center"
                  key={btn.key}
                  style={{ display: 'flex', marginBottom: 8 }}
                >
                  <HolderOutlined style={{ cursor: 'grab', color: '#999' }} />
                  <Input
                    onChange={(e) => updateButton(idx, 'label', e.target.value)}
                    placeholder="按钮文案，如 立即购买"
                    style={{ width: 180 }}
                    value={btn.label}
                  />
                  <Input
                    onChange={(e) => updateButton(idx, 'link', e.target.value)}
                    placeholder="https://..."
                    style={{ width: 280 }}
                    value={btn.link}
                  />
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeButton(idx)}
                    size="small"
                    type="text"
                  />
                </Space>
              ))}
              <Button
                disabled={editing.buttons.length >= 4}
                icon={<PlusOutlined />}
                onClick={addButton}
                size="small"
                type="dashed"
              >
                添加按钮
              </Button>
            </Form.Item>
```

（拖拽放 Task 5 接入，本步先把功能跑通；`HolderOutlined` 此处仅作占位图标，先不绑事件）

- [ ] **Step 4.7：类型检查（不 commit）**

```
pnpm type-check
```

Expected：admin 文件类型通过；`home.tsx`、`package-card.tsx` 仍报错（仍引用旧字段），属于预期。
**本任务结束不 commit** —— husky pre-commit 会跑全量 tsc，必须等 Task 5、6 把前台改完，统一在 Step 6.6 一次性提交。

---

## Task 5：Admin 按钮行拖拽排序

**Files:**
- Modify: `src/modules/battery-swap/admin/packages.tsx`

- [ ] **Step 5.1：新增 SortableButtonRow 组件**

在文件顶部 `SortableRow` 组件下方（约 86 行后），新增：

```tsx
function SortableButtonRow({
  buttonKey,
  children,
}: {
  buttonKey: string;
  children: (handleProps: {
    attributes: ReturnType<typeof useSortable>['attributes'];
    listeners: ReturnType<typeof useSortable>['listeners'];
  }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: buttonKey });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners })}
    </div>
  );
}
```

- [ ] **Step 5.2：在 Modal 的按钮列表外面包 DndContext + SortableContext**

把 Task 4.6 写入的 `<Form.Item label="购买按钮...">` 内部内容替换为：

```tsx
            <Form.Item label="购买按钮（最多 4 个，可拖拽排序）">
              <DndContext
                id="battery-swap-buttons"
                onDragEnd={(e) => {
                  const { active, over } = e;
                  if (over && active.id !== over.id) {
                    moveButton(String(active.id), String(over.id));
                  }
                }}
                sensors={sensors}
              >
                <SortableContext
                  items={editing.buttons.map((b) => b.key)}
                  strategy={verticalListSortingStrategy}
                >
                  {editing.buttons.map((btn, idx) => (
                    <SortableButtonRow buttonKey={btn.key} key={btn.key}>
                      {({ attributes, listeners }) => (
                        <Space
                          align="center"
                          style={{ display: 'flex', marginBottom: 8 }}
                        >
                          <span {...attributes} {...listeners}>
                            <HolderOutlined
                              style={{ cursor: 'grab', color: '#999' }}
                            />
                          </span>
                          <Input
                            onChange={(e) =>
                              updateButton(idx, 'label', e.target.value)
                            }
                            placeholder="按钮文案，如 立即购买"
                            style={{ width: 180 }}
                            value={btn.label}
                          />
                          <Input
                            onChange={(e) =>
                              updateButton(idx, 'link', e.target.value)
                            }
                            placeholder="https://..."
                            style={{ width: 280 }}
                            value={btn.link}
                          />
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => removeButton(idx)}
                            size="small"
                            type="text"
                          />
                        </Space>
                      )}
                    </SortableButtonRow>
                  ))}
                </SortableContext>
              </DndContext>
              <Button
                disabled={editing.buttons.length >= 4}
                icon={<PlusOutlined />}
                onClick={addButton}
                size="small"
                type="dashed"
                style={{ marginTop: 4 }}
              >
                添加按钮
              </Button>
            </Form.Item>
```

注意要点：
- `sensors` 已在主组件作用域内（套餐列表的拖拽复用），直接引用
- 只有 `HolderOutlined` 外层 `<span>` 绑 `attributes`/`listeners`，避免输入框被拖动事件捕获导致无法聚焦
- `verticalListSortingStrategy` 与 `arrayMove` 已在 `@dnd-kit/sortable` 顶部导入，无需新增 import

- [ ] **Step 5.3：类型检查**

```
pnpm type-check
```

Expected：admin 文件类型通过；`home.tsx`/`package-card.tsx` 仍报错。

---

## Task 6：前台渲染

**Files:**
- Modify: `src/modules/battery-swap/components/home.tsx`
- Modify: `src/modules/battery-swap/components/package-card.tsx`

- [ ] **Step 6.1：改 home.tsx 传参**

打开 `src/modules/battery-swap/components/home.tsx`，把 `<PackageCard ... purchaseLink={pkg.purchaseLink} ... />` 内的：

```tsx
            purchaseLink={pkg.purchaseLink}
```

整行替换为：

```tsx
            buttons={pkg.buttons}
```

- [ ] **Step 6.2：改 package-card.tsx Props 类型**

打开 `src/modules/battery-swap/components/package-card.tsx`，把顶部 import 与 Props 类型块（约 13–32 行）改为：

```ts
import type {
  PackageButton,
  PackageSpec,
} from '@/modules/battery-swap/schema';
import { formatPrice } from '@/modules/battery-swap/schema';

export type PackageCardProps = {
  title: string;
  company: string;
  imageUrl: string | null;
  detailImageUrl: string | null;
  cardBgColor: string | null;
  originalPrice: number;
  salePrice: number;
  specs: PackageSpec[];
  depositMethod: string | null;
  regionLimit: string | null;
  purchaseNotes: string | null;
  buttons: PackageButton[];
  validFrom: Date | string | null;
  validTo: Date | string | null;
  onBuy: (link: string) => void;
};
```

把 `PackageCard` 组件解构里 `purchaseLink,` 替换为 `buttons,`。

- [ ] **Step 6.3：替换底部按钮渲染块**

找到原文 209–221 行附近的：

```tsx
          {/* 购买按钮 */}
          <button
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 font-bold text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!purchaseLink}
            onClick={() => purchaseLink && onBuy(purchaseLink)}
            style={{
              backgroundColor: accent,
              boxShadow: `0 10px 15px -3px ${hexToRgba(accent, 0.2)}`,
            }}
            type="button"
          >
            立即购买 ¥{formatPrice(salePrice)} 起
          </button>
```

整段替换为：

```tsx
          {/* 购买按钮（0~4 个，2×2 自适应） */}
          {buttons.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {buttons.map((b, i) => (
                <button
                  className={`flex items-center justify-center truncate rounded-xl px-2 py-2.5 font-bold text-sm text-white ${
                    buttons.length === 1 ? 'col-span-2' : ''
                  } ${buttons.length === 3 && i === 2 ? 'col-span-2' : ''}`}
                  key={i}
                  onClick={() => onBuy(b.link)}
                  style={{
                    backgroundColor: accent,
                    boxShadow: `0 10px 15px -3px ${hexToRgba(accent, 0.2)}`,
                  }}
                  title={b.label}
                  type="button"
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
```

`salePrice` 仍被 props 解构出来但不再用于按钮文案 —— 它在卡片头部的价格区还在用（126–134 行），不要删 props 解构。

- [ ] **Step 6.4：类型检查**

```
pnpm type-check
```

Expected：整个项目类型通过。

- [ ] **Step 6.5：跑全量测试**

```
pnpm test
```

Expected：所有用例通过，新增 7 个 buttons 校验 case 计入总数。

- [ ] **Step 6.6：commit Task 4–6 的全部改动**

```
git add src/modules/battery-swap drizzle/0020_*.sql drizzle/meta/0020_snapshot.json drizzle/meta/_journal.json tests/modules/battery-swap
git status
```

确认 `git status` 列出：
- `src/modules/battery-swap/schema/index.ts`
- `src/modules/battery-swap/routers/admin.ts`
- `src/modules/battery-swap/admin/packages.tsx`
- `src/modules/battery-swap/components/home.tsx`
- `src/modules/battery-swap/components/package-card.tsx`
- `drizzle/0020_*.sql`
- `drizzle/meta/0020_snapshot.json`
- `drizzle/meta/_journal.json`
- `tests/modules/battery-swap/admin/upsert-input.test.ts`

提交：

```
git commit -m "feat(battery-swap): 套餐卡片底部支持多购买按钮配置（迁移 purchaseLink → buttons jsonb）"
```

husky 会跑 type-check + 全量 vitest，预期通过。

---

## Task 7：应用迁移 + 浏览器手验

**Files:** 无代码改动

- [ ] **Step 7.1：在本地数据库应用迁移**

⚠️ 跑前先 dump 一份本地 `battery_swap_package` 表（如果本地有重要测试数据），命令示例：

```
pg_dump -t '"pg-drizzle_battery_swap_package"' "$env:DATABASE_URL" > backup-battery-swap.sql
```

然后应用：

```
pnpm db:migrate
```

Expected：成功执行 `0020_*.sql`，无错误。

- [ ] **Step 7.2：用 db:studio 抽查一条老数据**

```
pnpm db:studio
```

打开浏览器，进入 `battery_swap_package` 表，确认：
- 老行的 `buttons` 列为 `[{"label":"立即购买","link":"<原 purchaseLink 值>"}]`
- 表里没有 `purchaseLink` 列

- [ ] **Step 7.3：启动 dev 服务器**

```
pnpm dev
```

- [ ] **Step 7.4：admin 端手验**

打开 `/admin/battery-swap`，依次确认：
- 老套餐编辑时按钮区域显示「立即购买」+ 原链接
- 「添加按钮」最多到 4 个后置灰
- 拖拽 `HolderOutlined` 图标可以重排
- 删除某个按钮、保存后再打开顺序与内容正确
- 空 label 或空 link 时点保存被 toast 拦截
- 全部按钮删空后保存出现 warning toast，但保存成功

- [ ] **Step 7.5：前台手验**

打开 `/battery-swap`，对几张卡片确认：
- 1 个按钮：整行宽度
- 2 个按钮：平分一行
- 3 个按钮：前 2 个一行 + 第 3 个独占
- 4 个按钮：2×2
- 0 个按钮：底部按钮区不渲染（卡片其余信息正常）
- 点击按钮触发 `openLink(b.link)`（钉钉容器内/浏览器内均跳转）
- 长文案 truncate，不撑爆卡片

- [ ] **Step 7.6：（可选）打 tag 或留生产迁移说明**

如果生产部署独立跑 `pnpm db:migrate`，写一条上线 checklist：
- 迁移耗时：单表 ALTER + UPDATE，行数 ≤ 1k 量级，影响秒级
- 回滚预案：本迁移不可向下兼容（purchase_link 已删除），如需回滚需从备份恢复列

无代码改动，无 commit。

---

## 自检备忘

- [ ] `grep -r purchaseLink src/modules/battery-swap` 应无任何匹配（除 schema 文件已删除）
- [ ] `grep -r purchaseLink tests/modules/battery-swap` 应无匹配
- [ ] `drizzle/0020_*.sql` 包含 UPDATE 回填语句
- [ ] zod 7 条 buttons 测试全过
- [ ] 浏览器手验 5 个布局场景通过
