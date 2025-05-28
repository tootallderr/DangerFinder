# Profile Images in Graph Visualization

## What's New

The graph visualizer now displays **profile pictures** as node images instead of simple colored circles!

## Features

### 🖼️ Profile Image Nodes
- **Circular profile pictures** replace colored circles when images are available
- **Automatic fallback** to colored circles if no image or if image fails to load
- **Clipped to circles** for consistent appearance
- **White borders** for better visibility and consistency

### ✨ Visual Enhancements
- **Drop shadows** on nodes for depth perception
- **Hover effects** with enhanced shadows
- **Consistent sizing** based on node importance (PageRank/degree)
- **Smooth transitions** and animations

## How It Works

### Data Flow
1. **Tampermonkey script** extracts profile images during scraping
2. **Backend stores** profile image URLs in the graph data
3. **Visualizer renders** images as SVG `<image>` elements with circular clipping paths
4. **Fallback system** ensures nodes always display properly

### Node Rendering Priority
1. **Profile image** (if available and loads successfully)
2. **Colored circle** (fallback based on community/importance)

### Image Requirements
- Profile images should be **publicly accessible URLs**
- **Square images work best** (they're clipped to circles)
- **Facebook profile images** are automatically extracted when available

## Fixing Queue Depth Issue

### Current Problem
Your queue contains profiles at **depth 2**, but the Tampermonkey script is set to process **depth 1** only.

### Solution Options

**Option 1: Increase Depth Limit**
```javascript
// In fb-scraper.user.js, change:
let currentDepth = GM_getValue('currentDepth', 2); // Instead of 1
```

**Option 2: Add Depth 1 Profiles**
Add some initial profiles at depth 1 to the queue manually or through the UI.

**Option 3: Process All Depths**
```javascript
// In autoNext() function, use a higher maxDepth:
const response = await sendToAPI(`/scrape/next?maxDepth=5`, null, 'GET');
```

## Viewing Results

1. **Start the backend server**: `node backend/server.js`
2. **Open visualizer**: `http://localhost:3000/visualizer/`
3. **Look for circular profile images** instead of colored dots
4. **Hover over nodes** to see enhanced effects
5. **Click nodes** to see profile details with images

## Technical Details

### SVG Implementation
- Uses `<image>` elements with `clip-path` for circular cropping
- Dynamic clipping path generation for each node
- Error handling for failed image loads

### Performance
- **Lazy loading** of images as needed
- **Efficient rendering** with D3.js
- **Graceful degradation** when images unavailable

### Browser Compatibility
- Works in all modern browsers
- SVG clipping paths are well-supported
- Fallback ensures functionality even with older browsers

## Troubleshooting

### Images Not Showing
1. Check that profile images were scraped (look in profile JSON files)
2. Verify image URLs are publicly accessible
3. Check browser console for CORS or loading errors

### Queue Not Processing
1. Verify depth settings match your queue data
2. Check current depth in Tampermonkey script
3. Ensure backend is running and accessible

### Performance Issues
1. Large images may slow rendering - profile images are typically optimized
2. Too many nodes (>1000) may require filtering
3. Use connection filter to show only highly connected nodes
