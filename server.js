// BI Pain Point Radar — Stack Overflow Proxy Server
// Deploy on Railway, Render, or Vercel (see instructions below)
//
// Required env vars:
//   SO_KEY=rl_BV1B13XGMMrgKp6qCUYdyVWRH   ← your Stack Overflow API key
//
// Once deployed, paste your public URL into the dashboard artifact:
//   const SO_PROXY_URL = "https://YOUR-DEPLOYMENT-URL.railway.app/api/stackoverflow"

import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;
const SO_KEY = process.env.SO_KEY;

const SO_TAG_MAP = {
  "Tableau":  "tableau",
  "Power BI": "powerbi",
  "Qlik":     "qlik",
  "Spotfire": "tibco-spotfire",
  "Sigma":    "sigma-computing",
};

// Allow requests from Claude artifact origin
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/api/stackoverflow", async (req, res) => {
  const tool = req.query.tool;
  if (!tool || !SO_TAG_MAP[tool]) {
    return res.status(400).json({ error: `Unknown tool: ${tool}. Valid: ${Object.keys(SO_TAG_MAP).join(", ")}` });
  }

  const tag = SO_TAG_MAP[tool];
  const key = SO_KEY ? `&key=${SO_KEY}` : "";

  const queries = [
    // Top voted questions tagged with the tool
    `https://api.stackexchange.com/2.3/questions?order=desc&sort=votes&tagged=${encodeURIComponent(tag)}&site=stackoverflow&pagesize=10${key}`,
    // Pain-point keyword search within the tag
    `https://api.stackexchange.com/2.3/search?order=desc&sort=relevance&intitle=${encodeURIComponent("error OR slow OR issue OR problem OR broken OR limitation")}&tagged=${encodeURIComponent(tag)}&site=stackoverflow&pagesize=10${key}`,
  ];

  try {
    const results = await Promise.all(
      queries.map(url =>
        fetch(url, { headers: { "Accept-Encoding": "gzip" } })
          .then(r => r.json())
          .then(d => d.items || [])
          .catch(() => [])
      )
    );

    // Flatten + deduplicate by question_id
    const seen = new Set();
    const unique = results.flat().filter(q => {
      if (seen.has(q.question_id)) return false;
      seen.add(q.question_id);
      return true;
    });

    // Return only the fields the dashboard needs
    const slim = unique.map(q => ({
      id:                 `so-${q.question_id}`,
      platform:           "stackoverflow",
      title:              q.title,
      body:               "",
      source_url:         q.link,
      subreddit_or_source:"stackoverflow.com",
      score:              q.score,
      tags:               q.tags || [],
      answer_count:       q.answer_count,
      is_answered:        q.is_answered,
    }));

    console.log(`[SO] ${tool} → ${slim.length} posts`);
    res.json(slim);
  } catch (err) {
    console.error(`[SO] Error for ${tool}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/", (req, res) => res.json({ status: "ok", tools: Object.keys(SO_TAG_MAP) }));

app.listen(PORT, () => console.log(`SO proxy running on :${PORT}`));
