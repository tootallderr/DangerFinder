# Facebook Social Graph Visualizer

An interactive web-based visualization tool for exploring scraped Facebook social network data.

## Features

### 🎯 Interactive Graph Visualization
- **Force-directed layout** with drag-and-drop nodes
- **Zoom and pan** functionality for exploring large networks
- **Real-time data loading** from the backend API
- **Multiple layout options**: Force-directed, Circular, Hierarchical

### 🎨 Visual Elements
- **Node sizing** based on PageRank or degree centrality
- **Color coding** by community detection or node importance
- **Edge connections** showing friend relationships
- **Hover tooltips** with detailed node information

### 🔍 Advanced Filtering
- **Search nodes** by name
- **Filter by connection count** using range slider
- **Community highlighting** with color legends
- **Depth-based visualization** showing scraping levels

### 📊 Statistics Panel
- **Real-time metrics**: Total nodes, edges, communities
- **Selected node details**: Profile info, centrality measures
- **Community breakdown**: Member lists and sizes
- **Graph analytics**: Average degree, depth distribution

### 📤 Export Options
- **JSON export** of current graph state
- **Full-screen mode** for presentations
- **Auto-refresh** every 30 seconds during active scraping

## How to Use

### 1. Access the Visualizer

**From Tampermonkey (Recommended):**
1. Navigate to any Facebook page with the Tampermonkey script active
2. Click the **🎯 Visualizer** button in the scraper UI
3. The visualizer will open in a new window

**Direct Access:**
- Visit: `http://localhost:3000/visualizer/` (backend running)
- Or open: `visualizer/index.html` (local file)

### 2. Navigation Controls

**Mouse Controls:**
- **Click and drag** nodes to reposition them
- **Scroll wheel** to zoom in/out
- **Click empty space** and drag to pan the view
- **Click nodes** to select and view details

**Layout Options:**
- **Force-Directed**: Natural clustering based on connections
- **Circular**: Arranges all nodes in a circle
- **Hierarchical**: Groups nodes by scraping depth

### 3. Filtering and Search

**Search Box:**
- Type names to highlight specific profiles
- Non-matching nodes become transparent

**Connection Filter:**
- Use slider to show only highly connected nodes
- Useful for finding influential profiles

**Full-screen Mode:**
- Click **⛶ Fullscreen** for better viewing
- Perfect for presentations or large graphs

### 4. Understanding the Visualization

**Node Colors:**
- 🔵 **Blue (Central)**: High PageRank nodes
- 🟡 **Yellow (Bridge)**: High betweenness centrality
- 🔴 **Red (Isolated)**: Nodes with no connections
- 🟢 **Green/Others**: Community-based coloring

**Node Sizes:**
- Larger nodes have more connections or higher PageRank
- Size helps identify influential profiles at a glance

**Edge Connections:**
- Lines represent friend relationships
- Thickness may indicate relationship strength

### 5. Sidebar Information

**Graph Statistics:**
- Monitor scraping progress in real-time
- View network metrics and growth

**Selected Node Panel:**
- Click any node to see detailed information
- Profile picture, connection count, centrality scores

**Communities List:**
- Browse detected social groups
- See member counts and sample names

## Technical Details

### Data Source
The visualizer connects to the backend API at `http://localhost:3000/api/` and fetches:
- `/graph` - Node and edge data with social network metrics
- `/stats` - Overall statistics and community information

### Auto-Refresh
- Automatically refreshes every 30 seconds during active scraping
- Manual refresh with **🔄 Refresh** button
- Loading indicators show data fetch status

### Performance
- Optimized for networks up to 1000+ nodes
- Smooth animations and interactions
- Efficient D3.js rendering

### Browser Compatibility
- Modern browsers with JavaScript enabled
- Chrome, Firefox, Safari, Edge
- Responsive design for different screen sizes

## Troubleshooting

### Visualizer Won't Load
1. Ensure backend server is running (`npm start`)
2. Check console for CORS or network errors
3. Try refreshing the page
4. Verify API endpoints are responding

### No Data Showing
1. Make sure you've scraped some Facebook profiles first
2. Click **🔗 Build Graph** in Tampermonkey to generate graph data
3. Check that profile data exists in `backend/data/profiles/`
4. Verify graph.json file has been created

### Performance Issues
1. Use filtering to reduce visible nodes
2. Try different layout options
3. Close other browser tabs/applications
4. Consider using a smaller dataset for testing

### Pop-up Blocked
1. Allow pop-ups for Facebook.com in browser settings
2. Manually navigate to visualizer URL
3. Use the backend-served version at `localhost:3000/visualizer/`

## Integration with Scraper

The visualizer is designed to work seamlessly with the Facebook Social Graph Scraper:

1. **Scrape profiles** using Tampermonkey script
2. **Build graph** using the "🔗 Build Graph" button
3. **Open visualizer** using the "🎯 Visualizer" button
4. **Explore results** interactively in real-time

The visualizer updates automatically as you scrape more data, making it perfect for live monitoring of your social network analysis.
