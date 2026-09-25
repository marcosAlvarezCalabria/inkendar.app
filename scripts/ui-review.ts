import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderUiReviewDocument, renderUiReviewScenarios } from "../apps/inkendar/app/ui/fixtures/ui-review.js";

// Development-only visual review of the UI foundation with synthetic fixtures.
const outputDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "inkendar", ".ui-review");
const assets = {
  stylesheetHref: "../app/styles.css",
  fontStylesheetHref: "../node_modules/@fontsource-variable/archivo/wdth.css",
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "index.html"), renderUiReviewDocument(assets));
for (const scenario of renderUiReviewScenarios(assets)) writeFileSync(join(outputDir, `${scenario.id}.html`), scenario.html);
process.stdout.write(`${join(outputDir, "index.html")}\n`);
