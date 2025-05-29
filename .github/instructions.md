# 📘 Facebook Social Graph Scraper — Full Project (Frontend + Backend)

Build a complete system to extract Facebook profiles, trace friendships across profiles, and build a recursive **social graph** — with a **Tampermonkey UI + Node.js backend**.

---

## 🎯 Project Objectives

- [x] Use Tampermonkey in Chrome to control scraping from logged-in Facebook
- [x] Scrape comprehensive profile data:
  - [x] Name, profile URL, profile image
  - [x] About information (work, education, location)
  - [x] Friend list with names and URLs
  - [x] Birthday/contact info
- [x] Track URLs to avoid duplicate scraping
- [x] Implement depth tracking (up to 5 levels deep)
- [x] Send scraped data to backend via API
- [x] Recursively trace relationships across profiles
- [x] Store graph in JSON/Graph database
- [x] Export and visualize the graph
- [x] Identify hidden communities through relationship analysis
- [x] Interactive web-based visualizer with real-time updates

---

## 🧱 Project Structure

```
facebook-social-graph/
├── backend/
│   ├── server.js
│   ├── routes/
│   │   └── scrape.js
│   └── data/
│       ├── profiles/
│       ├── queue.json
│       ├── visited.json
│       └── graph.json
├── tampermonkey/
│   └── fb-scraper.user.js
├── visualizer/
│   ├── index.html
│   ├── visualizer.js
│   └── README.md
├── scripts/
│   └── build-graph.js
│   └── analyze-communities.js
├── README.md
└── facebook-social-graph.md
```

---

## ✅ Step-by-Step Guide

### 1. 📁 Initialize Project

```bash
mkdir facebook-social-graph
cd facebook-social-graph
npm init -y
npm install express cors body-parser fs
```

---

### 2. 🧠 Create Node.js Backend

#### 📄 `backend/server.js`

Will handle:
- Profile storage with URL as unique identifier
- Queue management with depth tracking
- Visited URL tracking to prevent duplicates
- Community relationship mapping
- Profile image storage

---

### 3. 🧩 Enhanced Tampermonkey Script GUI

#### 📄 `tampermonkey/fb-scraper.user.js`

Features:
- Debug panel with real-time status
- Multiple scraping buttons for different sections:
  - Profile basics (name, image, URL)
  - About page (work, education, location)
  - Friends list
  - Full profile scrape
- Depth level indicator (1-5)
- Queue status display
- Navigation controls

Scraping capabilities:
- Extract profile images using proper selectors
- Navigate to About/Work sections
- Extract structured data from all relevant profile sections
- Handle pagination in Friends list

---

### 4. 👁️ Depth Management 

- Track relationship depth (up to 5 levels)
- Store depth with each profile in queue
- Implement configurable depth limit
- Visualize connection depth in final graph

---

### 5. 🔁 Improved Recursive Crawl

- Track visited URLs in `visited.json`
- Skip already-scraped profiles
- Prioritize queue by depth level
- Batch processing to avoid rate limiting
- Built-in delays between requests

---

### 6. 🧱 Advanced Graph Building

#### 📄 `scripts/build-graph.js`

- Create nodes with complete profile data
- Store profile images as base64 or URLs
- Build edges with relationship metadata
- Tag nodes with depth information
- Support filtering by depth level

---

### 7. 🔍 Community Detection

#### 📄 `scripts/analyze-communities.js`

- Implement community detection algorithms
- Identify hidden relationship clusters
- Generate reports on community structures
- Calculate centrality and importance metrics
- Highlight bridge profiles between communities

---

### 8. 📊 Visualization Improvements

- Interactive graph visualization with D3.js
- Real-time data updates and refresh
- Community coloring and detection display
- Node sizing based on centrality metrics
- Filter by depth, community, or connection count
- Export functionality for further analysis
- Full-screen presentation mode

---

## ✅ TODO CHECKLIST

* [x] Install Tampermonkey and load enhanced script with debug panel
* [x] Create multi-button interface for different scraping modes
* [x] Implement profile image extraction
* [x] Set up URL tracking system to avoid duplicates
* [x] Add depth tracking (1-5 levels)
* [x] Start backend server with enhanced storage capabilities
* [x] Implement About/Work page navigation and scraping
* [x] Build pagination handling for Friends lists
* [x] Create visited URL tracking
* [x] Enhance graph builder with community detection
* [x] Develop visualization with profile images and community highlighting
* [x] Build interactive web-based visualizer accessible from Tampermonkey UI
* [x] Add real-time graph updates and multiple layout options
* [x] Implement advanced filtering and search functionality

---

## 🧠 API Summary

| Endpoint                    | Description                             |
| --------------------------- | --------------------------------------- |
| `POST /api/profile`         | Send complete profile JSON with depth   |
| `POST /api/queue`           | Add URLs with depth info to visit next  |
| `GET /api/queue`            | Fetch remaining queue                   |
| `GET /api/visited`          | Check if URL already processed          |
| `GET /api/graph`            | Export full relationship map            |
| `GET /api/communities`      | Get detected communities                |
| `POST /api/profile-image`   | Upload profile image                    |

---
## 🚩 Future Enhancements

- [x] **Duplicate URL Prevention**: Implement tracking system to avoid re-scraping profiles. When the system finds a URL that's already been scraped, it reuses the existing data and connections without duplicating effort.
- [x] **Recursive Connection Management**: When building the social graph, properly handle recursive friend relationships by checking existing connections before adding new edges.
- [x] **Optimized Queue Processing**: Sort the scraping queue by depth level to ensure a breadth-first approach that maximizes coverage of the social network.
- [x] **Incremental Graph Building**: Update the graph in real-time as new profiles are scraped without requiring a full rebuild.
- [ ] **Advanced Community Detection**: Implement more sophisticated community detection algorithms beyond simple connected components.
- [ ] **Privacy-Focused Enhancement**: Add features to automatically detect and anonymize personal data in exported graphs.
- [ ] **Performance Optimization**: Implement pagination and lazy-loading for large graphs with thousands of nodes.
- [ ] **Alias & Similar Name Detection**: Integrate logic to detect profile aliases and similar names, linking profiles that may represent the same individual or closely related identities. This helps identify duplicate or merged profiles and improves the accuracy of the social graph.
