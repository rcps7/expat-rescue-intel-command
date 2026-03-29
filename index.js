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

// Fallback for SPA (Single Page Application)
app.get("/*path", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- 🚀 SYSTEM IGNITION ---
const srvPort = process.env.PORT || 3000;
// Fix for "Cannot GET /alerts/..."
// This redirects any alert sub-pages back to the main dashboard 
// so the app doesn't crash with a 404.
app.get("/alerts/:id", (req, res) => {
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
