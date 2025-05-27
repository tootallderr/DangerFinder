# 🕷️ Facebook Social Graph Scraper

A comprehensive system to extract Facebook profiles, trace friendships across profiles, and build a recursive social graph with advanced community detection and analysis.

## 🎯 Features

- **Advanced Tampermonkey GUI** with multiple scraping modes
- **Interactive Graph Visualizer** with real-time data display
- **Depth tracking** up to 5 levels deep
- **Node.js backend** with REST API for data storage
- **Graph building** with social network metrics
- **Community detection** using Louvain algorithm
- **Bridge node identification** for community connections
- **Multiple export formats** (JSON, CSV, GEXF)
- **Real-time scraping progress** and queue management

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Backend Server

```bash
node backend/server.js
```

The server will start on `http://localhost:3000`

### 3. Install Tampermonkey Script

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Open `tampermonkey/fb-scraper.user.js` and copy the script
3. Create a new script in Tampermonkey and paste the code
4. Save and enable the script

### 4. Start Scraping

1. Log into Facebook and navigate to any profile
2. The scraper UI will appear in the top-right corner
3. Use the different scraping modes:
   - **📋 Basic Info**: Name, URL, profile image
   - **📝 About Page**: Work, education, location
   - **👥 Friends List**: Extract friend connections
   - **🔄 Full Scrape**: Complete profile data
   - **⚡ Auto Next**: Navigate to queued profiles automatically
   - **🎯 Visualizer**: Open interactive graph visualization
   - **🔗 Build Graph**: Generate social network analysis

### 5. Visualize Your Data

Click the **🎯 Visualizer** button in the Tampermonkey UI to open the interactive graph visualizer. Features include:
- **Real-time graph visualization** with force-directed layout
- **Community detection** with color-coded clusters
- **Node filtering** and search functionality
- **Detailed statistics** and metrics panel
- **Export capabilities** for further analysis

## 📚 API Documentation

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/profile` | Store profile data |
| POST | `/api/queue` | Add URLs to scraping queue |
| GET | `/api/queue` | Get current queue status |
| GET | `/api/visited` | Check visited URLs |
| GET | `/api/graph` | Export graph data |
| GET | `/api/stats` | Get scraping statistics |
| POST | `/api/profile-image` | Store profile images |

### Example API Usage

```javascript
// Add profiles to queue
fetch('http://localhost:3000/api/queue', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    urls: ['https://facebook.com/profile1', 'https://facebook.com/profile2'],
    depth: 2
  })
});

// Get scraping statistics
fetch('http://localhost:3000/api/stats')
  .then(response => response.json())
  .then(data => console.log(data));
```

## 🧠 Graph Analysis

### Build Graph from Scraped Data

```bash
node scripts/build-graph.js build
```

### Analyze Communities

```bash
node scripts/analyze-communities.js analyze
```

### Export Data

```bash
# Export graph in different formats
node scripts/build-graph.js export json
node scripts/build-graph.js export csv
node scripts/build-graph.js export gexf

# Export community analysis
node scripts/analyze-communities.js export csv
```

## 📊 Data Structure

### Profile Data Format

```json
{
  "url": "https://facebook.com/username",
  "name": "John Doe",
  "profile_image": "https://...",
  "depth": 2,
  "about": {
    "work": ["Company Name"],
    "education": ["University"],
    "location": ["City, Country"]
  },
  "friends": [
    {
      "name": "Friend Name",
      "url": "https://facebook.com/friend"
    }
  ],
  "scraped_at": "2025-05-27T10:30:00Z"
}
```

### Graph Format

```json
{
  "nodes": [
    {
      "id": "profile_url",
      "name": "Profile Name",
      "depth": 1,
      "degree": 45,
      "pagerank": 0.0023,
      "community": 2
    }
  ],
  "edges": [
    {
      "source": "profile_url_1",
      "target": "profile_url_2",
      "type": "friend"
    }
  ]
}
```

## 🔍 Community Analysis Features

- **Louvain Algorithm**: Detect natural communities in the social graph
- **Bridge Nodes**: Find profiles that connect different communities
- **Influence Metrics**: Calculate PageRank, betweenness, and degree centrality
- **Community Statistics**: Density, conductance, and size distribution
- **Overlapping Communities**: Identify nodes that belong to multiple groups

## 📁 Project Structure

```
facebook-social-graph/
├── backend/
│   ├── server.js              # Main API server
│   ├── routes/
│   │   └── scrape.js          # Additional scraping routes
│   └── data/
│       ├── profiles/          # Individual profile JSON files
│       ├── queue.json         # URLs to scrape next
│       ├── visited.json       # Already processed URLs
│       └── graph.json         # Built graph data
├── tampermonkey/
│   └── fb-scraper.user.js     # Browser script for Facebook
├── scripts/
│   ├── build-graph.js         # Graph construction and export
│   └── analyze-communities.js # Community detection and analysis
├── package.json
└── README.md
```

## ⚙️ Configuration

Edit the `CONFIG` object in the Tampermonkey script:

```javascript
const CONFIG = {
    API_BASE: 'http://localhost:3000/api',  // Backend URL
    MAX_DEPTH: 5,                           // Maximum scraping depth
    SCRAPE_DELAY: 2000,                     // Delay between requests (ms)
    FRIEND_LIMIT: 100                       // Max friends per profile
};
```

## 🔒 Privacy and Ethics

- This tool is for **research and educational purposes only**
- Always respect Facebook's Terms of Service
- Only scrape profiles you have permission to access
- Be mindful of rate limiting and don't overload Facebook's servers
- Consider privacy implications when collecting and storing social data

## 📈 Visualization

The exported graph data can be visualized using:

- **Gephi**: Import GEXF files for advanced network visualization
- **Cytoscape**: Use JSON or CSV exports
- **D3.js**: Build custom web visualizations
- **NetworkX**: Python-based analysis and plotting

## 🐛 Troubleshooting

### Common Issues

1. **Script not loading**: Ensure Tampermonkey is enabled and script is active
2. **API connection failed**: Check that backend server is running on port 3000
3. **No profiles scraped**: Verify you're logged into Facebook and on a profile page
4. **Memory issues**: Large graphs may require increased Node.js memory limit:
   ```bash
   node --max-old-space-size=4096 scripts/build-graph.js build
   ```

### Debug Mode

Enable debug mode in the Tampermonkey script for detailed logging and element inspection.

## 📄 License

This project is for educational and research purposes. Please use responsibly and in accordance with applicable laws and terms of service.

## 🤝 Contributing

Contributions are welcome! Please consider:

- Adding new scraping capabilities
- Improving community detection algorithms
- Creating visualization tools
- Enhancing the user interface
- Adding data export formats

---

**⚠️ Important**: This tool is designed for legitimate research purposes. Always ensure you have appropriate permissions and comply with platform terms of service and applicable laws when scraping social media data.
