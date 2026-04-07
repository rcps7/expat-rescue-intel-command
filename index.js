const express = require("express");
const path = require("path");
const Parser = require("rss-parser");
const axios = require("axios");
const WebSocket = require("ws");
const app = express();

// RSS Parser with Browser Headers to bypass blocks
const parser = new Parser({
    headers: {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    timeout: 10000, // Increased to 10s for slower news servers
});

// Serve static files (HTML, CSS, Client JS)
app.use(express.static(path.join(__dirname, "public")));

// --- 📡 DATA ENDPOINTS --- //

// ✈️ FLIGHTS (ADSB Proxy)
app.get("/api/flights", async (req, res) => {
    try {
        // Using a more robust timeout and validation
        const response = await axios.get("https://api.adsb.lol/v2/ladd", {
            timeout: 8000,
        });

        const planes = response.data.ac || [];
        const mapped = planes
            .filter((p) => p.lat && p.lon) // Ensure they have coordinates
            .map((p) => ({
                callsign: (p.flight || p.r || "UKN").trim(),
                lat: p.lat,
                lng: p.lon,
                alt: p.alt_baro || 0,
                type:
                    p.t === "MIL" || (p.flight && p.flight.startsWith("RCH"))
                        ? "military"
                        : "civilian",
                heading: p.track || 0,
                speed: p.gs || 0,
                squawk: p.squawk || "----",
                category: p.category || "Unknown",
            }));

        res.json(mapped);
    } catch (e) {
        console.error("Flight API Error:", e.message);
        res.json([]); // Return empty array so map doesn't break
    }
});

// 🚢 LIVE SHIP TRACKING (AISStream WebSocket)
const AISSTREAM_KEY = process.env.AISSTREAM_API_KEY || "e0bf3e4d8906f9f39685f304920ca8d37a9a081f";
const shipRegistry = new Map(); // MMSI -> ship data

function connectAISStream() {
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

    ws.on("open", () => {
        console.log("✅ AISStream connected — live ship feed active");
        ws.send(JSON.stringify({
            APIKey: AISSTREAM_KEY,
            BoundingBoxes: [[[22.0, 48.0], [28.0, 58.0]]], // Persian Gulf
            FilterMessageTypes: ["PositionReport"]
        }));
    });

    ws.on("message", (data) => {
        try {
            const msg = JSON.parse(data);
            const pos = msg.Message?.PositionReport;
            const meta = msg.MetaData;
            if (!pos || !meta) return;

            const mmsi = String(meta.MMSI);
            const lat = pos.Latitude;
            const lng = pos.Longitude;
            if (!lat || !lng || lat === 0 || lng === 0) return;

            shipRegistry.set(mmsi, {
                name: (meta.ShipName || mmsi).trim(),
                mmsi,
                lat,
                lng,
                heading: pos.TrueHeading < 360 ? pos.TrueHeading : (pos.Cog || 0),
                speed: pos.Sog || 0,
                type: pos.NavigationalStatus === 5 ? "moored" : "civilian",
                updated: Date.now()
            });
        } catch (e) {}
    });

    ws.on("close", () => {
        console.log("⚠️  AISStream disconnected — reconnecting in 10s");
        setTimeout(connectAISStream, 10000);
    });

    ws.on("error", (err) => {
        console.error("AISStream error:", err.message);
        ws.terminate();
    });
}

connectAISStream();

// Purge ships not updated in last 10 minutes
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [mmsi, ship] of shipRegistry) {
        if (ship.updated < cutoff) shipRegistry.delete(mmsi);
    }
}, 60000);

app.get("/api/ships", (req, res) => {
    const ships = Array.from(shipRegistry.values());
    res.json(ships.length > 0 ? ships : []);
});

// 🛰️ SATELLITES
app.get("/api/satellites", async (req, res) => {
    res.json([
        { name: "STARLINK-102", lat: 27.0, lng: 49.0, type: "comms" },
        { name: "LANDSAT-8", lat: 24.0, lng: 52.0, type: "imaging" },
    ]);
});

