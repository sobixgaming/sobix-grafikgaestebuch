// Secret bindings are intentionally absent from wrangler.jsonc.
// Their runtime values are created with `wrangler secret put`.
interface Env {
  RATE_LIMIT_SECRET: string;
  ADMIN_TOKEN: string;
}
