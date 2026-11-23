'use dom';

// Renders literal Japanese prose alongside TeX math in $...$ or $$...$$.
// Expo SDK 56+ runs DOM components as normal DOM on Web and in an embedded
// DOM WebView on Android/iOS. KaTeX fonts and CSS are bundled locally.
import React, { useMemo } from 'react';
import * as katex from 'katex';
import 'katex/dist/katex.min.css';

type Props = {
  content: string;
  fontSize?: number;
  center?: boolean;
  color?: string;
  dom?: import('expo/dom').DOMProps;
};

type Piece = { text: string; math: boolean; block: boolean };
export function parseMath(content: string): Piece[] {
  const result: Piece[] = [];
  const re = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
  let start = 0;
  for (const match of content.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > start) result.push({ text: content.slice(start, index), math: false, block: false });
    const token = match[0];
    const block = token.startsWith('$$');
    result.push({ text: token.slice(block ? 2 : 1, block ? -2 : -1), math: true, block });
    start = index + token.length;
  }
  if (start < content.length) result.push({ text: content.slice(start), math: false, block: false });
  return result;
}

export default function MathContent({ content, fontSize = 18, center = false, color = '#F8F6FF' }: Props) {
  const pieces = useMemo(() => parseMath(content), [content]);
  return (
    <div style={{ boxSizing: 'border-box', width: '100%', color, fontSize,
      fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: 1.6,
      textAlign: center ? 'center' : 'left', overflowWrap: 'anywhere', padding: '5px 2px' }}>
      {pieces.map((item, i) => {
        if (!item.math) return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{item.text}</span>;
        const html = katex.renderToString(item.text, {
          displayMode: item.block, throwOnError: false, trust: false,
          strict: 'warn', maxExpand: 200, output: 'htmlAndMathml',
        });
        const style: React.CSSProperties = { color, overflowX: 'auto', maxWidth: '100%',
          verticalAlign: 'middle', display: item.block ? 'block' : 'inline-block' };
        return <span key={i} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </div>
  );
}
