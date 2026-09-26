import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const styles = readFileSync(join(appDir, "styles.css"), "utf8");
const root = readFileSync(join(appDir, "root.tsx"), "utf8");
const shells = readFileSync(join(appDir, "ui", "shells.tsx"), "utf8");
const conversations = readFileSync(join(appDir, "routes", "owner-conversations.tsx"), "utf8");
const calendars = readFileSync(join(appDir, "routes", "owner-calendars.tsx"), "utf8");

describe("mobile-first layout contract", () => {
  it("opts into viewport safe areas and prevents the document itself from overflowing", () => {
    expect(root).toContain("width=device-width, initial-scale=1, viewport-fit=cover");
    expect(styles).toMatch(/body\s*\{[^}]*overflow-x:\s*clip/su);
    expect(styles).toMatch(/\.topbar\s*\{[^}]*padding-top:\s*max\([^;]*env\(safe-area-inset-top\)/su);
    expect(styles).toMatch(/\.workspace\s*\{[^}]*padding-right:\s*max\([^;]*env\(safe-area-inset-right\)/su);
    expect(styles).toMatch(/\.public-frame\s*\{[^}]*padding-bottom:\s*max\([^;]*env\(safe-area-inset-bottom\)/su);
  });

  it("uses a single-column mobile form base and enhances it from the tablet breakpoint", () => {
    expect(styles).toMatch(/\.record-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/su);
    expect(styles).toMatch(/@media \(min-width:\s*48rem\)[\s\S]*\.record-form\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,/u);
    expect(styles).toMatch(/\.record-form\s*>\s*:is\(button, \.button\)\s*\{[^}]*width:\s*100%/su);
  });

  it("keeps compact navigation through phone widths and exposes the persistent rail at 768px", () => {
    expect(shells).toContain('className="brand-label"');
    expect(styles).toMatch(/\.brand-label\s*\{[^}]*display:\s*none/su);
    expect(styles).toMatch(/@media \(min-width:\s*23rem\)[\s\S]*\.brand-label\s*\{[^}]*display:\s*inline/u);

    const appFrameStart = styles.indexOf("/* ---------- App frame");
    const tabletStart = styles.indexOf("@media (min-width: 48rem)", appFrameStart);
    const desktopStart = styles.indexOf("@media (min-width: 64rem)", tabletStart);
    const tabletRules = styles.slice(tabletStart, desktopStart);
    expect(tabletStart).toBeGreaterThan(appFrameStart);
    expect(tabletRules).toMatch(/\.app-frame\[data-role="owner"\][\s\S]*grid-template-columns:\s*14rem minmax\(0, 1fr\)/u);
    expect(tabletRules).toMatch(/\.rail[\s\S]*display:\s*grid/u);
  });

  it("turns conversations into a phone list-or-detail flow and tablet master-detail", () => {
    expect(conversations).toContain('className="conversation-layout"');
    expect(conversations).toMatch(/className="[^"]*conversation-inbox[^"]*"/u);
    expect(conversations).toMatch(/className="[^"]*conversation-detail[^"]*"/u);
    expect(conversations).toMatch(/Volver a conversaciones/u);
    expect(styles).toMatch(/\.conversation-layout\[data-has-selection="true"\]\s+\.conversation-inbox\s*\{[^}]*display:\s*none/su);
    expect(styles).toMatch(/@media \(min-width:\s*48rem\)[\s\S]*\.conversation-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, [^)]+\)\s+minmax\(0, [^)]+\)/u);
  });

  it("keeps public choice controls stacked and finger-sized on narrow screens", () => {
    expect(styles).toMatch(/\.public-sheet ol > li form\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/su);
    expect(styles).toMatch(/\.public-sheet ol > li form\s+:is\(button, \.button\)\s*\{[^}]*width:\s*100%/su);
  });

  it("wraps long operational values and multi-action decisions without horizontal overflow", () => {
    expect(styles).toMatch(/a\s*\{[^}]*overflow-wrap:\s*anywhere/su);
    expect(styles).toMatch(/\.menu-sheet\s*\{[^}]*padding-top:\s*max\([^;]*env\(safe-area-inset-top\)/su);
    expect(calendars).toMatch(/<Form[^>]*className="record-actions"[^>]*>[\s\S]*Aprobar y confirmar[\s\S]*Rechazar/u);
  });
});
