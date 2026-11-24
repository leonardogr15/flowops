/** In-memory fake of the FlowOps API used by component tests (shapes follow openapi.yaml). */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import type { Member, MyMembership, User } from "../api/client";

type Role = MyMembership["role"];

const ORGS = {
  "orbital-supplies": { id: "o1", name: "Orbital Supplies Co.", slug: "orbital-supplies", created_at: "2026-11-01T10:00:00Z" },
  "kestrel-analytics": { id: "o2", name: "Kestrel Analytics", slug: "kestrel-analytics", created_at: "2026-11-02T10:00:00Z" },
};

export const ADAM: User = { id: "u1", email: "adam.admin@flowops.test", full_name: "Adam Admin", date_joined: "2026-11-01T10:00:00Z" };

interface Db {
  sessionUser: User | null;
  memberships: Record<string, Role>; // slug -> role of the signed-in user
  orgRequests: string[]; // X-Organization header seen on tenant-scoped requests
}

export const db: Db = { sessionUser: null, memberships: {}, orgRequests: [] };

export function resetDb(): void {
  db.sessionUser = null;
  db.memberships = { "orbital-supplies": "admin", "kestrel-analytics": "member" };
  db.orgRequests = [];
}
resetDb();

const problem = (status: number, detail: string, extra: object = {}) =>
  HttpResponse.json({ type: "urn:flowops:problem:x", title: "Error", status, detail, instance: "/", ...extra }, { status });

function tenant(request: Request): { slug: string; role: Role } | Response {
  if (!db.sessionUser) return problem(401, "Authentication credentials were not provided.");
  const slug = request.headers.get("X-Organization") ?? "";
  db.orgRequests.push(slug);
  const role = db.memberships[slug];
  if (!role) return problem(404, "Organization not found.");
  return { slug, role };
}

export const handlers = [
  http.get("/api/v1/auth/csrf", () => {
    document.cookie = "csrftoken=test-csrf";
    return HttpResponse.json({ csrfToken: "test-csrf" });
  }),
  http.get("/api/v1/auth/me", () => (db.sessionUser ? HttpResponse.json(db.sessionUser) : problem(401, "Authentication credentials were not provided."))),
  http.post("/api/v1/auth/login", async ({ request }) => {
    if (request.headers.get("X-CSRFToken") !== "test-csrf") return problem(403, "CSRF Failed: CSRF token missing.");
    const body = (await request.json()) as { email: string; password: string };
    if (body.email !== ADAM.email || body.password !== "right-password") return problem(401, "Invalid email or password.");
    db.sessionUser = ADAM;
    return HttpResponse.json(ADAM);
  }),
  http.post("/api/v1/auth/logout", () => {
    db.sessionUser = null;
    return new HttpResponse(null, { status: 204 });
  }),
  http.get("/api/v1/organizations", () => {
    if (!db.sessionUser) return problem(401, "Authentication credentials were not provided.");
    const list: MyMembership[] = Object.entries(db.memberships).map(([slug, role], i) => ({
      id: `m${i}`,
      role,
      organization: ORGS[slug as keyof typeof ORGS],
      created_at: "2026-11-01T10:00:00Z",
    }));
    return HttpResponse.json(list);
  }),
  http.get("/api/v1/org", ({ request }) => {
    const t = tenant(request);
    if (t instanceof Response) return t;
    return HttpResponse.json({ ...ORGS[t.slug as keyof typeof ORGS], role: t.role, member_count: 4 });
  }),
  http.patch("/api/v1/org", async ({ request }) => {
    const t = tenant(request);
    if (t instanceof Response) return t;
    if (t.role === "member") return problem(403, "Your role in this organization does not allow this action.");
    const body = (await request.json()) as { name: string };
    const org = ORGS[t.slug as keyof typeof ORGS];
    org.name = body.name;
    return HttpResponse.json({ ...org, role: t.role, member_count: 4 });
  }),
  http.get("/api/v1/org/members", ({ request }) => {
    const t = tenant(request);
    if (t instanceof Response) return t;
    const results: Member[] = [
      { id: "mm1", role: "owner", user: { ...ADAM, id: "u9", email: `owner@${t.slug}.test`, full_name: `Owner of ${t.slug}` }, created_at: "2026-11-01T10:00:00Z" },
    ];
    return HttpResponse.json({ next: null, previous: null, results });
  }),
];

export const server = setupServer(...handlers);
