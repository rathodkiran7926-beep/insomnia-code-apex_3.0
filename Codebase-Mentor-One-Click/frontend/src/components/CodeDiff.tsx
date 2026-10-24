import { useMemo } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { FileCode2 } from 'lucide-react';
import { Badge } from './UI';

export function CodeDiff({ before, after, path }: { before: string; after: string; path: string }) {
  const rows = useMemo(() => {
    const a = before ? before.split('\n') : [];
    const b = after ? after.split('\n') : [];
    const table: number[][] = Array.from({ length: a.length + 1 }, () =>
      Array(b.length + 1).fill(0),
    );
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        table[i][j] =
          a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    const result: { kind: 'same' | 'add' | 'remove'; old?: number; next?: number; text: string }[] =
      [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        result.push({ kind: 'same', old: i + 1, next: j + 1, text: a[i] });
        i++;
        j++;
      } else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) {
        result.push({ kind: 'add', next: j + 1, text: b[j++] });
      } else {
        result.push({ kind: 'remove', old: i + 1, text: a[i++] });
      }
    }
    return result;
  }, [before, after]);
  return (
    <div className="diff-view">
      <div className="diff-file-header">
        <FileCode2 size={15} />
        <strong>{path}</strong>
        <span className="diff-count-add">+{rows.filter((r) => r.kind === 'add').length}</span>
        <span className="diff-count-remove">−{rows.filter((r) => r.kind === 'remove').length}</span>
        <Badge>Sample diff</Badge>
      </div>
      <div
        className="diff-scroll"
        tabIndex={0}
        role="region"
        aria-label={`Unified code diff for ${path}`}
      >
        <pre>
          {rows.map((row, i) => (
            <div key={i} className={`diff-line diff-${row.kind}`}>
              <span className="diff-old-line">{row.old ?? ''}</span>
              <span className="diff-new-line">{row.next ?? ''}</span>
              <span className="diff-sign">
                {row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}
              </span>
              <code
                dangerouslySetInnerHTML={{
                  __html: Prism.highlight(
                    row.text || ' ',
                    Prism.languages.typescript,
                    'typescript',
                  ),
                }}
              />
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
