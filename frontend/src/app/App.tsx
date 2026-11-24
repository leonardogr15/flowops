import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, type RouteObject } from "react-router";

import { ApiError } from "../api/client";
import { LoginPage } from "../features/auth/LoginPage";
import { handleUnauthorized, SessionProvider, useSession } from "../features/auth/session";
import { CreateOrganizationDialog } from "../features/orgs/CreateOrganizationDialog";
import { OrganizationProvider, useOrganization } from "../features/orgs/organization";
import { NoOrganizationPage, OverviewPage, SettingsPage } from "../features/orgs/pages";
import { AcceptInvitationPage } from "../features/people/AcceptInvitationPage";
import { MembersPage } from "../features/people/MembersPage";
import { TemplatePage } from "../features/workflows/TemplatePage";
import { AuditPage } from "../features/audit/AuditPage";
import { InboxPage } from "../features/requests/InboxPage";
import { RequestDetailPage } from "../features/requests/RequestDetailPage";
import { RequestForm } from "../features/requests/RequestForm";
import { RequestsPage } from "../features/requests/RequestsPage";
import { WorkflowsPage } from "../features/workflows/WorkflowsPage";
import { NoticeProvider } from "../shared/ui/overlays";
import { AppShell } from "../shared/layout/AppShell";
import { Button, PageLoading, StateMessage } from "../shared/ui/primitives";

export function makeQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    // FE-01: any 401 after sign-in ends the session in the UI too (see handleUnauthorized).
    queryCache: new QueryCache({ onError: (error) => handleUnauthorized(client, error) }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => handleUnauthorized(client, error, mutation.meta?.authFlow === true),
    }),
    defaultOptions: {
      queries: {
        // Never retry auth/permission/not-found answers; retry transient failures once.
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
        refetchOnWindowFocus: false,
      },
    },
  });
  return client;
}

/** Redirects anonymous visitors to /login, remembering where they wanted to go. */
export function RequireAuth() {
  const { user, isLoading } = useSession();
  const location = useLocation();
  if (isLoading) return <PageLoading label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <OrganizationProvider>
      <RequireOrganization />
    </OrganizationProvider>
  );
}

function RequireOrganization() {
  const { active, isLoading, error } = useOrganization();
  if (isLoading) return <PageLoading label="Loading your organizations" />;
  if (error) return <StateMessage tone="error" title="Your organizations didn't load">Reload the page to try again.</StateMessage>;
  if (!active) return <NoOrganizationPage onCreate={<CreateOrganizationDialog trigger={<Button>Create an organization</Button>} />} />;
  return <Outlet />;
}

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/invite/:token", element: <AcceptInvitationPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/overview" replace /> },
          { path: "/overview", element: <OverviewPage /> },
          { path: "/requests", element: <RequestsPage /> },
          { path: "/requests/new", element: <RequestForm /> },
          { path: "/requests/:id", element: <RequestDetailPage /> },
          { path: "/requests/:id/edit", element: <RequestDetailPage editing /> },
          { path: "/inbox", element: <InboxPage /> },
          { path: "/audit", element: <AuditPage /> },
          { path: "/members", element: <MembersPage /> },
          { path: "/workflows", element: <WorkflowsPage /> },
          { path: "/workflows/new", element: <TemplatePage /> },
          { path: "/workflows/:id", element: <TemplatePage /> },
          { path: "/settings", element: <SettingsPage /> },
          { path: "*", element: <StateMessage title="Page not found">Use the navigation to find what you need.</StateMessage> },
        ],
      },
    ],
  },
];

export function Providers({ client, children }: { client: QueryClient; children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <NoticeProvider>{children}</NoticeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

const router = createBrowserRouter(routes);
const queryClient = makeQueryClient();

export function App() {
  return (
    <Providers client={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  );
}
