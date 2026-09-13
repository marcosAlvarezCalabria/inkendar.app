import type { Route } from "./+types/home";

import { authHandlers } from "../auth.server.js";

export async function loader({ request }: Route.LoaderArgs) {
  return await authHandlers.current(request);
}

export function meta(): Route.MetaDescriptors {
  return [
    { title: "Inkendar" },
    {
      name: "description",
      content: "Plataforma de operación para estudios de tatuaje.",
    },
  ];
}

export default function Home() {
  return null;
}
