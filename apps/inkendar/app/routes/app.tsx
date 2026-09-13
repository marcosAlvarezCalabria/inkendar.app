import type { Route } from "./+types/app";

import { authHandlers } from "../auth.server.js";

export async function loader({ request }: Route.LoaderArgs) {
  return await authHandlers.current(request);
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export default function AppEntry() {
  return null;
}
