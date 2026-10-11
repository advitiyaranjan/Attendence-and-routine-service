/**
 * Markdown as AI Pilot and notes write it: GitHub-flavoured (tables, ~~strike~~,
 * task lists, bare links) and single line breaks kept, since models and
 * students rarely leave blank lines between lines.
 */
import ReactMarkdown, { type Components, type UrlTransform, defaultUrlTransform } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { cn } from './ui';

const PLUGINS = [remarkGfm, remarkBreaks];

/** Wide tables scroll sideways instead of stretching the bubble. */
const BASE: Components = {
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
};

/** Models sometimes send literal "\n" sequences or wrap the whole reply in a ```markdown fence. */
export function tidyMarkdown(text: string): string {
  let t = text.replace(/\r\n/g, '\n');
  if (!t.includes('\n') && t.includes('\\n')) t = t.replace(/\\n/g, '\n');
  const fenced = /^\s*```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/i.exec(t);
  if (fenced) t = fenced[1]!;
  return t.trim();
}

export function Markdown({ children, components, className, urlTransform }: { children: string; components?: Components; className?: string; urlTransform?: UrlTransform }) {
  return (
    <div className={cn('prose-sm', className)}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={{ ...BASE, ...components }} urlTransform={urlTransform ?? defaultUrlTransform}>
        {tidyMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
}
