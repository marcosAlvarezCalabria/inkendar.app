import type { Route } from "./+types/logout";

import { privateHeaders } from "@inkendar/infrastructure";
import { authHandlers } from "../auth.server.js";

export function loader() {
  throw new Response("Método no permitido", { status: 405, headers: privateHeaders() });
}

export async function action({ request }: Route.ActionArgs) {
  return await authHandlers.logout(request);
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export default function Logout() {
  return null;
}
