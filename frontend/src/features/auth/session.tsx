import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, use, type ReactNode } from "react";

import { api, ApiError, ensureCsrf, setActiveOrganization, unwrap, type User } from "../../api/client";

interface Session {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);
export const meKey = ["me"] as const;

async function fetchMe(): Promise<User | null> {
  try {
    return await unwrap(api.GET("/api/v1/auth/me"));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: 60_000, retry: false });

  const login = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      await ensureCsrf();
      return unwrap(api.POST("/api/v1/auth/login", { body: { email, password } }));
    },
    onSuccess: (user) => queryClient.setQueryData(meKey, user),
  });

  const logout = useMutation({
    mutationFn: async () => {
      await ensureCsrf();
      await unwrap(api.POST("/api/v1/auth/logout"));
    },
    onSettled: () => {
      setActiveOrganization(null);
      queryClient.clear();
      queryClient.setQueryData(meKey, null);
    },
  });

  const value: Session = {
    user: me.data ?? null,
    isLoading: me.isPending,
    signIn: (email, password) => login.mutateAsync({ email, password }),
    signOut: () => logout.mutateAsync(),
  };
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error("useSession must be used inside <SessionProvider>");
  return session;
}
