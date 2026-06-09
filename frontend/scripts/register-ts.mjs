// Registers the TypeScript resolution hook (ts-hooks.mjs) so that
// `node --import ./scripts/register-ts.mjs ...` can load the project's
// extensionless TypeScript imports without any extra dependency.
import { register } from "node:module";
register("./ts-hooks.mjs", import.meta.url);
