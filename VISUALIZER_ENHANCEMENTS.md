# Facebook Social Graph Visualizer Enhancements

## Overview
Enhanced the Facebook Social Graph Visualizer with conviction data visualization and bulk selection functionality as requested.

## Implemented Features

### 1. Conviction Data Visualization
- **Visual Highlighting**: Convicted/annotated nodes are now highlighted with special colors and borders
  - High Risk (Convicted): Purple nodes with red border (`#8e44ad` with `#ff0000` border)
  - Medium Risk: Orange nodes with orange border (`#d35400` with `#ff6b35` border) 
  - Low Risk: Yellow nodes with orange border (`#f1c40f` with `#e67e22` border)
- **Enhanced Tooltips**: Now display conviction information including:
  - Risk level (HIGH/MEDIUM/LOW)
  - Category (confirmed-conviction, public-record, etc.)
  - Crime details if available
- **Updated Legend**: Added legend entries for conviction status indicators

### 2. Enhanced Node Details Panel
- **Conviction Information Display**: Shows detailed conviction data when a node is selected:
  - Risk level and category
  - Crime details (type, category, date, jurisdiction)
  - Notes and source information
  - Last updated timestamp
- **Demographic Information**: Displays age group classifications if available
- **Visual Alert**: Flagged profiles are highlighted with a red warning box

### 3. Bulk Selection System
- **Multi-Selection Mode**: Toggle button to enable/disable bulk selection
  - Button changes color when active (green background)
  - Ctrl+click or regular click in multi-select mode to select multiple nodes
- **Visual Feedback**: Selected nodes get a special glow effect
- **Selection Counter**: Real-time count of selected nodes

### 4. Demographic Marking Tools
- **Bulk Demographic Classification**: Mark multiple selected nodes as:
  - 👶 Kids
  - 👨 Adult  
  - ❓ Can't Tell
- **Selection Management**: 
  - Clear all selections
  - Select all visible nodes (respects current filters)
- **Backend Persistence**: Demographic annotations are saved to the backend

### 5. Data Integration
- **Annotations Loading**: Automatically loads annotation data from `/api/annotations` endpoint
- **Real-time Updates**: Annotations are synced with the backend in real-time
- **Error Handling**: Robust error handling for network requests and data loading

## Technical Implementation

### Backend API Integration
```javascript
// Load annotations from backend
const response = await fetch('http://localhost:3000/api/annotations');

// Save demographic annotations
await fetch('http://localhost:3000/api/annotations', {
    method: 'POST',
    body: JSON.stringify({
        profileUrl: profileUrl,
        annotation: {
            demographic: demographic,
            category: 'demographic-annotation',
            source: 'graph-visualizer-bulk-selection'
        }
    })
});
```

### Visual Styling System
```javascript
// Node color based on conviction status
getNodeColor(node) {
    const annotation = this.getAnnotationForNode(node);
    if (annotation) {
        switch (annotation.risk) {
            case 'high': return '#8e44ad';
            case 'medium': return '#d35400';
            case 'low': return '#f1c40f';
        }
    }
    // Fallback to community/importance coloring
}

// Border styling for risk indicators
getNodeBorderStyle(node) {
    const annotation = this.getAnnotationForNode(node);
    if (annotation) {
        switch (annotation.risk) {
            case 'high': return { width: 3, color: '#ff0000' };
            case 'medium': return { width: 2, color: '#ff6b35' };
            case 'low': return { width: 1, color: '#e67e22' };
        }
    }
    return { width: 1.5, color: '#fff' };
}
```

### Selection Management
```javascript
// Multi-node selection with visual feedback
toggleNodeSelection(node) {
    if (this.selectedNodes.has(node.id)) {
        this.selectedNodes.delete(node.id);
    } else {
        this.selectedNodes.add(node.id);
    }
    this.updateSelectionVisuals();
    this.updateSelectedCount();
}
```

## Data Structure Used

The visualizer works with the existing annotation structure from the backend:

```json
{
  "profileUrl": {
    "category": "confirmed-conviction",
    "source": "...",
    "notes": "...",
    "risk": "high",
    "profileName": "Name",
    "convictionDetails": {
      "type": "felony",
      "crimeCategory": "...",
      "date": "...",
      "jurisdiction": "..."
    },
    "demographic": "adult",
    "timestamp": 1748397454817,
    "lastUpdated": "2025-05-28T01:57:34.817Z"
  }
}
```

## UI Enhancements

### New Controls Added
1. **Multi-Select Button**: Toggle bulk selection mode
2. **Bulk Selection Panel**: Contains demographic marking tools
3. **Selection Counter**: Shows number of selected nodes
4. **Demographic Buttons**: Quick marking for Kids/Adult/Can't Tell
5. **Selection Management**: Clear and Select All Visible buttons

### Enhanced Legend
- Added color indicators for risk levels
- Clear visual distinction between conviction statuses
- Maintains existing community/importance indicators

## Usage Instructions

1. **View Convictions**: Convicted individuals are automatically highlighted with colored borders and special styling
2. **Single Node Details**: Click any node to see detailed information including conviction data
3. **Bulk Selection**: 
   - Click "Multi-Select" to enable bulk selection mode
   - Click nodes to select/deselect them
   - Use demographic buttons to mark selected nodes
   - Use "Clear" to deselect all or "All Visible" to select filtered nodes
4. **Filtering**: Use existing search and connection filters - bulk selection respects these filters

## Files Modified

1. **visualizer/index.html**: Added bulk selection UI controls and styling
2. **visualizer/visualizer.js**: Enhanced with conviction visualization and bulk selection functionality

## Compatibility

- Maintains full backward compatibility with existing graph data
- Works with the current backend annotation system
- Preserves all existing visualizer functionality
- Auto-refreshes data every 30 seconds to stay current

## Future Enhancements

Potential future improvements could include:
- Drag selection (rectangular selection area)
- Keyboard shortcuts for bulk operations
- Export functionality for selections
- Advanced filtering by conviction status
- Batch editing of conviction details
