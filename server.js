// BI Pain Point Radar — Stack Overflow Proxy Server
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

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.sendStatus(200); return; }
  next();
});

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      var chunks = [];
      res.on("data", function(chunk) { chunks.push(chunk); });
      res.on("end", function() {
        var raw = Buffer.concat(chunks).toString("utf8");
        console.log("[SO] Raw response length:", raw.length, "status:", res.statusCode);
        console.log("[SO] First 300 chars:", raw.slice(0, 300));
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error("JSON parse failed: " + raw.slice(0, 200))); }
      });
    }).on("error", function(e) {
      console.error("[SO] HTTPS error:", e.message);
      reject(e);
    });
  });
}

app.get("/", function(req, res) {
  res.json({ status: "ok", tools: Object.keys(SO_TAG_MAP) });
});

app.get("/api/stackoverflow", function(req, res) {
  var tool = req.query.tool;

  if (!tool || !SO_TAG_MAP[tool]) {
    return res.status(400).json({ error: "Unknown tool: " + tool });
  }

  var tag = encodeURIComponent(SO_TAG_MAP[tool]);
  var key = SO_KEY ? "&key=" + SO_KEY : "";

  // Use a single simple query first to isolate the issue
  var url = "https://api.stackexchange.com/2.3/search?order=desc&sort=relevance"
    + "&intitle=" + encodeURIComponent("error OR issue OR problem OR slow")
    + "&tagged=" + tag
    + "&site=stackoverflow&pagesize=10"
    + key;

  console.log("[SO] Fetching:", url);

  httpsGet(url).then(function(data) {
    console.log("[SO] Data keys:", Object.keys(data));
    console.log("[SO] Items count:", data.items ? data.items.length : "no items key");
    console.log("[SO] Error?", data.error_id, data.error_message);
    console.log("[SO] Quota remaining:", data.quota_remaining);

    if (data.error_id) {
      return res.status(500).json({ error: data.error_message, error_id: data.error_id });
    }

    var items = data.items || [];
    var slim = items.map(function(q) {
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

    console.log("[SO] Returning", slim.length, "items for", tool);
    res.json(slim);

  }).catch(function(err) {
    console.error("[SO] Caught error:", err.message);
    res.status(500).json({ error: err.message });
  });
});

app.listen(PORT, function() {
  console.log("BI Pain Radar proxy running on port " + PORT);
  console.log("SO_KEY: " + (SO_KEY ? "set ✓" : "NOT SET"));
});
