import "dotenv/config";
import express, {
  type Request,
  Response,
  NextFunction,
  type Express,
} from "express";
import path from "path";
import fs from "fs";
import { registerRoutes } from "./routes";

/**
 * Writes a simple, timestamped log line to stdout.
 * @param message - Message to log
 * @param source - Tag indicating the source module
 */
function log(message: string, source = "express"): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

/**
 * Serves the built client assets from dist/public in production.
 * @param app - Express application instance
 */
function serveStatic(app: Express): void {
  const distPath = path.resolve(process.cwd(), "dist", "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestPath = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json.bind(res) as (body?: any) => Response;
  res.json = ((body?: any) => {
    capturedJsonResponse = body as Record<string, any> | undefined;
    return originalResJson(body);
  }) as typeof res.json;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (requestPath.startsWith("/api")) {
      let logLine = `${req.method} ${requestPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  // Runtime config for the client: exposes window.__RUNTIME_CONFIG__
  app.get("/config.js", (_req: Request, res: Response) => {
    const agentId = process.env.VITE_AGENT_ID || process.env.AGENT_DID || "";
    const environment =
      process.env.VITE_NVM_ENVIRONMENT ||
      process.env.NVM_ENVIRONMENT ||
      "sandbox";
    const body =
      "window.__RUNTIME_CONFIG__ = Object.assign({}, window.__RUNTIME_CONFIG__, { VITE_AGENT_ID: " +
      JSON.stringify(agentId) +
      ", VITE_NVM_ENVIRONMENT: " +
      JSON.stringify(environment) +
      " });";
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.send(body);
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  // Only setup Vite in development, and load it dynamically to avoid bundling in production
  if (app.get("env") === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app as any, server as any);
  } else {
    serveStatic(app);
  }

  // Serve the app on the specified port or default to 3000
  // this serves both the API and the client
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  server.listen(PORT, "0.0.0.0", () => {
    log(`serving on port ${PORT}`);
  });
})();
