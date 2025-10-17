# Radar Labeler

A web-based annotation tool for labeling boats and buoys in radar and aerial images. Perfect for maritime surveillance, research, and dataset creation.

![React](https://img.shields.io/badge/React-18.2-blue)
![Vite](https://img.shields.io/badge/Vite-5.0-purple)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Multi-frame annotation**: Load and annotate image sequences
- **Flexible annotations**:
  - Point annotations for precise marking
  - Bounding box annotations for area coverage
  - Separate frame and global annotation layers
- **Intuitive controls**:
  - Zoom (0.2x - 32x) with image-center focus
  - Pan and rotation support
  - Keyboard shortcuts for efficiency
- **Smart frame management**:
  - View and verify frame order
  - Sort frames alphabetically
  - Click to jump between frames
- **Project persistence**:
  - Save/load projects as JSON
  - Auto-backup to browser localStorage
  - Live file writing to chosen location
  - Download project backups
- **Dark theme UI** with color-coded annotations

## Installation

### Prerequisites
- Node.js 18+ and npm

### Setup

```bash
# Clone the repository
git clone https://github.com/j-vaught/radar-labeler.git
cd radar-labeler

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

The app will open at `http://localhost:5173`

## Quick Start

1. **Load images**: Click "📂 Open Image" or "📁 Open Folder" to load radar/aerial images
2. **Select tool**: Choose annotation tool (1-4 keys or buttons)
3. **Annotate**:
   - Point tools: Click to place
   - Box tools: Click for default size, drag to custom size
4. **Save project**: Click "Choose Save File" for auto-save, or "💾 Backup Download"
5. **Load project**: Click "📥 Load Project" to restore saved work

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` | Boat Point tool |
| `2` | Boat Box tool |
| `3` | Buoy Point tool |
| `4` | Buoy Box tool |
| `ESC` | Select tool |
| `Space` | Pan mode (hold) |
| `+` / `-` | Zoom in/out |
| `[` / `]` | Rotate ±0.1° |
| `N/D` | Next frame |
| `P/A` | Previous frame |
| `Shift+Arrow` | Frame navigation |
| `Delete` / `Backspace` | Delete selected annotation |
| `Ctrl+S` / `Cmd+S` | Save |

## Annotation Types

### Boats (Green #22dd22)
- Frame-specific annotations
- Rotate with the image
- Point or box format

### Buoys (Cyan #00dddd)
- Global annotations (apply across all frames)
- Fixed coordinate system
- Point or box format

## UI Layout

```
┌─────────────────────────────────────┐
│         Radar Labeler              │
├──────────────┬──────────────────────┤
│   Sidebar    │                      │
│   (300px)    │     Canvas           │
│              │                      │
│  • File      │                      │
│  • Tools     │  [Image with         │
│  • Zoom      │   annotations]       │
│  • Rotation  │                      │
│  • Boats     │                      │
│  • Buoys     │                      │
│  • Nav       │                      │
│  • Status    │                      │
└──────────────┴──────────────────────┘
```

## Project File Format

Projects are saved as JSON:

```json
{
  "version": 1,
  "createdAt": "2024-10-17T12:00:00Z",
  "viewport": {
    "zoom": 1.5,
    "panX": 100,
    "panY": 50
  },
  "currentIndex": 0,
  "frames": [
    {
      "name": "image001.png",
      "url": "data:image/png;base64,...",
      "width": 1920,
      "height": 1080,
      "rotationDeg": 0,
      "annotations": [
        {
          "id": "abc123",
          "type": "point",
          "label": "boat",
          "x": 100,
          "y": 200
        }
      ]
    }
  ],
  "globalBuoys": []
}
```

## Frame Verification

Click **"📋 Show Frame Order"** to:
- View all frames in loading order
- See frame dimensions and annotation counts
- Sort frames alphabetically with **"↻ Sort Alphabetically"**
- Jump to any frame by clicking

## Tips & Tricks

- **Efficient labeling**: Use keyboard shortcuts for speed
- **Frame sorting**: Use alphabetical sort to organize by filename
- **Auto-backup**: Project auto-saves to localStorage every 400ms
- **File system access**: Save location persists across sessions
- **Zoom centering**: Zoom always centers on image center for stable panning
- **Hit detection**: Point tolerance is 10px for easier selection

## Tech Stack

- **React 18.2** - UI framework
- **Vite 5.0** - Build tool & dev server
- **Canvas 2D** - Image rendering
- **LocalStorage** - Auto-backup persistence
- **File System Access API** - Native file I/O with fallback

## Architecture

- **CoordinateTransformer**: Handles 2D transformations (pan, zoom, rotation)
- **FileIOManager**: Manages image loading, project save/load
- **RadarLabeler Component**: Main React component with all state & logic

Supports both rotated (frame-bound) and non-rotated (global) coordinate spaces for flexible annotation workflows.

## Performance

- Canvas-based rendering avoids DOM overhead
- Efficient hit testing with quadtree-compatible structure
- Debounced auto-save (400ms) to prevent excessive writes

## Browser Compatibility

- Chrome/Edge (recommended)
- Firefox
- Safari (with File System API fallback)

Requires File System Access API or standard File API for file operations.

## License

MIT License - feel free to use, modify, and distribute

## Contributing

Pull requests welcome! Areas for enhancement:
- Polygon annotation support
- Annotation templates
- Batch operations
- Advanced filtering
- Multi-user collaboration

## Support

For issues, questions, or feature requests, please open a GitHub issue.

---

**Created with Claude Code** 🤖
