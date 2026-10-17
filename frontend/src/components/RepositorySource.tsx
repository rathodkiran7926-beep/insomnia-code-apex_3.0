import { useMemo, useRef, useState, useEffect } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import {
  Check,
  Copy,
  ExternalLink,
  FileCode2,
  GitCommitHorizontal,
  Maximize2,
  WrapText,
} from 'lucide-react';
import { Modal } from './UI';

type StoredSource = {
  file: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  url: string;
};
type Segment = { text: string; classes: string[] };
function highlightedLines(text: string, language: string) {
  const lines: Segment[][] = [[]];
  const walk = (value: string | Prism.Token | (string | Prism.Token)[], classes: string[] = []) => {
    if (typeof value === 'string') {
      value.split('\n').forEach((part, i) => {
        if (i) lines.push([]);
        if (part) lines[lines.length - 1].push({ text: part, classes });
      });
    } else if (Array.isArray(value)) value.forEach((item) => walk(item, classes));
    else
      walk(value.content, [
        ...classes,
        'token',
        value.type,
        ...(typeof value.alias === 'string' ? [value.alias] : value.alias || []),
      ]);
  };
  walk(Prism.languages[language] ? Prism.tokenize(text, Prism.languages[language]) : text);
  return lines;
}
export function RepositorySource({ source, commit }: { source?: StoredSource; commit: string }) {
  const [expanded, setExpanded] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const language = source?.file.endsWith('.tsx')
    ? 'tsx'
    : source?.file.endsWith('.jsx')
      ? 'jsx'
      : /\.[cm]?ts$/.test(source?.file || '')
        ? 'typescript'
        : 'javascript';
  const lines = useMemo(
    () => highlightedLines(source?.excerpt || '', language),
    [source?.excerpt, language],
  );
  if (!source)
    return <p className="repository-source-missing">Source is unavailable for this component.</p>;
  const name = source.file.split('/').pop();
  const languageLabel =
    language === 'typescript'
      ? 'TypeScript'
      : language === 'tsx'
        ? 'TypeScript JSX'
        : language === 'jsx'
          ? 'JavaScript JSX'
          : 'JavaScript';
  const previewEnd = Math.min(source.endLine, source.startLine + lines.length - 1);
  const truncated = previewEnd < source.endLine || source.excerpt.length >= 1800;
  async function copy() {
    try {
      await navigator.clipboard.writeText(source!.excerpt);
      setCopied(true);
      setCopyError(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }
  const render = (large: boolean) => (
    <div
      className={`repository-source ${wrap ? 'source-wrapped' : ''} ${large ? 'source-expanded' : ''}`}
    >
      <div className="repository-source-toolbar">
        <span>
          <span className="repository-editor-file-icon">
            {language === 'typescript' || language === 'tsx' ? 'TS' : 'JS'}
          </span>
          <strong title={source.file}>{name}</strong>
          <span className="repository-editor-readonly">Read only</span>
        </span>
        <div>
          <button
            aria-label={wrap ? 'Turn off code wrapping' : 'Wrap long code lines'}
            aria-pressed={wrap}
            title="Wrap long lines"
            onClick={() => setWrap((v) => !v)}
          >
            <WrapText size={15} />
          </button>
          <button
            aria-label="Copy source excerpt"
            title={copied ? 'Copied' : 'Copy excerpt'}
            onClick={() => void copy()}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          {!large && (
            <button
              aria-label="Expand source code"
              title="Expand code viewer"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 size={15} />
              <span>Expand</span>
            </button>
          )}
        </div>
      </div>
      <div className="repository-source-file">
        <FileCode2 size={15} />
        <span title={source.file}>
          <small>
            {source.file.split('/').slice(0, -1).join(' › ') || 'Repository root'}{' '}
            <span aria-hidden="true"> › </span> {name}
          </small>
        </span>
        <span className="repository-source-language">{languageLabel}</span>
      </div>
      <div
        className="repository-source-scroll"
        role="region"
        aria-label={`Source excerpt: ${source.file}, lines ${source.startLine} to ${previewEnd}`}
        tabIndex={0}
      >
        <pre>
          {lines.map((segments, i) => (
            <div className="repository-source-line" key={i}>
              <span className="repository-source-number" aria-hidden="true">
                {source.startLine + i}
              </span>
              <code>
                {segments.length
                  ? segments.map((segment, j) => (
                      <span key={j} className={segment.classes.join(' ')}>
                        {segment.text}
                      </span>
                    ))
                  : ' '}
              </code>
            </div>
          ))}
        </pre>
      </div>
      <div className="repository-source-footer">
        <span>
          <GitCommitHorizontal size={13} />
          {commit.slice(0, 7)}
          <i />L{source.startLine}–L{previewEnd}
          <i />
          <span className="repository-editor-selection">{lines.length} lines in preview</span>
        </span>
        <a href={source.url} target="_blank" rel="noreferrer">
          View full source <ExternalLink size={12} />
        </a>
      </div>
      {truncated && (
        <div className="repository-source-notice">
          Saved preview only. Open GitHub to read the complete source (lines {source.startLine}–
          {source.endLine}).
        </div>
      )}
      {(copied || copyError) && (
        <div className="repository-source-feedback" role="status">
          {copied
            ? 'Source excerpt copied.'
            : 'Clipboard is unavailable. Select the code and copy it manually.'}
        </div>
      )}
    </div>
  );
  return (
    <>
      {render(false)}
      <Modal
        open={expanded}
        onOpenChange={setExpanded}
        title={name || 'Source code'}
        description={`Source preview at commit ${commit.slice(0, 12)}. ${source.file}`}
        className="repository-source-dialog"
      >
        {render(true)}
      </Modal>
    </>
  );
}
