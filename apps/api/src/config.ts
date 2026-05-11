import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "../../..");
const apiRoot = path.resolve(moduleDir, "..");

const candidateEnvFiles = [
  path.resolve(projectRoot, ".env"),
  path.resolve(apiRoot, ".env"),
  path.resolve(projectRoot, ".env.local"),
  path.resolve(apiRoot, ".env.local")
];

for (const envFile of candidateEnvFiles) {
  if (existsSync(envFile)) {
    loadDotEnv({ path: envFile, override: true });
  }
}

export const config = {
  apiPort: Number(process.env.API_PORT || 8787),
  tdxClientId: process.env.TDX_CLIENT_ID || "",
  tdxClientSecret: process.env.TDX_CLIENT_SECRET || "",
  tdxCityCodes: process.env.TDX_CITY_CODES || "Taipei",
  cwaApiKey: process.env.CWA_API_KEY || "",
  moenvApiKey: process.env.MOENV_API_KEY || "",
  wraApiKey: process.env.WRA_API_KEY || ""
};

export function missingEnv(names: Array<keyof typeof config>): string[] {
  return names.filter((name) => !config[name]);
}
