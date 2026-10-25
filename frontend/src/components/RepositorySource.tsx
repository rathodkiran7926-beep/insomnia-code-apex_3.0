import { useMemo, useRef, useState, useEffect, type CSSProperties } from 'react';
import Prism from 'prismjs';
import { createPortal } from 'react-dom';
import { useDelayedHover } from './useDelayedHover';
import { moveToIdeUri, type IdeTarget } from '../domain/moveToIde';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import {
  Check,
  Search,
  ChevronUp,
  ChevronDown,
  Download,
  Copy,
  ExternalLink,
  FileCode2,
  GitCommitHorizontal,
  Maximize2,
  WrapText,
} from 'lucide-react';
import { Modal } from './UI';
import '../styles/repository-source.css';

type StoredSource = {
  file: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  url: string;
  complete?: boolean;
  linkLabel?: string;
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
export function RepositorySource({
  source,
  commit,
  focusRange,
  onLineSelect,
  annotationLines = [],
  secondaryRange,
  navigationRange,
  versionLabel = 'commit',
  compact = false,
  ideTarget,
}: {
  source?: StoredSource;
  commit: string;
  focusRange?: { startLine: number; endLine: number };
  onLineSelect?: (line: number, extend: boolean) => void;
  annotationLines?: number[];
  secondaryRange?: { startLine: number; endLine: number };
  navigationRange?: { startLine: number; endLine: number };
  versionLabel?: 'commit' | 'source hash';
  compact?: boolean;
  ideTarget?: IdeTarget;
}) {
  const viewer = useRef<HTMLDivElement>(null);
  const ideHover = useDelayedHover<number>(`${ideTarget?.snapshotId}:${ideTarget?.repository}:${ideTarget?.commit}:${source?.url}:${source?.file}:${source?.excerpt}`);
  const usableIdeTarget = useMemo(() => {
    if (!source || !ideTarget) return undefined;
    try { moveToIdeUri(source, source.startLine, ideTarget); return ideTarget; }
    catch { return undefined; }
  }, [source, ideTarget]);
  const ideButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // The browser top layer escapes transformed/clipped parent dialogs while
    // keeping the action inside their accessible React/DOM focus scope.
    const popup = ideHover.popover.current;
    if (popup && typeof popup.showPopover === 'function' && !popup.matches(':popover-open')) popup.showPopover();
  }, [ideHover.active]);
  const [ideNotice, setIdeNotice] = useState('');
  useEffect(() => { setIdeNotice(''); }, [source?.url]);
  const expandedViewer = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [find, setFind] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [lineInput, setLineInput] = useState('');
  const [fontSize, setFontSize] = useState(14);
  const [jumpLine, setJumpLine] = useState<number | null>(null);
  const [lineError, setLineError] = useState('');
  const findInput = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    if (!find.trim() || !source) return [];
    return source.excerpt
      .split('\n')
      .flatMap((line, i) =>
        line.toLowerCase().includes(find.toLowerCase()) ? [source.startLine + i] : [],
      );
  }, [find, source]);
  useEffect(() => {
    setMatchIndex(0);
  }, [find, source?.file]);
  useEffect(() => {
    if (!expanded) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        findInput.current?.focus();
        findInput.current?.select();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [expanded]);
  useEffect(() => {
    setJumpLine(null);
    setLineInput('');
    setLineError('');
  }, [source?.file]);
  const matchLines = useMemo(() => new Set(matches), [matches]);
  const activeMatch = matches[matchIndex % (matches.length || 1)];
  function revealLine(line: number, focus = false) {
    const root = expandedViewer.current;
    const scroll = root?.querySelector<HTMLElement>('.repository-source-scroll');
    const target = root?.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (scroll && target) {
      scroll.scrollTop +=
        target.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top -
        scroll.clientHeight / 3;
      if (focus) scroll.focus();
    }
  }
  useEffect(() => {
    if (!expanded || activeMatch === undefined) return;
    const frame = requestAnimationFrame(() => revealLine(activeMatch));
    return () => cancelAnimationFrame(frame);
  }, [expanded, activeMatch]);
  function stepMatch(delta: number) {
    setMatchIndex((index) =>
      matches.length ? (index + delta + matches.length) % matches.length : 0,
    );
  }
  function downloadSource() {
    if (!source) return;
    const url = URL.createObjectURL(
      new Blob([source.excerpt], { type: 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download =
      (source.file.split('/').pop() || 'source') + (source.complete ? '' : '.excerpt.txt');
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function showSelection(root: HTMLDivElement | null) {
    const line =
      (navigationRange &&
        root?.querySelector<HTMLElement>(`[data-line="${navigationRange.startLine}"]`)) ||
      root?.querySelector<HTMLElement>('.source-focused-line');
    const scroll = root?.querySelector<HTMLElement>('.repository-source-scroll');
    if (line && scroll)
      scroll.scrollTop +=
        line.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 70;
  }
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!expanded || !matches.length)
        showSelection(expanded ? expandedViewer.current : viewer.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    source?.file,
    source?.excerpt,
    focusRange?.startLine,
    focusRange?.endLine,
    navigationRange?.startLine,
    navigationRange?.endLine,
    expanded,
  ]);
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
  const truncated =
    !source.complete && (previewEnd < source.endLine || source.excerpt.length >= 1800);
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
      className={`repository-source ${wrap ? 'source-wrapped' : ''} ${large ? 'source-expanded' : ''} ${compact && !large ? 'source-compact' : ''}`}
      ref={large ? expandedViewer : viewer}
      data-source-complete={source.complete ? 'true' : 'false'}
      style={large ? ({ '--source-font-size': `${fontSize}px` } as CSSProperties) : undefined}
    >
      <div className="repository-source-toolbar">
        <span>
          <span className="repository-editor-file-icon">
            {language === 'typescript' || language === 'tsx' ? 'TS' : 'JS'}
          </span>
          <strong title={source.file}>{name}</strong>
          <span className="repository-editor-readonly">Read only</span>
        </span>
        <div className="repository-source-selection">
          <span>
            {source.complete ? 'Complete file' : 'Saved excerpt'}
            {focusRange && (
              <>
                {' '}
                · Selected lines {focusRange.startLine}–{focusRange.endLine}
              </>
            )}
          </span>
          {focusRange && (
            <button onClick={() => showSelection(large ? expandedViewer.current : viewer.current)}>
              Jump to selection
            </button>
          )}
        </div>
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
            aria-label="Copy source code"
            title={copied ? 'Copied' : 'Copy displayed code'}
            onClick={() => void copy()}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          {large && (
            <>
              <button
                aria-label="Decrease code font size"
                disabled={fontSize <= 11}
                onClick={() => setFontSize((size) => Math.max(11, size - 1))}
              >
                A-
              </button>
              <span className="source-font-size" aria-live="polite">
                {fontSize}px
              </span>
              <button
                aria-label="Increase code font size"
                disabled={fontSize >= 20}
                onClick={() => setFontSize((size) => Math.min(20, size + 1))}
              >
                A+
              </button>
              <button
                aria-label={source.complete ? 'Download source file' : 'Download saved excerpt'}
                onClick={downloadSource}
              >
                <Download size={15} />
              </button>
            </>
          )}
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
      {large && (
        <div className="source-reading-tools">
          <div className="source-find-controls">
            <label className="source-find-field">
              <Search size={14} />
              <input
                ref={findInput}
                aria-label="Find in source"
                placeholder="Find in this file"
                value={find}
                onChange={(event) => setFind(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    stepMatch(event.shiftKey ? -1 : 1);
                  }
                }}
              />
            </label>
            <span className="source-match-count" role="status">
              {find
                ? matches.length
                  ? `${(matchIndex % matches.length) + 1} / ${matches.length} lines`
                  : 'No matches'
                : 'Ctrl/Cmd+F'}
            </span>
            <button
              aria-label="Previous matching line"
              disabled={!matches.length}
              onClick={() => stepMatch(-1)}
            >
              <ChevronUp size={15} />
            </button>
            <button
              aria-label="Next matching line"
              disabled={!matches.length}
              onClick={() => stepMatch(1)}
            >
              <ChevronDown size={15} />
            </button>
          </div>
          <form
            className="source-go-to-line"
            onSubmit={(event) => {
              event.preventDefault();
              const line = Number(lineInput);
              if (!Number.isInteger(line) || line < source.startLine || line > previewEnd) {
                setLineError(`Enter a line from ${source.startLine} to ${previewEnd}.`);
                return;
              }
              setLineError('');
              setJumpLine(line);
              revealLine(line, true);
            }}
          >
            <input
              aria-label="Go to source line"
              aria-invalid={!!lineError}
              aria-describedby={lineError ? 'source-line-error' : undefined}
              type="number"
              min={source.startLine}
              max={previewEnd}
              placeholder="Line"
              value={lineInput}
              onChange={(event) => {
                setLineInput(event.target.value);
                setLineError('');
              }}
            />
            <button type="submit">Go to line</button>
          </form>
          {lineError && (
            <span id="source-line-error" className="source-line-error" role="alert">
              {lineError}
            </span>
          )}
        </div>
      )}
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
        aria-label={`Source code: ${source.file}, lines ${source.startLine} to ${previewEnd}`}
        tabIndex={0}
      >
        <pre>
          {lines.map((segments, i) => (
            <div
              className={`repository-source-line ${secondaryRange && source.startLine + i >= secondaryRange.startLine && source.startLine + i <= secondaryRange.endLine ? 'source-review-line' : ''} ${large && matchLines.has(source.startLine + i) ? 'source-search-match' : ''} ${large && activeMatch === source.startLine + i ? 'source-active-match' : ''} ${large && jumpLine === source.startLine + i ? 'source-jump-line' : ''} ${focusRange && source.startLine + i >= focusRange.startLine && source.startLine + i <= focusRange.endLine ? `source-focused-line${source.startLine + i === focusRange.startLine ? ' source-focus-start' : ''}` : ''}`}
              key={i}
              data-line={source.startLine + i}
              aria-label={
                focusRange &&
                source.startLine + i >= focusRange.startLine &&
                source.startLine + i <= focusRange.endLine
                  ? `Selected line ${source.startLine + i}`
                  : undefined
              }
            >
                <button
                  type="button"
                  className="repository-source-number source-select-line"
                  aria-label={`${annotationLines.includes(source.startLine + i) ? 'Annotated line' : onLineSelect ? 'Select line' : 'Source line'} ${source.startLine + i}`}
                  aria-haspopup={usableIdeTarget ? 'dialog' : undefined}
                  aria-expanded={usableIdeTarget ? ideHover.active?.value === source.startLine + i : undefined}
                  onMouseEnter={(e) => { if (usableIdeTarget) ideHover.enter(source.startLine + i, e.currentTarget); }}
                  onMouseLeave={ideHover.leave}
                  onFocus={(e) => { if (usableIdeTarget) ideHover.enter(source.startLine + i, e.currentTarget); }}
                  onPointerUp={(e) => { if (e.pointerType === 'touch' && usableIdeTarget) ideHover.show(source.startLine + i, e.currentTarget, true); }}
                  onBlur={(e) => { if (e.relatedTarget !== ideButton.current) ideHover.leave(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ideHover.close(); }
                    if (ideHover.active?.value === source.startLine + i && (e.key === 'ArrowDown' || e.key === 'Tab' && !e.shiftKey)) {
                      e.preventDefault(); e.stopPropagation(); ideButton.current?.focus();
                    }
                  }}
                  onClick={(e) => {
                    onLineSelect?.(source.startLine + i, e.shiftKey);
                    if (usableIdeTarget) ideHover.show(source.startLine + i, e.currentTarget, true);
                  }}
                >
                  {annotationLines.includes(source.startLine + i) ? '● ' : ''}
                  {source.startLine + i}
                </button>
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
          <span className="repository-editor-selection">
            {lines.length} lines · {source.complete ? 'Full file' : 'Excerpt'}
          </span>
        </span>
        <a href={source.url} target="_blank" rel="noreferrer">
          {source.linkLabel || 'Open on GitHub'} <ExternalLink size={12} />
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
            ? 'Source code copied.'
            : 'Clipboard is unavailable. Select the code and copy it manually.'}
        </div>
      )}
      {ideNotice && <div className="repository-source-feedback" role="status">{ideNotice}</div>}
    </div>
  );
  const ideAction = ideHover.active && usableIdeTarget && (
        <div
          className="source-ide-popover"
          popover="manual"
          ref={ideHover.popover}
          role="dialog"
          aria-label="Source line actions"
          style={{
            left: ideHover.active.left,
            top: ideHover.active.top,
          }}
          onMouseEnter={ideHover.keep}
          onMouseLeave={ideHover.leave}
          onFocus={ideHover.keep}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) ideHover.leave(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault(); e.stopPropagation(); ideHover.active?.trigger.focus(); ideHover.close();
            }
          }}
        >
          <button type="button" ref={ideButton} onClick={(e) => {
            e.stopPropagation();
            try {
              const uri = moveToIdeUri(source, ideHover.active!.value, usableIdeTarget);
              window.location.assign(uri);
              setIdeNotice('VS Code requested. If it does not open, install the Codebase Mentor extension and allow your browser to open VS Code. Connect the matching repository snapshot in the extension.');
            } catch (error) { setIdeNotice(error instanceof Error ? error.message : 'IDE navigation is unavailable.'); }
            ideHover.close();
          }}>Move to IDE</button>
        </div>
      );
  // Keep dialog actions in their React focus scope; portal only the normal reader.
  const idePopover = ideAction && ideHover.active &&
    (ideHover.active.trigger.closest('.dialog') ? ideAction : createPortal(ideAction, document.body));
  return (
    <>
      {render(false)}
      {!expanded && idePopover}
      <Modal
        open={expanded}
        onOpenChange={setExpanded}
        title={name || 'Source code'}
        description={`${source.complete ? 'Complete file' : 'Saved excerpt'} at ${versionLabel} ${commit.slice(0, 12)}. ${source.file}`}
        className="repository-source-dialog"
      >
        {render(true)}
        {expanded && idePopover}
      </Modal>
    </>
  );
}
