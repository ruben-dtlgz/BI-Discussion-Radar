import { useState, useCallback } from "react";

// ── Flightdeck tokens ─────────────────────────────────────────────────────────
const FD = {
  bgPage:"#f4f5f9", bgSurface:"#fafafc", bgEl:"#ffffff",
  borderSubtle:"#eff0f5", borderStrong:"#c8cddb",
  cPrim:"#272d3a", cSec:"#5c657d", cTert:"#909ab8", cInv:"#fdfdff",
  accent:"#3b7dff", accentHov:"#3264c8", accentDis:"#9cbdff",
  danger:"#d64545", success:"#2da44e", warning:"#b45309",
  successBg:"#eefbf3", warningBg:"#fffbeb", dangerBg:"#fef2f2", infoBg:"#eff6ff",
  neutralBg:"#f4f5f9", purpleBg:"#f5f3ff", orangeBg:"#fff7ed",
  r3:"6px", r4:"8px", r5:"10px",
  sm:"0px 1px 2px rgba(39,45,58,0.08),0px 2px 6px rgba(59,125,255,0.14)",
  md:"0px 2px 4px rgba(39,45,58,0.10),0px 4px 12px rgba(59,125,255,0.20)",
};

// ── Config ────────────────────────────────────────────────────────────────────
const SO_PROXY_URL = import.meta.env.VITE_SO_PROXY_URL;

const ALL_TOOLS = ["Tableau","Power BI","Qlik","Spotfire","Sigma"];

const PLATFORMS = [
  { id:"stackoverflow", label:"Stack Overflow", icon:"🟧", color:"#f48024", live:true  },
  { id:"reddit",        label:"Reddit",         icon:"🟠", color:"#ff4500", live:false },
  { id:"discord",       label:"Discord",        icon:"🟣", color:"#5865f2", live:false },
  { id:"twitter",       label:"X / Twitter",    icon:"⬛", color:"#000000", live:false },
  { id:"linkedin",      label:"LinkedIn",       icon:"🔵", color:"#0077b5", live:false },
];

const CATEGORIES = ["Performance","Governance","UX/Usability","Cost","Onboarding","Integrations","Data Freshness","Other"];

const CAT_META = {
  "Performance":    {bg:FD.dangerBg,  text:FD.danger,    dot:FD.danger},
  "Governance":     {bg:FD.purpleBg,  text:"#7c3aed",    dot:"#7c3aed"},
  "UX/Usability":   {bg:FD.infoBg,    text:FD.accentHov, dot:FD.accent},
  "Cost":           {bg:FD.warningBg, text:FD.warning,   dot:"#f59e0b"},
  "Onboarding":     {bg:FD.successBg, text:"#166534",    dot:FD.success},
  "Integrations":   {bg:"#ecfeff",    text:"#0e7490",    dot:"#06b6d4"},
  "Data Freshness": {bg:FD.orangeBg,  text:"#c2410c",    dot:"#f97316"},
  "Other":          {bg:FD.neutralBg, text:FD.cSec,      dot:FD.borderStrong},
};

