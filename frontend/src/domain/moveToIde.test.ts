import { describe, expect, it } from 'vitest';
import { moveToIdeUri } from './moveToIde';
const source = {file:'src/routes/signup.ts',startLine:19,endLine:24,url:`https://github.com/Owner/Repo/blob/${'a'.repeat(40)}/src/routes/signup.ts#L19-L24`};
const target={snapshotId:'snapshot-123',repository:'https://github.com/owner/repo',commit:'a'.repeat(40)};
describe('Move to IDE source identity', () => {
  it('preserves absolute excerpt offsets and immutable identity', () => {
    const uri = new URL(moveToIdeUri(source, 21,target));
    expect(uri.protocol).toBe('vscode:');
    expect(uri.pathname).toBe('/moveToSource');
    expect(uri.searchParams.get('snapshotId')).toBe('snapshot-123');
    expect(uri.searchParams.get('line')).toBe('21');
    expect(uri.searchParams.get('file')).toBe(source.file);
    expect(uri.searchParams.get('repository')).toBe('https://github.com/owner/repo');
    expect(uri.searchParams.get('commit')).toBe('a'.repeat(40));
  });
  it('rejects missing, invalid or conflicting snapshot targets',()=>{
    for(const changed of [{snapshotId:''},{snapshotId:'../bad'},{commit:'b'.repeat(40)},{repository:'https://github.com/other/repo'}])
      expect(()=>moveToIdeUri(source,21,{...target,...changed})).toThrow();
    expect(()=>moveToIdeUri(source,21,undefined as never)).toThrow();
  });
  it('rejects unpinned, unrelated, unsafe and out-of-range targets', () => {
    for (const changed of [{url:source.url.replace('a'.repeat(40),'main')},{url:source.url.replace('github.com','other.example')},{file:'../secret'},{file:'src/other.ts'},{file:'C:/secret'},{file:'src/%2e%2e/secret'}])
      expect(() => moveToIdeUri({...source,...changed},21,target)).toThrow();
    for(const line of [0,1,25,21.5,NaN]) expect(() => moveToIdeUri(source,line,target)).toThrow();
  });
});
