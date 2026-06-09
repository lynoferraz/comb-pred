// Minimal, dependency-free module-resolution hook so plain Node can import the
// project's TypeScript backend-libs (app/backend-libs/**/*.ts). Node 24 strips
// TypeScript types natively; the only gap is that those files use extensionless
// relative imports (e.g. `from "../cartesapp/utils"` and `from "./ifaces.d"`),
// which Node's ESM resolver does not map to `.ts`. This hook fills that gap.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KNOWN_EXT = /\.(m?[jt]s|cjs|json|node)$/;

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !KNOWN_EXT.test(specifier)) {
    const base = context.parentURL ?? import.meta.url;
    for (const ext of [".ts", ".mts", "/index.ts"]) {
      const candidate = new URL(specifier + ext, base);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(specifier + ext, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
