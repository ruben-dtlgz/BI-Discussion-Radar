// BI Pain Point Radar — Stack Overflow Proxy Server
// Deploy on Railway — see package.json alongside this file

const express = require("express");
const https = require("https"); // Built-in Node module — no extra deps needed

const app = express();
const PORT = process.env.PORT || 3000;
const SO_KEY = process.env.SO_KEY || "";

const SO_TAG_MAP = {
  "Tableau":  "tableau",
  "Power BI": "powerbi",
  "Qlik":     "qlik",
  "Spotfire": "tibco-spotfire",
  "Sigma":    "sigma-computing",
};

// CORS — allow requests from any origin (including Claude artifacts)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Simple HTTPS GET helper using Node's built-in https module
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "Accept-Encoding": "identity" } }, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON parse failed: ${raw.slice(0, 100)}`)); }
      });
    }).on("error", reject);
  });
}

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", tools: Object.keys(SO_TAG_MAP) });
});

// Main endpoint — called by the dashboard
app.get("/api/stackoverflow", async (req, res) => {
  const tool = req.query.tool;

  if (!tool || !SO_TAG_MAP[tool]) {
    return res.status(400).json({
      error: `Unknown tool: "${tool}". Valid values: ${Object.keys(SO_TAG_MAP).join(", ")}`
    });
  }

  const tag = encodeURIComponent(SO_TAG_MAP[tool]);
  const key = SO_KEY ? `&key=${SO_KEY}` : "";

  const urls = [
    `https://api.stackexchange.com/2.3/questions?order=desc&sort=votes&tagged=${tag}&site=stackoverflow&pagesize=10${key}`,
    `https://api.stackexchange.com/2.3/search?order=desc&sort=relevance&intitle=${encodeURIComponent("error OR slow OR issue OR problem OR broken OR limitation")}&tagged=${tag}&site=stackoverflow&pagesize=10${key}`,
  ];

  try {
    const [r1, r2] = await Promise.allSettled(urls.map(httpsGet));

    const items1 = r1.status === "fulfilled" ? (r1.value.items || []) : [];
    const items2 = r2.status === "fulfilled" ? (r2.value.items || []) : [];

    // Deduplicate by question_id
    const seen = new Set();
    const unique = [...items1, ...items2].filter(q => {
      if (seen.has(q.question_id)) return false;
      seen.add(q.question_id);
      return true;
    });

    const slim = unique.map(q => ({
      id:                  `so-${q.question_id}`,
      platform:            "stackoverflow",
      title:               q.title,
      body:                "",
      source_url:          q.link,
      subreddit_or_source: "stackoverflow.com",
      score:               q.score,
      tags:                q.tags || [],
      answer_count:        q.answer_count,
      is_answered:         q.is_answered,
    }));

    console.log(`[SO] ${tool} (${SO_TAG_MAP[tool]}) → ${slim.length} posts`);
    res.json(slim);

  } catch (err) {
    console.error(`[SO] Error for ${tool}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`BI Pain Radar proxy running on port ${PORT}`);
  console.log(`SO_KEY: ${SO_KEY ? "set ✓" : "NOT SET — rate limits will apply"}`);
});
