// BI Pain Point Radar — Stack Overflow Proxy Server
const express = require("express");
const https   = require("https");
const zlib    = require("zlib");

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

// Fetch a URL and handle gzip decompression automatically
function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    var options = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": "bi-pain-radar/1.0"
      }
    };

    https.get(url, options, function(response) {
      var chunks = [];

      // Handle gzip decompression
      var stream = response;
      if (response.headers["content-encoding"] === "gzip") {
        stream = zlib.createGunzip();
        response.pipe(stream);
      }

      stream.on("data", function(chunk) { chunks.push(chunk); });
      stream.on("end", function() {
        var raw = Buffer.concat(chunks).toString("utf8");
        console.log("[SO] Status:", response.statusCode, "| Length:", raw.length, "| Encoding:", response.headers["content-encoding"] || "none");
        try {
          resolve(JSON.parse(raw));
        } catch(e) {
          console.error("[SO] JSON parse error. First 200 chars:", raw.slice(0, 200));
          reject(new Error("JSON parse failed"));
        }
      });
      stream.on("error", reject);

    }).on("error", reject);
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

  var tag      = encodeURIComponent(SO_TAG_MAP[tool]);
  var key      = SO_KEY ? "&key=" + SO_KEY : "";
  var keywords = req.query.keywords || "";

  // If keywords provided, use /search with intitle; otherwise use /questions by tag
  var url;
  if (keywords) {
    url = "https://api.stackexchange.com/2.3/search?order=desc&sort=relevance"
      + "&intitle=" + encodeURIComponent(keywords)
      + "&tagged=" + tag
      + "&site=stackoverflow&pagesize=20"
      + key;
    console.log("[SO] Keyword search:", keywords, "| Tag:", SO_TAG_MAP[tool]);
  } else {
    url = "https://api.stackexchange.com/2.3/questions?order=desc&sort=votes"
      + "&tagged=" + tag
      + "&site=stackoverflow&pagesize=20"
      + key;
    console.log("[SO] Top questions | Tag:", SO_TAG_MAP[tool]);
  }

  httpsGet(url).then(function(data) {
    if (data.error_id) {
      console.error("[SO] API error:", data.error_id, data.error_message);
      return res.status(500).json({ error: data.error_message });
    }

    var items = data.items || [];
    console.log("[SO] Items returned:", items.length, "| Quota remaining:", data.quota_remaining);

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

    res.json(slim);

  }).catch(function(err) {
    console.error("[SO] Error:", err.message);
    res.status(500).json({ error: err.message });
  });
});

app.listen(PORT, function() {
  console.log("BI Pain Radar proxy running on port " + PORT);
  console.log("SO_KEY: " + (SO_KEY ? "set ✓" : "NOT SET"));
});
