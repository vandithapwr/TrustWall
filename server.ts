import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import { apiRouter } from "./src/server/apiRouter.ts";
import { demoRouter } from "./src/server/demoApp.ts";
import { proxyRouter } from "./src/server/proxyRouter.ts";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // Mount TRUSTWALL Control Plane API, Reverse Proxy, and Protected TrustShop Demo App
  app.use("/api", apiRouter);
  app.use("/proxy", proxyRouter);
  app.use("/demo", demoRouter);

  const distDir = path.resolve(process.cwd(), "dist");
  const isProd = process.env.NODE_ENV === "production" && fs.existsSync(distDir);

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`TRUSTWALL full-stack server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
