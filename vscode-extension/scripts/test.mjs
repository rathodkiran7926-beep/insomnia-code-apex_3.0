import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
await build({
  stdin: { contents: "export * from './src/api-client/client'; export * from './src/connection'; export * from './src/repository'; export * from './src/repositoryController'; export * from './src/api-client/mentorContracts'; export * from './src/mentorController'; export * from './src/views/mentorContent';", resolveDir: process.cwd() },
  outfile: '.test-output/library.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
});
await build({
  stdin: { contents: "export {activate} from './src/extension'; export * from './src/vscode-adapters/workspaceContext'; export * from './src/vscode-adapters/gitContext'; export * from './src/vscode-adapters/editorContext'; export * from './src/vscode-adapters/sourceNavigation'; import editor from './test/vscode-stub.cjs'; export {editor};", resolveDir: process.cwd() },
  outfile: '.test-output/activation.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  plugins: [{ name: 'editor-api-substitute', setup(builder) {
    builder.onResolve({ filter: /^vscode$/ }, () => ({ path: path.resolve('test/vscode-stub.cjs') }));
  } }],
});
const result = spawnSync(process.execPath, ['--test', 'test/client.test.cjs', 'test/connection.test.cjs', 'test/backend-integration.test.cjs', 'test/activation.test.cjs', 'test/repository.test.cjs', 'test/adapters.test.cjs', 'test/bindings.test.cjs', 'test/mentor-contracts.test.cjs', 'test/mentor-controller.test.cjs', 'test/source-navigation.test.cjs', 'test/mentor-render.test.cjs', 'test/mentor-client.test.cjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
