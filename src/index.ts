const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

async function networkHash(request: Request, secret: string): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const data = new TextEncoder().encode(`${ip}|${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validPixels(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 70000) return false;
  try {
    const p = JSON.parse(value);
    return Array.isArray(p) && p.length === 4096 && p.every((c) => typeof c === "string" && (/^#[0-9a-f]{6}$/i.test(c) || c === ""));
  } catch { return false; }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/entries" && request.method === "GET") {
        const result = await env.DB.prepare("SELECT id, name, pixels, position_x AS x, position_y AS y, created_at FROM entries ORDER BY created_at ASC LIMIT 1000").all();
        return json({ entries: result.results }, 200, { "cache-control": "public, max-age=10" });
      }
      if (url.pathname === "/api/entries" && request.method === "POST") {
        const body = await request.json<Record<string, unknown>>();
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const x = Number(body.x), y = Number(body.y);
        if (!name || name.length > 32 || !/^[\p{L}\p{N} ._\-]+$/u.test(name)) return json({ error: "Bitte einen gültigen Namen mit maximal 32 Zeichen eingeben." }, 400);
        if (!validPixels(body.pixels) || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 1856 || y > 1016) return json({ error: "Ungültige Bild- oder Positionsdaten." }, 400);
        const createdAt = new Date().toISOString();
        const hash = await networkHash(request, env.RATE_LIMIT_SECRET);
        const id = crypto.randomUUID();
        const daily = await env.DB.prepare("SELECT COUNT(*) AS count FROM entries WHERE network_hash = ? AND substr(created_at, 1, 10) = ?")
          .bind(hash, createdAt.slice(0, 10)).first<{ count: number }>();
        if ((daily?.count ?? 0) >= 100) return json({ error: "Das vorübergehende Limit von 100 Einträgen pro Tag ist erreicht." }, 429);
        await env.DB.prepare("INSERT INTO entries (id,name,pixels,position_x,position_y,created_at,network_hash,user_agent) VALUES (?,?,?,?,?,?,?,?)")
          .bind(id, name, body.pixels, x, y, createdAt, hash, (request.headers.get("User-Agent") ?? "").slice(0, 300)).run();
        console.log(JSON.stringify({ event: "entry_created", id, name, createdAt, networkHash: hash.slice(0, 12) }));
        return json({ entry: { id, name, pixels: body.pixels, x, y, created_at: createdAt } }, 201);
      }
      if (url.pathname === "/api/admin/log" && request.method === "GET") {
        if (request.headers.get("Authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Nicht autorisiert" }, 401);
        const result = await env.DB.prepare("SELECT id,name,position_x AS x,position_y AS y,created_at,substr(network_hash,1,12) AS network,user_agent FROM entries ORDER BY created_at DESC LIMIT 500").all();
        return json({ entries: result.results });
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "Nicht gefunden" }, 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ event: "request_error", path: url.pathname, error: String(error) }));
      return json({ error: "Interner Serverfehler" }, 500);
    }
  }
} satisfies ExportedHandler<Env>;
