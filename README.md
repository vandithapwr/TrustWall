# TRUSTWALL — Trust-Aware Adaptive WAF

Full-stack TypeScript web application combining a Reverse Proxy & Request Normalizer (`/proxy/*`), an inert Protected Demo Storefront (`/demo/*`), an Adaptive ML & Trust Control Plane (`/api/*`), and a 6-page React Admin Dashboard.

## Prerequisites
- **Node.js** `18+` (recommended `20+` or `22+`) and **npm**

## Running Locally in VS Code
1. Unzip the downloaded project and open the folder in **VS Code**.
2. Open the VS Code integrated terminal (`Ctrl+~` / `Cmd+~`) and install dependencies:
   ```bash
   npm install
   ```
3. *(Optional)* Copy `.env.example` to `.env` if you want to customize `ADMIN_REVIEW_TOKEN`:
   ```bash
   cp .env.example .env
   ```
4. Start the full-stack server (Express API + Proxy + Vite React UI on port `3000`):
   ```bash
   npm run dev
   ```
5. Open **`http://localhost:3000`** in your browser.

## Useful Endpoints
- **Dashboard UI:** `http://localhost:3000`
- **Health Check:** `http://localhost:3000/api/health`
- **Reverse Proxy:** `http://localhost:3000/proxy/search?q=books`
- **Protected Demo Target:** `http://localhost:3000/demo/`
- **Default Local Reviewer Token:** `trustwall-local-reviewer-token` (override via `ADMIN_REVIEW_TOKEN` in `.env`)
