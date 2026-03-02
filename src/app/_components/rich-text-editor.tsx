'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface RichTextEditorProps {
  defaultValue?: string;
  onChange: (html: string) => void;
}

/**
 * 基于 Tiptap 的富文本编辑器组件。
 * 使用非受控模式（defaultValue 仅在挂载时设置），避免光标跳位。
 * 通过 key prop 切换编辑内容时重新挂载。
 */
export function RichTextEditor({
  defaultValue = '',
  onChange,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: defaultValue,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          'min-h-28 px-3 py-2 text-sm text-gray-700 focus:outline-none prose prose-sm max-w-none',
      },
    },
    immediatelyRender: false,
  });

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-1 border-gray-200 border-b bg-gray-50 px-2 py-1.5">
        <ToolbarButton
          active={editor?.isActive('bold')}
          className="font-bold"
          label="B"
          onClick={() => editor?.chain().focus().toggleBold().run()}
          title="加粗 (Ctrl+B)"
        />
        <ToolbarButton
          active={editor?.isActive('italic')}
          className="italic"
          label="I"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="斜体 (Ctrl+I)"
        />
        <ToolbarButton
          active={editor?.isActive('strike')}
          className="line-through"
          label="S̶"
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          title="删除线"
        />
        <Divider />
        <ToolbarButton
          active={editor?.isActive('heading', { level: 2 })}
          label="H2"
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 2 }).run()
          }
          title="二级标题"
        />
        <ToolbarButton
          active={editor?.isActive('heading', { level: 3 })}
          label="H3"
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 3 }).run()
          }
          title="三级标题"
        />
        <Divider />
        <ToolbarButton
          active={editor?.isActive('bulletList')}
          label="• 列表"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          title="无序列表"
        />
        <ToolbarButton
          active={editor?.isActive('orderedList')}
          label="1. 列表"
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          title="有序列表"
        />
        <Divider />
        <ToolbarButton
          label="撤销"
          onClick={() => editor?.chain().focus().undo().run()}
          title="撤销 (Ctrl+Z)"
        />
        <ToolbarButton
          label="重做"
          onClick={() => editor?.chain().focus().redo().run()}
          title="重做 (Ctrl+Y)"
        />
      </div>

      {/* 编辑区 */}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  label,
  title,
  active,
  className = '',
  onClick,
}: {
  label: string;
  title: string;
  active?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded px-2 py-1 text-xs transition-colors ${className} ${
        active
          ? 'bg-orange-100 text-orange-700'
          : 'text-gray-600 hover:bg-gray-200'
      }`}
      onClick={onClick}
      title={title}
      type="button"
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-4 w-px bg-gray-300" />;
}
