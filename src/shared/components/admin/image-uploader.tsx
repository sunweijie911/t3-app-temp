'use client';

import {
  DeleteOutlined,
  EditOutlined,
  LoadingOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { Upload } from 'antd';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

interface ImageUploaderProps {
  /** 当前图片 URL */
  value: string | null | undefined;
  /** URL 变化回调（上传成功传 url，删除传 null） */
  onChange: (url: string | null) => void;
  /** 上传模块名，对应 /api/upload?module=xxx */
  module: string;
  /** 最大文件大小（MB），默认 5 */
  maxSize?: number;
  /** 预览区域宽度，默认 240 */
  width?: number;
  /** 预览区域高度，默认 120 */
  height?: number;
  /** 占位文字 */
  placeholder?: string;
}

export function ImageUploader({
  value,
  onChange,
  module,
  maxSize = 5,
  width = 240,
  height = 120,
  placeholder = '点击或拖拽上传图片',
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(file: File) {
    if (file.size > maxSize * 1024 * 1024) {
      toast.error(`图片大小不能超过 ${maxSize}MB`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/upload?module=${module}`, {
        method: 'POST',
        body: fd,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast.error(data.error ?? '上传失败');
        return;
      }
      onChange(data.url);
    } catch {
      toast.error('上传失败，请重试');
    } finally {
      setUploading(false);
    }
  }

  // 有图片：显示预览 + hover 遮罩（更换 + 删除）
  if (value) {
    return (
      <div
        style={{
          position: 'relative',
          width,
          height,
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid #d9d9d9',
        }}
      >
        {/* biome-ignore lint/performance/noImgElement: 用户上传的动态图片，自部署环境下 next/image 无优化收益 */}
        <img
          alt="preview"
          src={value}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {/* 隐藏的文件选择器，用于更换图片 */}
        <input
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
            e.target.value = '';
          }}
          ref={fileInputRef}
          style={{ display: 'none' }}
          type="file"
        />
        <div
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0';
          }}
          role="toolbar"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            background: 'rgba(0,0,0,0.45)',
            opacity: 0,
            transition: 'opacity 0.2s',
          }}
        >
          {uploading ? (
            <LoadingOutlined style={{ fontSize: 24, color: '#fff' }} />
          ) : (
            <>
              <EditOutlined
                onClick={() => fileInputRef.current?.click()}
                style={{ fontSize: 22, color: '#fff', cursor: 'pointer' }}
                title="更换图片"
              />
              <DeleteOutlined
                onClick={() => onChange(null)}
                style={{ fontSize: 22, color: '#fff', cursor: 'pointer' }}
                title="删除图片"
              />
            </>
          )}
        </div>
      </div>
    );
  }

  // 无图片：拖拽/点击上传区域
  return (
    <Upload.Dragger
      accept="image/*"
      beforeUpload={(file) => {
        void handleUpload(file);
        return false;
      }}
      disabled={uploading}
      showUploadList={false}
      style={{ width, height, padding: 0 }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height,
          color: '#999',
          fontSize: 13,
        }}
      >
        {uploading ? (
          <LoadingOutlined style={{ fontSize: 24, marginBottom: 8 }} />
        ) : (
          <PlusOutlined style={{ fontSize: 24, marginBottom: 8 }} />
        )}
        <span>{uploading ? '上传中...' : placeholder}</span>
      </div>
    </Upload.Dragger>
  );
}
