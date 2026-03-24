// Minimal Blossom-compatible dev server
// Accepts PUT /upload with any body, stores by SHA-256 hash, serves via GET /:hash
// No auth required — dev only.

const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const PORT = 3000;
const DATA_DIR = "/data/blobs";

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // PUT /upload — store a blob
  if (req.method === "PUT" && req.url === "/upload") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const hash = crypto.createHash("sha256").update(body).digest("hex");
      const filePath = path.join(DATA_DIR, hash);

      fs.writeFileSync(filePath, body);

      const contentType = req.headers["content-type"] || "application/octet-stream";
      // Store content-type alongside the blob
      fs.writeFileSync(filePath + ".meta", contentType);

      console.log(`Stored ${hash} (${body.length} bytes, ${contentType})`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        sha256: hash,
        url: `http://localhost:${PORT}/${hash}`,
        size: body.length,
        type: contentType,
      }));
    });
    return;
  }

  // GET /:hash — serve a blob
  if (req.method === "GET" && req.url.length === 65 && req.url.startsWith("/")) {
    const hash = req.url.slice(1);
    const filePath = path.join(DATA_DIR, hash);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    let contentType = "application/octet-stream";
    const metaPath = filePath + ".meta";
    if (fs.existsSync(metaPath)) {
      contentType = fs.readFileSync(metaPath, "utf-8").trim();
    }

    const body = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": body.length,
    });
    res.end(body);
    return;
  }

  // GET / — health check
  if (req.method === "GET" && req.url === "/") {
    const files = fs.readdirSync(DATA_DIR).filter((f) => !f.endsWith(".meta"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", blobs: files.length }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Blossom dev server running on http://0.0.0.0:${PORT}`);
  console.log(`  PUT  /upload   — store a blob`);
  console.log(`  GET  /:hash    — retrieve a blob`);
  console.log(`  Data: ${DATA_DIR}`);
});
