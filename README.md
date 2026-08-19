# Sobix Grafikgästebuch

Eine gemeinsame 4096×4096-Pixelfläche mit integriertem 64×64-Pixel-Editor. Besucher geben einen Namen ein und dürfen pro UTC-Kalendertag und Netzwerkkennung einen Eintrag erstellen.

## Technik

- Cloudflare Worker für Website und API
- Cloudflare D1 für Bilder und Protokoll
- Keine dauerhafte Speicherung roher IP-Adressen; gespeichert wird ein gesalzener SHA-256-Hash
- Admin-Protokoll über `GET /api/admin/log` mit Bearer-Token

## Einrichtung

1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create grafikgaestebuch`
4. Die ausgegebene `database_id` in `wrangler.jsonc` einsetzen.
5. `npx wrangler d1 migrations apply grafikgaestebuch --remote`
6. Zwei lange, zufällige Secrets anlegen:
   - `npx wrangler secret put RATE_LIMIT_SECRET`
   - `npx wrangler secret put ADMIN_TOKEN`
7. `npm run deploy`

Cloudflare kann alternativ mit diesem GitHub-Repository verbunden werden. Build-Befehl: `npm run deploy`.

## Admin-Protokoll

```bash
curl -H "Authorization: Bearer DEIN_ADMIN_TOKEN" https://DEINE-DOMAIN/api/admin/log
```

Das Log enthält Name, UTC-Zeitpunkt, Position, Eintrags-ID, gekürzte Netzwerkkennung und User-Agent. Ein frei eingegebener Name bestätigt keine Identität. Die Netzwerkbegrenzung ist Spamschutz, aber ohne Anmeldung nicht fälschungssicher.

## Lokal

```bash
npm run db:local
npm run dev
```