// 📰 NEWS FEEDS (Fixed logic for undefined categories)
app.get("/api/news/:category", async (req, res) => {
    const urls = {
        ticker: "https://feeds.bbci.co.uk/news/world/rss.xml",
        iran: "https://www.aljazeera.com/xml/rss/all.xml",
        finance: "https://www.cnbc.com/id/10000664/device/rss/rss.html",
        tech: "https://vancouversun.com/category/business/technology/feed",
    };

    const category = req.params.category;
    const feedUrl = urls[category];

    if (!feedUrl) {
        return res.status(404).json({ error: "Category not found" });
    }

    try {
        const feed = await parser.parseURL(feedUrl);
        let items = feed.items || [];

        // Special logic for Iran: filter general feeds for specific keywords
        if (category === "iran") {
            items = items.filter((i) => {
                const content = (
                    i.title + i.contentSnippet + i.content || ""
                ).toLowerCase();
                return content.includes("iran") || content.includes("tehran");
            });
        }

        const formatted = items.slice(0, 8).map((item) => ({
            title: item.title,
            link: item.link,
            isoDate: item.isoDate,
        }));

        res.json(formatted);
    } catch (e) {
        console.error(`RSS Error (${category}):`, e.message);
        res.json([
            { title: `FEED [${category.toUpperCase()}] OFFLINE`, link: "#" },
        ]);
    }
});

