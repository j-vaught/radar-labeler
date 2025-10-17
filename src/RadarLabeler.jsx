import React, { useRef, useEffect, useState, useCallback } from 'react';
import './RadarLabeler.css';

// ============================================================================
// CONSTANTS
// ============================================================================
const KEY_PAN_STEP = 40;
const DEFAULT_BBOX_SIZE = 80;
const MIN_BBOX_SIDE = 5;
const CLICK_DRAG_THRESHOLD = 5;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 32;
const ROTATION_MIN = -10;
const ROTATION_MAX = 10;
const SAVE_DEBOUNCE_MS = 400;

const TOOL_SELECT = 'select';
const TOOL_PAN = 'pan';
const TOOL_BOAT_POINT = 'boat_point';
const TOOL_BOAT_BOX = 'boat_box';
const TOOL_BUOY_POINT = 'buoy_point';
const TOOL_BUOY_BOX = 'buoy_box';

const LABEL_BOAT = 'boat';
const LABEL_BUOY = 'buoy';

const ANNOTATION_POINT = 'point';
const ANNOTATION_BBOX = 'bbox';

const COLOR_BOAT = '#22dd22';      // green
const COLOR_BUOY = '#00dddd';      // cyan
const COLOR_SELECTED = '#ffaa00';  // amber/orange
const COLOR_TEXT = '#ffaa00';      // orange for labels

