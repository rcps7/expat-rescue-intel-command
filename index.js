const express = require("express");
const axios = require("axios");
const path = require("path");
const app = express();
const PORT = 3000;
// This tells your map what the Weather API key is without you having to type it in the HTML
app.get('/api/weather-key', (req, res) => {
    res.json({ key: process.env.WEATHER_API_KEY });
});

// This tells the server to send your index.html file when someone visits your site
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// This is your secure proxy for OpenSky (it hides your secret keys!)
app.get("/api/planes", async (req, res) => {
    try {
        // We use the secrets you saved in Replit
        const clientId = process.env.OPENSKY_CLIENT_ID;
        const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

        // Step 1: Get the temporary token
        const tokenParams = new URLSearchParams();
        tokenParams.append("grant_type", "client_credentials");
        tokenParams.append("client_id", clientId);
        tokenParams.append("client_secret", clientSecret);

        const tokenResponse = await axios.post(
            "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
            tokenParams,
        );
        const accessToken = tokenResponse.data.access_token;

        // Step 2: Use the token to get the live planes
        const planesResponse = await axios.get(
            "https://opensky-network.org/api/states/all",
            {
                headers: { Authorization: `Bearer ${accessToken}` },
            },
        );

        // Send the data to your webpage
        res.json(planesResponse.data);
    } catch (error) {
        console.error("Error fetching flight data:", error.message);
        res.status(500).json({ error: "Failed to fetch flight data" });
    }
});

app.listen(PORT, () => {
    console.log(`Command Center running securely on port ${PORT}`);
});
// This route fetches geopolitical alerts from GDELT
app.get('/api/intel', async (req, res) => {
    try {
        const userQuery = req.query.search || "";

        // Simplified query for 2026 stability
        // We use a broader search if no user query is provided
        let gdeltQuery = '(aviation OR "flight diversion" OR emergency)';
        if (userQuery) {
            gdeltQuery = `(${gdeltQuery} AND "${userQuery}")`;
        }

        const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(gdeltQuery)}&mode=artlist&maxrecords=10&format=json&sort=datedesc`;

        console.log("Fetching GDELT from:", url); // This shows in your Replit console

        const response = await axios.get(url, { timeout: 5000 });

        // If GDELT returns nothing, we send a clear empty array instead of an error
        const articles = response.data.articles || [];
        res.json(articles);

    } catch (error) {
        console.error("GDELT Error:", error.message);
        res.status(500).json({ error: "Intelligence feed currently unavailable" });
    }
});