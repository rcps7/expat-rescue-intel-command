    const express = require("express");
    const path = require("path");
    const Parser = require('rss-parser');
    const fr24 = require('flightradar24-client');

    const app = express();
    const PORT = 5000;
    const parser = new Parser();
// At the top of index.js, ensure you have axios or use the native fetch if on Node 18+
    const axios = require('axios');

    // Serve the Map
    app.get("/", (req, res) => {
        res.sendFile(path.join(__dirname, "index.html"));
    });

    // Secure Weather Key Proxy
    app.get('/api/weather-key', (req, res) => {
    res.json({ key: 'f40cc357f6be024566a0c703c7320ea6' }); 
    });

    // ✈️ NEW ROBUST FLIGHT ROUTE
    app.get('/api/planes', async (req, res) => {
    try {
        const response = await axios.get('https://api.adsb.lol/v2/ladd', {
            headers: { 'User-Agent': 'PravasiCommand/1.0' },
            timeout: 8000
        });

        const planes = response.data.ac || [];

        const mapped = planes.map(p => {
            // Check for Emergency Squawk 7700
            const isEmergency = p.squawk === '7700';

            // Check if flight is roughly in the Gulf Box 
            // (Lat: 20-30, Lon: 45-55)
            const inGulf = (p.lat > 20 && p.lat < 30) && (p.lon > 45 && p.lon < 55);

            return {
                callsign: p.flight?.trim() || p.r || 'UKNOWN',
                lat: p.lat,
                lng: p.lon,
                alt: p.alt_baro || 0,
                emergency: isEmergency,
                gulfAlert: inGulf
            };
        }).filter(p => p.lat && p.lng);

        res.json({ states: mapped });
    } catch (error) {
        res.json({ states: [] });
    }
});
app.get('/api/intel', async (req, res) => {
    const sources = [
        { name: 'BBC WORLD', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
        { name: 'AL JAZEERA', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
        { name: 'UPI NEWS', url: 'https://rss.upi.com/news/news.rss' }
    ];

    try {
        const feedPromises = sources.map(source => 
            parser.parseURL(source.url).then(feed => 
                feed.items.map(item => ({
                    title: `[${source.name}] ${item.title}`,
                    url: item.link,
                    domain: source.name
                }))
            ).catch(() => []) // If one source is down, the rest continue
        );

        const results = await Promise.all(feedPromises);
        const combinedFeed = results.flat().slice(0, 15);

        // Ensure your Threat Scanner still checks this feed
        if (typeof scanForThreats === "function") scanForThreats(combinedFeed);

        res.json(combinedFeed);
    } catch (error) {
        res.json([{ title: "PRIMARY INTEL LINKS INTERRUPTED - STANDBY" }]);
    }
});

// New "Heartbeat" route to check internet connectivity
    app.get('/api/status', async (req, res) => {
    try {
        await axios.get('https://www.google.com', { timeout: 2000 });
        res.json({ internet: "ONLINE", timestamp: new Date().toLocaleTimeString() });
    } catch (e) {
        res.json({ internet: "OFFLINE", error: e.message });
    }
});

    // Keep the server alive
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Pravasi Command Center Active on Port ${PORT}`);
    });