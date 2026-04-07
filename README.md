# Expat Rescue Intel Command

A real-time tactical intelligence dashboard built for expatriates and crisis responders operating in the Persian Gulf and GCC region. Combines live flight tracking, ship tracking, missile/drone alert feeds, ground infrastructure layers, a conflict index scoring system, and an AI-powered war prediction engine — all rendered on an interactive map.

Originally built for [pravasiintel.com](https://pravasiintel.com).

---

## Screenshots

> Map view with live flights, ships, ground intel layers, and GCC Conflict Index bar

![Dashboard](https://www.gdnonline.com/gdnimages/20260404/20260404162346ytjyju_T.jpg)

---

## Features

### Live Tracking
- **ADS-B Flight Tracking** — real-time aircraft positions over the Gulf via ADSB.lol, with military vs civilian classification, callsign, altitude, and speed in popups
- **AIS Ship Tracking** — live vessel positions via AISStream WebSocket, with ship name, type, speed, and flag in popups
- **Satellite Layer** — toggleable satellite/ISR overlay

### Ground Intel Layers (toggleable)
- **25 Airports** — colour-coded OPEN / RESTRICTED / CLOSED, including BDF/UAE/Saudi military airfields and civilian airports with operational status
- **24 Hospitals** — major medical facilities across Bahrain, UAE, Saudi Arabia, Kuwait, Qatar, and Oman with bed capacity and contact
- **19 Fuel Stations** — strategic fuel points on primary evacuation corridors
- **10 Named Evacuation Routes** — solid lines for CLEAR routes, dashed for CAUTION, with route descriptions

### GCC Conflict Index
- **7-country live threat bar** — UAE, Bahrain, Qatar, Kuwait, Saudi Arabia, Oman, Iran — each scored L1–L6 in real time
- Clicking any country opens a detail modal with live threat triggers, a threat meter, article count, and intel assessment
- Auto-updates every 5 minutes from live news volume and keyword severity scoring

### Missile & Drone Alert Feed — GDN Online
- Scrapes **Gulf Daily News (gdnonline.com)** Bahrain, Middle East, and World News sections every 3 minutes
- Filters articles against a 35-keyword threat vocabulary: missile, drone, intercept, BDF, IRGC, Houthi, ballistic, aggression, etc.
- Separate detection for **threat cleared / all clear / ceasefire** events
- Alerts appear in the Mission Log with a blinking **🚨 GDN ALERT** badge (red) or **✅ GDN CLEARED** badge (green)
- Every entry is clickable — links to the full GDN article
- Deduplicates by article ID across polling cycles so no story repeats

### Mission Log
- Live scrolling sidebar showing all threat events, GDN alerts, system status messages, and connection events
- Country-coded badges for UAE / BHR / QAT / KWT / SAU / OMN / IRN / GCC
- AST timestamps on every entry
- Mirrored in the mobile drawer

### Multi-Source Threat Feed
- RSS polling from BBC Middle East, Al Jazeera, UPI, and AP News
- GCC keyword filtering: strikes, evacuations, curfews, explosions, airspace closures
- Displayed in bottom panel and Mission Log

### MiroFish War Prediction Engine
- Dedicated page (`/war-prediction.html`) accessible from the dashboard
- Implements the [MiroFish](https://github.com/666ghj/MiroFish) swarm intelligence algorithm
- **5 specialist agents** debate across **3 rounds** using live GCC intelligence as seed data:
  - Senior Military Intelligence Analyst
  - Geopolitical Risk Expert
  - Regional Intelligence Officer (GCC/MENA)
  - Senior Diplomat and Conflict Mediator
  - Quantitative Risk Assessor
- Agents cross-examine each other's assessments in rounds 2 and 3, then produce a swarm consensus
- Outputs **30 / 60 / 90-day conflict probability meters** with animated bars
- Selectable regions: GCC Overall, Saudi Arabia, Iran, Bahrain, Strait of Hormuz, UAE, Yemen, Kuwait
- Powered by **Groq Llama 3.3 70B Versatile** (free tier) via streaming SSE

### News Data Grid
- **Iran Tensions** — curated live feed
- **Global Finance** — market-moving headlines
- **Cyber / Tech** — regional cyber threat news
- **GCC Strike Data** — strike event data from public sources

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| Framework | Express 5 |
| Map | Leaflet.js 1.9.4 |
| Flight data | ADSB.lol public API |
| Ship data | AISStream WebSocket API |
| News/alerts | RSS Parser + GDN Online scraper (axios + regex) |
| Conflict AI | Groq Cloud — Llama 3.3 70B Versatile |
| Streaming | Server-Sent Events (SSE) |
| Frontend | Vanilla JS, CSS3, HTML5 |
| Mobile | Responsive CSS — phones, tablets, iOS/Android |

---

## API Endpoints

| Endpoint | Description | Cache |
|---|---|---|
| `GET /api/flights` | Live ADS-B aircraft over GCC | 15s |
| `GET /api/ships` | Live AIS vessels via WebSocket | real-time |
| `GET /api/threats` | Filtered GCC threat headlines from RSS | 5 min |
| `GET /api/conflict-index` | 7-country conflict score + level | 5 min |
| `GET /api/gdn-alerts` | GDN Online missile/drone alerts | 3 min |
| `GET /api/news/:category` | News by category (iran/finance/tech) | 5 min |
| `GET /api/strikes` | GCC strike event data | 10 min |
| `POST /api/war-prediction` | SSE stream — MiroFish simulation | live |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes | Groq Cloud API key for the war prediction engine. Free tier works. Get one at [console.groq.com](https://console.groq.com) |
| `AISSTREAM_API_KEY` | Optional | AISStream key for ship tracking. Falls back to a built-in key. Get one at [aisstream.io](https://aisstream.io) |
| `PORT` | Optional | Server port. Defaults to `3000` |

---

## Installation

```bash
git clone https://github.com/your-username/expat-rescue-intel-command.git
cd expat-rescue-intel-command
npm install
```

Set your environment variables:

```bash
export GROQ_API_KEY=your_groq_key_here
```

Start the server:

```bash
node index.js
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Mobile Support

The dashboard is fully responsive for phones and tablets (Android and iOS):

- **Phones** — the Mission Log and Layer Controls become slide-out drawers triggered by floating action buttons; the bottom data panel becomes a tab strip; the conflict bar scrolls horizontally; the war prediction page navigates in-tab instead of opening a popup
- **Tablets** — panels narrow, conflict bar scrolls, layout adapts
- **iOS** — safe area insets handled for notch and home bar; can be saved to home screen as a web app

---

## Data Sources

| Source | Data | Method |
|---|---|---|
| [ADSB.lol](https://adsb.lol) | Live flight positions | REST API |
| [AISStream.io](https://aisstream.io) | Live ship positions | WebSocket |
| [GDN Online](https://www.gdnonline.com) | Bahrain/Gulf missile and drone alerts | HTML scraper |
| [BBC Middle East](https://feeds.bbci.co.uk/news/world/middle_east/rss.xml) | Regional news | RSS |
| [Al Jazeera](https://www.aljazeera.com/xml/rss/all.xml) | Regional news | RSS |
| [UPI](https://rss.upi.com/news/top_news.rss) | Breaking news | RSS |
| [AP News](https://rsshub.app/apnews/topics/mideast) | Middle East wire | RSS |
| [Groq Cloud](https://console.groq.com) | AI inference (Llama 3.3 70B) | REST API |

---

## Project Structure

```
.
├── index.js              # Express server, all API endpoints, GDN scraper, MiroFish engine
├── package.json
└── public/
    ├── index.html        # Main dashboard (map, panels, conflict bar, mission log)
    └── war-prediction.html  # MiroFish war prediction page
```

---

## Disclaimer

This dashboard is for **general informational purposes only**. Data is pulled from public sources and may be delayed, incomplete, or inaccurate. Do not use this as the sole basis for life-safety decisions. Always consult official government advisories and emergency services.

---

## License

MIT

---

## Author

Built by [Roopchand P S](mailto:gdnhd@tradearabia.net) for [Pravasi Intel](https://pravasiintel.com) — crisis intelligence for the Gulf expatriate community.
