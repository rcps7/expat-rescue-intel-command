const express = require("express");
const path = require("path");
const Parser = require("rss-parser");
const axios = require("axios");
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
            }));

        res.json(mapped);
    } catch (e) {
        console.error("Flight API Error:", e.message);
        res.json([]); // Return empty array so map doesn't break
    }
});

// 🚢 SHIPS (AIS Data)
app.get("/api/ships", async (req, res) => {
    // These coordinates are centered around the Persian Gulf
    res.json([
        {
            name: "CARGO ALPHA",
            lat: 26.5,
            lng: 50.8,
            type: "cargo",
            heading: 45,
        },
        {
            name: "USS PATROL",
            lat: 25.8,
            lng: 51.2,
            type: "military",
            heading: 120,
        },
        {
            name: "FERRY ONE",
            lat: 26.2,
            lng: 50.6,
            type: "civilian",
            heading: 200,
        },
    ]);
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

// 🚨 GCC ALERTS
app.get("/api/alerts", async (req, res) => {
    res.json({
        status: "DEFCON 3",
        active_threats: [
            {
                type: "UAV ACTIVITY",
                region: "Northern Gulf / Bushehr Sector",
                details:
                    "Low-altitude drone swarm detected. Regional air defense on high alert.",
                timestamp: new Date().toISOString(),
                link: "https://pravasiintel.com/alerts",
            },
        ],
    });
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