// 🚨 GCC LIVE THREAT FEED (Multi-source RSS — keyword filtered for GCC threats)
const THREAT_FEEDS = [
    { name: "BBC MidEast",  url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml" },
    { name: "Al Jazeera",   url: "https://www.aljazeera.com/xml/rss/all.xml" },
    { name: "UPI",          url: "https://rss.upi.com/news/news.rss" },
    { name: "AP News",      url: "https://rsshub.app/apnews/topics/mideast" },
];

const THREAT_KEYWORDS = [
    "missile", "ballistic", "drone", "UAV", "airstrike", "air strike", "intercept",
    "explosion", "attack", "Houthi", "IRGC", "rocket", "military", "strike", "threat",
    "defense", "Gulf", "GCC", "Bahrain", "UAE", "Qatar", "Kuwait", "Saudi", "Oman", "Iran"
];

const COUNTRY_MAP = {
    UAE:  ["UAE", "Abu Dhabi", "Dubai", "Emirates"],
    BHR:  ["Bahrain", "Manama", "BDF"],
    QAT:  ["Qatar", "Doha"],
    KWT:  ["Kuwait"],
    SAU:  ["Saudi", "Riyadh", "Jeddah", "KSA"],
    OMN:  ["Oman", "Muscat"],
    IRN:  ["Iran", "Tehran", "IRGC", "Khamenei", "Houthi"],
};

// Shared raw feed cache (used by both /api/threats and /api/conflict-index)
let rawFeedCache = null;
let rawFeedCacheTime = 0;

async function fetchRawFeed() {
    if (rawFeedCache && Date.now() - rawFeedCacheTime < 5 * 60 * 1000) {
        return rawFeedCache;
    }
    const feedResults = await Promise.all(
        THREAT_FEEDS.map(f =>
            parser.parseURL(f.url)
                .then(feed => feed.items.map(item => ({ ...item, _source: f.name })))
                .catch(() => [])
        )
    );
    rawFeedCache = feedResults.flat();
    rawFeedCacheTime = Date.now();
    return rawFeedCache;
}

// Conflict scoring — weights applied per article
const SEVERITY_WEIGHTS = [
    { words: ["ballistic missile", "airstrike", "air strike", "killed", "dead", "destroyed", "bomb", "explosion"], score: 3 },
    { words: ["missile", "drone attack", "attack", "strike", "rocket", "intercept", "Houthi", "IRGC", "warplane"], score: 2 },
    { words: ["threat", "tension", "military", "sanction", "warning", "troops", "conflict", "confrontation"], score: 1 },
    { words: ["diplomacy", "ceasefire", "peace", "talks", "agreement", "withdraw"], score: -1 },
];

// Geopolitical baseline levels (1=Minimal → 6=Critical)
const BASELINE_LEVELS = { UAE: 2, BHR: 3, QAT: 2, KWT: 2, SAU: 5, OMN: 1, IRN: 6 };

// Score thresholds: raw article score → level delta (+/-)
function scoreToDelta(score) {
    if (score >= 20) return 2;
    if (score >= 10) return 1;
    if (score >= 5)  return 0;
    if (score >= 1)  return 0;
    if (score <= -3) return -1;
    return 0;
}

let conflictIndexCache = null;
let conflictIndexCacheTime = 0;

app.get("/api/conflict-index", async (req, res) => {
    if (conflictIndexCache && Date.now() - conflictIndexCacheTime < 5 * 60 * 1000) {
        return res.json(conflictIndexCache);
    }
    try {
        const items = await fetchRawFeed();
        const now = Date.now();
        const WINDOW_MS = 6 * 60 * 60 * 1000; // 6-hour window

        const result = {};
        for (const [code, countryNames] of Object.entries(COUNTRY_MAP)) {
            const relevant = items.filter(item => {
                const text = ((item.title || "") + " " + (item.contentSnippet || "")).toUpperCase();
                const age = now - new Date(item.isoDate || 0).getTime();
                return age < WINDOW_MS && countryNames.some(n => text.includes(n.toUpperCase()));
            });

            let rawScore = 0;
            const triggeredHeadlines = [];
            relevant.forEach(item => {
                const text = ((item.title || "") + " " + (item.contentSnippet || "")).toLowerCase();
                let itemScore = 0;
                for (const bucket of SEVERITY_WEIGHTS) {
                    if (bucket.words.some(w => text.includes(w))) {
                        itemScore += bucket.score;
                    }
                }
                rawScore += itemScore;
                if (itemScore > 0 && item.title) triggeredHeadlines.push(item.title);
            });

            const baseline = BASELINE_LEVELS[code] || 3;
            const delta = scoreToDelta(rawScore);
            const level = Math.min(6, Math.max(1, baseline + delta));

            result[code] = {
                level,
                baseline,
                delta,
                articleCount: relevant.length,
                rawScore,
                triggers: triggeredHeadlines.slice(0, 3),
                updatedAt: new Date().toISOString(),
            };
        }

        conflictIndexCache = result;
        conflictIndexCacheTime = Date.now();
        res.json(result);
    } catch (e) {
        console.error("Conflict index error:", e.message);
        // Return baseline levels as fallback
        const fallback = {};
        for (const [code, lvl] of Object.entries(BASELINE_LEVELS)) {
            fallback[code] = { level: lvl, baseline: lvl, delta: 0, articleCount: 0, rawScore: 0, triggers: [], updatedAt: new Date().toISOString() };
        }
        res.json(fallback);
    }
});

let threatCache = null;
let threatCacheTime = 0;

app.get("/api/threats", async (req, res) => {
    if (threatCache && Date.now() - threatCacheTime < 5 * 60 * 1000) {
        return res.json(threatCache);
    }
    try {
        const all = await fetchRawFeed();
        const seen = new Set();

        const threats = all
            .filter(item => {
                const text = ((item.title || "") + " " + (item.contentSnippet || "")).toLowerCase();
                return THREAT_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
            })
            .filter(item => {
                const key = (item.title || "").slice(0, 60);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => new Date(b.isoDate || 0) - new Date(a.isoDate || 0))
            .slice(0, 20)
            .map(item => {
                const text = ((item.title || "") + " " + (item.contentSnippet || "")).toUpperCase();
                let country = "GCC";
                for (const [code, keywords] of Object.entries(COUNTRY_MAP)) {
                    if (keywords.some(k => text.includes(k.toUpperCase()))) {
                        country = code;
                        break;
                    }
                }
                return {
                    title: item.title,
                    url: item.link,
                    country,
                    timestamp: item.isoDate || new Date().toISOString(),
                    source: item._source,
                };
            });

        threatCache = threats;
        threatCacheTime = Date.now();
        res.json(threats);
    } catch (e) {
        console.error("Threat feed error:", e.message);
        res.json([]);
    }
});

// 🚨 GCC STRIKE DATA (from uae-dashboard GitHub repo — updated daily)
const STRIKE_BASE = "https://raw.githubusercontent.com/takahser/uae-dashboard/main/public";
const STRIKE_COUNTRIES = [
    { key: "uae",    label: "🇦🇪 UAE",    flag: "UAE" },
    { key: "saudi",  label: "🇸🇦 SAUDI",  flag: "KSA" },
    { key: "qatar",  label: "🇶🇦 QATAR",  flag: "QAT" },
    { key: "kuwait", label: "🇰🇼 KUWAIT", flag: "KWT" },
    { key: "bahrain",label: "🇧🇭 BAHRAIN",flag: "BHR" },
    { key: "oman",   label: "🇴🇲 OMAN",   flag: "OMN" },
];

let strikeCache = null;
let strikeCacheTime = 0;

app.get("/api/strikes", async (req, res) => {
    if (strikeCache && Date.now() - strikeCacheTime < 10 * 60 * 1000) {
        return res.json(strikeCache);
    }
    try {
        const results = await Promise.all(
            STRIKE_COUNTRIES.map(async (c) => {
                try {
                    const r = await axios.get(`${STRIKE_BASE}/data-${c.key}.json`, { timeout: 8000 });
                    const d = r.data;
                    const cum = d.cumulative || {};
                    const lastDay = (d.daily || []).slice(-1)[0] || {};
                    return {
                        key: c.key,
                        label: c.label,
                        lastUpdated: d.lastUpdated,
                        cumulative: {
                            ballisticDetected: cum.ballisticDetected || 0,
                            ballisticIntercepted: cum.ballisticIntercepted || 0,
                            ballisticSea: cum.ballisticSea || 0,
                            ballisticImpacted: cum.ballisticImpacted || 0,
                            dronesDetected: cum.dronesDetected || 0,
                            dronesIntercepted: cum.dronesIntercepted || 0,
                            dronesImpacted: cum.dronesImpacted || 0,
                            cruiseDetected: cum.cruiseDetected || 0,
                            cruiseIntercepted: cum.cruiseIntercepted || 0,
                            cruiseImpacted: cum.cruiseImpacted || 0,
                            killed: cum.killed || 0,
                            injured: cum.injured || 0,
                        },
                        latest: {
                            date: lastDay.date || null,
                            label: lastDay.label || null,
                            total: lastDay.total || 0,
                            ballisticDetected: lastDay.ballisticDetected || 0,
                            dronesDetected: lastDay.dronesDetected || 0,
                        },
                    };
                } catch (e) {
                    return { key: c.key, label: c.label, error: true };
                }
            })
        );
        strikeCache = results;
        strikeCacheTime = Date.now();
        res.json(results);
    } catch (e) {
        res.json([]);
    }
});

// ─────────────────────────────────────────────
// 🚨 GDN ONLINE ALERT SCRAPER
// Scrapes gdnonline.com Bahrain + Middle East
// sections for missile/drone/attack alerts.
// ─────────────────────────────────────────────
const GDN_SECTIONS = [
    "https://www.gdnonline.com/Section/1/Bahrain-News",
    "https://www.gdnonline.com/GroupSection/MiddleEastNews",
    "https://www.gdnonline.com/Section/3/World-News",
];

const ALERT_KEYWORDS = [
    "missile","rocket","drone","uav","attack","strike","intercept",
    "explosion","blast","siren","air defence","air defense","air raid",
    "bdf","bahrain defence force","emergency","evacuation",
    "bomb","artillery","projectile","debris","aggression","shelling",
    "missile launch","rocket launch","fired at","shoot down","shot down",
    "ballistic","hypersonic","houthi","hezbollah","hamas","irgc",
    "iranian attack","iran attack","iranian aggression","iran war",
    "iranian drone","iranian missile","iranian strike",
];

const CLEARED_KEYWORDS = [
    "all clear","threat cleared","cleared","safe","resumed","lifted",
    "normal operations","ended","ceased","ceasefire","stand down",
    "no threat","threat passed","threat over",
];

let gdnCache = { data: [], fetchedAt: 0 };
const GDN_TTL = 3 * 60 * 1000; // 3-minute refresh for live alerts

async function scrapeGDN() {
    if (Date.now() - gdnCache.fetchedAt < GDN_TTL && gdnCache.data.length) {
        return gdnCache.data;
    }

    const seen = new Set();
    const results = [];

    // Regex: extract /Details/{id}/{slug} + inline link text
    const linkRe = /<a\s+href="(\/Details\/(\d+)\/[^"]+)">([^<]{10,})<\/a>/g;

    for (const url of GDN_SECTIONS) {
        try {
            const resp = await axios.get(url, {
                timeout: 12000,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
                    "Accept": "text/html",
                },
            });
            const html = resp.data;
            let m;
            linkRe.lastIndex = 0;
            while ((m = linkRe.exec(html)) !== null) {
                const [, artPath, articleId, rawTitle] = m;
                if (seen.has(articleId)) continue;
                seen.add(articleId);

                const title = rawTitle.trim().replace(/\s+/g, " ");
                const lower = title.toLowerCase();

                // Skip non-news nav links
                if (title.length < 15 || /read more|subscribe|follow us|advertise/i.test(title)) continue;

                const isAlert   = ALERT_KEYWORDS.some(k => lower.includes(k));
                const isCleared = CLEARED_KEYWORDS.some(k => lower.includes(k));

                if (!isAlert && !isCleared) continue;

                // Cleared overrides alert if both match
                const type = isCleared ? "cleared" : "alert";

                results.push({
                    id: articleId,
                    title,
                    url: `https://www.gdnonline.com${artPath}`,
                    type,
                    source: "GDN",
                    fetchedAt: Date.now(),
                });
            }
        } catch (e) {
            console.error(`GDN scrape failed for ${url}:`, e.message);
        }
    }

    // Sort by article ID descending (higher ID = more recent)
    results.sort((a, b) => Number(b.id) - Number(a.id));

    gdnCache = { data: results, fetchedAt: Date.now() };
    return results;
}

