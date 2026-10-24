import { LoaderCircle, Sparkles, RefreshCw, ExternalLink } from 'lucide-react';
import type { GeneratedGuide as Guide } from '../services/generatedGuides';
import '../styles/generated-guides.css';

export function GeneratedGuide({
  guide,
  loading,
  error,
  retry,
}: {
  guide: Guide | null;
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  return (
    <div className="gemini-guide" data-generated-snapshot={guide?.snapshotId}>
      <div className="gemini-guide-heading">
        <Sparkles size={15} />
        <strong>Gemini documentation</strong>
        {guide && <span>Source-linked explanation</span>}
      </div>
      {loading && (
        <div className="gemini-guide-loading" role="status">
          <LoaderCircle size={16} />
          <div>
            Reading the code and writing your guide…
            <small>This can take a moment. Completed guides are saved for this commit.</small>
          </div>
        </div>
      )}
      {error && (
        <div className="gemini-guide-error" role="status">
          <p>{error}</p>
          <button onClick={retry}>
            <RefreshCw size={12} />
            Retry generation
          </button>
        </div>
      )}
      {guide && (
        <>
          {guide.sections.map((section, i) => (
            <section key={i} className="gemini-guide-section">
              <h3>{section.title}</h3>
              <p>{section.content}</p>
              <div className="gemini-guide-citations">
                {section.referenceIds.map((id) => {
                  const reference = guide.citations.find((c) => c.id === id);
                  return reference ? (
                    <a
                      href={reference.url}
                      key={id}
                      target="_blank"
                      rel="noreferrer"
                      title={reference.file}
                    >
                      {reference.file.split('/').pop()}:{reference.startLine}–{reference.endLine}
                      <ExternalLink size={10} />
                    </a>
                  ) : null;
                })}
              </div>
            </section>
          ))}
          <footer>
            Generated from the analyzed commit. Review interpretations against the source.
            {guide.contextLimited
              ? ' Large source contexts are sampled; this guide is not an exhaustive audit.'
              : ''}
          </footer>
        </>
      )}
    </div>
  );
}
