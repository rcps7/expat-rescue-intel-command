const express = require("express");
const path = require("path");
const Parser = require("rss-parser");
const axios = require("axios"); // Moved to the top with other imports

const app = express();
const PORT = 3000;
const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
    },
    timeout: 10000 // Added a timeout to prevent hanging
});

// Serve the Main Dashboard
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Secure Weather Key Proxy
app.get("/api/weather-key", (req, res) => {
    res.json({ key: "f40cc357f6be024566a0c703c7320ea6" }); 
});

// 🚢 NAVAL TRAFFIC ROUTE
app.get("/api/naval", async (req, res) => {
    try {
        // If you don't have a VesselFinder Key yet, use this mock data to verify your frontend map works
        const mockShips = [
            { name: "MT ARABIAN STAR", lat: 26.2, lng: 50.7, type: "Tanker", dest: "Khalifa Port" },
            { name: "USS ABRAHAM LINCOLN", lat: 25.5, lng: 52.1, type: "Military", dest: "Patrol" }
        ];
        res.json(mockShips); 
    } catch (e) { res.json([]); }
});

// ✈️ ROBUST FLIGHT ROUTE (ADSB)
app.get("/api/planes", async (req, res) => {
    try {
        const response = await axios.get("https://api.adsb.lol/v2/ladd", {
            headers: { "User-Agent": "PravasiCommand/1.0" },
            timeout: 8000
        });

        const planes = response.data.ac || [];

        const mapped = planes.map(p => {
            // Check for Emergency Squawk 7700
            const isEmergency = p.squawk === "7700";

            // Check if flight is roughly in the Gulf Box (Lat: 20-30, Lon: 45-55)
            const inGulf = (p.lat > 20 && p.lat < 30) && (p.lon > 45 && p.lon < 55);

            return {
                callsign: p.flight?.trim() || p.r || "UNKNOWN",
                lat: p.lat,
                lng: p.lon,
                alt: p.alt_baro || 0,
                emergency: isEmergency,
                gulfAlert: inGulf
            };
        }).filter(p => p.lat && p.lng);

        res.json({ states: mapped });
    } catch (error) {
        console.log("Flight feed error:", error.message);
        res.json({ states: [] });
    }
});

// 📡 GLOBAL INTEL FEED (RSS MULTI-SYNC)
app.get("/api/intel", async (req, res) => {
    const parser = new Parser({
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const sources = [
        { name: "BBC", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
        { name: "FIRST POST", url: "https://www.firstpost.com/rss/world.xml" }
    ];

    try {
        const feedPromises = sources.map(s => 
            parser.parseURL(s.url).then(f => f.items.map(i => ({
                title: `[${s.name}] ${i.title}`,
                url: i.link
            }))).catch(() => [])
        );
        const results = await Promise.all(feedPromises);
        res.json(results.flat().slice(0, 15));
    } catch (e) { res.json([]); }
});

// 🟢 SYSTEM HEARTBEAT
app.get("/api/status", async (req, res) => {
    try {
        await axios.get("https://www.google.com", { timeout: 2000 });
        res.json({ internet: "ONLINE", timestamp: new Date().toLocaleTimeString() });
    } catch (e) {
        res.json({ internet: "OFFLINE", error: e.message });
    }
});

// 🚀 IGNITION
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Pravasi Command Center Active on Port ${PORT}`);
});