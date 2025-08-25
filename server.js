const express = require("express");
const bodyParser = require("body-parser");
const { Log, requestLogger } = require("./logger");
const { createShortcodeEntry, getEntry, addClick, getStats } = require("./storage");
const app = express();
const PORT = process.env.PORT || 3000;
app.use(bodyParser.json());
app.use(requestLogger({ stack: "backend", package: "route" }));
function nowPlusMinutesIso(minutes) {
  const d = new Date(Date.now() + minutes * 60000);
  return d.toISOString();
}
function isValidUrl(s) {
  try {
    new URL(s);
    return true;
  } catch (e) { return false; }
}
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function randShort(len = 6) {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}
function generateUniqueShortcode(checkFn) {
  // try different lengths to reduce collisions
  for (const len of [6,7,8]) {
    for (let i = 0; i < 5; i++) { // try 5 times per length
      const s = randShort(len);
      if (!checkFn(s)) return s;
    }
  }
  return "s" + Date.now().toString(36);
}
function isAlphanumeric(s) {
  return /^[0-9a-zA-Z]+$/.test(s);
}
app.post("/shorturls", async (req, res) => {
  try {
    const { url, validity, shortcode } = req.body || {};
    if (!url || typeof url !== "string" || !isValidUrl(url)) {
      await Log("backend","error","handler","create shorturl: invalid url provided").catch(()=>{});
      return res.status(400).json({ error: "url (string) required and must be valid" });
    }
    const validityMinutes = Number.isInteger(validity) ? validity : 30;
    if (validity !== undefined && (!Number.isInteger(validity) || validity <= 0)) {
      await Log("backend","warn","handler","create shorturl: invalid validity provided, defaulting").catch(()=>{});
    }
    let finalCode = null;
    if (shortcode !== undefined) {
      if (typeof shortcode !== "string" || !isAlphanumeric(shortcode)) {
        await Log("backend","error","handler","create shorturl: invalid shortcode format").catch(()=>{});
        return res.status(400).json({ error: "shortcode must be alphanumeric string (no spaces)" });
      }
      if (shortcode.length < 4 || shortcode.length > 20) {
        await Log("backend","error","handler","create shorturl: shortcode length invalid").catch(()=>{});
        return res.status(400).json({ error: "shortcode length must be between 4 and 20" });
      }
      const existing = getEntry(shortcode);
      if (existing) {
        await Log("backend","error","handler","create shorturl: shortcode collision").catch(()=>{});
        return res.status(409).json({ error: "shortcode already exists" });
      }
      finalCode = shortcode;
    } else {
      finalCode = generateUniqueShortcode(code => !!getEntry(code));
    }

    const expiryTs = nowPlusMinutesIso(validityMinutes);
    const entry = createShortcodeEntry(finalCode, url, expiryTs);

    const shortLink = `${req.protocol}://${req.get("host")}/${finalCode}`;

    await Log("backend","info","handler",`shorturl created ${finalCode}`).catch(()=>{});

    return res.status(201).json({ shortLink, expiry: expiryTs });
  } catch (e) {
    await Log("backend","fatal","handler","create shorturl: server error").catch(()=>{});
    console.error(e);
    return res.status(500).json({ error: "internal server error" });
  }
});

app.get("/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const entry = getEntry(code);
    if (!entry) {
      await Log("backend","warn","handler",`redirect: shortcode not found ${code}`).catch(()=>{});
      return res.status(404).json({ error: "shortcode not found" });
    }
    const now = new Date().toISOString();
    if (entry.expiryTs && entry.expiryTs < now) {
      await Log("backend","info","handler",`redirect: shortcode expired ${code}`).catch(()=>{});
      return res.status(410).json({ error: "short link expired" });
    }

    const click = {
      ts: new Date().toISOString(),
      referrer: req.get("referer") || null,
      ip: req.ip || req.connection.remoteAddress || "unknown"
      // coarse geo requires external service; leave unknown or implement later
    };
    addClick(code, click);

    await Log("backend","info","handler",`redirecting ${code} -> ${entry.originalUrl}`).catch(()=>{});

    return res.redirect(302, entry.originalUrl);
  } catch (e) {
    await Log("backend","error","handler","redirect: server error").catch(()=>{});
    console.error(e);
    return res.status(500).json({ error: "internal server error" });
  }
});

app.get("/shorturls/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const s = getStats(code);
    if (!s) {
      await Log("backend","warn","handler",`stats: shortcode not found ${code}`).catch(()=>{});
      return res.status(404).json({ error: "shortcode not found" });
    }
    await Log("backend","info","handler",`stats requested ${code}`).catch(()=>{});
    return res.json(s);
  } catch (e) {
    await Log("backend","fatal","handler","stats: server error").catch(()=>{});
    console.error(e);
    return res.status(500).json({ error: "internal server error" });
  }
});
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Shortener microservice running on port ${PORT}`);
  Log("backend","info","service",`service started on port ${PORT}`).catch(()=>{});
});
