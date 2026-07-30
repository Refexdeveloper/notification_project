import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import ApplicationsPage from "@/pages/applications/page";
import ApplicationDetail from "@/pages/applications/detail/page";
import ResourceWorkspacePage from "@/pages/applications/resource-workspace/page";
import DataformRedirect from "@/pages/applications/DataformRedirect";
import TemplatesPage from "@/pages/templates/page";
import TemplateDetailPage from "@/pages/templates/detail/page";
import SchedulersPage from "@/pages/schedulers/page";
import SchedulerDetailPage from "@/pages/schedulers/detail/page";
import HistoryPage from "@/pages/history/page";
import LogsPage from "@/pages/logs/page";
import AuditLogsPage from "@/pages/audit-logs/page";
import SettingsPage from "@/pages/settings/page";
import LoginPage from "@/pages/login/page";
import NotFound from "@/pages/NotFound";

const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/", element: <Navigate to="/applications" replace /> },
  { path: "/applications", element: <ApplicationsPage /> },
  {
    path: "/applications/:id/resources/:resourceId",
    element: <ResourceWorkspacePage />,
  },
  {
    path: "/applications/:id/dataforms/:formId",
    element: <DataformRedirect />,
  },
  { path: "/applications/:id", element: <ApplicationDetail /> },
  { path: "/templates/:id", element: <TemplateDetailPage /> },
  { path: "/templates", element: <TemplatesPage /> },
  { path: "/schedulers/:id", element: <SchedulerDetailPage /> },
  { path: "/schedulers", element: <SchedulersPage /> },
  { path: "/history", element: <HistoryPage /> },
  { path: "/logs", element: <LogsPage /> },
  { path: "/audit-logs", element: <AuditLogsPage /> },
  { path: "/settings", element: <SettingsPage /> },
  { path: "*", element: <NotFound /> },
];

export default routes;