// ============================================================================
// UTILITIES
// ============================================================================

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function naturalSort(arr) {
  return [...arr].sort((a, b) => {
    const aStr = a.toString().toLowerCase();
    const bStr = b.toString().toLowerCase();
    return aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function createDefaultProject() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    viewport: { zoom: 1, panX: 0, panY: 0 },
    currentIndex: 0,
    frames: [],
    globalBuoys: [],
  };
}

function createAnnotation(type, label, x, y, w = 0, h = 0) {
  const ann = {
    id: generateId(),
    type,
    label,
    x,
    y,
  };
  if (type === ANNOTATION_BBOX) {
    ann.w = w;
    ann.h = h;
  }
  return ann;
}

// ============================================================================
// COORDINATE TRANSFORMS
// ============================================================================

class CoordinateTransformer {
  constructor(imgW, imgH, zoom, panX, panY, rotationDeg, rotated = true) {
    this.imgW = imgW;
    this.imgH = imgH;
    this.zoom = zoom;
    this.panX = panX;
    this.panY = panY;
    this.rotationDeg = rotationDeg;
    this.rotated = rotated;
  }

  screenToImage(sx, sy) {
    // Reverse the transform chain: undo pan, undo zoom, undo rotation (if active)
    const canvasCenterX = this.imgW / 2;
    const canvasCenterY = this.imgH / 2;

    // Undo pan
    let x = sx - this.panX;
    let y = sy - this.panY;

    // Undo zoom
    x /= this.zoom;
    y /= this.zoom;

    // Undo translation to center
    x -= canvasCenterX;
    y -= canvasCenterY;

    // Undo rotation if active
    if (this.rotated && this.rotationDeg !== 0) {
      const rad = (-this.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const nx = x * cos - y * sin;
      const ny = x * sin + y * cos;
      x = nx;
      y = ny;
    }

    // Undo translation back from center
    x += canvasCenterX;
    y += canvasCenterY;

    return { x, y };
  }

  imageToScreen(ix, iy) {
    const canvasCenterX = this.imgW / 2;
    const canvasCenterY = this.imgH / 2;

    // Translate to center
    let x = ix - canvasCenterX;
    let y = iy - canvasCenterY;

    // Apply rotation if active
    if (this.rotated && this.rotationDeg !== 0) {
      const rad = (this.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const nx = x * cos - y * sin;
      const ny = x * sin + y * cos;
      x = nx;
      y = ny;
    }

    // Translate back from center
    x += canvasCenterX;
    y += canvasCenterY;

    // Apply zoom
    x *= this.zoom;
    y *= this.zoom;

    // Apply pan
    x += this.panX;
    y += this.panY;

    return { x, y };
  }
}

// ============================================================================
// FILE I/O
// ============================================================================

class FileIOManager {
  constructor() {
    this.fileHandle = null;
  }

  async requestSaveFile() {
    try {
      this.fileHandle = await window.showSaveFilePicker({
        suggestedName: 'radar_project.json',
        types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
      });
      return true;
    } catch {
      return false;
    }
  }

  async liveWrite(project) {
    if (!this.fileHandle) return false;
    try {
      const writable = await this.fileHandle.createWritable();
      await writable.write(JSON.stringify(project, null, 2));
      await writable.close();
      return true;
    } catch (err) {
      console.error('Live write failed:', err);
      return false;
    }
  }

  saveToLocalStorage(project) {
    try {
      localStorage.setItem('radar_project_backup', JSON.stringify(project));
      return true;
    } catch {
      return false;
    }
  }

  loadFromLocalStorage() {
    try {
      const data = localStorage.getItem('radar_project_backup');
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  downloadJSON(project) {
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'radar_project_backup.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async loadSingleImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          resolve({
            name: file.name,
            url: reader.result,
            width: img.width,
            height: img.height,
          });
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async loadFolder(entries) {
    const imageExts = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp']);
    const images = [];

    for (const entry of entries) {
      const name = entry.name.toLowerCase();
      const ext = name.split('.').pop();
      if (imageExts.has(ext)) {
        const file = await entry.getFile();
        try {
          const img = await this.loadSingleImage(file);
          images.push(img);
        } catch (err) {
          console.warn(`Failed to load ${file.name}:`, err);
        }
      }
    }

    return naturalSort(images.map((img, idx) => ({ ...img, sortKey: img.name }))).map(
      (img, idx) => {
        const { sortKey, ...rest } = img;
        return rest;
      }
    );
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function RadarLabeler() {
  const canvasRef = useRef(null);
  const fileIORef = useRef(new FileIOManager());
  const saveTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // Project state
  const [project, setProject] = useState(createDefaultProject());
  const [tool, setTool] = useState(TOOL_SELECT);
  const [selection, setSelection] = useState(null); // { type: 'frame'|'global', id, index? }
  const [hoveredId, setHoveredId] = useState(null);

  // Interaction state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dragCurrent, setDragCurrent] = useState(null);
  const [status, setStatus] = useState('Ready');
  const [lastSaveTime, setLastSaveTime] = useState(null);
  const [showFrameList, setShowFrameList] = useState(false);

  const currentFrame = project.frames[project.currentIndex];

  // ========== File I/O ==========
  const handleOpenFile = async () => {
    try {
      // Try File System Access API first
      if (window.showOpenFilePicker) {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'Image Files', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.bmp'] } }],
        });
        const file = await handle.getFile();
        const frameData = await fileIORef.current.loadSingleImage(file);
        const newProject = {
          ...project,
          frames: [{ ...frameData, rotationDeg: 0, annotations: [] }],
          currentIndex: 0,
        };
        setProject(newProject);
        setStatus('Image loaded');
      } else {
        // Fallback to standard file input
        fileInputRef.current?.click();
      }
    } catch (err) {
      console.error('Error opening file:', err);
      // If File System API fails, try standard input
      if (err.name !== 'AbortError') {
        fileInputRef.current?.click();
      } else {
        setStatus('File selection cancelled');
      }
    }
  };

  const handleFileInputChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const frameData = await fileIORef.current.loadSingleImage(file);
      const newProject = {
        ...project,
        frames: [{ ...frameData, rotationDeg: 0, annotations: [] }],
        currentIndex: 0,
      };
      setProject(newProject);
      setStatus('Image loaded');
    } catch (err) {
      console.error('Error loading image:', err);
      setStatus(`Failed to load image: ${err.message}`);
    }
    // Reset input
    e.target.value = '';
  };

  const handleFolderInputChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      const imageExts = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp']);
      const images = [];

      for (const file of files) {
        const name = file.name.toLowerCase();
        const ext = name.split('.').pop();
        if (imageExts.has(ext)) {
          try {
            const img = await fileIORef.current.loadSingleImage(file);
            images.push(img);
          } catch (err) {
            console.warn(`Failed to load ${file.name}:`, err);
          }
        }
      }

      if (images.length === 0) {
        setStatus('No compatible images found');
        return;
      }

      const frames = images.map((img, idx) => ({ ...img, rotationDeg: 0, annotations: [] }));
      const newProject = {
        ...project,
        frames: frames,
        currentIndex: 0,
      };
      setProject(newProject);
      setStatus(`Loaded ${frames.length} images`);
    } catch (err) {
      console.error('Error loading images:', err);
      setStatus(`Failed to load images: ${err.message}`);
    }
    // Reset input
    e.target.value = '';
  };

  const handleOpenFolder = async () => {
    try {
      // Try File System Access API first
      if (window.showDirectoryPicker) {
        const dirHandle = await window.showDirectoryPicker();
        const entries = [];
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file') entries.push(entry);
        }

        if (entries.length === 0) {
          setStatus('No images found in folder');
          return;
        }

        const frames = await fileIORef.current.loadFolder(entries);
        if (frames.length === 0) {
          setStatus('No compatible images in folder');
          return;
        }

        const newProject = {
          ...project,
          frames: frames.map((f) => ({ ...f, rotationDeg: 0, annotations: [] })),
          currentIndex: 0,
        };
        setProject(newProject);
        setStatus(`Loaded ${frames.length} images`);
      } else {
        // Fallback to standard folder input
        folderInputRef.current?.click();
      }
    } catch (err) {
      console.error('Error opening folder:', err);
      // If File System API fails, try standard input
      if (err.name !== 'AbortError') {
        folderInputRef.current?.click();
      } else {
        setStatus('Folder selection cancelled');
      }
    }
  };

  const handleChooseSaveFile = async () => {
    const ok = await fileIORef.current.requestSaveFile();
    if (ok) {
      setStatus('Save file chosen; auto-saving enabled');
    } else {
      setStatus('Save file selection cancelled');
    }
  };

  const handleBackupDownload = () => {
    fileIORef.current.downloadJSON(project);
    setStatus('Backup downloaded');
  };

  const handleLoadProject = async () => {
    try {
      if (window.showOpenFilePicker) {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
        });
        const file = await handle.getFile();
        const text = await file.text();
        const loadedProject = JSON.parse(text);

        // Validate project structure
        if (loadedProject.version && loadedProject.frames && Array.isArray(loadedProject.frames)) {
          setProject(loadedProject);
          setSelection(null);
          setStatus(`Loaded project with ${loadedProject.frames.length} frames`);
        } else {
          setStatus('Invalid project file format');
        }
      } else {
        // Fallback to standard file input
        projectInputRef.current?.click();
      }
    } catch (err) {
      console.error('Error loading project:', err);
      if (err.name !== 'AbortError') {
        projectInputRef.current?.click();
      } else {
        setStatus('Project selection cancelled');
      }
    }
  };

  const projectInputRef = useRef(null);

  const handleProjectFileInput = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const loadedProject = JSON.parse(text);

      // Validate project structure
      if (loadedProject.version && loadedProject.frames && Array.isArray(loadedProject.frames)) {
        setProject(loadedProject);
        setSelection(null);
        setStatus(`Loaded project with ${loadedProject.frames.length} frames`);
      } else {
        setStatus('Invalid project file format');
      }
    } catch (err) {
      console.error('Error loading project:', err);
      setStatus(`Failed to load project: ${err.message}`);
    }
    e.target.value = '';
  };

  // ========== Auto-save ==========
  const triggerSave = useCallback(
    (proj) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

      saveTimeoutRef.current = setTimeout(async () => {
        fileIORef.current.saveToLocalStorage(proj);
        const ok = await fileIORef.current.liveWrite(proj);
        const now = new Date().toLocaleTimeString();
        setLastSaveTime(now);
        if (!ok && fileIORef.current.fileHandle) {
          setStatus(`Save failed at ${now}; backup in localStorage`);
        } else {
          setStatus(`Saved ${now}`);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    []
  );

  // ========== Project updates ==========
  const updateProject = useCallback(
    (updater) => {
      const newProj = typeof updater === 'function' ? updater(project) : updater;
      setProject(newProj);
      triggerSave(newProj);
    },
    [project, triggerSave]
  );

  const updateFrameAnnotations = useCallback(
    (frameIndex, annotations) => {
      updateProject((proj) => {
        const newFrames = [...proj.frames];
        newFrames[frameIndex] = { ...newFrames[frameIndex], annotations };
        return { ...proj, frames: newFrames };
      });
    },
    [updateProject]
  );

  const updateGlobalBuoys = useCallback(
    (buoys) => {
      updateProject((proj) => ({ ...proj, globalBuoys: buoys }));
    },
    [updateProject]
  );

  const updateViewport = useCallback(
    (zoom, panX, panY) => {
      updateProject((proj) => ({
        ...proj,
        viewport: { zoom, panX, panY },
      }));
    },
    [updateProject]
  );

  const updateFrameRotation = useCallback(
    (frameIndex, rotationDeg) => {
      updateProject((proj) => {
        const newFrames = [...proj.frames];
        newFrames[frameIndex] = { ...newFrames[frameIndex], rotationDeg };
        return { ...proj, frames: newFrames };
      });
    },
    [updateProject]
  );

  const sortFramesAlphabetically = useCallback(() => {
    updateProject((proj) => {
      const sortedFrames = naturalSort(proj.frames.map((f, idx) => ({ ...f, originalIndex: idx })).map(f => f.name)).map(name => {
        const frame = proj.frames.find(f => f.name === name);
        return frame;
      });
      // Handle potential duplicates by doing a proper sort
      const framesCopy = [...proj.frames];
      framesCopy.sort((a, b) => {
        const aStr = (a.name || '').toLowerCase();
        const bStr = (b.name || '').toLowerCase();
        return aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: 'base' });
      });
      return { ...proj, frames: framesCopy, currentIndex: 0 };
    });
    setSelection(null);
    setStatus('Frames sorted alphabetically');
  }, [updateProject]);

  // ========== Navigation ==========
  const goToFrame = useCallback(
    (index) => {
      if (index >= 0 && index < project.frames.length) {
        updateProject((proj) => ({ ...proj, currentIndex: index }));
        setSelection(null);
      }
    },
    [project.frames.length, updateProject]
  );

  // ========== Annotation editing ==========
  const deleteAnnotation = useCallback(() => {
    if (!selection) return;
    if (selection.type === 'frame' && currentFrame) {
      const newAnns = currentFrame.annotations.filter((a) => a.id !== selection.id);
      updateFrameAnnotations(project.currentIndex, newAnns);
      setSelection(null);
    } else if (selection.type === 'global') {
      const newBuoys = project.globalBuoys.filter((b) => b.id !== selection.id);
      updateGlobalBuoys(newBuoys);
      setSelection(null);
    }
  }, [selection, currentFrame, project, updateFrameAnnotations, updateGlobalBuoys]);

  const moveAnnotation = useCallback(
    (id, dx, dy, isGlobal = false) => {
      const anns = isGlobal ? project.globalBuoys : currentFrame?.annotations || [];
      const idx = anns.findIndex((a) => a.id === id);
      if (idx === -1) return;

      const newAnns = [...anns];
      const ann = { ...newAnns[idx] };
      ann.x += dx;
      ann.y += dy;
      newAnns[idx] = ann;

      if (isGlobal) {
        updateGlobalBuoys(newAnns);
      } else {
        updateFrameAnnotations(project.currentIndex, newAnns);
      }
    },
    [project, currentFrame, updateFrameAnnotations, updateGlobalBuoys]
  );

  const resizeAnnotation = useCallback(
    (id, dw, dh, isGlobal = false) => {
      const anns = isGlobal ? project.globalBuoys : currentFrame?.annotations || [];
      const idx = anns.findIndex((a) => a.id === id);
      if (idx === -1 || anns[idx].type !== ANNOTATION_BBOX) return;

      const newAnns = [...anns];
      const ann = { ...newAnns[idx] };
      ann.w = Math.max(MIN_BBOX_SIDE, ann.w + dw);
      ann.h = Math.max(MIN_BBOX_SIDE, ann.h + dh);
      newAnns[idx] = ann;

      if (isGlobal) {
        updateGlobalBuoys(newAnns);
      } else {
        updateFrameAnnotations(project.currentIndex, newAnns);
      }
    },
    [project, currentFrame, updateFrameAnnotations, updateGlobalBuoys]
  );

  const updateAnnotation = useCallback(
    (id, updates, isGlobal = false) => {
      const anns = isGlobal ? project.globalBuoys : currentFrame?.annotations || [];
      const idx = anns.findIndex((a) => a.id === id);
      if (idx === -1) return;

      const newAnns = [...anns];
      newAnns[idx] = { ...newAnns[idx], ...updates };

      if (isGlobal) {
        updateGlobalBuoys(newAnns);
      } else {
        updateFrameAnnotations(project.currentIndex, newAnns);
      }
    },
    [project, currentFrame, updateFrameAnnotations, updateGlobalBuoys]
  );

  // ========== Hit testing ==========
  const getAnnotationAtPoint = useCallback(
    (screenX, screenY) => {
      if (!currentFrame) return null;
      const { zoom, panX, panY } = project.viewport;
      const rotated = true;
      const trans = new CoordinateTransformer(
        currentFrame.width,
        currentFrame.height,
        zoom,
        panX,
        panY,
        currentFrame.rotationDeg,
        rotated
      );
      const { x: imgX, y: imgY } = trans.screenToImage(screenX, screenY);

      // Hit test frame annotations
      for (let i = currentFrame.annotations.length - 1; i >= 0; i--) {
        const ann = currentFrame.annotations[i];
        if (ann.type === ANNOTATION_POINT) {
          const dist = Math.hypot(ann.x - imgX, ann.y - imgY);
          if (dist < 10) return { type: 'frame', id: ann.id, index: i };
        } else if (ann.type === ANNOTATION_BBOX) {
          if (imgX >= ann.x && imgX < ann.x + ann.w && imgY >= ann.y && imgY < ann.y + ann.h) {
            return { type: 'frame', id: ann.id, index: i };
          }
        }
      }

      // Hit test global buoys
      const nonRotated = false;
      const transBuoy = new CoordinateTransformer(
        currentFrame.width,
        currentFrame.height,
        zoom,
        panX,
        panY,
        0,
        nonRotated
      );
      const { x: buoyX, y: buoyY } = transBuoy.screenToImage(screenX, screenY);

      for (let i = project.globalBuoys.length - 1; i >= 0; i--) {
        const buoy = project.globalBuoys[i];
        if (buoy.type === ANNOTATION_POINT) {
          const dist = Math.hypot(buoy.x - buoyX, buoy.y - buoyY);
          if (dist < 10) return { type: 'global', id: buoy.id, index: i };
        } else if (buoy.type === ANNOTATION_BBOX) {
          if (
            buoyX >= buoy.x &&
            buoyX < buoy.x + buoy.w &&
            buoyY >= buoy.y &&
            buoyY < buoy.y + buoy.h
          ) {
            return { type: 'global', id: buoy.id, index: i };
          }
        }
      }

      return null;
    },
    [currentFrame, project]
  );

  const getHandleAtPoint = useCallback(
    (screenX, screenY, ann, isGlobal = false) => {
      if (ann.type !== ANNOTATION_BBOX) return null;
      const { zoom, panX, panY } = project.viewport;
      const rotated = !isGlobal;
      const trans = new CoordinateTransformer(
        currentFrame.width,
        currentFrame.height,
        zoom,
        panX,
        panY,
        isGlobal ? 0 : currentFrame.rotationDeg,
        rotated
      );

      const handleSize = 8 / zoom;
      const { x: sx1, y: sy1 } = trans.imageToScreen(ann.x, ann.y);
      const { x: sx2, y: sy2 } = trans.imageToScreen(ann.x + ann.w, ann.y + ann.h);

      const handles = [
        { name: 'nw', sx: sx1, sy: sy1 },
        { name: 'n', sx: (sx1 + sx2) / 2, sy: sy1 },
        { name: 'ne', sx: sx2, sy: sy1 },
        { name: 'w', sx: sx1, sy: (sy1 + sy2) / 2 },
        { name: 'e', sx: sx2, sy: (sy1 + sy2) / 2 },
        { name: 'sw', sx: sx1, sy: sy2 },
        { name: 's', sx: (sx1 + sx2) / 2, sy: sy2 },
        { name: 'se', sx: sx2, sy: sy2 },
      ];

      for (const h of handles) {
        const dist = Math.hypot(h.sx - screenX, h.sy - screenY);
        if (dist < handleSize * 1.5) return h.name;
      }
      return null;
    },
    [project, currentFrame]
  );

  // ========== CANVAS RENDERING ==========
  useEffect(() => {
    if (!canvasRef.current || !currentFrame) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width;
    canvas.height = rect.height;

    const { zoom, panX, panY } = project.viewport;

    // Draw background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Load and draw frame image
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = currentFrame.url;
    img.onload = () => {
      // Draw boats (rotated space)
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(zoom, zoom);
      ctx.translate(currentFrame.width / 2, currentFrame.height / 2);
      ctx.rotate((currentFrame.rotationDeg * Math.PI) / 180);
      ctx.translate(-currentFrame.width / 2, -currentFrame.height / 2);
      ctx.drawImage(img, 0, 0);
      ctx.restore();

      // Draw frame annotations (boats in rotated space)
      const rotated = true;
      const transBots = new CoordinateTransformer(
        currentFrame.width,
        currentFrame.height,
        zoom,
        panX,
        panY,
        currentFrame.rotationDeg,
        rotated
      );
      drawAnnotations(ctx, currentFrame.annotations, transBots, COLOR_BOAT, false);

      // Draw global buoys (non-rotated space)
      const nonRotated = false;
      const transBuoys = new CoordinateTransformer(
        currentFrame.width,
        currentFrame.height,
        zoom,
        panX,
        panY,
        0,
        nonRotated
      );
      drawAnnotations(ctx, project.globalBuoys, transBuoys, COLOR_BUOY, true);

      // Draw drag preview if active
      if (isDragging && dragStart && dragCurrent) {
        drawDragPreview(ctx, dragStart, dragCurrent);
      }

      // Draw HUD
      drawHUD(
        ctx,
        canvas.width,
        canvas.height,
        project.currentIndex,
        project.frames.length,
        zoom,
        panX,
        panY,
        currentFrame.rotationDeg
      );
    };
  }, [project, currentFrame, isDragging, dragStart, dragCurrent, hoveredId, selection]);

  function drawAnnotations(ctx, anns, trans, defaultColor, isGlobal) {
    for (const ann of anns) {
      const isSelected = selection?.id === ann.id && selection?.type === (isGlobal ? 'global' : 'frame');
      const isHovered = hoveredId === ann.id;
      const color = isSelected || isHovered ? COLOR_SELECTED : defaultColor;

      if (ann.type === ANNOTATION_POINT) {
        const { x: sx, y: sy } = trans.imageToScreen(ann.x, ann.y);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx - 8, sy);
        ctx.lineTo(sx + 8, sy);
        ctx.moveTo(sx, sy - 8);
        ctx.lineTo(sx, sy + 8);
        ctx.stroke();
      } else if (ann.type === ANNOTATION_BBOX) {
        const { x: sx1, y: sy1 } = trans.imageToScreen(ann.x, ann.y);
        const { x: sx2, y: sy2 } = trans.imageToScreen(ann.x + ann.w, ann.y + ann.h);
        const w = sx2 - sx1;
        const h = sy2 - sy1;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(sx1, sy1, w, h);

        if (isSelected) {
          // Draw handles
          const handles = [
            [sx1, sy1],
            [(sx1 + sx2) / 2, sy1],
            [sx2, sy1],
            [sx1, (sy1 + sy2) / 2],
            [sx2, (sy1 + sy2) / 2],
            [sx1, sy2],
            [(sx1 + sx2) / 2, sy2],
            [sx2, sy2],
          ];
          for (const [hx, hy] of handles) {
            ctx.fillStyle = COLOR_SELECTED;
            ctx.fillRect(hx - 4, hy - 4, 8, 8);
          }
        }
      }

      // Draw label
      if (isSelected || isHovered) {
        const { x: sx, y: sy } = trans.imageToScreen(ann.x, ann.y);
        ctx.fillStyle = COLOR_TEXT;
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`${ann.label.toUpperCase()} ${ann.type.toUpperCase()}`, sx + 10, sy - 10);
      }
    }
  }

  function drawDragPreview(ctx, start, current) {
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const w = Math.abs(current.x - start.x);
    const h = Math.abs(current.y - start.y);
    ctx.strokeStyle = COLOR_SELECTED;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  function drawHUD(ctx, cw, ch, frameIdx, frameCount, zoom, panX, panY, rot) {
    const text = `Frame ${frameIdx + 1}/${frameCount}  Zoom ${zoom.toFixed(2)}x  Pan(${panX.toFixed(0)}, ${panY.toFixed(0)})  Rot ${rot.toFixed(2)}°`;
    ctx.fillStyle = '#cccccc';
    ctx.font = '11px monospace';
    ctx.fillText(text, 10, ch - 10);
  }

  // ========== MOUSE EVENTS ==========
  const handleCanvasMouseDown = useCallback(
    (e) => {
      if (!currentFrame) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      if (tool === TOOL_PAN) {
        setIsDragging(true);
        setDragStart({ x: screenX, y: screenY });
        return;
      }

      if (tool === TOOL_SELECT) {
        const hit = getAnnotationAtPoint(screenX, screenY);
        if (hit) {
          setSelection(hit);
          const ann =
            hit.type === 'global' ? project.globalBuoys[hit.index] : currentFrame.annotations[hit.index];
          const handle = getHandleAtPoint(screenX, screenY, ann, hit.type === 'global');
          setIsDragging(true);
          setDragStart({ x: screenX, y: screenY, handle, hit });
        } else {
          setSelection(null);
        }
        return;
      }

      // Drawing mode
      if ([TOOL_BOAT_POINT, TOOL_BOAT_BOX, TOOL_BUOY_POINT, TOOL_BUOY_BOX].includes(tool)) {
        setIsDragging(true);
        setDragStart({ x: screenX, y: screenY });
      }
    },
    [tool, currentFrame, project, getAnnotationAtPoint, getHandleAtPoint]
  );

  const handleCanvasMouseMove = useCallback(
    (e) => {
      if (!currentFrame) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      if (tool === TOOL_PAN && isDragging && dragStart) {
        const dx = screenX - dragStart.x;
        const dy = screenY - dragStart.y;
        updateViewport(project.viewport.zoom, project.viewport.panX + dx, project.viewport.panY + dy);
        setDragStart({ x: screenX, y: screenY });
        return;
      }

      if (tool === TOOL_SELECT && isDragging && dragStart) {
        if (dragStart.handle && dragStart.hit) {
          // Resize
          const { zoom, panX, panY } = project.viewport;
          const isGlobal = dragStart.hit.type === 'global';
          const trans = new CoordinateTransformer(
            currentFrame.width,
            currentFrame.height,
            zoom,
            panX,
            panY,
            isGlobal ? 0 : currentFrame.rotationDeg,
            !isGlobal
          );
          const { x: imgX, y: imgY } = trans.screenToImage(screenX, screenY);
          const ann = isGlobal
            ? project.globalBuoys[dragStart.hit.index]
            : currentFrame.annotations[dragStart.hit.index];

          if (dragStart.handle === 'se') {
            const dw = imgX - (ann.x + ann.w);
            const dh = imgY - (ann.y + ann.h);
            resizeAnnotation(ann.id, dw, dh, isGlobal);
          } else if (dragStart.handle === 'nw') {
            const dx = imgX - ann.x;
            const dy = imgY - ann.y;
            moveAnnotation(ann.id, dx, dy, isGlobal);
            resizeAnnotation(ann.id, -dx, -dy, isGlobal);
          }
        } else if (selection && !dragStart.handle) {
          // Move
          const dx = screenX - dragStart.x;
          const dy = screenY - dragStart.y;
          const { zoom } = project.viewport;
          moveAnnotation(selection.id, dx / zoom, dy / zoom, selection.type === 'global');
          setDragStart({ x: screenX, y: screenY });
        }
        return;
      }

      if ([TOOL_BOAT_POINT, TOOL_BOAT_BOX, TOOL_BUOY_POINT, TOOL_BUOY_BOX].includes(tool) && isDragging) {
        setDragCurrent({ x: screenX, y: screenY });
        return;
      }

      // Update hover
      const hit = getAnnotationAtPoint(screenX, screenY);
      setHoveredId(hit?.id || null);
    },
    [
      tool,
      currentFrame,
      project,
      isDragging,
      dragStart,
      selection,
      getAnnotationAtPoint,
      updateViewport,
      moveAnnotation,
      resizeAnnotation,
    ]
  );

  const handleCanvasMouseUp = useCallback(
    (e) => {
      if (!currentFrame) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      if ([TOOL_BOAT_POINT, TOOL_BOAT_BOX, TOOL_BUOY_POINT, TOOL_BUOY_BOX].includes(tool) && isDragging) {
        const moveDistance = dragStart
          ? Math.hypot(screenX - dragStart.x, screenY - dragStart.y)
          : 0;

        const { zoom, panX, panY } = project.viewport;
        let isGlobal = false;
        let rotated = true;

        if (tool === TOOL_BUOY_POINT || tool === TOOL_BUOY_BOX) {
          isGlobal = true;
          rotated = false;
        }

        const trans = new CoordinateTransformer(
          currentFrame.width,
          currentFrame.height,
          zoom,
          panX,
          panY,
          rotated ? currentFrame.rotationDeg : 0,
          rotated
        );
        const { x: imgX, y: imgY } = trans.screenToImage(dragStart.x, dragStart.y);

        if (tool === TOOL_BOAT_POINT || tool === TOOL_BUOY_POINT) {
          const label = tool === TOOL_BOAT_POINT ? LABEL_BOAT : LABEL_BUOY;
          const ann = createAnnotation(ANNOTATION_POINT, label, imgX, imgY);
          if (isGlobal) {
            updateGlobalBuoys([...project.globalBuoys, ann]);
          } else {
            updateFrameAnnotations(project.currentIndex, [...currentFrame.annotations, ann]);
          }
        } else if (tool === TOOL_BOAT_BOX || tool === TOOL_BUOY_BOX) {
          const label = tool === TOOL_BOAT_BOX ? LABEL_BOAT : LABEL_BUOY;

          if (moveDistance < CLICK_DRAG_THRESHOLD) {
            // Click only: default size
            const ann = createAnnotation(ANNOTATION_BBOX, label, imgX, imgY, DEFAULT_BBOX_SIZE, DEFAULT_BBOX_SIZE);
            if (isGlobal) {
              updateGlobalBuoys([...project.globalBuoys, ann]);
            } else {
              updateFrameAnnotations(project.currentIndex, [...currentFrame.annotations, ann]);
            }
          } else {
            // Drag: size from drag
            const { x: imgX2, y: imgY2 } = trans.screenToImage(screenX, screenY);
            const bx = Math.min(imgX, imgX2);
            const by = Math.min(imgY, imgY2);
            const bw = Math.max(MIN_BBOX_SIDE, Math.abs(imgX2 - imgX));
            const bh = Math.max(MIN_BBOX_SIDE, Math.abs(imgY2 - imgY));

            const ann = createAnnotation(ANNOTATION_BBOX, label, bx, by, bw, bh);
            if (isGlobal) {
              updateGlobalBuoys([...project.globalBuoys, ann]);
            } else {
              updateFrameAnnotations(project.currentIndex, [...currentFrame.annotations, ann]);
            }
          }
        }
      }

      setIsDragging(false);
      setDragStart(null);
      setDragCurrent(null);
    },
    [
      tool,
      currentFrame,
      project,
      isDragging,
      dragStart,
      updateFrameAnnotations,
      updateGlobalBuoys,
    ]
  );

  const handleCanvasMouseLeave = () => {
    setHoveredId(null);
    setIsDragging(false);
    setDragStart(null);
    setDragCurrent(null);
  };

  // ========== KEYBOARD EVENTS ==========
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!currentFrame) return;

      const { zoom, panX, panY } = project.viewport;
      const step = KEY_PAN_STEP / zoom;

      switch (e.key) {
        case 'ArrowUp':
          updateViewport(zoom, panX, panY + step);
          e.preventDefault();
          break;
        case 'ArrowDown':
          updateViewport(zoom, panX, panY - step);
          e.preventDefault();
          break;
        case 'ArrowLeft':
          updateViewport(zoom, panX + step, panY);
          e.preventDefault();
          break;
        case 'ArrowRight':
          updateViewport(zoom, panX - step, panY);
          e.preventDefault();
          break;
        case 'n':
        case 'N':
        case 'd':
        case 'D':
          if (e.shiftKey) break;
          goToFrame(project.currentIndex + 1);
          break;
        case 'p':
        case 'P':
        case 'a':
        case 'A':
          if (e.shiftKey) break;
          goToFrame(project.currentIndex - 1);
          break;
        case '+':
        case '=':
          updateViewport(Math.min(ZOOM_MAX, zoom * 1.2), panX, panY);
          e.preventDefault();
          break;
        case '-':
        case '_':
          updateViewport(Math.max(ZOOM_MIN, zoom / 1.2), panX, panY);
          e.preventDefault();
          break;
        case '[':
          updateFrameRotation(
            project.currentIndex,
            Math.max(ROTATION_MIN, currentFrame.rotationDeg - 0.1)
          );
          e.preventDefault();
          break;
        case ']':
          updateFrameRotation(
            project.currentIndex,
            Math.min(ROTATION_MAX, currentFrame.rotationDeg + 0.1)
          );
          e.preventDefault();
          break;
        case 'Delete':
        case 'Backspace':
          deleteAnnotation();
          e.preventDefault();
          break;
        case 'Escape':
          setTool(TOOL_SELECT);
          break;
        case '1':
          setTool(TOOL_BOAT_POINT);
          break;
        case '2':
          setTool(TOOL_BOAT_BOX);
          break;
        case '3':
          setTool(TOOL_BUOY_POINT);
          break;
        case '4':
          setTool(TOOL_BUOY_BOX);
          break;
        default:
          if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            goToFrame(project.currentIndex + (e.key === 'ArrowLeft' ? -1 : 1));
          }
          break;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (fileIORef.current.fileHandle) {
          triggerSave(project);
          setStatus('Saving...');
        } else {
          handleBackupDownload();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    currentFrame,
    project,
    updateViewport,
    goToFrame,
    updateFrameRotation,
    deleteAnnotation,
    triggerSave,
  ]);

  // Space-drag pan
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        setTool((prev) => (prev === TOOL_PAN ? TOOL_SELECT : TOOL_PAN));
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        setTool((prev) => (prev === TOOL_PAN ? TOOL_SELECT : prev));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Wheel zoom
  useEffect(() => {
    const handleWheel = (e) => {
      if (!currentFrame) return;
      e.preventDefault();
      const { zoom, panX, panY } = project.viewport;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor));

      // Zoom center on image center
      const imgCenterX = currentFrame.width / 2;
      const imgCenterY = currentFrame.height / 2;

      // Get current screen position of image center
      const trans = new CoordinateTransformer(
        currentFrame.width,
        currentFrame.height,
        zoom,
        panX,
        panY,
        currentFrame.rotationDeg,
        true
      );
      const { x: screenCenterX, y: screenCenterY } = trans.imageToScreen(imgCenterX, imgCenterY);

      // Calculate new pan so image center stays at same screen position
      const transNew = new CoordinateTransformer(
        currentFrame.width,
        currentFrame.height,
        newZoom,
        0,
        0,
        currentFrame.rotationDeg,
        true
      );
      const { x: newScreenX, y: newScreenY } = transNew.imageToScreen(imgCenterX, imgCenterY);
      const newPanX = panX + (screenCenterX - newScreenX);
      const newPanY = panY + (screenCenterY - newScreenY);

      updateViewport(newZoom, newPanX, newPanY);
    };
    canvasRef.current?.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvasRef.current?.removeEventListener('wheel', handleWheel);
  }, [currentFrame, project, updateViewport]);

  // Restore from localStorage on mount
  useEffect(() => {
    const backup = fileIORef.current.loadFromLocalStorage();
    if (backup && backup.frames && backup.frames.length > 0) {
      setProject(backup);
      setStatus('Restored from localStorage backup');
    }
  }, []);

  // ========== RENDER ==========
  if (!currentFrame) {
    return (
      <div className="radar-labeler">
        <div className="sidebar">
          <div className="section">
            <button onClick={handleOpenFile} className="btn btn-primary">
              📂 Open Image
            </button>
            <button onClick={handleOpenFolder} className="btn btn-primary">
              📁 Open Folder
            </button>
          </div>
          <div className="status">{status}</div>
        </div>
        <canvas ref={canvasRef} className="canvas" />

        {/* Hidden file inputs for fallback */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
        />
        <input
          ref={folderInputRef}
          type="file"
          webkitdirectory=""
          multiple
          accept="image/*"
          onChange={handleFolderInputChange}
          style={{ display: 'none' }}
        />
      </div>
    );
  }

  return (
    <div className="radar-labeler">
      <div className="sidebar">
        <div className="section">
          <h3>📂 File</h3>
          <button onClick={handleOpenFile} className="btn">
            Open Image
          </button>
          <button onClick={handleOpenFolder} className="btn">
            Open Folder
          </button>
          <button onClick={handleLoadProject} className="btn btn-accent">
            📥 Load Project
          </button>
          <button onClick={handleChooseSaveFile} className="btn btn-accent">
            Choose Save File
          </button>
          <button onClick={handleBackupDownload} className="btn">
            💾 Backup Download
          </button>
        </div>

        <div className="section">
          <h3>🎯 Tools</h3>
          <button
            className={`btn ${tool === TOOL_SELECT ? 'active' : ''}`}
            onClick={() => setTool(TOOL_SELECT)}
          >
            Select (Esc)
          </button>
          <button
            className={`btn ${tool === TOOL_PAN ? 'active' : ''}`}
            onClick={() => setTool(TOOL_PAN)}
          >
            Pan (Space)
          </button>
          <button
            className={`btn ${tool === TOOL_BOAT_POINT ? 'active' : ''}`}
            onClick={() => setTool(TOOL_BOAT_POINT)}
          >
            🚤 Boat Point (1)
          </button>
          <button
            className={`btn ${tool === TOOL_BOAT_BOX ? 'active' : ''}`}
            onClick={() => setTool(TOOL_BOAT_BOX)}
          >
            🚤 Boat Box (2)
          </button>
          <button
            className={`btn ${tool === TOOL_BUOY_POINT ? 'active' : ''}`}
            onClick={() => setTool(TOOL_BUOY_POINT)}
          >
            🪁 Buoy Point (3)
          </button>
          <button
            className={`btn ${tool === TOOL_BUOY_BOX ? 'active' : ''}`}
            onClick={() => setTool(TOOL_BUOY_BOX)}
          >
            🪁 Buoy Box (4)
          </button>
        </div>

        <div className="section">
          <h3>🔍 Zoom</h3>
          <input
            type="range"
            min={Math.log(ZOOM_MIN)}
            max={Math.log(ZOOM_MAX)}
            step="0.05"
            value={Math.log(project.viewport.zoom)}
            onChange={(e) =>
              updateViewport(Math.exp(parseFloat(e.target.value)), project.viewport.panX, project.viewport.panY)
            }
            className="slider"
          />
          <span>{project.viewport.zoom.toFixed(2)}x</span>
          <button
            onClick={() =>
              updateViewport(1, 0, 0)
            }
            className="btn"
          >
            Reset
          </button>
        </div>

        <div className="section">
          <h3>🔄 Rotation</h3>
          <input
            type="range"
            min={ROTATION_MIN}
            max={ROTATION_MAX}
            step="0.01"
            value={currentFrame.rotationDeg}
            onChange={(e) =>
              updateFrameRotation(project.currentIndex, parseFloat(e.target.value))
            }
            className="slider"
          />
          <input
            type="number"
            min={ROTATION_MIN}
            max={ROTATION_MAX}
            step="0.01"
            value={currentFrame.rotationDeg.toFixed(2)}
            onChange={(e) =>
              updateFrameRotation(project.currentIndex, Math.max(ROTATION_MIN, Math.min(ROTATION_MAX, parseFloat(e.target.value))))
            }
            className="input"
          />
          <span>°</span>
        </div>

        <div className="section">
          <h3>🐟 Boats ({currentFrame.annotations.length})</h3>
          <div className="list">
            {currentFrame.annotations.map((ann, idx) => (
              <div
                key={ann.id}
                className={`list-item ${selection?.id === ann.id ? 'selected' : ''}`}
                onClick={() => setSelection({ type: 'frame', id: ann.id, index: idx })}
              >
                {ann.label} {ann.type}
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <h3>🪁 Global Buoys ({project.globalBuoys.length})</h3>
          <div className="list">
            {project.globalBuoys.map((buoy, idx) => (
              <div
                key={buoy.id}
                className={`list-item ${selection?.id === buoy.id ? 'selected' : ''}`}
                onClick={() => setSelection({ type: 'global', id: buoy.id, index: idx })}
              >
                {buoy.label} {buoy.type}
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <h3>📍 Navigation</h3>
          <div className="nav-buttons">
            <button
              onClick={() => goToFrame(project.currentIndex - 1)}
              disabled={project.currentIndex === 0}
              className="btn"
            >
              ← Prev (P/A)
            </button>
            <span>{project.currentIndex + 1} / {project.frames.length}</span>
            <button
              onClick={() => goToFrame(project.currentIndex + 1)}
              disabled={project.currentIndex === project.frames.length - 1}
              className="btn"
            >
              Next (N/D) →
            </button>
          </div>
          <button
            onClick={() => setShowFrameList(!showFrameList)}
            className="btn btn-accent"
            style={{ marginTop: '8px', width: '100%' }}
          >
            {showFrameList ? '✕ Hide Frame List' : '📋 Show Frame Order'}
          </button>
        </div>

        <div className="section">
          <h3>⏱️ Status</h3>
          <div className="status">{status}</div>
          {lastSaveTime && <div className="status-time">Last save: {lastSaveTime}</div>}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="canvas"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseLeave}
      />

      {/* Frame List Modal */}
      {showFrameList && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            onClick: () => setShowFrameList(false),
          }}
        >
          <div
            style={{
              backgroundColor: '#1a1a1a',
              border: '2px solid #00dddd',
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '600px',
              maxHeight: '70vh',
              overflowY: 'auto',
              color: '#cccccc',
              fontFamily: 'monospace',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, color: '#00dddd', marginBottom: '15px' }}>
              Frame Order ({project.frames.length} frames)
            </h2>
            <button
              onClick={sortFramesAlphabetically}
              style={{
                marginBottom: '15px',
                padding: '8px 12px',
                backgroundColor: '#00dddd',
                border: 'none',
                color: '#000',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold',
                width: '100%',
              }}
            >
              ↻ Sort Alphabetically
            </button>
            <div style={{ display: 'grid', gap: '8px' }}>
              {project.frames.map((frame, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    goToFrame(idx);
                    setShowFrameList(false);
                  }}
                  style={{
                    padding: '10px',
                    backgroundColor:
                      idx === project.currentIndex ? '#00dddd' : '#2a2a2a',
                    color: idx === project.currentIndex ? '#000' : '#cccccc',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    border:
                      idx === project.currentIndex
                        ? '2px solid #ffaa00'
                        : '1px solid #444',
                    transition: 'all 0.2s',
                    fontSize: '13px',
                  }}
                  onMouseEnter={(e) => {
                    if (idx !== project.currentIndex) {
                      e.target.style.backgroundColor = '#333';
                      e.target.style.color = '#fff';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (idx !== project.currentIndex) {
                      e.target.style.backgroundColor = '#2a2a2a';
                      e.target.style.color = '#cccccc';
                    }
                  }}
                >
                  <strong>#{idx + 1}</strong>: {frame.name || 'Unnamed'}
                  <span style={{ marginLeft: '10px', fontSize: '11px', opacity: 0.7 }}>
                    ({frame.width}×{frame.height}, {frame.annotations?.length || 0} boats)
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowFrameList(false)}
              style={{
                marginTop: '15px',
                padding: '8px 16px',
                backgroundColor: '#333',
                border: '1px solid #666',
                color: '#cccccc',
                borderRadius: '4px',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Hidden file inputs for fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory=""
        multiple
        accept="image/*"
        onChange={handleFolderInputChange}
        style={{ display: 'none' }}
      />
      <input
        ref={projectInputRef}
        type="file"
        accept="application/json"
        onChange={handleProjectFileInput}
        style={{ display: 'none' }}
      />
    </div>
  );
}
