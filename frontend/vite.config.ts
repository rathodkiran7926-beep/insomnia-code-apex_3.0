import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'prism-explicit-core',
      enforce: 'pre',
      apply: 'build',
      transform(code, id) {
        // Prism 1.x grammars assume a free global. Bind the core explicitly so
        // production chunk evaluation cannot register a grammar before the core.
        // https://github.com/PrismJS/prism/issues/4088
        if (
          /\/prismjs\/components\/prism-(typescript|json|jsx|tsx)\.js$/.test(id.replace(/\\/g, '/'))
        ) {
          return { code: `import Prism from 'prismjs';\n${code}`, map: null };
        }
      },
    },
  ],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
});
