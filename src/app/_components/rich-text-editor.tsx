'use client';

import TextAlign from '@tiptap/extension-text-align';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import './rich-text-editor.css';

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
    extensions: [
      StarterKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: defaultValue,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'focus:outline-none',
      },
    },
    immediatelyRender: false,
  });

  return (
    <div className="rich-text-editor overflow-hidden rounded-lg border border-gray-200">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-0.5 border-gray-200 border-b bg-gray-50 px-2 py-1.5">
        {/* 文本格式 */}
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
          active={editor?.isActive('underline')}
          className="underline"
          label="U"
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          title="下划线 (Ctrl+U)"
        />
        <ToolbarButton
          active={editor?.isActive('strike')}
          className="line-through"
          label="S"
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          title="删除线"
        />

        <Divider />

        {/* 标题 */}
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

        {/* 对齐 */}
        <ToolbarButton
          active={editor?.isActive({ textAlign: 'left' })}
          label="左"
          onClick={() => editor?.chain().focus().setTextAlign('left').run()}
          title="左对齐"
        />
        <ToolbarButton
          active={editor?.isActive({ textAlign: 'center' })}
          label="中"
          onClick={() => editor?.chain().focus().setTextAlign('center').run()}
          title="居中"
        />
        <ToolbarButton
          active={editor?.isActive({ textAlign: 'right' })}
          label="右"
          onClick={() => editor?.chain().focus().setTextAlign('right').run()}
          title="右对齐"
        />

        <Divider />

        {/* 列表 */}
        <ToolbarButton
          active={editor?.isActive('bulletList')}
          label="● 列表"
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

        {/* 分割线 */}
        <ToolbarButton
          label="分割线"
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          title="插入分割线"
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
  className: extraClass = '',
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
      className={`rounded px-2 py-1 text-xs transition-colors ${extraClass} ${
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
