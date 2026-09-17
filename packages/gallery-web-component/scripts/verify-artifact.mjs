import { readFile } from "node:fs/promises";

const assetUrl = new globalThis.URL("../../../apps/inkendar/public/inkendar-gallery.js", import.meta.url);
const source = await readFile(assetUrl, "utf8");

if (!source.includes('ELEMENT_NAME = "inkendar-gallery"') || !source.includes("customElements.define(ELEMENT_NAME")) throw new Error("Gallery asset does not register inkendar-gallery");
if (source.includes("SUPABASE_SERVICE_ROLE_KEY") || /service_role|\.rpc\(|gallery_publication_binding|\/master\.webp/iu.test(source)) {
  throw new Error("Gallery asset contains a forbidden server-only identifier");
}