// ── Anthropic API headers ─────────────────────────────────────────────────────
const AI_HEADERS = {
  "Content-Type": "application/json",
  "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
};

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchSOPosts(tool, onLog, keywords) {
  if (SO_PROXY_URL) {
    try {
      onLog(`Fetching live SO data for ${tool}…`);
      const kw  = keywords ? `&keywords=${encodeURIComponent(keywords)}` : "";
      const res = await fetch(`${SO_PROXY_URL}?tool=${encodeURIComponent(tool)}${kw}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = await res.json();
      onLog(`✓ ${items.length} live SO posts for ${tool}`);
      return items.map(q => ({ ...q, platform:"stackoverflow", tool }));
    } catch(e) {
      onLog(`⚠ Live SO fetch failed for ${tool}: ${e.message} — falling back to AI synthesis`);
    }
  }
  onLog(`Generating AI Stack Overflow insights for ${tool}…`);
  const kwClause = keywords
    ? `Focus specifically on pain points related to: "${keywords}".`
    : "Focus on the most common and impactful pain points.";
  const prompt = `You are a BI market researcher who has studied Stack Overflow questions tagged with "${tool}".
Generate 8 realistic Stack Overflow questions representing real pain points users have with ${tool}.
${kwClause}
Respond ONLY with a valid JSON array:
[{"id":"1","title":"realistic SO question title","body":"question body (2-3 sentences)","category":"one of: ${CATEGORIES.join(", ")}","tags":["tag1","tag2"],"score":12,"answer_count":3,"is_answered":true,"source_url":"https://stackoverflow.com/questions/123456/url-slug"}]`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", headers: AI_HEADERS,
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:2000,messages:[{role:"user",content:prompt}]})
    });
    if (!res.ok) { onLog(`⚠ Claude error for SO/${tool}: ${res.status}`); return []; }
    const data   = await res.json();
    const text   = data.content?.[0]?.text || "[]";
    const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
    onLog(`✓ ${parsed.length} AI SO insights for ${tool}`);
    return parsed.map((q,i) => ({...q, id:`so-${tool}-${i}`, tool, platform:"stackoverflow", subreddit_or_source:"stackoverflow.com"}));
  } catch(e) {
    onLog(`⚠ AI SO synthesis error for ${tool}: ${e.message}`);
    return [];
  }
}

async function classifyPosts(posts, onLog) {
  if (!posts.length) return [];
  onLog(`Classifying ${posts.length} posts with Claude…`);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", headers: AI_HEADERS,
      body:JSON.stringify({
        model:"claude-sonnet-4-20250514", max_tokens:1500,
        messages:[{role:"user",content:
          `Classify each Stack Overflow question into exactly one BI pain point category.
Categories: ${CATEGORIES.join(", ")}
Questions: ${JSON.stringify(posts.map(p=>({id:p.id,title:p.title,body:p.body})))}
Return ONLY a JSON array: [{"id":"...","category":"..."}]. No markdown, no explanation.`
        }]
      })
    });
    if (!res.ok) { onLog(`⚠ Claude API error: ${res.status}`); return []; }
    const data   = await res.json();
    const text   = data.content?.[0]?.text || "[]";
    const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
    onLog(`✓ Classified ${parsed.length} posts`);
    return parsed;
  } catch(e) { onLog(`⚠ Classification error: ${e.message}`); return []; }
}

async function fetchAIInsights(platform, tool, onLog, keywords) {
  const platformCtx = {
    reddit:   "Reddit threads from r/tableau, r/PowerBI, r/BusinessIntelligence, r/dataengineering",
    discord:  "Discord messages from BI and data engineering community servers",
    twitter:  "X/Twitter posts from BI practitioners and analytics engineers",
    linkedin: "LinkedIn posts and comments from BI professionals and data leaders",
  }[platform];
  const kwClause = keywords
    ? `Focus specifically on pain points related to: "${keywords}".`
    : "Focus on the most common and impactful pain points.";
  const prompt = `You are a BI market researcher who has studied ${platformCtx}.
Generate 8 realistic, specific pain point posts that real users have expressed about ${tool}.
${kwClause}
Each post must sound authentic to the platform, be specific, and express genuine frustration.
Respond ONLY with a valid JSON array:
[{"id":"1","title":"short summary (max 12 words)","body":"full realistic post text (2-4 sentences)","category":"one of: ${CATEGORIES.join(", ")}","subreddit_or_source":"realistic source","source_url":"plausible deep-link URL","score":42}]`;
  onLog(`Generating AI insights for ${tool} on ${platform}…`);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", headers: AI_HEADERS,
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:2000,messages:[{role:"user",content:prompt}]})
    });
    if (!res.ok) { onLog(`⚠ Claude error for ${tool}: ${res.status}`); return []; }
    const data   = await res.json();
    const text   = data.content?.[0]?.text || "[]";
    const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
    onLog(`✓ ${parsed.length} AI insights for ${tool}`);
    return parsed.map((p,i) => ({...p, id:`${platform}-${tool}-${i}`, tool, platform}));
  } catch(e) { onLog(`⚠ AI insight error for ${tool}: ${e.message}`); return []; }
}

// ── Flightdeck Checkbox ───────────────────────────────────────────────────────
const CHECK_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 6l3 3 5-5' stroke='white' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;
const DASH_SVG  = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 6h6' stroke='white' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`;

function FDCheckbox({ status="inactive", onChange, label }) {
  const isActive = status==="active", isIndet=status==="indeterminate";
  const checked  = isActive||isIndet;
  return (
    <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",userSelect:"none"}}
      onClick={e=>{e.preventDefault();onChange();}}>
      <span style={{
        display:"inline-flex",alignItems:"center",justifyContent:"center",
        width:16,height:16,borderRadius:4,flexShrink:0,transition:"all .12s",
        background:checked?FD.accent:"#fafafc",
        border:checked?`1px solid ${FD.accent}`:"1px solid #6b758f",
        backgroundImage:isActive?CHECK_SVG:isIndet?DASH_SVG:"none",
        backgroundRepeat:"no-repeat",backgroundPosition:"center",backgroundSize:"12px 12px",
      }}/>
      {label&&<span style={{fontSize:13,fontWeight:500,color:FD.cPrim}}>{label}</span>}
    </label>
  );
}

// ── Flightdeck Input ──────────────────────────────────────────────────────────
function FDInput({ value, onChange, placeholder, disabled }) {
  const [hovered, setHovered] = useState(false);
  const filled = value && value.length > 0;
  return (
    <div style={{
      display:"flex",alignItems:"center",gap:8,height:36,padding:"0 12px",
      borderRadius:FD.r3,background:"#fafafc",flex:1,minWidth:180,maxWidth:400,
      border:`1px solid ${disabled?"#eff0f5":hovered?"#c8cddb":"#dee1ea"}`,
      transition:"border-color .15s",
    }}
      onMouseEnter={()=>setHovered(true)}
      onMouseLeave={()=>setHovered(false)}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{flexShrink:0}}>
        <circle cx="7" cy="7" r="4.5" stroke={disabled?"#bdc3d4":hovered?"#272d3a":"#6b758f"} strokeWidth="1.3"/>
        <path d="M10.5 10.5L13 13" stroke={disabled?"#bdc3d4":hovered?"#272d3a":"#6b758f"} strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
      <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        disabled={disabled}
        style={{border:"none",outline:"none",background:"transparent",fontSize:13,
          fontFamily:"'Inter',system-ui,sans-serif",fontWeight:400,
          color:filled?"#272d3a":"#6b758f",width:"100%"}}/>
      {filled&&!disabled&&(
        <button onClick={()=>onChange("")} style={{background:"none",border:"none",cursor:"pointer",color:FD.cTert,fontSize:16,padding:0,lineHeight:1,flexShrink:0}}>×</button>
      )}
    </div>
  );
}

// ── Tool selector ─────────────────────────────────────────────────────────────
function ToolSelector({ selectedTools, onChange }) {
  const allSelected  = selectedTools.length===ALL_TOOLS.length;
  const noneSelected = selectedTools.length===0;
  const allStatus    = allSelected?"active":selectedTools.length>0?"indeterminate":"inactive";
  const toggleAll    = ()=>onChange(allSelected?[]:[...ALL_TOOLS]);
  const toggle       = tool=>onChange(selectedTools.includes(tool)?selectedTools.filter(t=>t!==tool):[...selectedTools,tool]);
  return (
    <div style={{background:FD.bgEl,border:`1px solid ${FD.borderSubtle}`,borderRadius:FD.r4,padding:"12px 16px",display:"flex",alignItems:"center",gap:20,flexWrap:"wrap",boxShadow:FD.sm}}>
      <span style={{fontSize:11,fontWeight:600,color:FD.cTert,textTransform:"uppercase",letterSpacing:"0.05em",whiteSpace:"nowrap"}}>BI Tools</span>
      <div style={{display:"flex",alignItems:"center",gap:16,paddingRight:16,borderRight:`1px solid ${FD.borderSubtle}`}}>
        <FDCheckbox status={allStatus} label="All" onChange={toggleAll}/>
        {!noneSelected&&!allSelected&&(
          <button onClick={()=>onChange([])} style={{background:"none",border:"none",fontSize:11,color:FD.cTert,cursor:"pointer",padding:0,fontWeight:500}}>Clear ×</button>
        )}
      </div>
      <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
        {ALL_TOOLS.map(tool=>(
          <FDCheckbox key={tool} status={selectedTools.includes(tool)?"active":"inactive"} label={tool} onChange={()=>toggle(tool)}/>
        ))}
      </div>
      <span style={{marginLeft:"auto",fontSize:11,color:FD.cTert,whiteSpace:"nowrap"}}>
        {noneSelected?"No tools selected":allSelected?"All tools selected":`${selectedTools.length} of ${ALL_TOOLS.length} selected`}
      </span>
    </div>
  );
}

// ── Small UI atoms ────────────────────────────────────────────────────────────
const Tag = ({cat})=>{
  const m=CAT_META[cat]||CAT_META["Other"];
  return <span style={{background:m.bg,color:m.text,border:`1px solid ${m.dot}44`,borderRadius:FD.r3,padding:"2px 8px",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>{cat}</span>;
};
const Btn = ({onClick,disabled,children,small})=>(
  <button onClick={onClick} disabled={disabled} style={{
    background:disabled?FD.accentDis:FD.accent,color:FD.cInv,border:"none",
    borderRadius:FD.r3,padding:small?"5px 12px":"8px 18px",fontSize:small?12:14,fontWeight:500,
    cursor:disabled?"not-allowed":"pointer",boxShadow:disabled?"none":FD.sm,
    display:"flex",alignItems:"center",gap:6,transition:"all .15s",whiteSpace:"nowrap"
  }}>{children}</button>
);
const TabBtn = ({label,active,onClick})=>(
  <button onClick={onClick} style={{
    background:active?FD.bgEl:"transparent",color:active?FD.accent:FD.cSec,
    border:active?`1px solid ${FD.borderStrong}`:"1px solid transparent",
    borderRadius:FD.r3,padding:"6px 14px",fontSize:13,fontWeight:active?600:500,
    cursor:"pointer",boxShadow:active?FD.sm:"none",transition:"all .15s"
  }}>{label}</button>
);

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [activePlatform, setActivePlatform] = useState("stackoverflow");
  const [scanning,       setScanning]       = useState(false);
  const [logs,           setLogs]           = useState([]);
  const [showLogs,       setShowLogs]       = useState(false);
  const [data,           setData]           = useState({});
  const [tab,            setTab]            = useState("heatmap");
  const [selTool,        setSelTool]        = useState(null);
  const [selCat,         setSelCat]         = useState(null);
  const [selectedTools,  setSelectedTools]  = useState([...ALL_TOOLS]);
  const [keywords,       setKeywords]       = useState("");

  const addLog = useCallback(msg=>setLogs(l=>[...l,`[${new Date().toLocaleTimeString()}] ${msg}`]),[]);

  const runScan = useCallback(async (platform)=>{
    if (!selectedTools.length) { addLog("⚠ No tools selected."); return; }
    setScanning(true); setLogs([]); setShowLogs(true); setSelTool(null); setSelCat(null);
    const plt = PLATFORMS.find(p=>p.id===platform);
    let all = [];
    for (const tool of selectedTools) {
      let posts = [];
      if (platform==="stackoverflow") {
        const raw = await fetchSOPosts(tool, addLog, keywords);
        if (raw.length) {
          const cls = await classifyPosts(raw, addLog);
          const map = Object.fromEntries(cls.map(c=>[c.id,c.category]));
          posts = raw.map(p=>({...p,category:map[p.id]||"Other"}));
        }
      } else {
        posts = await fetchAIInsights(platform, tool, addLog, keywords);
      }
      all = [...all,...posts];
      setData(d=>({...d,[platform]:[...all]}));
    }
    addLog(`✅ Done — ${all.length} total insights for ${plt.label}.`);
    setScanning(false); setTab("heatmap");
  },[addLog, selectedTools, keywords]);

  const platform  = PLATFORMS.find(p=>p.id===activePlatform);
  const posts     = data[activePlatform]||[];
  const heatmap   = ALL_TOOLS.map(tool=>{
    const row={tool};
    CATEGORIES.forEach(cat=>{row[cat]=posts.filter(p=>p.tool===tool&&p.category===cat).length;});
    return row;
  });
  const maxVal    = Math.max(...heatmap.flatMap(r=>CATEGORIES.map(c=>r[c])),1);
  const catTotals = CATEGORIES.map(cat=>({cat,count:posts.filter(p=>p.category===cat).length})).sort((a,b)=>b.count-a.count);
  const filtered  = posts.filter(p=>(!selTool||p.tool===selTool)&&(!selCat||p.category===selCat));

  return (
    <div style={{fontFamily:"'Inter',system-ui,sans-serif",background:FD.bgPage,minHeight:"100vh",padding:24}}>
      <div style={{maxWidth:1100,margin:"0 auto"}}>

        {/* Header */}
        <div style={{marginBottom:24}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:FD.accent}}/>
            <span style={{fontSize:11,fontWeight:600,color:FD.cTert,letterSpacing:"0.06em",textTransform:"uppercase"}}>Social Listening</span>
          </div>
          <h1 style={{margin:"0 0 4px",fontSize:20,fontWeight:600,color:FD.cPrim}}>BI Pain Point Radar</h1>
          <p style={{margin:0,fontSize:13,color:FD.cSec}}>Live Stack Overflow data · AI-synthesized insights for other platforms · Claude-classified</p>
        </div>

        {/* Platform + controls card */}
        <div style={{background:FD.bgEl,borderRadius:FD.r5,border:`1px solid ${FD.borderSubtle}`,padding:16,marginBottom:20,boxShadow:FD.sm}}>
          <p style={{margin:"0 0 12px",fontSize:12,fontWeight:600,color:FD.cTert,textTransform:"uppercase",letterSpacing:"0.05em"}}>Select Platform</p>

          {/* Platform buttons */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {PLATFORMS.map(p=>{
              const hasData=!!(data[p.id]?.length), isActive=activePlatform===p.id;
              return (
                <button key={p.id} onClick={()=>setActivePlatform(p.id)} style={{
                  background:isActive?p.color+"18":FD.bgSurface, color:isActive?p.color:FD.cPrim,
                  border:`1.5px solid ${isActive?p.color:FD.borderStrong}`,
                  borderRadius:FD.r4,padding:"8px 14px",fontSize:13,fontWeight:isActive?600:500,
                  cursor:"pointer",display:"flex",alignItems:"center",gap:8,
                  boxShadow:isActive?`0 0 0 3px ${p.color}22`:"none",transition:"all .15s",
                }}>
                  <span>{p.icon}</span>{p.label}
                  {p.live&&<span style={{background:FD.successBg,color:FD.success,border:`1px solid ${FD.success}44`,borderRadius:10,padding:"1px 6px",fontSize:9,fontWeight:700,letterSpacing:"0.04em"}}>LIVE</span>}
                  {hasData&&<span style={{background:p.color,color:"#fff",borderRadius:10,padding:"0 6px",fontSize:10,fontWeight:700}}>{data[p.id].length}</span>}
                </button>
              );
            })}
          </div>

          {/* Tool selector */}
          <div style={{marginTop:14}}>
            <ToolSelector selectedTools={selectedTools} onChange={setSelectedTools}/>
          </div>

          {/* Keyword input */}
          <div style={{marginTop:14,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <span style={{fontSize:11,fontWeight:600,color:FD.cTert,textTransform:"uppercase",letterSpacing:"0.05em",whiteSpace:"nowrap"}}>Focus Keywords</span>
            <FDInput value={keywords} onChange={setKeywords} placeholder="e.g. slow dashboards, licensing cost, API limits…" disabled={scanning}/>
            <span style={{fontSize:11,color:FD.cTert}}>Leave empty to scan all pain points</span>
          </div>

          {/* Platform info + scan button */}
          <div style={{marginTop:14,padding:"10px 14px",background:platform.live?FD.successBg:FD.infoBg,borderRadius:FD.r4,border:`1px solid ${platform.live?FD.success+"44":FD.accent+"44"}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div style={{fontSize:12,color:platform.live?FD.success:FD.accentHov,fontWeight:500}}>
              {platform.id==="stackoverflow"&&!SO_PROXY_URL
                ? <>🤖 AI-synthesized SO-style Q&A · <span style={{color:FD.warning,fontWeight:600}}>Deploy proxy for live data</span></>
                : platform.live
                ? `🟢 Live data — pulling real questions from ${platform.label} API`
                : `🤖 AI-synthesized — Claude generates realistic insights`}
            </div>
            <Btn onClick={()=>runScan(activePlatform)} disabled={scanning||selectedTools.length===0} small>
              {scanning
                ? <><span style={{width:10,height:10,border:"2px solid rgba(255,255,255,0.4)",borderTopColor:"#fff",borderRadius:"50%",display:"inline-block",animation:"spin .7s linear infinite"}}/> Scanning…</>
                : `${platform.icon} Scan ${platform.label}`}
            </Btn>
          </div>
        </div>

        {/* Scan log */}
        {logs.length>0&&(
          <div style={{background:FD.bgEl,border:`1px solid ${FD.borderStrong}`,borderRadius:FD.r4,marginBottom:20,overflow:"hidden"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderBottom:`1px solid ${FD.borderSubtle}`,cursor:"pointer"}} onClick={()=>setShowLogs(v=>!v)}>
              <span style={{fontSize:12,fontWeight:600,color:FD.cSec}}>🔍 Scan log ({logs.length})</span>
              <span style={{fontSize:11,color:FD.cTert}}>{showLogs?"▲ hide":"▼ show"}</span>
            </div>
            {showLogs&&(
              <div style={{padding:"10px 14px",maxHeight:140,overflowY:"auto",fontFamily:"monospace",fontSize:11,lineHeight:1.8}}>
                {logs.map((l,i)=>(
                  <div key={i} style={{color:l.includes("✓")||l.includes("✅")?FD.success:l.includes("⚠")?FD.danger:FD.cSec}}>{l}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {posts.length>0&&(
          <>
            {/* Tool pills */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
              {ALL_TOOLS.map(tool=>{
                const count=posts.filter(p=>p.tool===tool).length, active=selTool===tool;
                return (
                  <button key={tool} onClick={()=>{setSelTool(active?null:tool);setTab("posts");}} style={{
                    background:active?FD.accent:FD.bgEl,color:active?FD.cInv:FD.cPrim,
                    border:`1px solid ${active?FD.accent:FD.borderStrong}`,
                    borderRadius:FD.r3,padding:"5px 12px",fontSize:12,fontWeight:500,
                    cursor:"pointer",display:"flex",alignItems:"center",gap:6,
                    boxShadow:active?FD.sm:"none",transition:"all .15s"
                  }}>
                    {tool}
                    <span style={{background:active?"rgba(255,255,255,0.25)":FD.bgPage,borderRadius:10,padding:"0 6px",fontSize:11,fontWeight:600}}>{count}</span>
                  </button>
                );
              })}
              {selTool&&<button onClick={()=>setSelTool(null)} style={{background:"none",border:"none",color:FD.cTert,fontSize:12,cursor:"pointer",padding:"5px 4px"}}>Clear ×</button>}
            </div>

            {/* View tabs */}
            <div style={{display:"flex",gap:4,marginBottom:16,background:FD.bgPage,padding:4,borderRadius:FD.r4,width:"fit-content",border:`1px solid ${FD.borderSubtle}`}}>
              {[["heatmap","Heatmap"],["categories","By Category"],["posts","Posts"]].map(([k,l])=>(
                <TabBtn key={k} label={l} active={tab===k} onClick={()=>setTab(k)}/>
              ))}
            </div>

            {/* Heatmap */}
            {tab==="heatmap"&&(
              <div style={{background:FD.bgEl,borderRadius:FD.r5,border:`1px solid ${FD.borderSubtle}`,boxShadow:FD.sm,overflow:"hidden"}}>
                <div style={{padding:"14px 20px",borderBottom:`1px solid ${FD.borderSubtle}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:13,fontWeight:600,color:FD.cPrim}}>Tool × Pain Point Matrix <span style={{fontWeight:400,color:FD.cTert,fontSize:12}}>— {platform.icon} {platform.label}</span></span>
                  <span style={{fontSize:11,color:FD.cTert}}>Click a cell to drill into posts →</span>
                </div>
                <div style={{overflowX:"auto",padding:20}}>
                  <table style={{width:"100%",borderCollapse:"separate",borderSpacing:3,fontSize:12}}>
                    <thead>
                      <tr>
                        <th style={{textAlign:"left",padding:"4px 8px",color:FD.cTert,fontWeight:600,fontSize:11,minWidth:90}}>Tool</th>
                        {CATEGORIES.map(c=><th key={c} style={{padding:"4px 6px",color:FD.cSec,fontWeight:600,fontSize:11,textAlign:"center",whiteSpace:"nowrap"}}>{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {heatmap.map(row=>(
                        <tr key={row.tool}>
                          <td style={{padding:"6px 8px",color:FD.cPrim,fontWeight:600,fontSize:13}}>{row.tool}</td>
                          {CATEGORIES.map(cat=>{
                            const v=row[cat],m=CAT_META[cat],intensity=v/maxVal;
                            return (
                              <td key={cat} onClick={()=>{if(v>0){setSelTool(row.tool);setSelCat(cat);setTab("posts");}}}
                                title={v>0?`${row.tool} · ${cat}: ${v} posts`:""}
                                style={{padding:"8px 6px",textAlign:"center",borderRadius:FD.r3,
                                  background:v===0?FD.bgPage:m.bg,color:v===0?FD.borderStrong:m.text,
                                  fontWeight:v===0?400:700,cursor:v>0?"pointer":"default",
                                  border:`1px solid ${v>0?m.dot+"55":FD.borderSubtle}`,
                                  opacity:v===0?1:Math.max(0.45,0.3+intensity*0.7),
                                  minWidth:36,transition:"all .1s"}}>
                                {v||"—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* By Category */}
            {tab==="categories"&&(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(195px,1fr))",gap:12}}>
                {catTotals.map(({cat,count})=>{
                  const m=CAT_META[cat];
                  return (
                    <div key={cat} onClick={()=>{setSelCat(selCat===cat?null:cat);setTab("posts");}}
                      style={{background:FD.bgEl,borderRadius:FD.r5,padding:16,cursor:"pointer",
                        border:`1px solid ${selCat===cat?m.dot:FD.borderSubtle}`,
                        boxShadow:selCat===cat?FD.md:FD.sm,transition:"all .15s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:m.dot,marginTop:5}}/>
                        <span style={{fontSize:24,fontWeight:700,color:FD.cPrim}}>{count}</span>
                      </div>
                      <p style={{margin:"8px 0 4px",fontSize:13,fontWeight:600,color:FD.cPrim}}>{cat}</p>
                      <div style={{height:3,background:FD.borderSubtle,borderRadius:2}}>
                        <div style={{height:3,borderRadius:2,background:m.dot,width:`${(count/Math.max(posts.length,1))*100}%`,transition:"width .5s"}}/>
                      </div>
                      <p style={{margin:"6px 0 0",fontSize:11,color:FD.cTert}}>{((count/Math.max(posts.length,1))*100).toFixed(0)}% of insights</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Posts */}
            {tab==="posts"&&(
              <div>
                {(selTool||selCat)&&(
                  <div style={{display:"flex",gap:6,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
                    <span style={{fontSize:12,color:FD.cTert,fontWeight:500}}>Filters:</span>
                    {selTool&&<span onClick={()=>setSelTool(null)} style={{background:FD.accent+"15",color:FD.accentHov,border:`1px solid ${FD.accent}33`,borderRadius:FD.r3,padding:"3px 10px",fontSize:12,cursor:"pointer",fontWeight:600}}>{selTool} ×</span>}
                    {selCat&&<span onClick={()=>setSelCat(null)} style={{background:CAT_META[selCat].bg,color:CAT_META[selCat].text,border:`1px solid ${CAT_META[selCat].dot}44`,borderRadius:FD.r3,padding:"3px 10px",fontSize:12,cursor:"pointer",fontWeight:600}}>{selCat} ×</span>}
                    <span style={{fontSize:12,color:FD.cTert}}>· {filtered.length} posts</span>
                  </div>
                )}
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {filtered.slice(0,60).map(p=>{
                    const m=CAT_META[p.category]||CAT_META["Other"];
                    const plt=PLATFORMS.find(x=>x.id===p.platform);
                    return (
                      <div key={p.id} style={{background:FD.bgEl,borderRadius:FD.r5,padding:"14px 16px",
                        border:`1px solid ${FD.borderSubtle}`,borderLeft:`3px solid ${m.dot}`,boxShadow:FD.sm}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                          <p style={{margin:0,color:FD.cPrim,fontWeight:600,fontSize:13,flex:1,lineHeight:1.4}}>{p.title}</p>
                          <div style={{display:"flex",gap:6,flexShrink:0,alignItems:"center"}}>
                            <span style={{background:FD.bgPage,border:`1px solid ${FD.borderSubtle}`,borderRadius:FD.r3,padding:"2px 8px",fontSize:11,color:FD.cSec,fontWeight:500}}>{p.tool}</span>
                            <Tag cat={p.category}/>
                          </div>
                        </div>
                        {p.body&&<p style={{margin:"7px 0 0",fontSize:12,color:FD.cSec,lineHeight:1.6}}>{p.body}</p>}
                        {p.platform==="stackoverflow"&&(
                          <div style={{margin:"8px 0 0",display:"flex",gap:8,flexWrap:"wrap"}}>
                            <span style={{fontSize:11,background:p.is_answered?FD.successBg:FD.dangerBg,color:p.is_answered?FD.success:FD.danger,border:`1px solid ${p.is_answered?FD.success+"44":FD.danger+"44"}`,borderRadius:FD.r3,padding:"1px 7px",fontWeight:600}}>
                              {p.is_answered?"✓ Answered":"✗ Unanswered"}
                            </span>
                            <span style={{fontSize:11,color:FD.cTert}}>💬 {p.answer_count} answers</span>
                            {p.tags?.slice(0,3).map(t=>(
                              <span key={t} style={{fontSize:10,background:FD.orangeBg,color:"#c2410c",border:"1px solid #f9731644",borderRadius:FD.r3,padding:"1px 6px"}}>{t}</span>
                            ))}
                          </div>
                        )}
                        <div style={{margin:"8px 0 0",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                          <span style={{fontSize:11,color:plt?.color||FD.cTert,fontWeight:500}}>{plt?.icon} {p.subreddit_or_source}</span>
                          <span style={{fontSize:11,color:FD.cTert}}>↑ {p.score}</span>
                          {p.source_url&&(
                            <a href={p.source_url} target="_blank" rel="noreferrer" style={{fontSize:11,color:FD.accent,textDecoration:"none",display:"flex",alignItems:"center",gap:3,border:`1px solid ${FD.accent}33`,borderRadius:FD.r3,padding:"1px 7px",background:FD.infoBg,fontWeight:500}}>
                              ↗ View {plt?.live?"source":"simulated source"}
                              {!plt?.live&&<span style={{fontSize:9,color:FD.cTert}}>(AI)</span>}
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {filtered.length===0&&(
                    <div style={{background:FD.bgEl,border:`1px solid ${FD.borderSubtle}`,borderRadius:FD.r5,padding:"40px 20px",textAlign:"center"}}>
                      <p style={{color:FD.cTert,fontSize:13,margin:0}}>No posts match the current filters.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Idle state */}
        {!scanning&&posts.length===0&&(
          <div style={{background:FD.bgEl,borderRadius:FD.r5,border:`1px dashed ${FD.borderStrong}`,padding:"60px 20px",textAlign:"center"}}>
            <div style={{width:44,height:44,background:platform.live?FD.successBg:FD.infoBg,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",fontSize:20}}>{platform.icon}</div>
            <p style={{fontSize:14,fontWeight:600,color:FD.cPrim,margin:"0 0 6px"}}>
              {platform.live?`Ready to pull live ${platform.label} data`:`Ready to generate ${platform.label} insights`}
            </p>
            <p style={{fontSize:13,color:FD.cSec,margin:"0 0 20px"}}>
              {platform.live
                ?`Will fetch real questions from Stack Overflow, then classify them with Claude.`
                :`Claude will synthesize realistic pain point insights for ${platform.label}.`}
            </p>
            <Btn onClick={()=>runScan(activePlatform)}>{platform.icon} Scan {platform.label}</Btn>
          </div>
        )}

      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box} input::placeholder{color:#6b758f}`}</style>
    </div>
  );
}