import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { makeQueryClient, Providers, routes } from "../app/App";

/** Renders the real route tree at a given URL with a fresh query cache. */
export function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <Providers client={makeQueryClient()}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...utils, router };
}
