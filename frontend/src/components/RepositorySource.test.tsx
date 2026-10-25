import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepositorySource } from './RepositorySource';
const commit='a'.repeat(40);
const source={file:'src/a.ts',startLine:180,endLine:181,excerpt:'export const a = 1;\nexport const b = 2;',url:`https://github.com/a/b/blob/${commit}/src/a.ts#L180-L181`};
const target={snapshotId:'snap',repository:'https://github.com/a/b',commit};
describe('source viewer IDE action availability',()=>{
  it('keeps real absolute line numbers without an IDE action when context is missing',()=>{
    const markup=renderToStaticMarkup(<RepositorySource source={source} commit={commit}/>);
    expect(markup).toContain('data-line="180"');expect(markup).not.toContain('aria-haspopup="dialog"');expect(markup).not.toContain('source-ide-popover');
  });
  it('enables the action only for source matching a supplied snapshot target',()=>{
    const markup=renderToStaticMarkup(<RepositorySource source={source} commit={commit} ideTarget={target}/>);
    expect(markup).toContain('aria-haspopup="dialog"');expect(markup).not.toContain('source-ide-popover');
    const wrong=renderToStaticMarkup(<RepositorySource source={source} commit={commit} ideTarget={{...target,commit:'b'.repeat(40)}}/>);
    expect(wrong).not.toContain('aria-haspopup="dialog"');
  });
});
