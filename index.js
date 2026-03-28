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
        ticker: "https://feeds.bbci.co.uk/news/world/rss.xml", // Top scrolling
        iran: "https://www.aljazeera.com/xml/rss/all.xml", // Filtered later
        finance:
            "https://search.cnbc.com/rs/search/combinedcms/view.xml?id=10000664",
        tech: "https://www.wired.com/feed/rss",
    };

    try {
        const feedUrl = urls[req.params.category];
        if (!feedUrl) return res.status(404).json([]);

        const feed = await parser.parseURL(feedUrl);
        const articles = feed.items.slice(0, 5).map((item) => ({
            title: item.title,
            link: item.link,
        }));
        res.json(articles);
    } catch (e) {
        console.error(`Feed Error (${req.params.category}):`, e.message);
        res.json([{ title: "FEED OFFLINE", link: "#" }]);
    }
});
// 🚨 GCC MISSILE & UAV ALERTS (GitHub Tracker Proxy)
app.get("/api/alerts", async (req, res) => {
    try {
        // Provide the direct URL to the Raw JSON file in the GitHub repository.
        // E.g., const targetUrl = "https://raw.githubusercontent.com/username/gcc-missile-tracker/main/alerts.json";
        // const response = await axios.get(targetUrl, { timeout: 5000 });
        // const alertData = response.data;

        // --- MOCK DATA FOR UI TESTING ---
        // Delete this block and use the axios call above when you have the exact GitHub repo URL.
        const alertData = {
            status: "DEFCON 4",
            last_updated: new Date().toISOString(),
            active_threats: [
                {
                    id: "TR-992",
                    type: "UAV Activity",
                    region: "Northern Gulf",
                    details:
                        "Unidentified drone activity detected heading South. Airspace monitoring elevated.",
                    source: "OSINT Tracker",
                    link: "https://twitter.com/IntelCrab", // Opens in the popup
                },
            ],
        };
        // ---------------------------------

        res.json(alertData);
    } catch (e) {
        console.error("Alerts Feed Error:", e.message);
        res.json({ status: "UNKNOWN", active_threats: [] });
    }
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
