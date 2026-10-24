import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
const development = watch || process.argv.includes('--development');
const options = {
  entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js',
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  external: ['vscode'], sourcemap: development ? 'linked' : false,
  minify: !development, logLevel: 'info',
};
if (watch) {
  const builder = await context(options);
  await builder.watch();
} else {
  await build(options);
}
