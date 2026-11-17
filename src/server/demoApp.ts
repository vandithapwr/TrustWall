import express from "express";

const PRODUCTS = [
  { id: 1, name: "Network Security Essentials", category: "books", price: 39.99 },
  { id: 2, name: "Applied Cryptography Guide", category: "books", price: 54.5 },
  { id: 3, name: "Mechanical Keyboard", category: "electronics", price: 89.0 },
  { id: 4, name: "USB-C Hardware Security Key", category: "electronics", price: 49.0 },
  { id: 5, name: "Cloud Architecture Poster", category: "merch", price: 19.0 },
];

const DEMO_USERS: Record<string, string> = {
  alice: "demo-pass-123",
  bob: "demo-pass-456",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function handleDemoDispatch(params: {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
}): { status: number; payload: unknown } {
  const cleanPath = params.path.split("?")[0] || "/";
  const method = params.method.toUpperCase();

  if (cleanPath === "/" || cleanPath === "/health") {
    return {
      status: 200,
      payload: {
        service: "TrustShop Protected Demo Target",
        status: "ok",
        endpoints: ["/search", "/login", "/products", "/api/products", "/api/v2/catalog", "/api/feedback"],
      },
    };
  }

  if (cleanPath === "/search" && method === "GET") {
    const q = String(params.query.q ?? "");
    const qLower = q.toLowerCase();
    const matches = PRODUCTS.filter(
      (p) => p.name.toLowerCase().includes(qLower) || p.category.toLowerCase().includes(qLower)
    );
    return {
      status: 200,
      payload: { query: escapeHtml(q), count: matches.length, results: matches },
    };
  }

  if (cleanPath === "/login" && method === "POST") {
    const username = String(params.body.username ?? "");
    const password = String(params.body.password ?? "");
    const authenticated = DEMO_USERS[username] === password;
    return {
      status: authenticated ? 200 : 401,
      payload: {
        status: authenticated ? "authenticated" : "invalid_credentials",
        username: escapeHtml(username),
      },
    };
  }

  if ((cleanPath === "/products" || cleanPath === "/api/products") && method === "GET") {
    const category = params.query.category?.toLowerCase();
    const maxPrice = params.query.max_price ? Number(params.query.max_price) : null;
    let filtered = PRODUCTS;
    if (category) {
      filtered = filtered.filter((p) => p.category.toLowerCase() === category);
    }
    if (maxPrice !== null && !Number.isNaN(maxPrice)) {
      filtered = filtered.filter((p) => p.price <= maxPrice);
    }
    return { status: 200, payload: { count: filtered.length, products: filtered } };
  }

  if (cleanPath === "/api/v2/catalog" && method === "GET") {
    const sort = params.query.sort === "price" ? "price" : "name";
    const items = [...PRODUCTS].sort((a, b) =>
      sort === "price" ? a.price - b.price : a.name.localeCompare(b.name)
    );
    return { status: 200, payload: { api_version: "v2", in_stock: true, items } };
  }

  if (cleanPath === "/api/feedback" && method === "POST") {
    const rating = Math.max(1, Math.min(5, Number(params.body.rating ?? 5)));
    const comment = escapeHtml(String(params.body.comment ?? "").slice(0, 200));
    return { status: 200, payload: { status: "received", rating, comment_escaped: comment } };
  }

  return {
    status: 200,
    payload: { service: "TrustShop", path: escapeHtml(cleanPath), status: "handled" },
  };
}

export const demoRouter = express.Router();
demoRouter.use((req, res) => {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    query[k] = String(v ?? "");
  }
  const result = handleDemoDispatch({
    method: req.method,
    path: req.path,
    query,
    body: (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>,
  });
  res.status(result.status).json(result.payload);
});
