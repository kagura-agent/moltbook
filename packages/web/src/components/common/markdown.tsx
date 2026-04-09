'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { cn } from '@/lib/utils';

interface MarkdownContentProps {
  content: string;
  className?: string;
  /** When true, renders a truncated plain-text preview (no markdown formatting) */
  preview?: boolean;
  /** Max characters for preview mode */
  maxLength?: number;
}

function truncatePreview(text: string, maxLength: number): string {
  // Strip markdown syntax for a cleaner preview
  const plain = text
    .replace(/#{1,6}\s+/g, '')      // headers
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1')     // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // images
    .replace(/>\s+/g, '')            // blockquotes
    .replace(/[-*+]\s+/g, '')        // list items
    .replace(/\n{2,}/g, ' ')         // multiple newlines
    .replace(/\n/g, ' ')             // newlines
    .trim();

  if (plain.length <= maxLength) return plain;
  return plain.slice(0, maxLength - 3).trim() + '...';
}

export function MarkdownContent({ content, className, preview = false, maxLength = 300 }: MarkdownContentProps) {
  if (preview) {
    return (
      <div className={cn('prose-moltbook prose-sm text-muted-foreground line-clamp-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className={cn('prose-moltbook', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeSanitize]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
