const fetch = require("node-fetch"); 
const LOG_ENDPOINT = process.env.LOG_ENDPOINT || "http://20.244.56.144/evaluation-service/logs";
const AUTH_TOKEN = process.env.LOG_AUTH_TOKEN || ""; 
const VALID_STACKS = new Set(["backend", "frontend"]);
const VALID_LEVELS = new Set(["debug", "info", "warn", "error", "fatal"]);
const VALID_PACKAGES = new Set([
  "cache","controller","cron_job","db","domain","handler","repository","route","service",
  "api","component","hook","page","state","style",
  "auth","config","middleware","utils"
]);
function isLowercaseString(s) {
  return typeof s === "string" && s === s.toLowerCase();
}
async function Log(stack, level, pkg, message) {
  if (!isLowercaseString(stack) || !VALID_STACKS.has(stack)) {
    console.warn("logger: invalid stack, sending anyway:", stack);
  }
  if (!isLowercaseString(level) || !VALID_LEVELS.has(level)) {
    console.warn("logger: invalid level, sending anyway:", level);
  }
  if (!isLowercaseString(pkg) ) {
    console.warn("logger: invalid package case, sending anyway:", pkg);
  } else if (!VALID_PACKAGES.has(pkg)) {
    console.warn("logger: package not in canonical list:", pkg);
  }
  const body = { stack, level, package: pkg, message };
  try {
    const headers = { "Content-Type": "application/json" };
    if (AUTH_TOKEN) headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;

    const res = await fetch(LOG_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeout: 3000 
    });
    if (!res.ok) {
      const text = await res.text().catch(()=>"");
      console.warn("logger: remote returned non-ok", res.status, text);
    } else {
    }
  } catch (err) {
    console.warn("logger: could not post to remote log server:", err.message || err);
  }
}
function requestLogger(options = {}) {
  const stack = options.stack || "backend";
  const pkg = options.package || "route";
  return async function (req, res, next) {
    const start = Date.now();
    const url = req.originalUrl || req.url;
    const method = req.method;
    res.on("finish", () => {
      const duration = Date.now() - start;
      const msg = `${method} ${url} -> ${res.statusCode} (${duration}ms)`;
      Log(stack, "info", pkg, msg).catch(()=>{});
    });
    next();
  };
}
module.exports = { Log, requestLogger };
