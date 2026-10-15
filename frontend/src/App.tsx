import { Suspense, lazy } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { WorkspaceProvider } from './state/WorkspaceContext';
const Workspace = lazy(() => import('./pages/Workspace'));

const Repository = lazy(() => import('./pages/Repository'));
const Journeys = lazy(() => import('./pages/Journeys'));
const Learn = lazy(() => import('./pages/Learn'));
const Practice = lazy(() => import('./pages/Practice'));
const Changes = lazy(() => import('./pages/Changes'));
const Knowledge = lazy(() => import('./pages/Knowledge'));
const Progress = lazy(() => import('./pages/Progress'));

export default function App() {
  return (
    <WorkspaceProvider>
      <HashRouter>
        <a
          href="#main-content"
          className="skip-link"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('main-content')?.focus();
          }}
        >
          Skip to content
        </a>
        <Suspense
          fallback={
            <div className="app-loading">
              <span className="loading-spinner" />
              Opening your workspace…
            </div>
          }
        >
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Navigate to="/workspace" replace />} />
              <Route path="workspace" element={<Workspace />} />
              <Route path="repository" element={<Repository />} />
              <Route path="journeys" element={<Journeys />} />
              <Route path="learn" element={<Learn />} />
              <Route path="practice" element={<Practice />} />
              <Route path="changes" element={<Changes />} />
              <Route path="knowledge" element={<Knowledge />} />
              <Route path="progress" element={<Progress />} />
              <Route path="*" element={<Navigate to="/workspace" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </WorkspaceProvider>
  );
}
