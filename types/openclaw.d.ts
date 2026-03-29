// Stub type declarations for OpenClaw plugin SDK.
// The real module is provided at runtime by OpenClaw itself.

declare module "openclaw/plugin-sdk/plugin-entry" {
  export function definePluginEntry(entry: {
    id: string;
    name?: string;
    description?: string;
    register(api: unknown, config?: unknown): void;
  }): unknown;
}

declare module "openclaw/plugin-sdk/*" {
  const value: unknown;
  export default value;
  export = value;
}
