# 🚨 Conviction Tracking System Explanation

## How It Works:

### 1. **Data Storage Location**
- **Where:** Browser's local storage via Tampermonkey's `GM_setValue()`
- **Key:** `'profileAnnotations'`
- **Structure:** JSON object with profile URLs as keys

### 2. **When You Mark a Conviction**

#### Option A: Quick Mark Button (🚨 Mark Conviction)
```javascript
// When you click "🚨 Mark Conviction" and fill the form:
ProfileAnnotations.set(currentUrl, {
    category: 'confirmed-conviction',  // ← This marks it as a conviction
    source: 'Court Case #12345',
    notes: 'Assault conviction from 2023',
    risk: 'high',                     // Auto-set for convictions
    profileName: 'John Doe',
    convictionDetails: {              // ← Conviction-specific data
        type: 'felony',
        crimeCategory: 'Assault',
        date: '',
        jurisdiction: ''
    }
});
```

#### Option B: Full Annotation Dialog (📝 Annotate)
```javascript
// When you select "🚨 Confirmed Conviction" from dropdown:
ProfileAnnotations.set(currentUrl, {
    category: 'confirmed-conviction',  // ← This marks it as a conviction
    source: 'Superior Court Record',
    notes: 'Convicted of aggravated assault',
    risk: 'high',
    profileName: 'John Doe',
    convictionDetails: {              // ← Full conviction details
        type: 'felony',
        crimeCategory: 'Assault',
        date: '2023-05-15',
        jurisdiction: 'Superior Court of California'
    }
});
```

### 3. **Stored Data Example**
```json
{
  "https://www.facebook.com/john.doe": {
    "category": "confirmed-conviction",
    "source": "Court Case #12345",
    "notes": "Assault conviction from 2023",
    "risk": "high",
    "profileName": "John Doe",
    "convictionDetails": {
      "type": "felony",
      "crimeCategory": "Assault",
      "date": "2023-05-15",
      "jurisdiction": "Superior Court of California"
    },
    "timestamp": 1716825600000,
    "lastUpdated": "2024-05-27T20:00:00.000Z"
  }
}
```

### 4. **How the System Recognizes Convictions**

#### Detection Logic:
```javascript
// The system checks the 'category' field:
if (annotation.category === 'confirmed-conviction') {
    // Display red warning
    // Show conviction details
    // Apply high-risk styling
}
```

#### Visual Display:
- **Red background** with white text
- **🚨 CONFIRMED CONVICTION** header
- **Conviction details** prominently displayed
- **Stays visible** (doesn't auto-hide)

### 5. **Retrieving Conviction Data**

#### Console Commands:
```javascript
// Get all convictions
FB_Scraper.getConvictions()

// Get statistics
FB_Scraper.getConvictionStats()

// Export as CSV
FB_Scraper.exportConvictions()
```

#### Filter Logic:
```javascript
getConvictions: () => {
    const annotations = GM_getValue('profileAnnotations', {});
    const convictions = {};
    for (const [url, annotation] of Object.entries(annotations)) {
        if (annotation.category === 'confirmed-conviction') {  // ← Filter by category
            convictions[url] = annotation;
        }
    }
    return convictions;
}
```

## Summary:

1. **Mark**: Click button → Fill form → Save
2. **Store**: Data saved with `category: 'confirmed-conviction'`
3. **Display**: Red warning box appears on profile
4. **Track**: System filters by category to find convictions
5. **Export**: CSV export for analysis

The key identifier is the `category: 'confirmed-conviction'` field - this is what the system uses to distinguish convictions from other annotations.
