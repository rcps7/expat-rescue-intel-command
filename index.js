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
