import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, type RouteObject } from "react-router";

import { ApiError } from "../api/client";
import { LoginPage } from "../features/auth/LoginPage";
import { SessionProvider, useSession } from "../features/auth/session";
import { CreateOrganizationDialog } from "../features/orgs/CreateOrganizationDialog";
import { OrganizationProvider, useOrganization } from "../features/orgs/organization";
import { MembersPage, NoOrganizationPage, OverviewPage, SettingsPage } from "../features/orgs/pages";
import { AppShell } from "../shared/layout/AppShell";
import { Button, PageLoading, StateMessage } from "../shared/ui/primitives";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Never retry auth/permission/not-found answers; retry transient failures once.
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
        refetchOnWindowFocus: false,
      },
    },
  });
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
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/overview" replace /> },
          { path: "/overview", element: <OverviewPage /> },
          { path: "/members", element: <MembersPage /> },
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
      <SessionProvider>{children}</SessionProvider>
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
