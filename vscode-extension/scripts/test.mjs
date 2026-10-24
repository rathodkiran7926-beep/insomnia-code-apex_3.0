import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
await build({
  stdin: { contents: "export * from './src/api-client/client'; export * from './src/connection'; export * from './src/repository'; export * from './src/repositoryController'; export * from './src/api-client/mentorContracts'; export * from './src/mentorController'; export * from './src/views/mentorContent'; export * from './src/api-client/atlasContracts'; export * from './src/atlasController'; export * from './src/api-client/prContracts'; export * from './src/prController'; export * from './src/comparisonContexts'; export * from './src/api-client/checkpointContracts'; export * from './src/checkpointController'; export * from './src/handoffController'; export * from './src/api-client/handoffContracts'; export * from './src/views/handoffContent'; export * from './src/views/checkpointContent';", resolveDir: process.cwd() },
  outfile: '.test-output/library.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
});
await build({
  stdin: { contents: "export {activate} from './src/extension'; export * from './src/vscode-adapters/workspaceContext'; export * from './src/vscode-adapters/gitContext'; export * from './src/vscode-adapters/editorContext'; export * from './src/vscode-adapters/sourceNavigation'; export * from './src/views/atlasTree'; export * from './src/commands/atlasCommands'; export * from './src/views/changesTree'; export * from './src/views/savedTasks'; export * from './src/commands/handoffCommands'; export * from './src/views/handoffPanel'; export * from './src/views/savedHandoffs'; export * from './src/views/mentorTree'; export * from './src/views/checkpointPanel'; export * from './src/commands/checkpointCommands'; export * from './src/commands/prCommands'; import editor from './test/vscode-stub.cjs'; export {editor};", resolveDir: process.cwd() },
  outfile: '.test-output/activation.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  plugins: [{ name: 'editor-api-substitute', setup(builder) {
    builder.onResolve({ filter: /^vscode$/ }, () => ({ path: path.resolve('test/vscode-stub.cjs') }));
  } }],
});
const result = spawnSync(process.execPath, ['--test', 'test/handoff-controller.test.cjs', 'test/handoff-actions.test.cjs', 'test/handoff-contracts.test.cjs', 'test/handoff-client.test.cjs', 'test/handoff-render.test.cjs', 'test/checkpoint-actions.test.cjs', 'test/checkpoint-controller.test.cjs', 'test/checkpoint-contracts.test.cjs', 'test/checkpoint-client.test.cjs', 'test/checkpoint-render.test.cjs', 'test/pr-actions.test.cjs', 'test/changes-tree.test.cjs', 'test/pr-controller.test.cjs', 'test/pr-contracts.test.cjs', 'test/pr-client.test.cjs', 'test/comparison-context.test.cjs', 'test/atlas-ui.test.cjs', 'test/atlas-client.test.cjs', 'test/atlas-controller.test.cjs', 'test/atlas-contracts.test.cjs', 'test/client.test.cjs', 'test/connection.test.cjs', 'test/backend-integration.test.cjs', 'test/activation.test.cjs', 'test/repository.test.cjs', 'test/adapters.test.cjs', 'test/bindings.test.cjs', 'test/mentor-contracts.test.cjs', 'test/mentor-controller.test.cjs', 'test/source-navigation.test.cjs', 'test/mentor-render.test.cjs', 'test/mentor-client.test.cjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
