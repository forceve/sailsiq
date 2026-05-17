import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { WorkspaceProvider } from '@/context/WorkspaceContext';
import { ThemeProvider } from '@/theme/ThemeContext';
import AppShell from '@/components/AppShell';
import HomePage from '@/pages/HomePage';
import NewSessionPage from '@/pages/NewSessionPage';
import ReplayWorkspacePage from '@/pages/ReplayWorkspacePage';
import ExportSharePage from '@/pages/ExportSharePage';
import SettingsPage from '@/pages/SettingsPage';
import NotFoundPage from '@/pages/NotFoundPage';
import CanvasWorkspacePage from '@/pages/CanvasWorkspacePage';

function ShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <BrowserRouter>
          <Routes>
            {/* Replay workspace uses its own full-screen layout */}
            <Route
              path="/session/:sessionId/replay"
              element={<ReplayWorkspacePage />}
            />
            {/* Canvas workspace: manual drawing mode */}
            <Route
              path="/session/:sessionId/canvas"
              element={<CanvasWorkspacePage />}
            />

            {/* All other pages wrapped in AppShell */}
            <Route element={<ShellLayout />}>
              <Route index element={<HomePage />} />
              <Route path="/new" element={<NewSessionPage />} />
              <Route
                path="/session/:sessionId/export"
                element={<ExportSharePage />}
              />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
