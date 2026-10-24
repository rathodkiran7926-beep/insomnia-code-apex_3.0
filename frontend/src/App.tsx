import { Suspense, lazy } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { WorkspaceProvider } from './state/WorkspaceContext';
import { RepositoryAnalysisProvider } from './state/RepositoryAnalysisContext';
import { CollaborationProvider } from './state/CollaborationContext';

const Home = lazy(() => import('./pages/Home'));
const Workspace = lazy(() => import('./pages/Workspace'));
const DemoWorkspace = lazy(() => import('./pages/DemoWorkspace'));
const Repository = lazy(() => import('./pages/Repository'));
const Journeys = lazy(() => import('./pages/Journeys'));
const PreparedJourneys = lazy(() => import('./pages/PreparedJourneys'));
const CodeJourneyTheater = lazy(() => import('./pages/CodeJourneyTheater'));
const Learn = lazy(() => import('./pages/Learn'));
const Practice = lazy(() => import('./pages/Practice'));
const Changes = lazy(() => import('./pages/Changes'));
const Knowledge = lazy(() => import('./pages/Knowledge'));
const Progress = lazy(() => import('./pages/Progress'));
const AgentContext = lazy(() => import('./pages/AgentContext'));
const PreparedAgentContext = lazy(() => import('./pages/PreparedAgentContext'));
const Handoffs = lazy(() => import('./pages/Handoffs'));
const TeamKnowledge = lazy(() => import('./pages/TeamKnowledge'));

export default function App() {
  return (
    <WorkspaceProvider>
      <RepositoryAnalysisProvider>
        <CollaborationProvider>
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
                  Opening Codebase Mentor…
                </div>
              }
            >
              <Routes>
                {/* Dedicated full-width Symboolic-inspired Home Screen */}
                <Route path="/" element={<Home />} />
                <Route path="/home" element={<Home />} />

                {/* Application Workspace Shell */}
                <Route element={<Shell />}>
                  <Route path="workspace" element={<Workspace />} />
                  <Route path="demo-workspace" element={<DemoWorkspace />} />
                  <Route path="repository" element={<Repository />} />
                  <Route path="journeys" element={<Journeys />} />
                  <Route path="journeys/:id" element={<CodeJourneyTheater />} />
                  <Route path="prepared-journeys" element={<PreparedJourneys />} />
                  <Route path="learn" element={<Learn />} />
                  <Route path="practice" element={<Practice />} />
                  <Route path="changes" element={<Changes />} />
                  <Route path="knowledge" element={<TeamKnowledge />} />
                  <Route path="knowledge-demo" element={<Knowledge />} />
                  <Route path="handoffs" element={<Handoffs />} />
                  <Route path="handoffs/:id" element={<Handoffs />} />
                  <Route path="progress" element={<Progress />} />
                  <Route path="agent-context" element={<AgentContext />} />
                  <Route path="agent-context-demo" element={<PreparedAgentContext />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </Suspense>
          </HashRouter>
        </CollaborationProvider>
      </RepositoryAnalysisProvider>
    </WorkspaceProvider>
  );
}
