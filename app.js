(function () {
    "use strict";

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    const DEFAULT_FONT = "Zain Bold";
    const FONT_FALLBACK = '"Zain", "Vazirmatn", system-ui, sans-serif';

    // Font discovery. When the app is served over HTTP we read the fonts
    // folder directly (manifest first, then the directory listing). When it is
    // opened from disk (file://) those fetches are blocked by the browser, so
    // this bundled list is used as an offline fallback.
    const FONT_DIR = "assets/fonts/";
    const FONT_MANIFEST = FONT_DIR + "fonts.json";
    const FONT_EXT_RE = /\.(ttf|otf|woff2?|eot)$/i;
    const FONT_FILE_LIST = [
        { file: "Zain-Bold.ttf", family: "Zain Bold" },
        { file: "Zain/Zain-Regular.ttf", family: "Zain Regular" },
        { file: "Zain/Zain-Black.ttf", family: "Zain Black" },
        { file: "Zain/Zain-ExtraBold.ttf", family: "Zain ExtraBold" },
        { file: "Zain/Zain-ExtraLight.ttf", family: "Zain ExtraLight" },
        { file: "Zain/Zain-Light.ttf", family: "Zain Light" },
        { file: "Zain/Zain-Italic.ttf", family: "Zain Italic" },
        { file: "Zain/Zain-LightItalic.ttf", family: "Zain Light Italic" },
        { file: "Vazirmatn/static/Vazirmatn-Regular.ttf", family: "Vazirmatn Regular" },
        { file: "Vazirmatn/static/Vazirmatn-Black.ttf", family: "Vazirmatn Black" },
        { file: "Vazirmatn/static/Vazirmatn-Bold.ttf", family: "Vazirmatn Bold" },
        { file: "Vazirmatn/static/Vazirmatn-ExtraBold.ttf", family: "Vazirmatn ExtraBold" },
        { file: "Vazirmatn/static/Vazirmatn-ExtraLight.ttf", family: "Vazirmatn ExtraLight" },
        { file: "Vazirmatn/static/Vazirmatn-Light.ttf", family: "Vazirmatn Light" },
        { file: "Vazirmatn/static/Vazirmatn-Medium.ttf", family: "Vazirmatn Medium" },
        { file: "Vazirmatn/static/Vazirmatn-SemiBold.ttf", family: "Vazirmatn SemiBold" },
        { file: "Vazirmatn/static/Vazirmatn-Thin.ttf", family: "Vazirmatn Thin" },
        { file: "Vazirmatn/Vazirmatn-VariableFont_wght.ttf", family: "Vazirmatn Variable" }
    ];

    const DEFAULT_CANVAS = { width: 800, height: 600 };
    const MAX_HISTORY = 120;
    const PRESET_STORAGE_KEY = "memeEditor.textPresets";
    const DEFAULT_SHAPE_FILL = "#ff0000";
    const DEFAULT_RECT_RADIUS = 12;

    // Render the document at a higher internal resolution so text (and vector
    // shapes) stay crisp even when the base image is small. The long edge is
    // brought up to at least this many pixels, capped by MAX_RENDER_SCALE.
    const RENDER_TARGET = 1600;
    const MAX_RENDER_SCALE = 4;

    const CURSORS = {
        select: "default",
        text: "text",
        brush: "crosshair",
        rect: "crosshair",
        ellipse: "crosshair",
        crop: "crosshair",
        eyedropper: "crosshair"
    };

    const HANDLE_CURSORS = {
        nw: "nwse-resize",
        n: "ns-resize",
        ne: "nesw-resize",
        e: "ew-resize",
        se: "nwse-resize",
        s: "ns-resize",
        sw: "nesw-resize",
        w: "ew-resize"
    };

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    const state = {
        baseImage: { source: null, width: 0, height: 0 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        background: "#ffffff",
        objects: [],
        selectedObjectId: null,
        activeTool: "select",
        brush: { mode: "draw", color: "#000000", size: 10 },
        currentColor: "#000000",
        currentShapeFill: DEFAULT_SHAPE_FILL,
        textPresets: []
    };

    let history = [];
    let historyIndex = -1;
    let interaction = null;
    let rafPending = false;

    // Crop tool rectangle (document coordinates). View-only until applied.
    let crop = null;

    // Active alignment guides shown while placing text/objects.
    // { allV, allH, v, h } where v/h are the snapped (highlighted) lines.
    let guideState = null;

    // View-only (not part of the document): render supersampling and zoom.
    let renderScale = 1;
    let zoom = 1; // 1 = fit to screen
    let displayScale = 1; // CSS pixels per document pixel

    // Registered font faces discovered from the fonts folder.
    let availableFonts = [];

    // ---------------------------------------------------------------------
    // DOM references
    // ---------------------------------------------------------------------

    const $ = (id) => document.getElementById(id);

    const canvas = $("canvas");
    const stage = $("stage");
    const emptyState = $("empty-state");
    const dropOverlay = $("drop-overlay");
    const toastsEl = $("toasts");
    const toolsEl = $("tools");

    const fileInput = $("file-input");
    const layerInput = $("layer-input");
    const replaceInput = $("replace-input");

    const brushMode = $("brush-mode");
    const brushColor = $("brush-color");
    const brushSize = $("brush-size");
    const brushSizeValue = $("brush-size-value");
    const btnCoverBg = $("btn-cover-bg");

    const padTop = $("pad-top");
    const padRight = $("pad-right");
    const padBottom = $("pad-bottom");
    const padLeft = $("pad-left");
    const presetClassic = $("preset-classic");
    const presetModern = $("preset-modern");

    const bgWhite = $("bg-white");
    const bgBlack = $("bg-black");
    const bgColor = $("bg-color");

    const propEmpty = $("prop-empty");
    const propText = $("prop-text");
    const propImage = $("prop-image");
    const propShape = $("prop-shape");
    const propCrop = $("prop-crop");
    const propOrder = $("prop-order");

    const cropApply = $("crop-apply");
    const cropCancel = $("crop-cancel");
    const cropSize = $("crop-size");

    const textContent = $("text-content");
    const textFont = $("text-font");
    const textSize = $("text-size");
    const textSizeValue = $("text-size-value");
    const textAutoFit = $("text-autofit");
    const textMaxSize = $("text-maxsize");
    const textAlignEl = $("text-align");
    const textColor = $("text-color");
    const textOutlineEnabled = $("text-outline-enabled");
    const textOutlineColor = $("text-outline-color");
    const textOutlineWidth = $("text-outline-width");
    const textOutlineValue = $("text-outline-value");

    const presetSelect = $("preset-select");
    const presetNameInput = $("preset-name");
    const presetApply = $("preset-apply");
    const presetSave = $("preset-save");
    const presetRename = $("preset-rename");
    const presetDelete = $("preset-delete");

    const imageOpacity = $("image-opacity");
    const imageOpacityValue = $("image-opacity-value");
    const imageWidth = $("image-width");
    const imageHeight = $("image-height");

    const shapeFill = $("shape-fill");
    const shapeRadiusField = $("shape-radius-field");
    const shapeRadius = $("shape-radius");
    const shapeRadiusValue = $("shape-radius-value");

    const zoomIn = $("zoom-in");
    const zoomOut = $("zoom-out");
    const zoomFit = $("zoom-fit");
    const zoomLabel = $("zoom-label");

    const orderForward = $("order-forward");
    const orderBackward = $("order-backward");
    const btnDelete = $("btn-delete");

    const btnOpen = $("btn-open");
    const btnReplace = $("btn-replace");
    const btnSave = $("btn-save");
    const btnUndo = $("btn-undo");
    const btnRedo = $("btn-redo");
    const emptyOpen = $("empty-open");

    // ---------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------

    function uid() {
        return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    }

    function clamp(v, min, max) {
        return Math.min(max, Math.max(min, v));
    }

    function rgbToHex(r, g, b) {
        return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
    }

    function toast(message, type) {
        const el = document.createElement("div");
        el.className = "toast" + (type === "error" ? " error" : "");
        el.textContent = message;
        toastsEl.appendChild(el);
        setTimeout(() => {
            el.style.opacity = "0";
            el.style.transition = "opacity 0.25s";
            setTimeout(() => el.remove(), 260);
        }, 2200);
    }

    function isEditingTarget(target) {
        if (!target) return false;
        const tag = target.tagName;
        return (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT" ||
            target.isContentEditable
        );
    }

    function getCtx() {
        return canvas.getContext("2d");
    }

    function fontStack(family) {
        const name = (family || DEFAULT_FONT).replace(/"/g, "");
        return '"' + name + '", ' + FONT_FALLBACK;
    }

    function isResizable(obj) {
        return (
            obj.type === "text" ||
            obj.type === "rect" ||
            obj.type === "ellipse" ||
            obj.type === "image"
        );
    }

    // ---------------------------------------------------------------------
    // Document geometry
    // ---------------------------------------------------------------------

    function computeDocumentSize() {
        const img = state.baseImage;
        if (!img.source || !img.width || !img.height) {
            return { width: DEFAULT_CANVAS.width, height: DEFAULT_CANVAS.height, left: 0, top: 0 };
        }
        const left = Math.round((img.width * state.padding.left) / 100);
        const right = Math.round((img.width * state.padding.right) / 100);
        const top = Math.round((img.height * state.padding.top) / 100);
        const bottom = Math.round((img.height * state.padding.bottom) / 100);
        return {
            width: Math.max(1, img.width + left + right),
            height: Math.max(1, img.height + top + bottom),
            left,
            top
        };
    }

    function getDocPoint(event) {
        const rect = canvas.getBoundingClientRect();
        // canvas.width is in supersampled device pixels; divide by renderScale
        // to get the document width before mapping from CSS pixels.
        const docWidth = canvas.width / renderScale;
        const docHeight = canvas.height / renderScale;
        const scaleX = docWidth / rect.width;
        const scaleY = docHeight / rect.height;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY
        };
    }

    // Rectangle the base image occupies in document coordinates. The base image
    // is always drawn at its native resolution (1 document unit = 1 pixel).
    function getImageRect() {
        const size = computeDocumentSize();
        const img = state.baseImage;
        return { x: size.left, y: size.top, width: img.width, height: img.height };
    }

    function clampCropRect(a, b) {
        const img = getImageRect();
        const x1 = clamp(Math.min(a.x, b.x), img.x, img.x + img.width);
        const y1 = clamp(Math.min(a.y, b.y), img.y, img.y + img.height);
        const x2 = clamp(Math.max(a.x, b.x), img.x, img.x + img.width);
        const y2 = clamp(Math.max(a.y, b.y), img.y, img.y + img.height);
        return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    }

    function shiftObjects(dx, dy) {
        if (!dx && !dy) return;
        for (const o of state.objects) {
            o.x = (o.x || 0) + dx;
            o.y = (o.y || 0) + dy;
            if (o.points) {
                for (const pt of o.points) {
                    pt.x += dx;
                    pt.y += dy;
                }
            }
        }
    }

    // Guide lines: the start, middle and end of the base image on both axes.
    function getGuideLines() {
        const img = getImageRect();
        if (!img.width || !img.height) return { xs: [], ys: [] };
        return {
            xs: [img.x, img.x + img.width / 2, img.x + img.width],
            ys: [img.y, img.y + img.height / 2, img.y + img.height]
        };
    }

    // Find the nearest guide alignment for an object placed at (nx, ny) and
    // return the snapped position plus the guide lines to highlight.
    function computeSnappedPosition(obj, nx, ny) {
        const guides = getGuideLines();
        if (!guides.xs.length) return { x: nx, y: ny, v: [], h: [], allV: [], allH: [] };

        const oldX = obj.x;
        const oldY = obj.y;
        obj.x = nx;
        obj.y = ny;
        const b = getObjectBounds(obj);
        obj.x = oldX;
        obj.y = oldY;

        const threshold = 7 / (displayScale > 0 ? displayScale : 1);
        const vCandidates = [b.x, b.x + b.width / 2, b.x + b.width];
        const hCandidates = [b.y, b.y + b.height / 2, b.y + b.height];

        let bestV = null;
        let bestVd = Infinity;
        for (const gx of guides.xs) {
            for (const c of vCandidates) {
                const d = Math.abs(gx - c);
                if (d <= threshold && d < bestVd) {
                    bestVd = d;
                    bestV = { guide: gx, delta: gx - c };
                }
            }
        }
        let bestH = null;
        let bestHd = Infinity;
        for (const gy of guides.ys) {
            for (const c of hCandidates) {
                const d = Math.abs(gy - c);
                if (d <= threshold && d < bestHd) {
                    bestHd = d;
                    bestH = { guide: gy, delta: gy - c };
                }
            }
        }

        const result = { x: nx, y: ny, v: [], h: [], allV: guides.xs, allH: guides.ys };
        if (bestV) {
            result.x = nx + bestV.delta;
            result.v.push(bestV.guide);
        }
        if (bestH) {
            result.y = ny + bestH.delta;
            result.h.push(bestH.guide);
        }
        return result;
    }

    // ---------------------------------------------------------------------
    // Object model helpers
    // ---------------------------------------------------------------------

    function createTextObject(x, y) {
        return {
            id: uid(),
            type: "text",
            x: x,
            y: y,
            text: "Text",
            fontFamily: DEFAULT_FONT,
            fontSize: 48,
            maxFontSize: 24,
            autoFit: false,
            color: "#ffffff",
            outlineColor: "#000000",
            outlineWidth: 4,
            outlineEnabled: true,
            align: "center",
            scaleX: 1,
            scaleY: 1
        };
    }

    function getSelectedObject() {
        if (!state.selectedObjectId) return null;
        return state.objects.find((o) => o.id === state.selectedObjectId) || null;
    }

    function selectedTextObject() {
        const o = getSelectedObject();
        return o && o.type === "text" ? o : null;
    }

    function getEffectiveFontSize(obj) {
        if (!obj.autoFit) return obj.fontSize;
        const size = computeDocumentSize();
        const avail = Math.max(40, size.width - 40);
        const ctx = getCtx();
        ctx.save();
        let fs = Math.max(8, obj.maxFontSize || obj.fontSize);
        let guard = 0;
        const lines = (obj.text || " ").split("\n");
        while (fs > 8 && guard < 600) {
            ctx.font = fs + "px " + fontStack(obj.fontFamily);
            let w = 0;
            for (const line of lines) w = Math.max(w, ctx.measureText(line).width);
            if (w <= avail) break;
            fs -= 1;
            guard++;
        }
        ctx.restore();
        return fs;
    }

    function getTextMetrics(obj) {
        const ctx = getCtx();
        const fontSize = getEffectiveFontSize(obj);
        const lineHeight = fontSize * 1.15;
        const lines = (obj.text || " ").split("\n");
        ctx.save();
        ctx.font = fontSize + "px " + fontStack(obj.fontFamily);
        let width = 0;
        for (const line of lines) width = Math.max(width, ctx.measureText(line).width);
        ctx.restore();
        return { fontSize, lineHeight, lines, width, height: lineHeight * lines.length };
    }

    function getTextBounds(obj) {
        const m = getTextMetrics(obj);
        const sx = obj.scaleX == null ? 1 : obj.scaleX;
        const sy = obj.scaleY == null ? 1 : obj.scaleY;
        const width = m.width * Math.abs(sx);
        const height = m.height * Math.abs(sy);
        let left;
        if (obj.align === "left") left = obj.x;
        else if (obj.align === "right") left = obj.x - width;
        else left = obj.x - width / 2;
        return { x: left, y: obj.y - height / 2, width: width, height: height };
    }

    function getObjectBounds(obj) {
        if (obj.type === "text") return getTextBounds(obj);
        if (obj.type === "brush") {
            if (!obj.points.length) return { x: obj.x || 0, y: obj.y || 0, width: 0, height: 0 };
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of obj.points) {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            }
            const pad = obj.size / 2;
            return { x: minX - pad, y: minY - pad, width: maxX - minX + obj.size, height: maxY - minY + obj.size };
        }
        return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
    }

    function hitTest(point) {
        for (let i = state.objects.length - 1; i >= 0; i--) {
            const o = state.objects[i];
            const b = getObjectBounds(o);
            if (
                point.x >= b.x &&
                point.x <= b.x + b.width &&
                point.y >= b.y &&
                point.y <= b.y + b.height
            ) {
                return o;
            }
        }
        return null;
    }

    function handleSizeDoc() {
        const scale = displayScale > 0 ? displayScale : 1;
        return 11 / scale;
    }

    function getHandleRects(obj) {
        const b = getObjectBounds(obj);
        const s = handleSizeDoc();
        const midX = b.x + b.width / 2;
        const midY = b.y + b.height / 2;
        const right = b.x + b.width;
        const bottom = b.y + b.height;
        return [
            ["nw", b.x, b.y],
            ["n", midX, b.y],
            ["ne", right, b.y],
            ["e", right, midY],
            ["se", right, bottom],
            ["s", midX, bottom],
            ["sw", b.x, bottom],
            ["w", b.x, midY]
        ].map(function (d) {
            return { name: d[0], x: d[1] - s / 2, y: d[2] - s / 2, width: s, height: s };
        });
    }

    function hitHandle(obj, point) {
        if (!isResizable(obj)) return null;
        const handles = getHandleRects(obj);
        for (const h of handles) {
            if (
                point.x >= h.x &&
                point.x <= h.x + h.width &&
                point.y >= h.y &&
                point.y <= h.y + h.height
            ) {
                return h.name;
            }
        }
        return null;
    }

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------

    function renderBrush(ctx, obj) {
        if (!obj.points.length) return;
        ctx.save();
        ctx.strokeStyle = obj.color;
        ctx.fillStyle = obj.color;
        ctx.lineWidth = obj.size;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (obj.points.length === 1) {
            ctx.beginPath();
            ctx.arc(obj.points[0].x, obj.points[0].y, obj.size / 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(obj.points[0].x, obj.points[0].y);
            for (let i = 1; i < obj.points.length; i++) {
                ctx.lineTo(obj.points[i].x, obj.points[i].y);
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    function renderText(ctx, obj) {
        const m = getTextMetrics(obj);
        const sx = obj.scaleX == null ? 1 : obj.scaleX;
        const sy = obj.scaleY == null ? 1 : obj.scaleY;
        ctx.save();
        ctx.translate(obj.x, obj.y);
        ctx.scale(sx, sy);
        ctx.font = m.fontSize + "px " + fontStack(obj.fontFamily);
        ctx.textAlign = obj.align;
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        const startY = -m.height / 2 + m.lineHeight / 2;
        m.lines.forEach((line, i) => {
            const yy = startY + i * m.lineHeight;
            if (obj.outlineEnabled && obj.outlineWidth > 0) {
                ctx.lineWidth = obj.outlineWidth;
                ctx.strokeStyle = obj.outlineColor;
                ctx.strokeText(line, 0, yy);
            }
            ctx.fillStyle = obj.color;
            ctx.fillText(line, 0, yy);
        });
        ctx.restore();
    }

    function renderObject(ctx, obj) {
        switch (obj.type) {
            case "text":
                renderText(ctx, obj);
                break;
            case "rect": {
                ctx.fillStyle = obj.fill;
                const r = Math.max(
                    0,
                    Math.min(
                        obj.radius == null ? DEFAULT_RECT_RADIUS : obj.radius,
                        Math.abs(obj.width) / 2,
                        Math.abs(obj.height) / 2
                    )
                );
                if (r > 0 && ctx.roundRect) {
                    ctx.beginPath();
                    ctx.roundRect(obj.x, obj.y, obj.width, obj.height, r);
                    ctx.fill();
                } else {
                    ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
                }
                break;
            }
            case "ellipse":
                ctx.beginPath();
                ctx.fillStyle = obj.fill;
                ctx.ellipse(
                    obj.x + obj.width / 2,
                    obj.y + obj.height / 2,
                    Math.abs(obj.width / 2),
                    Math.abs(obj.height / 2),
                    0,
                    0,
                    Math.PI * 2
                );
                ctx.fill();
                break;
            case "image":
                if (obj.source) {
                    ctx.save();
                    ctx.globalAlpha = obj.opacity == null ? 1 : obj.opacity;
                    ctx.drawImage(obj.source, obj.x, obj.y, obj.width, obj.height);
                    ctx.restore();
                }
                break;
            case "brush":
                renderBrush(ctx, obj);
                break;
            default:
                break;
        }
    }

    function renderDocument(ctx) {
        const size = computeDocumentSize();
        ctx.clearRect(0, 0, size.width, size.height);
        ctx.fillStyle = state.background;
        ctx.fillRect(0, 0, size.width, size.height);

        const img = state.baseImage;
        if (img.source) {
            ctx.drawImage(img.source, size.left, size.top, img.width, img.height);
        }

        for (const obj of state.objects) {
            renderObject(ctx, obj);
        }
    }

    function drawSelection(ctx) {
        const obj = getSelectedObject();
        if (!obj) return;
        const b = getObjectBounds(obj);
        const u = 1 / (displayScale > 0 ? displayScale : 1); // document units per CSS pixel
        const pad = 3 * u;
        ctx.save();
        ctx.strokeStyle = "#4f74ff";
        ctx.lineWidth = 1.5 * u;
        ctx.setLineDash([6 * u, 4 * u]);
        ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
        ctx.setLineDash([]);

        if (isResizable(obj)) {
            const handles = getHandleRects(obj);
            ctx.fillStyle = "#4f74ff";
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1 * u;
            for (const h of handles) {
                ctx.fillRect(h.x, h.y, h.width, h.height);
                ctx.strokeRect(h.x, h.y, h.width, h.height);
            }
        }
        ctx.restore();
    }

    function updateSelectionGuides() {
        if (interaction) return;
        const obj = getSelectedObject();
        if (obj && obj.type === "text" && state.activeTool === "select") {
            const g = getGuideLines();
            guideState = { allV: g.xs, allH: g.ys, v: [], h: [] };
        } else {
            guideState = null;
        }
    }

    // Editor-only alignment guides. Faint lines show the image start, middle
    // and end; bright lines mark a snap that is currently active.
    function drawGuides(ctx) {
        if (!guideState) return;
        const size = computeDocumentSize();
        const u = 1 / (displayScale > 0 ? displayScale : 1);
        ctx.save();
        ctx.strokeStyle = "rgba(108, 140, 255, 0.5)";
        ctx.lineWidth = 1 * u;
        ctx.setLineDash([7 * u, 5 * u]);
        ctx.beginPath();
        for (const x of guideState.allV) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, size.height);
        }
        for (const y of guideState.allH) {
            ctx.moveTo(0, y);
            ctx.lineTo(size.width, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "#4f74ff";
        ctx.lineWidth = 1.8 * u;
        ctx.beginPath();
        for (const x of guideState.v) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, size.height);
        }
        for (const y of guideState.h) {
            ctx.moveTo(0, y);
            ctx.lineTo(size.width, y);
        }
        ctx.stroke();
        ctx.restore();
    }

    // Editor-only crop overlay. Dims everything outside the crop rectangle and
    // draws a rule-of-thirds grid inside it.
    function drawCropOverlay(ctx) {
        if (state.activeTool !== "crop" || !state.baseImage.source) return;
        const size = computeDocumentSize();
        const u = 1 / (displayScale > 0 ? displayScale : 1);
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        if (!crop) {
            ctx.fillRect(0, 0, size.width, size.height);
        } else {
            const c = crop;
            ctx.fillRect(0, 0, size.width, c.y);
            ctx.fillRect(0, c.y, c.x, c.height);
            ctx.fillRect(c.x + c.width, c.y, size.width - (c.x + c.width), c.height);
            ctx.fillRect(0, c.y + c.height, size.width, size.height - (c.y + c.height));

            ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
            ctx.lineWidth = 1 * u;
            ctx.beginPath();
            for (let i = 1; i < 3; i++) {
                const gx = c.x + (c.width * i) / 3;
                ctx.moveTo(gx, c.y);
                ctx.lineTo(gx, c.y + c.height);
                const gy = c.y + (c.height * i) / 3;
                ctx.moveTo(c.x, gy);
                ctx.lineTo(c.x + c.width, gy);
            }
            ctx.stroke();

            ctx.strokeStyle = "#4f74ff";
            ctx.lineWidth = 1.5 * u;
            ctx.strokeRect(c.x, c.y, c.width, c.height);
        }
        ctx.restore();
    }

    function getRenderScale(size) {
        const longSide = Math.max(size.width, size.height);
        if (longSide <= 0) return 1;
        if (longSide >= RENDER_TARGET) return 1;
        return Math.min(MAX_RENDER_SCALE, Math.ceil(RENDER_TARGET / longSide));
    }

    function computeFitScale(width, height) {
        const availW = stage.clientWidth - 48;
        const availH = stage.clientHeight - 48;
        if (availW <= 0 || availH <= 0) return 1;
        return Math.min(availW / width, availH / height, 1);
    }

    function applyDisplayScale(size) {
        const fit = computeFitScale(size.width, size.height);
        displayScale = fit * zoom;
        canvas.style.width = Math.max(1, Math.round(size.width * displayScale)) + "px";
        canvas.style.height = Math.max(1, Math.round(size.height * displayScale)) + "px";
        zoomLabel.textContent = Math.round(zoom * 100) + "%";
    }

    function render() {
        const size = computeDocumentSize();
        renderScale = getRenderScale(size);
        const w = Math.max(1, Math.round(size.width * renderScale));
        const h = Math.max(1, Math.round(size.height * renderScale));
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;

        applyDisplayScale(size);

        const ctx = getCtx();
        ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
        renderDocument(ctx);
        updateSelectionGuides();
        drawGuides(ctx);
        drawCropOverlay(ctx);
        drawSelection(ctx);

        updateEmptyState();
    }

    function setZoom(value) {
        zoom = clamp(value, 0.1, 8);
        render();
    }

    function requestRender() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            render();
        });
    }

    function updateEmptyState() {
        const hasImage = !!state.baseImage.source;
        emptyState.classList.toggle("hidden", hasImage);
        btnReplace.disabled = !hasImage;
    }

    // ---------------------------------------------------------------------
    // History
    // ---------------------------------------------------------------------

    function cloneObject(obj) {
        const copy = Object.assign({}, obj);
        if (obj.points) copy.points = obj.points.map((p) => ({ x: p.x, y: p.y }));
        return copy;
    }

    function cloneState() {
        return {
            baseImage: {
                source: state.baseImage.source,
                width: state.baseImage.width,
                height: state.baseImage.height
            },
            padding: Object.assign({}, state.padding),
            background: state.background,
            objects: state.objects.map(cloneObject),
            selectedObjectId: state.selectedObjectId,
            brush: Object.assign({}, state.brush),
            currentColor: state.currentColor,
            currentShapeFill: state.currentShapeFill
        };
    }

    function applySnapshot(snap) {
        state.baseImage = {
            source: snap.baseImage.source,
            width: snap.baseImage.width,
            height: snap.baseImage.height
        };
        state.padding = Object.assign({}, snap.padding);
        state.background = snap.background;
        state.objects = snap.objects.map(cloneObject);
        state.selectedObjectId = snap.selectedObjectId;
        state.brush = Object.assign({}, snap.brush);
        state.currentColor = snap.currentColor;
        state.currentShapeFill = snap.currentShapeFill;
        render();
        syncUI();
    }

    function updateHistoryButtons() {
        if (!btnUndo || !btnRedo) return;
        btnUndo.disabled = historyIndex <= 0;
        btnRedo.disabled = historyIndex >= history.length - 1;
    }

    function commit() {
        history = history.slice(0, historyIndex + 1);
        history.push(cloneState());
        if (history.length > MAX_HISTORY) {
            history.shift();
        }
        historyIndex = history.length - 1;
        updateHistoryButtons();
    }

    function undo() {
        if (historyIndex <= 0) return;
        historyIndex--;
        applySnapshot(history[historyIndex]);
        updateHistoryButtons();
    }

    function redo() {
        if (historyIndex >= history.length - 1) return;
        historyIndex++;
        applySnapshot(history[historyIndex]);
        updateHistoryButtons();
    }

    // ---------------------------------------------------------------------
    // Image loading
    // ---------------------------------------------------------------------

    function isImageFile(file) {
        return file && file.type && file.type.indexOf("image/") === 0;
    }

    function loadImageFile(file, mode) {
        if (!file) return;
        if (!isImageFile(file)) {
            toast("Unsupported file type", "error");
            return;
        }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = function () {
            URL.revokeObjectURL(url);
            handleLoadedImage(img, mode);
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            toast("Could not read image file", "error");
        };
        img.src = url;
    }

    const IMAGE_PATH_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;

    function isImagePath(path) {
        return IMAGE_PATH_RE.test(path || "");
    }

    function hasBackend() {
        return !!(window.go && window.go.main && window.go.main.App);
    }

    function loadImagePath(path, mode) {
        if (!hasBackend()) return;
        window.go.main.App.ReadImageFile(path)
            .then(function (dataURL) {
                const img = new Image();
                img.onload = function () {
                    handleLoadedImage(img, mode);
                };
                img.onerror = function () {
                    toast("Could not read image file", "error");
                };
                img.src = dataURL;
            })
            .catch(function () {
                toast("Could not read image file", "error");
            });
    }

    function handleLoadedImage(img, mode) {
        if (!img.naturalWidth || !img.naturalHeight) {
            toast("Image has no dimensions", "error");
            return;
        }
        if (mode === "replace") {
            setBaseImage(img);
        } else if (mode === "layer") {
            addImageLayer(img);
        } else if (!state.baseImage.source) {
            setBaseImage(img);
        } else {
            addImageLayer(img);
        }
    }

    function setBaseImage(img) {
        state.baseImage = {
            source: img,
            width: img.naturalWidth,
            height: img.naturalHeight
        };
        state.selectedObjectId = null;
        commit();
        render();
        syncUI();
        toast("Base image loaded");
    }

    function addImageLayer(img) {
        const size = computeDocumentSize();
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const maxW = size.width * 0.8;
        const maxH = size.height * 0.8;
        if (w > maxW || h > maxH) {
            const k = Math.min(maxW / w, maxH / h);
            w *= k;
            h *= k;
        }
        const obj = {
            id: uid(),
            type: "image",
            source: img,
            x: Math.round((size.width - w) / 2),
            y: Math.round((size.height - h) / 2),
            width: Math.round(w),
            height: Math.round(h),
            opacity: 1
        };
        state.objects.push(obj);
        state.selectedObjectId = obj.id;
        state.activeTool = "select";
        commit();
        render();
        syncUI();
        toast("Image added as layer");
    }

    // ---------------------------------------------------------------------
    // Fonts
    // ---------------------------------------------------------------------

    function deriveFontFamily(file) {
        const base = file.split("/").pop().replace(FONT_EXT_RE, "");
        const name = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
        return name || base;
    }

    function normalizeFontEntry(entry) {
        const file = typeof entry === "string" ? entry : entry && entry.file;
        if (!file || !FONT_EXT_RE.test(file)) return null;
        let url;
        if (/^(https?:)?\/\//i.test(file) || file.charAt(0) === "/") {
            url = file;
        } else if (file.indexOf(FONT_DIR) === 0) {
            url = file;
        } else {
            url = FONT_DIR + file.replace(/^\.\//, "");
        }
        return {
            family: (entry && entry.family) || deriveFontFamily(file),
            url: url,
            weight: (entry && entry.weight) || "normal",
            style: (entry && entry.style) || "normal"
        };
    }

    // Follow a directory listing (works with static servers that enable
    // autoindex) to collect every font file under the fonts folder.
    async function scanFontDirectory(root) {
        const files = [];
        const visited = new Set();
        const queue = [{ path: root, depth: 0 }];
        while (queue.length) {
            const item = queue.shift();
            if (item.depth > 4 || visited.has(item.path)) continue;
            visited.add(item.path);
            let html;
            try {
                const res = await fetch(item.path, { cache: "no-store" });
                if (!res.ok) continue;
                const type = res.headers.get("content-type") || "";
                if (type && type.indexOf("html") === -1) continue;
                html = await res.text();
            } catch (err) {
                continue;
            }
            const re = /href\s*=\s*["']([^"']+)["']/gi;
            let m;
            while ((m = re.exec(html))) {
                let href = m[1].split("?")[0].split("#")[0];
                if (!href || href.indexOf("javascript:") === 0) continue;
                href = decodeURIComponent(href);
                if (href.charAt(0) === "/") href = href.slice(1);
                if (href.indexOf("..") === 0) continue;
                if (href.indexOf("./") === 0) href = href.slice(2);
                if (!href) continue;
                if (href.charAt(href.length - 1) === "/") {
                    queue.push({ path: item.path + href, depth: item.depth + 1 });
                } else if (FONT_EXT_RE.test(href)) {
                    files.push(href.indexOf(item.path) === 0 ? href : item.path + href);
                }
            }
        }
        return files;
    }

    async function discoverFonts() {
        const entries = [];
        try {
            const res = await fetch(FONT_MANIFEST, { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                const list = Array.isArray(data) ? data : (data && data.fonts) || [];
                for (const e of list) entries.push(e);
            }
        } catch (err) {
            /* fall through to bundled list */
        }
        for (const f of FONT_FILE_LIST) entries.push(f);
        try {
            const scanned = await scanFontDirectory(FONT_DIR);
            for (const f of scanned) entries.push(f);
        } catch (err) {
            /* directory listing unavailable */
        }
        const result = [];
        const byUrl = new Set();
        for (const e of entries) {
            const norm = normalizeFontEntry(e);
            if (!norm || byUrl.has(norm.url)) continue;
            byUrl.add(norm.url);
            result.push(norm);
        }
        return result;
    }

    function registerFontFaces(list) {
        const css = list
            .map(function (f) {
                const family = f.family.replace(/"/g, "");
                return (
                    '@font-face{font-family:"' + family + '";src:url("' + f.url + '");' +
                    "font-weight:" + f.weight + ";font-style:" + f.style + ";font-display:swap;}"
                );
            })
            .join("\n");
        let el = document.getElementById("dynamic-font-faces");
        if (!el) {
            el = document.createElement("style");
            el.id = "dynamic-font-faces";
            document.head.appendChild(el);
        }
        el.textContent = css;
    }

    function renderFontOptions() {
        const seen = new Set();
        const families = [];
        for (const f of availableFonts) {
            if (seen.has(f.family)) continue;
            seen.add(f.family);
            families.push(f.family);
        }
        if (!families.length) families.push(DEFAULT_FONT);
        textFont.innerHTML = "";
        for (const fam of families) {
            const opt = document.createElement("option");
            opt.value = fam;
            opt.textContent = fam;
            textFont.appendChild(opt);
        }
        const obj = selectedTextObject();
        setFontSelectValue(obj ? obj.fontFamily : DEFAULT_FONT);
    }

    function setFontSelectValue(family) {
        if (!family) family = DEFAULT_FONT;
        const known = Array.prototype.some.call(textFont.options, function (o) {
            return o.value === family;
        });
        if (!known) {
            const opt = document.createElement("option");
            opt.value = family;
            opt.textContent = family;
            textFont.appendChild(opt);
        }
        textFont.value = family;
    }

    function ensureFontLoaded(family) {
        if (!document.fonts || !document.fonts.load || !family) return Promise.resolve();
        return document.fonts.load('64px "' + family.replace(/"/g, "") + '"').catch(function () {});
    }

    function initFonts() {
        return discoverFonts().then(function (list) {
            availableFonts = list;
            registerFontFaces(availableFonts);
            renderFontOptions();
            const loads = availableFonts.map(function (f) {
                return ensureFontLoaded(f.family);
            });
            Promise.all(loads).then(function () {
                render();
                syncUI();
            });
        });
    }

    // ---------------------------------------------------------------------
    // Tool + UI sync
    // ---------------------------------------------------------------------

    function setActiveTool(tool) {
        if (tool === "crop" && !state.baseImage.source) {
            toast("Open an image before cropping", "error");
            return;
        }
        if (tool !== "crop") crop = null;
        if (tool === "crop") {
            state.selectedObjectId = null;
            guideState = null;
        }
        state.activeTool = tool;
        canvas.style.cursor = CURSORS[tool] || "default";
        document.querySelectorAll(".tool").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.tool === tool);
        });
        syncUI();
    }

    function syncUI() {
        document.querySelectorAll(".tool").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.tool === state.activeTool);
        });

        const obj = getSelectedObject();
        const cropping = state.activeTool === "crop" && !!state.baseImage.source;
        propEmpty.classList.toggle("hidden", !!obj || cropping);
        propText.classList.toggle("hidden", !(obj && obj.type === "text"));
        propImage.classList.toggle("hidden", !(obj && obj.type === "image"));
        propShape.classList.toggle("hidden", !(obj && (obj.type === "rect" || obj.type === "ellipse")));
        propCrop.classList.toggle("hidden", !cropping);
        propOrder.classList.toggle("hidden", !obj || cropping);

        const cropReady = !!crop && crop.width >= 2 && crop.height >= 2;
        cropApply.disabled = !cropReady;
        cropSize.textContent = cropReady
            ? Math.round(crop.width) + " × " + Math.round(crop.height) + " px"
            : "";

        if (obj && obj.type === "text") {
            textContent.value = obj.text;
            setFontSelectValue(obj.fontFamily);
            textSize.value = obj.fontSize;
            textSizeValue.textContent = Math.round(
                getEffectiveFontSize(obj) * (obj.scaleY == null ? 1 : obj.scaleY)
            );
            textAutoFit.checked = !!obj.autoFit;
            textMaxSize.value = obj.maxFontSize;
            textColor.value = obj.color;
            textOutlineEnabled.checked = !!obj.outlineEnabled;
            textOutlineColor.value = obj.outlineColor;
            textOutlineWidth.value = obj.outlineWidth;
            textOutlineValue.textContent = obj.outlineWidth;
            textAlignEl.querySelectorAll("button").forEach((b) => {
                b.classList.toggle("active", b.dataset.align === obj.align);
            });
            const preset = state.textPresets.find((p) => p.fontFamily === obj.fontFamily);
            if (preset) presetSelect.value = preset.id;
        }

        if (obj && obj.type === "image") {
            const pct = Math.round((obj.opacity == null ? 1 : obj.opacity) * 100);
            imageOpacity.value = pct;
            imageOpacityValue.textContent = pct;
            imageWidth.value = Math.round(obj.width);
            imageHeight.value = Math.round(obj.height);
        }

        if (obj && (obj.type === "rect" || obj.type === "ellipse")) {
            shapeFill.value = obj.fill;
            const isRect = obj.type === "rect";
            shapeRadiusField.classList.toggle("hidden", !isRect);
            if (isRect) {
                const r = obj.radius == null ? DEFAULT_RECT_RADIUS : obj.radius;
                shapeRadius.value = r;
                shapeRadiusValue.textContent = Math.round(r);
            }
        }

        updateEmptyState();
    }

    // ---------------------------------------------------------------------
    // Pointer interaction
    // ---------------------------------------------------------------------

    function onPointerDown(event) {
        if (event.button !== 0) return;
        const p = getDocPoint(event);
        const tool = state.activeTool;
        guideState = null;

        if (tool === "eyedropper") {
            sampleColorAt(p);
            return;
        }

        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (err) {
            /* pointer capture is best-effort */
        }

        if (tool === "crop") {
            const img = getImageRect();
            if (
                p.x < img.x ||
                p.x > img.x + img.width ||
                p.y < img.y ||
                p.y > img.y + img.height
            ) {
                return;
            }
            crop = { x: p.x, y: p.y, width: 0, height: 0 };
            interaction = { kind: "crop", start: p };
            render();
            syncUI();
            return;
        }

        if (tool === "brush") {
            const stroke = {
                id: uid(),
                type: "brush",
                points: [{ x: p.x, y: p.y }],
                color: state.brush.color,
                size: state.brush.size,
                mode: state.brush.mode
            };
            state.objects.push(stroke);
            state.selectedObjectId = stroke.id;
            interaction = { kind: "brush", object: stroke };
            render();
            syncUI();
            return;
        }

        if (tool === "text") {
            const textObj = createTextObject(p.x, p.y);
            state.objects.push(textObj);
            state.selectedObjectId = textObj.id;
            setActiveTool("select");
            commit();
            render();
            syncUI();
            focusTextEditor();
            return;
        }

        if (tool === "rect" || tool === "ellipse") {
            const shape = {
                id: uid(),
                type: tool,
                x: p.x,
                y: p.y,
                width: 0,
                height: 0,
                fill: state.currentShapeFill,
                radius: DEFAULT_RECT_RADIUS
            };
            state.objects.push(shape);
            state.selectedObjectId = shape.id;
            interaction = { kind: "create", object: shape, start: p };
            render();
            syncUI();
            return;
        }

        // Select tool
        const selected = getSelectedObject();
        if (selected) {
            const handle = hitHandle(selected, p);
            if (handle) {
                interaction = {
                    kind: "resize",
                    object: selected,
                    handle: handle,
                    start: p,
                    bounds: getObjectBounds(selected),
                    original: snapshotResize(selected)
                };
                return;
            }
        }

        const hit = hitTest(p);
        if (hit) {
            state.selectedObjectId = hit.id;
            interaction = {
                kind: "drag",
                object: hit,
                dx: p.x - hit.x,
                dy: p.y - hit.y,
                moved: false
            };
        } else {
            state.selectedObjectId = null;
            interaction = null;
        }
        render();
        syncUI();
    }

    function snapshotResize(obj) {
        if (obj.type === "text") {
            const m = getTextMetrics(obj);
            return { baseWidth: m.width || 1, baseHeight: m.height || 1 };
        }
        return {};
    }

    function applyResize(inter, p) {
        const obj = inter.object;
        const b = inter.bounds;
        const h = inter.handle;

        let left = b.x;
        let right = b.x + b.width;
        let top = b.y;
        let bottom = b.y + b.height;

        if (h.indexOf("w") !== -1) left = Math.min(p.x, right - 2);
        if (h.indexOf("e") !== -1) right = Math.max(p.x, left + 2);
        if (h.indexOf("n") !== -1) top = Math.min(p.y, bottom - 2);
        if (h.indexOf("s") !== -1) bottom = Math.max(p.y, top + 2);

        // Corners preserve the original aspect ratio; edges resize freely.
        if (h.length === 2 && b.width > 0 && b.height > 0) {
            const scale = Math.max((right - left) / b.width, (bottom - top) / b.height);
            const nw = b.width * scale;
            const nh = b.height * scale;
            if (h.indexOf("w") !== -1) left = right - nw;
            else right = left + nw;
            if (h.indexOf("n") !== -1) top = bottom - nh;
            else bottom = top + nh;
        }

        const nw = right - left;
        const nh = bottom - top;

        if (obj.type === "text") {
            const baseW = inter.original.baseWidth || 1;
            const baseH = inter.original.baseHeight || 1;
            obj.scaleX = clamp(nw / baseW, 0.05, 50);
            obj.scaleY = clamp(nh / baseH, 0.05, 50);
            if (obj.align === "left") obj.x = left;
            else if (obj.align === "right") obj.x = right;
            else obj.x = left + nw / 2;
            obj.y = top + nh / 2;
        } else {
            obj.x = left;
            obj.y = top;
            obj.width = nw;
            obj.height = nh;
        }
    }

    function updateHoverCursor(event) {
        if (state.activeTool !== "select") return;
        const p = getDocPoint(event);
        const selected = getSelectedObject();
        if (selected) {
            const handle = hitHandle(selected, p);
            if (handle) {
                canvas.style.cursor = HANDLE_CURSORS[handle] || "default";
                return;
            }
        }
        canvas.style.cursor = hitTest(p) ? "move" : CURSORS[state.activeTool] || "default";
    }

    function onPointerMove(event) {
        if (!interaction) {
            updateHoverCursor(event);
            return;
        }
        const p = getDocPoint(event);

        if (interaction.kind === "brush") {
            interaction.object.points.push({ x: p.x, y: p.y });
            requestRender();
            return;
        }

        if (interaction.kind === "crop") {
            crop = clampCropRect(interaction.start, p);
            requestRender();
            return;
        }

        if (interaction.kind === "create") {
            const o = interaction.object;
            const s = interaction.start;
            o.x = Math.min(s.x, p.x);
            o.y = Math.min(s.y, p.y);
            o.width = Math.abs(p.x - s.x);
            o.height = Math.abs(p.y - s.y);
            requestRender();
            return;
        }

        if (interaction.kind === "drag") {
            const o = interaction.object;
            const snap = computeSnappedPosition(o, p.x - interaction.dx, p.y - interaction.dy);
            o.x = snap.x;
            o.y = snap.y;
            guideState = { allV: snap.allV, allH: snap.allH, v: snap.v, h: snap.h };
            interaction.moved = true;
            requestRender();
            return;
        }

        if (interaction.kind === "resize") {
            applyResize(interaction, p);
            requestRender();
            return;
        }
    }

    function onPointerUp(event) {
        if (!interaction) return;
        const kind = interaction.kind;

        if (kind === "brush") {
            commit();
        } else if (kind === "crop") {
            if (!crop || crop.width < 2 || crop.height < 2) crop = null;
        } else if (kind === "create") {
            const o = interaction.object;
            if (o.width < 2 || o.height < 2) {
                o.width = Math.max(o.width, 160);
                o.height = Math.max(o.height, 120);
            }
            commit();
            setActiveTool("select");
        } else if (kind === "drag" && interaction.moved) {
            commit();
        } else if (kind === "resize") {
            commit();
        }

        interaction = null;
        render();
        syncUI();
    }

    function onDoubleClick(event) {
        if (state.activeTool !== "select") return;
        const p = getDocPoint(event);
        const hit = hitTest(p);
        if (hit && hit.type === "text") {
            state.selectedObjectId = hit.id;
            render();
            syncUI();
            focusTextEditor();
        }
    }

    function focusTextEditor() {
        syncUI();
        textContent.focus();
        textContent.select();
    }

    function sampleColorAt(p) {
        const size = computeDocumentSize();
        const x = Math.floor(p.x);
        const y = Math.floor(p.y);
        if (x < 0 || y < 0 || x >= size.width || y >= size.height) return;
        const ctx = getCtx();
        const px = clamp(Math.floor(p.x * renderScale), 0, canvas.width - 1);
        const py = clamp(Math.floor(p.y * renderScale), 0, canvas.height - 1);
        const data = ctx.getImageData(px, py, 1, 1).data;
        const hex = rgbToHex(data[0], data[1], data[2]);
        state.currentColor = hex;
        state.brush.color = hex;
        brushColor.value = hex;
        toast("Picked " + hex);
    }

    // ---------------------------------------------------------------------
    // Text presets
    // ---------------------------------------------------------------------

    function loadPresets() {
        try {
            const raw = localStorage.getItem(PRESET_STORAGE_KEY);
            state.textPresets = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(state.textPresets)) state.textPresets = [];
        } catch (err) {
            state.textPresets = [];
        }
    }

    function persistPresets() {
        try {
            localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(state.textPresets));
        } catch (err) {
            toast("Could not save presets", "error");
        }
    }

    function renderPresetOptions() {
        presetSelect.innerHTML = "";
        if (!state.textPresets.length) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "No presets saved";
            presetSelect.appendChild(opt);
            return;
        }
        state.textPresets.forEach((p) => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            presetSelect.appendChild(opt);
        });
    }

    function saveCurrentAsPreset() {
        const obj = selectedTextObject();
        if (!obj) {
            toast("Select a text object first", "error");
            return;
        }
        const name = (presetNameInput.value || "").trim() || "Preset " + (state.textPresets.length + 1);
        const preset = {
            id: uid(),
            name: name,
            fontFamily: obj.fontFamily,
            maxFontSize: obj.maxFontSize || obj.fontSize,
            align: obj.align,
            color: obj.color,
            outlineColor: obj.outlineColor,
            outlineWidth: obj.outlineWidth,
            outlineEnabled: obj.outlineEnabled
        };
        state.textPresets.push(preset);
        persistPresets();
        renderPresetOptions();
        presetSelect.value = preset.id;
        presetNameInput.value = "";
        toast('Saved preset "' + name + '"');
    }

    function applySelectedPreset() {
        const obj = selectedTextObject();
        if (!obj) {
            toast("Select a text object first", "error");
            return;
        }
        const preset = state.textPresets.find((p) => p.id === presetSelect.value);
        if (!preset) {
            toast("No preset selected", "error");
            return;
        }
        obj.fontFamily = preset.fontFamily;
        obj.maxFontSize = preset.maxFontSize;
        obj.fontSize = preset.maxFontSize;
        obj.autoFit = true;
        obj.align = preset.align;
        obj.color = preset.color;
        obj.outlineColor = preset.outlineColor;
        obj.outlineWidth = preset.outlineWidth;
        obj.outlineEnabled = preset.outlineEnabled;
        commit();
        render();
        syncUI();
        toast('Applied "' + preset.name + '"');
    }

    function renameSelectedPreset() {
        const preset = state.textPresets.find((p) => p.id === presetSelect.value);
        if (!preset) {
            toast("No preset selected", "error");
            return;
        }
        const name = (presetNameInput.value || "").trim();
        if (!name) {
            toast("Enter a new name", "error");
            return;
        }
        preset.name = name;
        persistPresets();
        renderPresetOptions();
        presetSelect.value = preset.id;
        presetNameInput.value = "";
        toast("Preset renamed");
    }

    function deleteSelectedPreset() {
        const preset = state.textPresets.find((p) => p.id === presetSelect.value);
        if (!preset) {
            toast("No preset selected", "error");
            return;
        }
        state.textPresets = state.textPresets.filter((p) => p !== preset);
        persistPresets();
        renderPresetOptions();
        toast("Preset deleted");
    }

    // ---------------------------------------------------------------------
    // Export
    // ---------------------------------------------------------------------

    function exportImage() {
        if (!state.baseImage.source && state.objects.length === 0) {
            toast("Nothing to export", "error");
            return;
        }
        const size = computeDocumentSize();
        const scale = getRenderScale(size);
        const off = document.createElement("canvas");
        off.width = Math.max(1, Math.round(size.width * scale));
        off.height = Math.max(1, Math.round(size.height * scale));
        const octx = off.getContext("2d");
        octx.setTransform(scale, 0, 0, scale, 0, 0);
        renderDocument(octx);

        off.toBlob(function (blob) {
            if (!blob) {
                toast("Export failed", "error");
                return;
            }
            if (hasBackend()) {
                const reader = new FileReader();
                reader.onload = function () {
                    window.go.main.App.SaveImage(reader.result)
                        .then(function (saved) {
                            if (saved) toast("Saved " + saved);
                        })
                        .catch(function (err) {
                            toast("Save failed: " + err, "error");
                        });
                };
                reader.onerror = function () {
                    toast("Save failed", "error");
                };
                reader.readAsDataURL(blob);
                return;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "meme.png";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast("Saved meme.png");
        }, "image/png");
    }

    // ---------------------------------------------------------------------
    // Object operations

    function deleteSelectedObject() {
        const obj = getSelectedObject();
        if (!obj) return;
        state.objects = state.objects.filter((o) => o !== obj);
        state.selectedObjectId = null;
        commit();
        render();
        syncUI();
    }

    function bringForward() {
        const obj = getSelectedObject();
        if (!obj) return;
        const i = state.objects.indexOf(obj);
        if (i >= 0 && i < state.objects.length - 1) {
            const tmp = state.objects[i];
            state.objects[i] = state.objects[i + 1];
            state.objects[i + 1] = tmp;
            commit();
            render();
        }
    }

    function sendBackward() {
        const obj = getSelectedObject();
        if (!obj) return;
        const i = state.objects.indexOf(obj);
        if (i > 0) {
            const tmp = state.objects[i];
            state.objects[i] = state.objects[i - 1];
            state.objects[i - 1] = tmp;
            commit();
            render();
        }
    }

    // ---------------------------------------------------------------------
    // Crop
    // ---------------------------------------------------------------------

    function applyCrop() {
        const img = state.baseImage;
        if (!img.source || !crop || crop.width < 2 || crop.height < 2) {
            toast("Select a crop area first", "error");
            return;
        }
        const rect = getImageRect();
        const ix = clamp(Math.round(crop.x - rect.x), 0, img.width - 1);
        const iy = clamp(Math.round(crop.y - rect.y), 0, img.height - 1);
        const cw = clamp(Math.round(crop.width), 1, img.width - ix);
        const ch = clamp(Math.round(crop.height), 1, img.height - iy);

        const off = document.createElement("canvas");
        off.width = cw;
        off.height = ch;
        off.getContext("2d").drawImage(img.source, ix, iy, cw, ch, 0, 0, cw, ch);

        // Keep overlays aligned with the image content they were placed on.
        const oldSize = computeDocumentSize();
        state.baseImage = { source: off, width: cw, height: ch };
        const newSize = computeDocumentSize();
        shiftObjects(newSize.left - oldSize.left - ix, newSize.top - oldSize.top - iy);

        crop = null;
        state.selectedObjectId = null;
        setActiveTool("select");
        commit();
        render();
        syncUI();
        toast("Cropped to " + cw + " × " + ch);
    }

    function cancelCrop() {
        crop = null;
        setActiveTool("select");
        render();
        syncUI();
    }

    // ---------------------------------------------------------------------
    // Event wiring
    // ---------------------------------------------------------------------

    function bindEvents() {
        // Tools
        toolsEl.addEventListener("click", function (event) {
            const btn = event.target.closest(".tool");
            if (!btn) return;
            const tool = btn.dataset.tool;
            if (tool === "image") {
                layerInput.click();
                return;
            }
            setActiveTool(tool);
        });

        // Canvas pointer events
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("dblclick", onDoubleClick);

        // Brush controls
        brushMode.addEventListener("change", function () {
            state.brush.mode = brushMode.value;
        });
        brushColor.addEventListener("input", function () {
            state.brush.color = brushColor.value;
            state.currentColor = brushColor.value;
        });
        brushSize.addEventListener("input", function () {
            state.brush.size = parseInt(brushSize.value, 10) || 1;
            brushSizeValue.textContent = state.brush.size;
        });
        btnCoverBg.addEventListener("click", function () {
            state.brush.color = state.background;
            state.currentColor = state.background;
            brushColor.value = state.background;
            toast("Brush color set to background");
        });

        // Padding presets
        presetClassic.addEventListener("click", function () {
            setPadding({ top: 20, right: 0, bottom: 0, left: 0 });
        });
        presetModern.addEventListener("click", function () {
            setPadding({ top: 20, right: 5, bottom: 5, left: 5 });
        });

        // Manual padding inputs
        [padTop, padRight, padBottom, padLeft].forEach(function (input) {
            input.addEventListener("input", function () {
                readPaddingInputs();
                requestRender();
            });
            input.addEventListener("change", function () {
                readPaddingInputs();
                commit();
                render();
            });
        });

        // Background
        bgWhite.addEventListener("click", function () {
            setBackground("#ffffff");
        });
        bgBlack.addEventListener("click", function () {
            setBackground("#000000");
        });
        bgColor.addEventListener("input", function () {
            state.background = bgColor.value;
            requestRender();
        });
        bgColor.addEventListener("change", function () {
            state.background = bgColor.value;
            commit();
            render();
        });

        // Text properties
        textContent.addEventListener("input", function () {
            const obj = selectedTextObject();
            if (!obj) return;
            obj.text = textContent.value;
            requestRender();
        });
        textContent.addEventListener("change", function () {
            if (selectedTextObject()) commit();
        });
        textFont.addEventListener("change", function () {
            const obj = selectedTextObject();
            if (!obj) return;
            obj.fontFamily = textFont.value;
            commit();
            render();
            ensureFontLoaded(obj.fontFamily).then(function () {
                render();
            });
        });
        textSize.addEventListener("input", function () {
            const obj = selectedTextObject();
            if (!obj) return;
            obj.fontSize = parseInt(textSize.value, 10) || 8;
            textSizeValue.textContent = Math.round(
                getEffectiveFontSize(obj) * (obj.scaleY == null ? 1 : obj.scaleY)
            );
            requestRender();
        });
        textSize.addEventListener("change", function () {
            if (selectedTextObject()) commit();
        });
        textAutoFit.addEventListener("change", function () {
            const obj = selectedTextObject();
            if (!obj) return;
            obj.autoFit = textAutoFit.checked;
            commit();
            render();
            syncUI();
        });
        textMaxSize.addEventListener("change", function () {
            const obj = selectedTextObject();
            if (!obj) return;
            obj.maxFontSize = parseInt(textMaxSize.value, 10) || obj.fontSize;
            commit();
            render();
        });
        textAlignEl.addEventListener("click", function (event) {
            const btn = event.target.closest("button");
            if (!btn) return;
            const obj = selectedTextObject();
            if (!obj) return;
            obj.align = btn.dataset.align;
            commit();
            render();
            syncUI();
        });
        textColor.addEventListener("input", function () {
            const obj = selectedTextObject();
            if (!obj) return;
            obj.color = textColor.value;
            requestRender();
        });
        textColor.addEventListener("change", function () {
            if (selectedTextObject()) commit();
        });
        textOutlineEnabled.addEventListener("change", function () {
            const obj = selectedTextObject();
            if (!obj) return;
            obj.outlineEnabled = textOutlineEnabled.checked;
            commit();
            render();
        });
        textOutlineColor.addEventListener("input", function () {
            const obj = selectedTextObject();
            if (!obj) return;
            obj.outlineColor = textOutlineColor.value;
            requestRender();
        });
        textOutlineColor.addEventListener("change", function () {
            if (selectedTextObject()) commit();
        });
        textOutlineWidth.addEventListener("input", function () {
            const obj = selectedTextObject();
            if (!obj) return;
            obj.outlineWidth = parseInt(textOutlineWidth.value, 10) || 0;
            textOutlineValue.textContent = obj.outlineWidth;
            requestRender();
        });
        textOutlineWidth.addEventListener("change", function () {
            if (selectedTextObject()) commit();
        });

        // Presets
        presetApply.addEventListener("click", applySelectedPreset);
        presetSave.addEventListener("click", saveCurrentAsPreset);
        presetRename.addEventListener("click", renameSelectedPreset);
        presetDelete.addEventListener("click", deleteSelectedPreset);

        // Image layer properties
        imageOpacity.addEventListener("input", function () {
            const obj = getSelectedObject();
            if (!obj || obj.type !== "image") return;
            obj.opacity = parseInt(imageOpacity.value, 10) / 100;
            imageOpacityValue.textContent = imageOpacity.value;
            requestRender();
        });
        imageOpacity.addEventListener("change", function () {
            const obj = getSelectedObject();
            if (obj && obj.type === "image") commit();
        });
        imageWidth.addEventListener("change", function () {
            const obj = getSelectedObject();
            if (!obj || obj.type !== "image") return;
            obj.width = Math.max(1, parseInt(imageWidth.value, 10) || 1);
            commit();
            render();
        });
        imageHeight.addEventListener("change", function () {
            const obj = getSelectedObject();
            if (!obj || obj.type !== "image") return;
            obj.height = Math.max(1, parseInt(imageHeight.value, 10) || 1);
            commit();
            render();
        });

        // Shape properties
        shapeFill.addEventListener("input", function () {
            const obj = getSelectedObject();
            if (!obj || (obj.type !== "rect" && obj.type !== "ellipse")) return;
            obj.fill = shapeFill.value;
            state.currentShapeFill = shapeFill.value;
            requestRender();
        });
        shapeFill.addEventListener("change", function () {
            const obj = getSelectedObject();
            if (obj && (obj.type === "rect" || obj.type === "ellipse")) commit();
        });
        shapeRadius.addEventListener("input", function () {
            const obj = getSelectedObject();
            if (!obj || obj.type !== "rect") return;
            obj.radius = parseInt(shapeRadius.value, 10) || 0;
            shapeRadiusValue.textContent = obj.radius;
            requestRender();
        });
        shapeRadius.addEventListener("change", function () {
            const obj = getSelectedObject();
            if (obj && obj.type === "rect") commit();
        });

        // Zoom
        zoomIn.addEventListener("click", function () {
            setZoom(zoom * 1.25);
        });
        zoomOut.addEventListener("click", function () {
            setZoom(zoom / 1.25);
        });
        zoomFit.addEventListener("click", function () {
            setZoom(1);
        });
        stage.addEventListener(
            "wheel",
            function (e) {
                if (!e.ctrlKey && !e.metaKey) return;
                e.preventDefault();
                setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
            },
            { passive: false }
        );
        window.addEventListener("resize", function () {
            render();
        });

        // Ordering + delete
        orderForward.addEventListener("click", bringForward);
        orderBackward.addEventListener("click", sendBackward);
        btnDelete.addEventListener("click", deleteSelectedObject);

        // Crop
        cropApply.addEventListener("click", applyCrop);
        cropCancel.addEventListener("click", cancelCrop);

        // File inputs
        btnOpen.addEventListener("click", () => fileInput.click());
        emptyOpen.addEventListener("click", () => fileInput.click());
        btnReplace.addEventListener("click", () => replaceInput.click());
        btnSave.addEventListener("click", exportImage);
        btnUndo.addEventListener("click", undo);
        btnRedo.addEventListener("click", redo);

        fileInput.addEventListener("change", function (e) {
            loadImageFile(e.target.files[0], "auto");
            e.target.value = "";
        });
        layerInput.addEventListener("change", function (e) {
            loadImageFile(e.target.files[0], "layer");
            e.target.value = "";
        });
        replaceInput.addEventListener("change", function (e) {
            loadImageFile(e.target.files[0], "replace");
            e.target.value = "";
        });

        // Drag + drop
        ["dragenter", "dragover"].forEach(function (ev) {
            window.addEventListener(ev, function (e) {
                e.preventDefault();
                dropOverlay.classList.add("visible");
            });
        });
        window.addEventListener("dragleave", function (e) {
            if (!e.relatedTarget) dropOverlay.classList.remove("visible");
        });
        window.addEventListener("drop", function (e) {
            e.preventDefault();
            dropOverlay.classList.remove("visible");
            if (hasBackend()) return;
            const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
            const file = files.find(isImageFile);
            if (file) loadImageFile(file, "auto");
            else toast("No image found in drop", "error");
        });

        if (window.runtime && typeof window.runtime.OnFileDrop === "function") {
            window.runtime.OnFileDrop(function (x, y, paths) {
                dropOverlay.classList.remove("visible");
                const images = (paths || []).filter(isImagePath);
                if (!images.length) {
                    toast("No image found in drop", "error");
                    return;
                }
                loadImagePath(images[0], "auto");
            }, false);
        }

        // Clipboard paste
        window.addEventListener("paste", function (e) {
            if (isEditingTarget(e.target)) return;
            const items = (e.clipboardData && e.clipboardData.items) || [];
            for (const item of items) {
                if (item.type && item.type.indexOf("image/") === 0) {
                    const file = item.getAsFile();
                    if (file) {
                        e.preventDefault();
                        loadImageFile(file, "auto");
                        return;
                    }
                }
            }
        });

        // Keyboard shortcuts
        window.addEventListener("keydown", function (e) {
            if (isEditingTarget(e.target)) return;
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();

            if (mod && key === "z") {
                e.preventDefault();
                if (e.shiftKey) redo();
                else undo();
                return;
            }
            if (mod && key === "s") {
                e.preventDefault();
                exportImage();
                return;
            }
            if (mod) return;

            if (key === "escape") {
                if (state.activeTool === "crop") cancelCrop();
                return;
            }

            switch (key) {
                case "v":
                    setActiveTool("select");
                    break;
                case "t":
                    setActiveTool("text");
                    break;
                case "b":
                    setActiveTool("brush");
                    break;
                case "r":
                    setActiveTool("rect");
                    break;
                case "e":
                    setActiveTool("ellipse");
                    break;
                case "c":
                    setActiveTool("crop");
                    break;
                case "i":
                    setActiveTool("eyedropper");
                    break;
                case "delete":
                case "backspace":
                    e.preventDefault();
                    deleteSelectedObject();
                    break;
                default:
                    break;
            }
        });
    }

    function setPadding(values) {
        state.padding = {
            top: values.top,
            right: values.right,
            bottom: values.bottom,
            left: values.left
        };
        padTop.value = values.top;
        padRight.value = values.right;
        padBottom.value = values.bottom;
        padLeft.value = values.left;
        commit();
        render();
    }

    function readPaddingInputs() {
        state.padding.top = clamp(parseFloat(padTop.value) || 0, 0, 200);
        state.padding.right = clamp(parseFloat(padRight.value) || 0, 0, 200);
        state.padding.bottom = clamp(parseFloat(padBottom.value) || 0, 0, 200);
        state.padding.left = clamp(parseFloat(padLeft.value) || 0, 0, 200);
    }

    function setBackground(color) {
        state.background = color;
        bgColor.value = color;
        commit();
        render();
    }

    // ---------------------------------------------------------------------
    // Boot
    // ---------------------------------------------------------------------

    function init() {
        loadPresets();
        renderPresetOptions();
        bindEvents();
        setActiveTool("select");
        readPaddingInputs();
        commit();
        updateHistoryButtons();
        render();
        syncUI();

        initFonts();
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                render();
            });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
