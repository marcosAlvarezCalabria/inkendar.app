import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const workspaceRules = {
  "@inkendar/app": {
    manifest: "apps/inkendar/package.json",
    allowedInternalDependencies: [
      "@inkendar/application",
      "@inkendar/domain",
      "@inkendar/infrastructure",
      "@inkendar/public-content",
      "@inkendar/ui",
    ],
  },
  "@inkendar/application": {
    manifest: "packages/application/package.json",
    allowedInternalDependencies: ["@inkendar/domain"],
  },
  "@inkendar/domain": {
    manifest: "packages/domain/package.json",
    allowedInternalDependencies: [],
  },
  "@inkendar/infrastructure": {
    manifest: "packages/infrastructure/package.json",
    allowedInternalDependencies: ["@inkendar/application", "@inkendar/domain"],
  },
  "@inkendar/public-content": {
    manifest: "packages/public-content/package.json",
    allowedInternalDependencies: ["@inkendar/application", "@inkendar/domain"],
  },
  "@inkendar/ui": {
    manifest: "packages/ui/package.json",
    allowedInternalDependencies: ["@inkendar/application", "@inkendar/domain"],
  },
} as const;

type PackageManifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

async function readManifest(relativePath: string): Promise<PackageManifest> {
  const contents = await readFile(path.join(repositoryRoot, relativePath), "utf8");
  return JSON.parse(contents) as PackageManifest;
}

describe("workspace architecture", () => {
  for (const [workspaceName, rule] of Object.entries(workspaceRules)) {
    it(`${workspaceName} does not declare outward workspace dependencies`, async () => {
      const manifest = await readManifest(rule.manifest);
      const dependencyNames = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ];
      const internalDependencies = dependencyNames.filter((name) => name.startsWith("@inkendar/"));
      const outwardDependencies = internalDependencies.filter(
        (name) => !(rule.allowedInternalDependencies as readonly string[]).includes(name),
      );

      expect(manifest.name).toBe(workspaceName);
      expect(outwardDependencies).toEqual([]);
    });
  }
});
