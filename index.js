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
    timeout: 8000,
});

// Serve static files (HTML, CSS, Client JS)
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- 📡 DATA ENDPOINTS --- //

// ✈️ FLIGHTS (ADSB Proxy)
app.get("/api/flights", async (req, res) => {
    try {
        const response = await axios.get("https://api.adsb.lol/v2/ladd", {
            timeout: 5000,
        });
        const planes = response.data.ac || [];
        const mapped = planes
            .map((p) => ({
                callsign: p.flight?.trim() || "UNKNOWN",
                lat: p.lat,
                lng: p.lon,
                alt: p.alt_baro || 0,
                type:
                    p.t === "MIL" || p.flight?.startsWith("RCH")
                        ? "military"
                        : "civilian",
                heading: p.track || 0,
            }))
            .filter((p) => p.lat && p.lng);
        res.json(mapped);
    } catch (e) {
        res.json([]);
    }
});

// 🚢 SHIPS (Mocked structure - insert VesselFinder API here)
app.get("/api/ships", async (req, res) => {
    // Replace with actual AIS API call
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

// 🛰️ SATELLITES (Mocked structure - insert TLE parser here)
app.get("/api/satellites", async (req, res) => {
    res.json([
        { name: "STARLINK-102", lat: 27.0, lng: 49.0, type: "comms" },
        { name: "LANDSAT-8", lat: 24.0, lng: 52.0, type: "imaging" },
    ]);
});

// 📰 NEWS FEEDS (Categorized)
app.get("/api/news/:category", async (req, res) => {
    const urls = {
        ticker: "https://feeds.bbci.co.uk/news/world/rss.xml",
        iran: "https://www.aljazeera.com/xml/rss/all.xml", 
        finance: "https://www.cnbc.com/id/10000664/device/rss/rss.html",
        tech: "https://vancouversun.com/category/business/technology/feed"
    };

    try {
        const feedUrl = urls[req.params.category];
        const feed = await parser.parseURL(feedUrl);
        // Filter Iran news specifically if using a general feed
        let items = feed.items;
        if(req.params.category === 'iran') {
            items = items.filter(i => i.title.toLowerCase().includes('iran') || i.content.toLowerCase().includes('iran')).slice(0, 5);
        }
        res.json(items.slice(0, 5).map(item => ({ title: item.title, link: item.link })));
    } catch (e) { res.json([{ title: "FEED TEMPORARILY OFFLINE", link: "#" }]); }
});
// 🚨 GCC MISSILE & UAV ALERTS (GitHub Tracker Proxy)
app.get("/api/alerts", async (req, res) => {
    res.json({
        status: "DEFCON 3",
        active_threats: [{
            type: "UAV ACTIVITY",
            region: "Northern Gulf / Bushehr Sector",
            details: "Low-altitude drone swarm detected. Regional air defense on high alert. Avoid coastal corridors.",
            timestamp: new Date().toISOString(),
            link: "https://pravasiintel.com/alerts/uav-sector-7" // Point this to your actual info page
        }]
    });
});
// --- 🚀 SYSTEM IGNITION ---
// We check if Replit provided a port, otherwise we use 3000
const srvPort = process.env.PORT || 3000;

app.listen(srvPort, "0.0.0.0", () => {
    console.log(`
    -------------------------------------------
    🛰️  EXPAT RESCUE INTEL COMMAND ACTIVE
    -------------------------------------------
    Status: ONLINE
    Port: ${srvPort}
    -------------------------------------------
    `);
});
