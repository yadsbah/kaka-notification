import Elysia from "elysia";
import { resolve, sep } from "node:path";

const WEB_DIST = resolve(import.meta.dir, "../../web/dist");
const INDEX = resolve(WEB_DIST, "index.html");

// Serves the built Refine dashboard. Hashed assets are cached forever; any other path gets index.html
// so client-side routes survive a reload. API paths never fall through to the SPA.
const webRouter = new Elysia().get("/*", async ({ request, set, error }) => {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  if (pathname.startsWith("/api/") || pathname === "/api" || pathname === "/health") {
    return error(404, { error: "Not found" });
  }

  const requested = resolve(WEB_DIST, `.${pathname}`);
  if (requested.startsWith(WEB_DIST + sep) && pathname !== "/") {
    const file = Bun.file(requested);
    if (await file.exists()) {
      if (pathname.startsWith("/assets/")) set.headers["cache-control"] = "public, max-age=31536000, immutable";
      return file;
    }
  }

  const index = Bun.file(INDEX);
  if (!(await index.exists())) {
    return error(404, { error: "Dashboard not built. Run `bun run build:web`." });
  }
  set.headers["cache-control"] = "no-cache";
  return index;
});

export default webRouter;
