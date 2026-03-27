// BI Pain Point Radar — Stack Overflow Proxy Server
// Requires: express (see package.json)
// Env vars:  SO_KEY=your_stackoverflow_api_key

const express = require("express");
const https   = require("https");

const app    = express();
const PORT   = process.env.PORT || 3000;
const SO_KEY = process.env.SO_KEY || "";

const SO_TAG_MAP = {
  "Tableau":  "tableau",
  "Power BI": "powerbi",
  "Qlik":     "qlik",
  "Spotfire": "tibco-spotfire",
  "Sigma":    "sigma-computing",
};

// CORS — allow requests from any origin (including Claude artifacts)
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.sendStatus(200); return; }
  next();
});

// Simple HTTPS GET using Node built-in — no extra deps
function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: { "Accept-Encoding": "identity" } }, function(res) {
      var raw = "";
      res.on("data", function(chunk) { raw += chunk; });
      res.on("end", function() {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error("JSON parse failed: " + raw.slice(0, 120))); }
      });
    }).on("error", reject);
  });
}

// Health check
app.get("/", function(req, res) {
  res.json({ status: "ok", tools: Object.keys(SO_TAG_MAP) });
});

// Main endpoint
app.get("/api/stackoverflow", function(req, res) {
  var tool = req.query.tool;

  if (!tool || !SO_TAG_MAP[tool]) {
    res.status(400).json({ error: "Unknown tool: " + tool });
    return;
  }

  var tag = encodeURIComponent(SO_TAG_MAP[tool]);
  var key = SO_KEY ? "&key=" + SO_KEY : "";

  var urls = [
    "https://api.stackexchange.com/2.3/questions?order=desc&sort=votes&tagged=" + tag + "&site=stackoverflow&pagesize=10" + key,
    "https://api.stackexchange.com/2.3/search?order=desc&sort=relevance&intitle=" + encodeURIComponent("error OR slow OR issue OR problem OR broken OR limitation") + "&tagged=" + tag + "&site=stackoverflow&pagesize=10" + key,
  ];

  Promise.allSettled(urls.map(httpsGet)).then(function(results) {
    var items1 = results[0].status === "fulfilled" ? (results[0].value.items || []) : [];
    var items2 = results[1].status === "fulfilled" ? (results[1].value.items || []) : [];

    var seen = {};
    var unique = items1.concat(items2).filter(function(q) {
      if (seen[q.question_id]) return false;
      seen[q.question_id] = true;
      return true;
    });

    var slim = unique.map(function(q) {
      return {
        id:                  "so-" + q.question_id,
        platform:            "stackoverflow",
        title:               q.title,
        body:                "",
        source_url:          q.link,
        subreddit_or_source: "stackoverflow.com",
        score:               q.score,
        tags:                q.tags || [],
        answer_count:        q.answer_count,
        is_answered:         q.is_answered,
      };
    });

    console.log("[SO] " + tool + " -> " + slim.length + " posts");
    res.json(slim);

  }).catch(function(err) {
    console.error("[SO] Error for " + tool + ":", err.message);
    res.status(500).json({ error: err.message });
  });
});

app.listen(PORT, function() {
  console.log("BI Pain Radar proxy running on port " + PORT);
  console.log("SO_KEY: " + (SO_KEY ? "set ✓" : "NOT SET — rate limits apply"));
});
