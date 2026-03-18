'use client';

export function MarkdownRenderer({ content }: { content: string }) {
  const html = markdownToHtml(content);
  return (
    <div
      className="prose prose-purple max-w-none [&_blockquote]:border-purple-300 [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:text-gray-600 [&_blockquote]:italic [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:font-bold [&_h1]:text-2xl [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-xl [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-medium [&_h3]:text-lg [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_p]:leading-relaxed [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized by markdownToHtml which escapes all HTML entities before processing
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function sanitizeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownToHtml(md: string): string {
  // First sanitize all HTML to prevent XSS
  let html = sanitizeHtml(md);

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold (must be before italic)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote><p>$1</p></blockquote>');
  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');
  html = html.replace(/((?:<oli>.*<\/oli>\n?)+)/g, (match) => {
    const items = match.replace(/<oli>(.*?)<\/oli>/g, '<li>$1</li>');
    return `<ol>${items}</ol>`;
  });
  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<uli>$1</uli>');
  html = html.replace(/((?:<uli>.*<\/uli>\n?)+)/g, (match) => {
    const items = match.replace(/<uli>(.*?)<\/uli>/g, '<li>$1</li>');
    return `<ul>${items}</ul>`;
  });
  // Paragraphs - wrap lines not already in tags
  html = html.replace(/^(?!<[houlb]|<li|<bl|<\/[uo]l>)(.+)$/gm, '<p>$1</p>');
  // Line breaks
  html = html.replace(/\n\n/g, '');
  return html;
}