app.get("/api/gdn-alerts", async (req, res) => {
    try {
        const alerts = await scrapeGDN();
        res.json(alerts);
    } catch (e) {
        console.error("GDN endpoint error:", e.message);
        res.json([]);
    }
});

// ─────────────────────────────────────────────
// 🛰️ BHMONITOR PROXY — Live MOI Bahrain feed
// Pulls from bhmonitor.com open API (no key needed)
// Sources: MOI Bahrain @moi_bahrain via BHMonitor
// ─────────────────────────────────────────────
let bhmCache = { data: null, fetchedAt: 0 };
const BHM_TTL = 30 * 1000; // 30-second cache

async function fetchBHMonitor() {
    if (bhmCache.data && Date.now() - bhmCache.fetchedAt < BHM_TTL) {
        return bhmCache.data;
    }
    const headers = { "Accept": "application/json", "User-Agent": "Mozilla/5.0" };
    const base = "https://bhmonitor.com";
    const [statusRes, sirenRes, feedRes] = await Promise.allSettled([
        axios.get(`${base}/api/status`, { timeout: 8000, headers }),
        axios.get(`${base}/api/siren`, { timeout: 8000, headers }),
        axios.get(`${base}/api/feed`, { timeout: 8000, headers }),
    ]);

    const status = statusRes.status === "fulfilled" ? statusRes.value.data : null;
    const siren  = sirenRes.status  === "fulfilled" ? sirenRes.value.data  : null;
    const feed   = feedRes.status   === "fulfilled" ? feedRes.value.data   : [];

    const data = { status, siren, feed: Array.isArray(feed) ? feed.slice(0, 30) : [] };
    bhmCache = { data, fetchedAt: Date.now() };
    return data;
}

