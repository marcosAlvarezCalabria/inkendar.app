import type { Route } from "./+types/home";

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
  return (
    <main>
      <p className="eyebrow">Inkendar</p>
      <h1>La plataforma está en construcción.</h1>
      <p>Esta base técnica ya ejecuta la PWA y su servidor full-stack.</p>
    </main>
  );
}
