import { useEffect, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import {
  Braces,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  FileCode2,
  GitCommitHorizontal,
  Link2,
} from 'lucide-react';
import type { Snapshot, SourceRef } from '../data/types';
import { versions } from '../data/fixtures';
import { resolveSource } from '../domain/model';
import { useWorkspace } from '../state/WorkspaceContext';
import { Badge, Button, IconButton } from './UI';

export function CodeViewer({
  source,
  snapshot,
  compact = false,
  title,
  fullFile = false,
}: {
  source?: SourceRef;
  snapshot?: Snapshot;
  compact?: boolean;
  title?: string;
  fullFile?: boolean;
}) {
  const { state, notify } = useWorkspace();
  const ref = source ?? state.source;
  const version = snapshot ?? state.snapshot;
  const resolved = resolveSource(version, ref);
  const [tab, setTab] = useState<'source' | 'evidence'>('source');
  const [all, setAll] = useState(fullFile);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setTab('source');
    setCollapsed(false);
  }, [ref.path, ref.start, ref.end, version, state.sourceFocusKey]);
  useEffect(() => {
    const container = scroll.current;
    const highlighted = container?.querySelector('.code-line.highlighted');
    if (!container || !highlighted || tab !== 'source' || collapsed) return;
    container.scrollTop +=
      highlighted.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
  }, [ref.path, ref.start, ref.end, version, state.sourceFocusKey, all, collapsed, tab]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(resolved?.selected ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      notify('Clipboard access is unavailable in this browser. Select and copy the source text.');
    }
  }
  if (
    !source &&
    !state.journeyId &&
    (state.selectedNode === 'client' ||
      (state.selectedNode === 'email' && state.snapshot === 'base'))
  )
    return (
      <section className="panel code-panel">
        <div className="empty-state">
          <Link2 size={25} />
          <strong>
            {state.selectedNode === 'client'
              ? 'A conceptual external boundary'
              : 'Not part of the base snapshot'}
          </strong>
          <p>
            {state.selectedNode === 'client'
              ? 'No client source is included in this sample. Select a source-linked component to inspect its implementation.'
              : 'The email integration is introduced by PR #402. Switch to its head snapshot to inspect the prepared source.'}
          </p>
          <Badge>No source claim for this selection</Badge>
        </div>
      </section>
    );
  if (!resolved)
    return (
      <section className="panel code-panel">
        <div className="empty-state">
          <FileCode2 size={25} />
          <strong>Source is outside this snapshot</strong>
          <p>
            This reference cannot be resolved at {versions[version].commit}. Choose a supported
            source location.
          </p>
        </div>
      </section>
    );
  const start = all ? 0 : Math.max(0, ref.start - 2);
  const end = all ? resolved.lines.length : Math.min(resolved.lines.length, ref.end + 2);
  const language = ref.path.endsWith('.json')
    ? 'json'
    : ref.path.endsWith('.ts')
      ? 'typescript'
      : 'plain';
  return (
    <section className={`panel code-panel ${compact ? 'compact-code' : ''}`}>
      <div className="code-topbar">
        <div className="code-tabs">
          <button className={tab === 'source' ? 'active' : ''} onClick={() => setTab('source')}>
            <Code2 size={14} />
            {title ?? 'Source code'}
          </button>
          <button className={tab === 'evidence' ? 'active' : ''} onClick={() => setTab('evidence')}>
            <Link2 size={13} />
            Evidence
          </button>
        </div>
        <div className="row gap-8">
          <Badge>Sample source</Badge>
          <IconButton icon={copied ? Check : Copy} label="Copy selected source" onClick={copy} />
          <IconButton
            icon={collapsed ? ChevronDown : ChevronUp}
            label={collapsed ? 'Expand source panel' : 'Collapse source panel'}
            onClick={() => setCollapsed((x) => !x)}
          />
        </div>
      </div>
      {!collapsed && (
        <>
          {tab === 'source' ? (
            <>
              <div className="file-path">
                <FileCode2 size={14} className="violet-text" />
                <span>{ref.path}</span>
                <span className="file-range">
                  L{ref.start}–{ref.end}
                </span>
                <span className="code-language">
                  {language === 'typescript' && <span className="ts-icon">TS</span>}
                  {language === 'typescript' ? 'TypeScript' : 'Configuration'}
                </span>
              </div>
              <div
                className="code-scroll"
                ref={scroll}
                role="region"
                aria-label={`${ref.path}, highlighted lines ${ref.start} to ${ref.end}`}
                tabIndex={0}
              >
                <pre>
                  {resolved.lines.slice(start, end).map((line, i) => {
                    const number = start + i + 1;
                    return (
                      <div
                        key={number}
                        className={`code-line ${number >= ref.start && number <= ref.end ? 'highlighted' : ''}`}
                      >
                        <span className="line-number" aria-hidden="true">
                          {number}
                        </span>
                        <code
                          dangerouslySetInnerHTML={{
                            __html: Prism.languages[language]
                              ? Prism.highlight(line || ' ', Prism.languages[language], language)
                              : Prism.util.encode(line || ' '),
                          }}
                        />
                      </div>
                    );
                  })}
                </pre>
              </div>
              <div className="code-footer">
                <span>
                  <GitCommitHorizontal size={13} /> {versions[version].commit}
                  <span className="footer-dot">·</span>Demo revision
                </span>
                <button onClick={() => setAll((x) => !x)}>
                  {all ? 'Show relevant lines' : `View full file (${resolved.lines.length} lines)`}
                  <ChevronDown size={12} />
                </button>
              </div>
            </>
          ) : (
            <div className="evidence-content stack-16">
              <div className="row gap-8">
                <Badge tone="green">Source-supported within sample</Badge>
                <Badge>Not executed</Badge>
              </div>
              <p>
                This reference resolves to the prepared sample file below. It describes source
                behavior; it does not establish an observed runtime result.
              </p>
              <dl>
                <div>
                  <dt>Repository</dt>
                  <dd>acme/relay-api · synthetic fixture</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>
                    {versions[version].commit} · {versions[version].branch}
                  </dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{ref.path}</dd>
                </div>
                <div>
                  <dt>Inclusive range</dt>
                  <dd>
                    {ref.start}–{ref.end}
                  </dd>
                </div>
                <div>
                  <dt>Evidence kind</dt>
                  <dd>Code fixture · no observation ID</dd>
                </div>
              </dl>
              <Button variant="ghost" icon={Braces} onClick={() => setTab('source')}>
                Inspect the deciding code
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