// Static BHMonitor shelter + hospital locations
app.get("/api/bhm-locations", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "bhm-locations.json"));
});

app.get("/api/bhmonitor", async (req, res) => {
    try {
        const data = await fetchBHMonitor();
        res.json(data);
    } catch (e) {
        console.error("BHMonitor proxy error:", e.message);
        res.json({ status: null, siren: null, feed: [] });
    }
});

// --- 🚀 SYSTEM IGNITION ---
const srvPort = process.env.PORT || 3000;

// Fallback for SPA — must come AFTER all /api/* routes
app.get("/alerts/:id", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/*path", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(srvPort, "0.0.0.0", () => {
    console.log(`
    -------------------------------------------
    🛰️  EXPAT RESCUE INTEL COMMAND ACTIVE
    -------------------------------------------
    Status: ONLINE
    Environment: ${process.env.NODE_ENV || "development"}
    Port: ${srvPort}
    Target: http://localhost:${srvPort}
    -------------------------------------------
    `);
});

// ═══════════════════════════════════════════
// 🧠 WAR PREDICTION ENGINE (MiroFish Algorithm)
// Multi-agent swarm intelligence via Groq (free)
// ═══════════════════════════════════════════

app.use(express.json());

const SWARM_AGENTS = [
    { id: "military",    role: "Senior Military Intelligence Analyst",        style: "analytical, data-driven, focuses on force disposition and capability comparisons" },
    { id: "geopolitical",role: "Geopolitical Risk Expert",                     style: "strategic, considers historical patterns and alliance dynamics" },
    { id: "intel",       role: "Regional Intelligence Officer (GCC/MENA)",     style: "intelligence-community perspective, source-based, threat actor focused" },
    { id: "diplomatic",  role: "Senior Diplomat and Conflict Mediator",        style: "de-escalation biased, considers backchannel diplomacy and off-ramps" },
    { id: "risk",        role: "Quantitative Risk Assessor",                   style: "probability-driven, scenario-weighted, presents confidence intervals" },
];

async function callGroq(messages, apiKey) {
    const r = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model: "llama-3.3-70b-versatile", messages, temperature: 0.7, max_tokens: 600 },
        { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 30000 }
    );
    return r.data.choices[0].message.content;
}

app.post("/api/war-prediction", async (req, res) => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        return res.status(503).json({ error: "NO_KEY", message: "GROQ_API_KEY not configured" });
    }

    const { region = "GCC" } = req.body;

    // Set up SSE streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (type, payload) => {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    try {
        // === COLLECT LIVE INTELLIGENCE SEED DATA ===
        send("status", { msg: "Collecting live intelligence data..." });

        const [threatData, conflictData] = await Promise.all([
            axios.get(`http://localhost:${srvPort}/api/threats`).then(r => r.data).catch(() => []),
            axios.get(`http://localhost:${srvPort}/api/conflict-index`).then(r => r.data).catch(() => ({})),
        ]);

        const headlines = threatData.slice(0, 8).map(t => `[${t.country}] ${t.title}`).join("\n");
        const conflictSummary = Object.entries(conflictData).map(([c, d]) =>
            `${c}: Level ${d.level}/6 (score:${d.rawScore}, articles:${d.articleCount}, delta:${d.delta > 0 ? "+" : ""}${d.delta})`
        ).join("\n");

        const seedContext = `
LIVE INTELLIGENCE FEED — ${new Date().toUTCString()}
TARGET REGION: ${region}

=== CONFLICT INDEX (real-time, last 6h) ===
${conflictSummary || "No data"}

=== RECENT THREAT HEADLINES ===
${headlines || "No recent headlines"}

=== ANALYSIS PARAMETERS ===
- Time horizon: 30, 60, 90 days
- Scope: Armed conflict escalation, military strikes, proxy warfare
- Geographic focus: Persian Gulf / GCC region`;

        send("seed", { context: seedContext });

        // === ROUND 1: Independent Assessments ===
        send("round", { n: 1, msg: "Round 1 — Independent agent assessments" });
        const round1 = {};

        for (const agent of SWARM_AGENTS) {
            send("agent_start", { id: agent.id, role: agent.role, round: 1 });
            const response = await callGroq([
                {
                    role: "system",
                    content: `You are a ${agent.role}. Your analytical style is: ${agent.style}. Provide concise, expert analysis in 3-4 sentences. End with a probability estimate for armed conflict escalation in the next 90 days as: PROBABILITY: X%`
                },
                {
                    role: "user",
                    content: `Based on this live intelligence data, assess the risk of armed conflict escalation in the ${region} region:\n\n${seedContext}`
                }
            ], apiKey);
            round1[agent.id] = response;
            send("agent_output", { id: agent.id, role: agent.role, round: 1, text: response });
        }

        // === ROUND 2: Cross-pollination ===
        send("round", { n: 2, msg: "Round 2 — Agents review peer assessments and refine" });
        const round2 = {};
        const round1Summary = SWARM_AGENTS.map(a => `[${a.role}]: ${round1[a.id]}`).join("\n\n");

        for (const agent of SWARM_AGENTS) {
            send("agent_start", { id: agent.id, role: agent.role, round: 2 });
            const response = await callGroq([
                {
                    role: "system",
                    content: `You are a ${agent.role}. Your style: ${agent.style}. Review peer assessments and refine your position. Agree or challenge specific points. End with updated: PROBABILITY: X%`
                },
                {
                    role: "user",
                    content: `Your peers' Round 1 assessments:\n\n${round1Summary}\n\nRefine your analysis of ${region} conflict risk. Challenge or support specific points from your colleagues.`
                }
            ], apiKey);
            round2[agent.id] = response;
            send("agent_output", { id: agent.id, role: agent.role, round: 2, text: response });
        }

        // === ROUND 3: Final Prediction ===
        send("round", { n: 3, msg: "Round 3 — Final probability convergence" });
        const round3 = {};
        const round2Summary = SWARM_AGENTS.map(a => `[${a.role}]: ${round2[a.id]}`).join("\n\n");

        for (const agent of SWARM_AGENTS) {
            send("agent_start", { id: agent.id, role: agent.role, round: 3 });
            const response = await callGroq([
                {
                    role: "system",
                    content: `You are a ${agent.role}. Deliver your FINAL verdict. State: (1) Final probability % for armed escalation in 30/60/90 days, (2) top 2 triggering indicators to watch, (3) single most likely scenario. Format: FINAL_PROBABILITY_30D: X% | FINAL_PROBABILITY_60D: X% | FINAL_PROBABILITY_90D: X%`
                },
                {
                    role: "user",
                    content: `After 2 rounds of debate, deliver your final prediction for ${region}.\n\nPeer refinements:\n${round2Summary}`
                }
            ], apiKey);
            round3[agent.id] = response;
            send("agent_output", { id: agent.id, role: agent.role, round: 3, text: response });
        }

        // === SYNTHESIS: Swarm Convergence ===
        send("status", { msg: "Computing swarm consensus..." });
        const allOutputs = SWARM_AGENTS.map(a =>
            `[${a.role}]:\nR1: ${round1[a.id]}\nR3: ${round3[a.id]}`
        ).join("\n\n---\n\n");

        const synthesis = await callGroq([
            {
                role: "system",
                content: "You are the MiroFish Swarm Synthesis Engine. Aggregate 5 expert agents into a final consensus report. Structure: CONSENSUS PROBABILITY (30/60/90 day), KEY ESCALATION TRIGGERS, KEY DE-ESCALATION FACTORS, MOST LIKELY SCENARIO, WATCH LIST (top 3 indicators). Be precise and actionable."
            },
            {
                role: "user",
                content: `Synthesize these 5 expert final assessments into a GCC War Prediction consensus for ${region}:\n\n${allOutputs}\n\nSeed data:\n${seedContext}`
            }
        ], apiKey);

        send("synthesis", { text: synthesis, agents: SWARM_AGENTS.length, rounds: 3, region });
        send("done", { msg: "Simulation complete" });
        res.end();

    } catch (e) {
        console.error("War prediction error:", e.message);
        send("error", { msg: e.response?.data?.error?.message || e.message });
        res.end();
    }
});
