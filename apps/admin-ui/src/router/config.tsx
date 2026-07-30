import { Navigate, type RouteObject } from "react-router-dom";
import PrototypeOnlyGate from "@/components/routing/PrototypeOnlyGate";
import ApplicationsPage from "@/pages/applications/page";
import ApplicationDetail from "@/pages/applications/detail/page";
import ResourceWorkspaceRoute from "@/components/routing/ResourceWorkspaceRoute";
import DataformRedirect from "@/pages/applications/DataformRedirect";
import TemplatesPage from "@/pages/templates/page";
import TemplateDetailPage from "@/pages/templates/detail/page";
import SchedulersPage from "@/pages/schedulers/page";
import SchedulerDetailPage from "@/pages/schedulers/detail/page";
import HistoryPage from "@/pages/history/page";
import LogsPage from "@/pages/logs/page";
import AuditLogsPage from "@/pages/audit-logs/page";
import SettingsPage from "@/pages/settings/page";
import UsersPage from "@/pages/users/page";
import LoginPage from "@/pages/login/page";
import NotFound from "@/pages/NotFound";

const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/", element: <Navigate to="/applications" replace /> },
  { path: "/applications", element: <ApplicationsPage /> },
  {
    path: "/applications/:id/resources/:resourceId",
    element: <ResourceWorkspaceRoute />,
  },
  {
    path: "/applications/:id/dataforms/:formId",
    element: <DataformRedirect />,
  },
  { path: "/applications/:id", element: <ApplicationDetail /> },
  { path: "/users", element: <UsersPage /> },
  { path: "/templates/:id", element: <TemplateDetailPage /> },
  {
    path: "/templates",
    element: (
      <PrototypeOnlyGate>
        <TemplatesPage />
      </PrototypeOnlyGate>
    ),
  },
  {
    path: "/schedulers/:id",
    element: (
      <PrototypeOnlyGate>
        <SchedulerDetailPage />
      </PrototypeOnlyGate>
    ),
  },
  {
    path: "/schedulers",
    element: (
      <PrototypeOnlyGate>
        <SchedulersPage />
      </PrototypeOnlyGate>
    ),
  },
  {
    path: "/history",
    element: (
      <PrototypeOnlyGate>
        <HistoryPage />
      </PrototypeOnlyGate>
    ),
  },
  { path: "/logs", element: <PrototypeOnlyGate><LogsPage /></PrototypeOnlyGate> },
  { path: "/audit-logs", element: <PrototypeOnlyGate><AuditLogsPage /></PrototypeOnlyGate> },
  {
    path: "/settings",
    element: (
      <PrototypeOnlyGate>
        <SettingsPage />
      </PrototypeOnlyGate>
    ),
  },
  { path: "*", element: <NotFound /> },
];

export default routes;
