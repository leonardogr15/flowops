import createClient, { type Middleware } from "openapi-fetch";

import type { components, paths } from "./schema";

export type User = components["schemas"]["User"];
export type MyMembership = components["schemas"]["MyMembership"];
export type Member = components["schemas"]["Member"];
export type CurrentOrganization = components["schemas"]["CurrentOrganization"];
export type Role = MyMembership["role"];

/** RFC 9457 problem returned by the API for every error. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors?: Record<string, string[]>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail);
    this.name = "ApiError";
    this.status = problem.status;
    this.problem = problem;
  }

  fieldError(field: string): string | undefined {
    return this.problem.errors?.[field]?.[0];
  }
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
let activeOrganization: string | null = null;

/** The organization slug sent as X-Organization on tenant-scoped requests. */
export function setActiveOrganization(slug: string | null): void {
  activeOrganization = slug;
}

export function readCookie(name: string): string | null {
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

const headers: Middleware = {
  onRequest({ request }) {
    if (UNSAFE.has(request.method)) {
      const token = readCookie("csrftoken");
      if (token) request.headers.set("X-CSRFToken", token);
    }
    if (activeOrganization && !request.headers.has("X-Organization")) {
      request.headers.set("X-Organization", activeOrganization);
    }
    return request;
  },
};

// Absolute same-origin URL: identical in the browser, and valid for fetch outside it (tests).
export const api = createClient<paths>({
  baseUrl: globalThis.location?.origin ?? "",
  credentials: "same-origin",
  fetch: (request) => globalThis.fetch(request), // resolved per call, so instrumentation and mocks apply
});
api.use(headers);

function toProblem(status: number, body: unknown): Problem {
  if (body && typeof body === "object" && "status" in body && "detail" in body) return body as Problem;
  return { type: "about:blank", title: "Request failed", status, detail: "The server could not complete the request." };
}

/** Unwraps an openapi-fetch result, throwing ApiError with the server's problem details. */
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await promise;
  } catch {
    throw new ApiError({
      type: "about:blank",
      title: "Network error",
      status: 0,
      detail: "Could not reach FlowOps. Check your connection and try again.",
    });
  }
  if (!result.response.ok) throw new ApiError(toProblem(result.response.status, result.error));
  return result.data as T;
}

/** Ensures the CSRF cookie exists before the first unsafe request. */
export async function ensureCsrf(): Promise<void> {
  if (!readCookie("csrftoken")) await unwrap(api.GET("/api/v1/auth/csrf"));
}
