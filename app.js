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
    // Neutral slate that suits the dark UI (was pure white).
    const DEFAULT_BACKGROUND = "#232733";
    const MAX_HISTORY = 120;
    // Legacy keys, kept so existing browser-only users keep their presets.
    const PRESET_STORAGE_KEY = "memeEditor.textPresets";
    const DEFAULT_PRESET_STORAGE_KEY = "memeEditor.defaultTextPreset";
    // Single preferences blob used when no native backend is available
    // (e.g. opening the page in a regular browser).
    const PREF_STORAGE_KEY = "memeEditor.preferences";
    const PREFERENCES_VERSION = 1;
    // Default writing direction for new text. The main use case is Farsi with
    // embedded English words, so RTL (which still renders Latin runs correctly)
    // is the default until the user changes it.
    const DEFAULT_TEXT_DIRECTION = "rtl";
    const DEFAULT_RECT_RADIUS = 12;
    const DEFAULT_BLUR_RADIUS = 16;

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
        background: DEFAULT_BACKGROUND,
        objects: [],
        selectedObjectId: null,
        activeTool: "select",
        brush: { mode: "draw", color: "#000000", size: 10, blurRadius: DEFAULT_BLUR_RADIUS },
        currentColor: "#000000",
        currentShapeFill: DEFAULT_BACKGROUND,
        currentShapeMode: "fill",
        currentShapeBlur: DEFAULT_BLUR_RADIUS,
        logoImage: null,
        logoDataURL: null,
        textPresets: [],
        defaultPresetId: null,
        startCanvas: {
            width: DEFAULT_CANVAS.width,
            height: DEFAULT_CANVAS.height,
            background: DEFAULT_BACKGROUND
        },
        started: false
    };

    // Preferences are restored asynchronously from the config file. Until that
    // completes we must not write anything back, otherwise defaults would
    // overwrite the user's saved settings.
    let preferencesLoaded = false;
    let persistTimer = null;

    let history = [];
    let historyIndex = -1;
    let interaction = null;
    let rafPending = false;
    let pendingLogoPlace = false;
    // Eyedropper sampling launched from a colour picker: while active the next
    // canvas click feeds the picked colour to `eyedropperApply`.
    let eyedropperActive = false;
    let eyedropperApply = null;
    // Most recently opened colour picker, so the "I" shortcut knows where to
    // send a sampled colour.
    let lastColorInput = null;
    // Active crop of an image layer: { objectId, rect } (rect in the object's
    // local, unrotated coordinates) or null.
    let imageCrop = null;

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
    const brushBlurField = $("brush-blur-field");
    const brushBlur = $("brush-blur");
    const brushBlurValue = $("brush-blur-value");
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

    const startOverlay = $("start-overlay");
    const startOpen = $("start-open");
    const startEmpty = $("start-empty");
    const startWidth = $("start-width");
    const startHeight = $("start-height");
    const startBg = $("start-bg");

    const propEmpty = $("prop-empty");
    const propText = $("prop-text");
    const propImage = $("prop-image");
    const propShape = $("prop-shape");
    const propBrush = $("prop-brush");
    const propCrop = $("prop-crop");
    const propOrder = $("prop-order");
    const propTransform = $("prop-transform");
    const propertiesEl = $("properties");

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
    const textDirectionEl = $("text-direction");
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
    const presetSetDefault = $("preset-set-default");

    const rotationRange = $("rotation-range");
    const rotationInput = $("rotation-input");
    const rotationValue = $("rotation-value");
    const rotationReset = $("rotation-reset");

    const imageOpacity = $("image-opacity");
    const imageOpacityValue = $("image-opacity-value");
    const imageWidth = $("image-width");
    const imageHeight = $("image-height");
    const imageCropStart = $("image-crop-start");
    const imageCropStartField = $("image-crop-start-field");
    const imageCropControls = $("image-crop-controls");
    const imageCropApply = $("image-crop-apply");
    const imageCropCancel = $("image-crop-cancel");
    const imageCropSize = $("image-crop-size");

    const shapeFill = $("shape-fill");
    const shapeFillField = $("shape-fill-field");
    const shapeModeEl = $("shape-mode");
    const shapeBlurField = $("shape-blur-field");
    const shapeBlur = $("shape-blur");
    const shapeBlurValue = $("shape-blur-value");
    const shapeRadiusField = $("shape-radius-field");
    const shapeRadius = $("shape-radius");
    const shapeRadiusValue = $("shape-radius-value");

    const zoomIn = $("zoom-in");
    const zoomOut = $("zoom-out");
    const zoomFit = $("zoom-fit");
    const zoomLabel = $("zoom-label");

    const logoPlace = $("logo-place");
    const logoChange = $("logo-change");
    const logoInput = $("logo-input");

    const orderForward = $("order-forward");
    const orderBackward = $("order-backward");
    const btnDelete = $("btn-delete");

    const btnOpen = $("btn-open");
    const btnReplace = $("btn-replace");
    const btnSave = $("btn-save");
    const btnUndo = $("btn-undo");
    const btnRedo = $("btn-redo");
    const btnRestart = $("btn-restart");
    const emptyOpen = $("empty-open");

    const confirmOverlay = $("confirm-overlay");
    const confirmTitle = $("confirm-title");
    const confirmMessage = $("confirm-message");
    const confirmYes = $("confirm-yes");
    const confirmCancel = $("confirm-cancel");

    // ---------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------

    function uid() {
        return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    }

    function clamp(v, min, max) {
        return Math.min(max, Math.max(min, v));
    }

    // Keep sizes/timings readable: at most two decimal places.
    function round2(v) {
        return Math.round(v * 100) / 100;
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

    function isRotatable(obj) {
        return !!obj && obj.type !== "brush";
    }

    function normalizeAngle(deg) {
        let a = deg % 360;
        if (a > 180) a -= 360;
        if (a <= -180) a += 360;
        return a;
    }

    function rotatePoint(p, center, angleDeg) {
        const a = (angleDeg * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        return {
            x: center.x + dx * cos - dy * sin,
            y: center.y + dx * sin + dy * cos
        };
    }

    function getObjectCenter(obj) {
        const b = getObjectBounds(obj);
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }

    // Map a document-space point into an object's unrotated local frame so the
    // existing axis-aligned hit-testing / handle logic keeps working.
    function toLocalPoint(obj, point) {
        const rot = obj.rotation || 0;
        if (!rot) return point;
        return rotatePoint(point, getObjectCenter(obj), -rot);
    }

    // ---------------------------------------------------------------------
    // Document geometry
    // ---------------------------------------------------------------------

    function computeDocumentSize() {
        const img = state.baseImage;
        if (!img.width || !img.height) {
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
        const obj = {
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
            direction: DEFAULT_TEXT_DIRECTION,
            rotation: 0,
            scaleX: 1,
            scaleY: 1
        };
        const preset = getDefaultPreset();
        if (preset) applyTextPreset(obj, preset);
        return obj;
    }

    function getDefaultPreset() {
        if (!state.defaultPresetId) return null;
        return state.textPresets.find((p) => p.id === state.defaultPresetId) || null;
    }

    function applyTextPreset(obj, preset) {
        obj.fontFamily = preset.fontFamily;
        obj.maxFontSize = preset.maxFontSize;
        obj.fontSize = preset.maxFontSize;
        obj.autoFit = true;
        obj.align = preset.align;
        obj.color = preset.color;
        obj.outlineColor = preset.outlineColor;
        obj.outlineWidth = preset.outlineWidth;
        obj.outlineEnabled = preset.outlineEnabled;
        obj.direction = preset.direction || DEFAULT_TEXT_DIRECTION;
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
            const p = toLocalPoint(o, point);
            if (
                p.x >= b.x &&
                p.x <= b.x + b.width &&
                p.y >= b.y &&
                p.y <= b.y + b.height
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
        const local = toLocalPoint(obj, point);
        const handles = getHandleRects(obj);
        for (const h of handles) {
            if (
                local.x >= h.x &&
                local.x <= h.x + h.width &&
                local.y >= h.y &&
                local.y <= h.y + h.height
            ) {
                return h.name;
            }
        }
        return null;
    }

    function getRotateHandleRect(obj) {
        const b = getObjectBounds(obj);
        const u = 1 / (displayScale > 0 ? displayScale : 1);
        const s = handleSizeDoc() * 1.15;
        const gap = 26 * u;
        const cx = b.x + b.width / 2;
        const cy = b.y - gap;
        return { x: cx - s / 2, y: cy - s / 2, width: s, height: s };
    }

    function hitRotateHandle(obj, point) {
        if (!isRotatable(obj)) return false;
        const local = toLocalPoint(obj, point);
        const r = getRotateHandleRect(obj);
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const radius = r.width / 2 + 3 / (displayScale > 0 ? displayScale : 1);
        const dx = local.x - cx;
        const dy = local.y - cy;
        return dx * dx + dy * dy <= radius * radius;
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

    // Build the silhouette of an object as the current path so it can be used
    // as a clip region for the special "blur" paint mode.
    function objectPath(ctx, obj) {
        if (obj.type === "rect") {
            const r = Math.max(
                0,
                Math.min(
                    obj.radius == null ? DEFAULT_RECT_RADIUS : obj.radius,
                    Math.abs(obj.width) / 2,
                    Math.abs(obj.height) / 2
                )
            );
            if (r > 0 && ctx.roundRect) ctx.roundRect(obj.x, obj.y, obj.width, obj.height, r);
            else ctx.rect(obj.x, obj.y, obj.width, obj.height);
        } else if (obj.type === "ellipse") {
            ctx.ellipse(
                obj.x + obj.width / 2,
                obj.y + obj.height / 2,
                Math.abs(obj.width / 2),
                Math.abs(obj.height / 2),
                0,
                0,
                Math.PI * 2
            );
        } else if (obj.type === "brush") {
            const rr = Math.max(1, (obj.size || 1) / 2);
            const pts = obj.points;
            const dot = (x, y) => {
                ctx.moveTo(x + rr, y);
                ctx.arc(x, y, rr, 0, Math.PI * 2);
            };
            if (pts.length === 1) {
                dot(pts[0].x, pts[0].y);
            }
            for (let i = 1; i < pts.length; i++) {
                const a = pts[i - 1];
                const b = pts[i];
                const dist = Math.hypot(b.x - a.x, b.y - a.y);
                const steps = Math.max(1, Math.ceil(dist / rr));
                for (let s = 0; s <= steps; s++) {
                    const t = s / steps;
                    dot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
                }
            }
        }
    }

    const scratch = { b: null };
    function getScratch(key, w, h) {
        let c = scratch[key];
        if (!c) {
            c = document.createElement("canvas");
            scratch[key] = c;
        }
        if (c.width !== w) c.width = w;
        if (c.height !== h) c.height = h;
        return c;
    }

    // Cache of Go-computed blur bitmaps, keyed by object id. Each entry is
    // { key, bitmap, pendingKey, failedKey }. `contentRev` is bumped whenever
    // the document content changes so stale blurs are recomputed.
    const blurCache = new Map();
    let contentRev = 0;
    let exporting = false;

    function deviceScaleOf(ctx) {
        const t = ctx.getTransform();
        return Math.hypot(t.a, t.b) || 1;
    }

    // One separable box-blur pass over an ImageData buffer. `horizontal`
    // selects the axis. Edge pixels are replicated so the blur fades cleanly.
    function boxBlurPass(data, w, h, r, horizontal) {
        const outer = horizontal ? h : w;
        const inner = horizontal ? w : h;
        const innerStride = horizontal ? 4 : w * 4;
        const outerStride = horizontal ? w * 4 : 4;
        const win = 2 * r + 1;
        const tmp = new Float32Array(inner * 4);
        for (let o = 0; o < outer; o++) {
            const base = o * outerStride;
            let sr = 0;
            let sg = 0;
            let sb = 0;
            let sa = 0;
            for (let i = -r; i <= r; i++) {
                const ii = i < 0 ? 0 : i >= inner ? inner - 1 : i;
                const idx = base + ii * innerStride;
                sr += data[idx];
                sg += data[idx + 1];
                sb += data[idx + 2];
                sa += data[idx + 3];
            }
            for (let x = 0; x < inner; x++) {
                const oi = x * 4;
                tmp[oi] = sr / win;
                tmp[oi + 1] = sg / win;
                tmp[oi + 2] = sb / win;
                tmp[oi + 3] = sa / win;
                const addI = x + r + 1;
                const subI = x - r;
                const ai = base + (addI >= inner ? inner - 1 : addI) * innerStride;
                const si = base + (subI < 0 ? 0 : subI) * innerStride;
                sr += data[ai] - data[si];
                sg += data[ai + 1] - data[si + 1];
                sb += data[ai + 2] - data[si + 2];
                sa += data[ai + 3] - data[si + 3];
            }
            for (let x = 0; x < inner; x++) {
                const idx = base + x * innerStride;
                const oi = x * 4;
                data[idx] = tmp[oi];
                data[idx + 1] = tmp[oi + 1];
                data[idx + 2] = tmp[oi + 2];
                data[idx + 3] = tmp[oi + 3];
            }
        }
    }

    // Compute the device-space region a blur object must sample, plus the
    // device-space blur radius. Must be called while the object's rotation
    // transform is active (as renderObject does).
    function blurRegionInfo(ctx, obj) {
        const radius = Math.max(1, obj.blurRadius || DEFAULT_BLUR_RADIUS);
        const scale = deviceScaleOf(ctx);
        const canvas = ctx.canvas;
        const t = ctx.getTransform();
        const b = getObjectBounds(obj);

        const corners = [
            { x: b.x, y: b.y },
            { x: b.x + b.width, y: b.y },
            { x: b.x + b.width, y: b.y + b.height },
            { x: b.x, y: b.y + b.height }
        ].map((p) => ({
            x: t.a * p.x + t.c * p.y + t.e,
            y: t.b * p.x + t.d * p.y + t.f
        }));

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of corners) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }

        const rDev = Math.max(1, Math.round(radius * scale));
        const pad = rDev * 2 + 4;
        const x0 = clamp(Math.floor(minX - pad), 0, canvas.width);
        const y0 = clamp(Math.floor(minY - pad), 0, canvas.height);
        const x1 = clamp(Math.ceil(maxX + pad), 0, canvas.width);
        const y1 = clamp(Math.ceil(maxY + pad), 0, canvas.height);
        const rw = x1 - x0;
        const rh = y1 - y0;
        if (rw < 1 || rh < 1) return null;
        return { x0: x0, y0: y0, rw: rw, rh: rh, rDev: rDev };
    }

    // Draw a (possibly blurred) bitmap back inside the object's silhouette.
    function drawBlurBitmap(ctx, obj, bitmap, info) {
        ctx.save();
        ctx.beginPath();
        objectPath(ctx, obj);
        ctx.clip();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(bitmap, info.x0, info.y0);
        ctx.restore();
    }

    // Synchronous fallback used without the Go backend (browser preview and
    // PNG export), matching the original JS implementation.
    function jsBlurFill(ctx, obj, info) {
        const img = (function () {
            try {
                return ctx.getImageData(info.x0, info.y0, info.rw, info.rh);
            } catch (err) {
                return null;
            }
        })();
        if (!img) return;
        const passR = Math.max(1, Math.round(info.rDev / 3));
        for (let i = 0; i < 3; i++) {
            boxBlurPass(img.data, info.rw, info.rh, passR, true);
            boxBlurPass(img.data, info.rw, info.rh, passR, false);
        }
        const blur = getScratch("b", info.rw, info.rh);
        blur.getContext("2d").putImageData(img, 0, 0);
        drawBlurBitmap(ctx, obj, blur, info);
    }

    // Blur the background (everything beneath this object) inside its shape.
    // The heavy pixel work runs in the Go backend so the UI thread stays
    // responsive; results are cached per object and recomputed only when the
    // content, geometry or blur radius changes.
    function renderBlurFill(ctx, obj) {
        const info = blurRegionInfo(ctx, obj);
        if (!info) return;

        if (!hasBackend() || exporting) {
            jsBlurFill(ctx, obj, info);
            return;
        }

        const key =
            contentRev + "|" + info.x0 + "," + info.y0 + "," + info.rw + "," + info.rh + "|" + info.rDev;
        const entry = blurCache.get(obj.id);
        if (entry && entry.key === key && entry.bitmap) {
            drawBlurBitmap(ctx, obj, entry.bitmap, info);
            return;
        }
        if (entry && entry.failedKey === key) {
            // Go failed for this revision: fall back so the blur still shows.
            jsBlurFill(ctx, obj, info);
            return;
        }
        // Same region but content changed: show the previous blur until the
        // refreshed one arrives, so the preview doesn't flicker during edits.
        if (entry && entry.bitmap && sameRegion(entry.region, info)) {
            drawBlurBitmap(ctx, obj, entry.bitmap, info);
        }
        // (Re)compute. During an active drag/draw we throttle so we don't flood
        // the backend, but still give progressive feedback.
        const throttle = interaction ? 100 : 0;
        const lastRequest = entry ? entry.lastRequest || 0 : 0;
        if ((!entry || entry.pendingKey !== key) && Date.now() - lastRequest >= throttle) {
            requestBlurBitmap(ctx, obj, key, info);
        }
    }

    function sameRegion(a, b) {
        return (
            a &&
            b &&
            a.x0 === b.x0 &&
            a.y0 === b.y0 &&
            a.rw === b.rw &&
            a.rh === b.rh &&
            a.rDev === b.rDev
        );
    }

    function requestBlurBitmap(ctx, obj, key, info) {
        const entry = blurCache.get(obj.id) || {};
        entry.pendingKey = key;
        entry.region = info;
        entry.lastRequest = Date.now();
        blurCache.set(obj.id, entry);

        // Everything beneath this object is already drawn in the canvas now.
        const off = document.createElement("canvas");
        off.width = info.rw;
        off.height = info.rh;
        off.getContext("2d").drawImage(
            ctx.canvas,
            info.x0,
            info.y0,
            info.rw,
            info.rh,
            0,
            0,
            info.rw,
            info.rh
        );
        const dataURL = off.toDataURL("image/jpeg", 0.9);

        window.go.main.App.BlurPNG(dataURL, info.rDev)
            .then(function (result) {
                const img = new Image();
                img.onload = function () {
                    // Ignore results that a newer request has superseded.
                    const current = blurCache.get(obj.id);
                    if (!current || current.pendingKey !== key) return;
                    const bitmap = document.createElement("canvas");
                    bitmap.width = info.rw;
                    bitmap.height = info.rh;
                    bitmap.getContext("2d").drawImage(img, 0, 0);
                    blurCache.set(obj.id, {
                        key: key,
                        bitmap: bitmap,
                        pendingKey: key,
                        region: info,
                        lastRequest: current.lastRequest
                    });
                    requestRender();
                };
                img.onerror = function () {
                    const current = blurCache.get(obj.id);
                    if (!current || current.pendingKey !== key) return;
                    blurCache.set(obj.id, { pendingKey: key, failedKey: key, region: info });
                };
                img.src = result;
            })
            .catch(function () {
                const e = blurCache.get(obj.id) || {};
                e.pendingKey = key;
                e.failedKey = key;
                blurCache.set(obj.id, e);
            });
    }

    function renderText(ctx, obj) {
        const m = getTextMetrics(obj);
        const sx = obj.scaleX == null ? 1 : obj.scaleX;
        const sy = obj.scaleY == null ? 1 : obj.scaleY;
        ctx.save();
        ctx.translate(obj.x, obj.y);
        ctx.scale(sx, sy);
        ctx.font = m.fontSize + "px " + fontStack(obj.fontFamily);
        ctx.direction = obj.direction === "ltr" ? "ltr" : "rtl";
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
        const rot = obj.rotation || 0;
        if (rot) {
            const c = getObjectCenter(obj);
            ctx.save();
            ctx.translate(c.x, c.y);
            ctx.rotate((rot * Math.PI) / 180);
            ctx.translate(-c.x, -c.y);
        }
        switch (obj.type) {
            case "text":
                renderText(ctx, obj);
                break;
            case "rect": {
                if (obj.mode === "blur") {
                    renderBlurFill(ctx, obj);
                    break;
                }
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
                if (obj.mode === "blur") {
                    renderBlurFill(ctx, obj);
                    break;
                }
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
                if (obj.mode === "blur") {
                    renderBlurFill(ctx, obj);
                } else {
                    renderBrush(ctx, obj);
                }
                break;
            default:
                break;
        }
        if (rot) ctx.restore();
    }

    function renderDocument(ctx) {
        if (blurCache.size) {
            for (const id of blurCache.keys()) {
                if (!state.objects.some((o) => o.id === id)) blurCache.delete(id);
            }
        }
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
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        ctx.save();
        if (obj.rotation) {
            ctx.translate(cx, cy);
            ctx.rotate((obj.rotation * Math.PI) / 180);
            ctx.translate(-cx, -cy);
        }
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

        if (isRotatable(obj)) {
            const rh = getRotateHandleRect(obj);
            const rcx = rh.x + rh.width / 2;
            const rcy = rh.y + rh.height / 2;
            ctx.strokeStyle = "#4f74ff";
            ctx.lineWidth = 1.5 * u;
            ctx.beginPath();
            ctx.moveTo(cx, b.y);
            ctx.lineTo(rcx, rcy);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(rcx, rcy, rh.width / 2, 0, Math.PI * 2);
            ctx.fillStyle = "#4f74ff";
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1 * u;
            ctx.stroke();
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

    // Editor-only overlay for cropping an image layer. Drawn in the object's
    // local (unrotated) frame so it lines up with rotated images.
    function drawImageCropOverlay(ctx) {
        if (!imageCrop) return;
        const target = state.objects.find((o) => o.id === imageCrop.objectId);
        if (!target) return;
        const b = getObjectBounds(target);
        const u = 1 / (displayScale > 0 ? displayScale : 1);
        ctx.save();
        if (target.rotation) {
            const c = getObjectCenter(target);
            ctx.translate(c.x, c.y);
            ctx.rotate((target.rotation * Math.PI) / 180);
            ctx.translate(-c.x, -c.y);
        }
        const r = imageCrop.rect;
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.beginPath();
        ctx.rect(b.x, b.y, b.width, b.height);
        if (r && r.width > 0 && r.height > 0) {
            ctx.rect(r.x, r.y, r.width, r.height);
            ctx.fill("evenodd");
        } else {
            ctx.fill();
        }

        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 1 * u;
        ctx.setLineDash([5 * u, 4 * u]);
        ctx.strokeRect(b.x, b.y, b.width, b.height);
        ctx.setLineDash([]);

        if (r && r.width >= 1 && r.height >= 1) {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
            ctx.lineWidth = 1 * u;
            ctx.beginPath();
            for (let i = 1; i < 3; i++) {
                const gx = r.x + (r.width * i) / 3;
                ctx.moveTo(gx, r.y);
                ctx.lineTo(gx, r.y + r.height);
                const gy = r.y + (r.height * i) / 3;
                ctx.moveTo(r.x, gy);
                ctx.lineTo(r.x + r.width, gy);
            }
            ctx.stroke();

            ctx.strokeStyle = "#4f74ff";
            ctx.lineWidth = 1.5 * u;
            ctx.strokeRect(r.x, r.y, r.width, r.height);
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
        drawImageCropOverlay(ctx);
        if (!imageCrop) drawSelection(ctx);

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
        emptyState.classList.toggle("hidden", state.started);
        btnReplace.disabled = !state.started;
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
        contentRev++;
        render();
        syncUI();
    }

    function updateHistoryButtons() {
        if (!btnUndo || !btnRedo) return;
        btnUndo.disabled = historyIndex <= 0;
        btnRedo.disabled = historyIndex >= history.length - 1;
    }

    function commit() {
        contentRev++;
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
        markStarted();
        commit();
        render();
        syncUI();
        toast("Base image loaded");
    }

    // ---------------------------------------------------------------------
    // Project start / lock
    // ---------------------------------------------------------------------

    function setAppLocked(locked) {
        document.body.classList.toggle("locked", locked);
        if (toolsEl) {
            toolsEl.querySelectorAll(".tool").forEach(function (btn) {
                btn.disabled = locked;
            });
        }
        startOverlay.classList.toggle("hidden", !locked);
    }

    function markStarted() {
        if (state.started) return;
        state.started = true;
        setAppLocked(false);
    }

    function startEmptyCanvas() {
        const w = clamp(parseInt(startWidth.value, 10) || DEFAULT_CANVAS.width, 1, 10000);
        const h = clamp(parseInt(startHeight.value, 10) || DEFAULT_CANVAS.height, 1, 10000);
        state.baseImage = { source: null, width: w, height: h };
        state.background = hexToRgb(startBg.value) ? startBg.value : DEFAULT_BACKGROUND;
        state.startCanvas = { width: w, height: h, background: state.background };
        state.currentShapeFill = state.background;
        bgColor.value = state.background;
        state.selectedObjectId = null;
        schedulePersistPreferences();
        markStarted();
        commit();
        render();
        syncUI();
        toast("Empty canvas created · " + w + " × " + h);
    }

    // ---------------------------------------------------------------------
    // Confirmation dialog + restart
    // ---------------------------------------------------------------------

    let confirmAction = null;

    function showConfirm(title, message, confirmLabel, onConfirm) {
        confirmTitle.textContent = title;
        confirmMessage.textContent = message;
        confirmYes.textContent = confirmLabel;
        confirmAction = onConfirm;
        confirmOverlay.classList.remove("hidden");
    }

    function closeConfirm() {
        confirmOverlay.classList.add("hidden");
        confirmAction = null;
    }

    // Throw everything away and return to the start screen.
    function resetProject() {
        state.baseImage = { source: null, width: 0, height: 0 };
        state.padding = { top: 0, right: 0, bottom: 0, left: 0 };
        state.background = DEFAULT_BACKGROUND;
        state.objects = [];
        state.selectedObjectId = null;
        state.activeTool = "select";
        state.brush = { mode: "draw", color: "#000000", size: 10, blurRadius: DEFAULT_BLUR_RADIUS };
        state.currentColor = "#000000";
        state.currentShapeFill = DEFAULT_BACKGROUND;
        state.currentShapeMode = "fill";
        state.currentShapeBlur = DEFAULT_BLUR_RADIUS;
        state.started = false;

        history = [];
        historyIndex = -1;
        crop = null;
        imageCrop = null;
        interaction = null;
        zoom = 1;
        blurCache.clear();

        padTop.value = 0;
        padRight.value = 0;
        padBottom.value = 0;
        padLeft.value = 0;
        brushMode.value = "draw";
        brushColor.value = "#000000";
        brushSize.value = 10;
        brushSizeValue.textContent = "10";
        brushBlur.value = DEFAULT_BLUR_RADIUS;
        brushBlurValue.textContent = DEFAULT_BLUR_RADIUS;
        brushBlurField.classList.add("hidden");
        bgColor.value = DEFAULT_BACKGROUND;
        shapeFill.value = DEFAULT_BACKGROUND;
        // The start-canvas size/background are saved preferences, so leave them
        // as the user set them instead of resetting to defaults.
        startWidth.value = state.startCanvas.width;
        startHeight.value = state.startCanvas.height;
        startBg.value = state.startCanvas.background;

        setActiveTool("select");
        commit();
        render();
        syncUI();
        setAppLocked(true);
        toast("Project reset");
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
    // Logo (quick-access image)
    // ---------------------------------------------------------------------

    function setLogoFromFile(file, placeAfter) {
        if (!file) return;
        if (!isImageFile(file)) {
            toast("Unsupported file type", "error");
            return;
        }
        // Read as a data URL (rather than an object URL) so the logo can be
        // written to the preferences file and restored on the next launch.
        const reader = new FileReader();
        reader.onload = function () {
            const dataURL = reader.result;
            const img = new Image();
            img.onload = function () {
                state.logoImage = img;
                state.logoDataURL = dataURL;
                schedulePersistPreferences();
                toast("Logo saved for quick access");
                if (placeAfter) addLogoLayer();
            };
            img.onerror = function () {
                toast("Could not read logo image", "error");
            };
            img.src = dataURL;
        };
        reader.onerror = function () {
            toast("Could not read logo image", "error");
        };
        reader.readAsDataURL(file);
    }

    // Drop the saved logo into the canvas as a normal image layer, sized
    // relative to the document and centered so it is easy to notice and move.
    function addLogoLayer() {
        const img = state.logoImage;
        if (!img) return;
        const size = computeDocumentSize();
        let w = Math.round(size.width * 0.54);
        let h = Math.max(1, Math.round(w * (img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.5)));
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
            opacity: 1,
            rotation: 0
        };
        state.objects.push(obj);
        state.selectedObjectId = obj.id;
        state.activeTool = "select";
        commit();
        render();
        syncUI();
        toast("Logo added");
    }

    function placeLogo() {
        if (!state.logoImage) {
            // No logo saved yet: let the user pick one straight away.
            pendingLogoPlace = true;
            logoInput.click();
            return;
        }
        addLogoLayer();
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
        const explicitUrl = entry && entry.url;
        if (!explicitUrl && (!file || !FONT_EXT_RE.test(file))) return null;
        let url;
        if (explicitUrl) {
            url = explicitUrl;
        } else if (/^(https?:)?\/\//i.test(file) || file.charAt(0) === "/") {
            url = file;
        } else if (file.indexOf(FONT_DIR) === 0) {
            url = file;
        } else {
            url = FONT_DIR + file.replace(/^\.\//, "");
        }
        return {
            family: (entry && entry.family) || deriveFontFamily(file || "Font"),
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

        // Fonts the user dropped into a "fonts" folder next to the executable.
        if (hasBackend() && window.go.main.App.ListUserFonts) {
            try {
                const userFonts = await window.go.main.App.ListUserFonts();
                for (const f of userFonts || []) {
                    if (f && f.dataUrl) entries.push({ family: f.family, url: f.dataUrl });
                }
            } catch (err) {
                /* no user fonts */
            }
        }

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
        if (imageCrop) imageCrop = null;
        if (tool !== "crop") crop = null;
        if (tool === "crop" || tool === "brush") {
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

    function updateRotationUI(obj) {
        const rot = normalizeAngle(obj.rotation || 0);
        rotationRange.value = Math.round(rot);
        rotationInput.value = Math.round(rot);
        rotationValue.textContent = Math.round(rot);
        rotationReset.disabled = !(obj.rotation || 0);
    }

    function textDisplaySize(obj) {
        return round2(getEffectiveFontSize(obj) * (obj.scaleY == null ? 1 : obj.scaleY));
    }

    function updateTextSizeUI(obj) {
        const size = textDisplaySize(obj);
        textSize.value = clamp(size, 8, 400);
        textSizeValue.textContent = size;
    }

    function setSelectedRotation(deg) {
        const obj = getSelectedObject();
        if (!obj) return;
        obj.rotation = normalizeAngle(deg);
        updateRotationUI(obj);
        requestRender();
    }

    // Keep the Arrange section prominent: for text objects it sits right below
    // the text content field; for every other object it sits at the top of the
    // properties panel.
    function placeArrangeSection(type) {
        if (type === "text") {
            const anchor = textContent.closest(".field");
            if (anchor && anchor.nextSibling !== propOrder) {
                anchor.parentNode.insertBefore(propOrder, anchor.nextSibling);
            }
        } else if (propertiesEl.firstChild !== propOrder) {
            propertiesEl.insertBefore(propOrder, propertiesEl.firstChild);
        }
    }

    function syncUI() {
        document.querySelectorAll(".tool").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.tool === state.activeTool);
        });

        const obj = getSelectedObject();
        if (imageCrop && !state.objects.some((o) => o.id === imageCrop.objectId)) {
            imageCrop = null;
        }
        const cropping = state.activeTool === "crop" && !!state.baseImage.source;
        const showBrush = state.activeTool === "brush";
        propEmpty.classList.toggle("hidden", !!obj || cropping || showBrush);
        propText.classList.toggle("hidden", !(obj && obj.type === "text"));
        propImage.classList.toggle("hidden", !(obj && obj.type === "image"));
        propShape.classList.toggle("hidden", !(obj && (obj.type === "rect" || obj.type === "ellipse")));
        propBrush.classList.toggle("hidden", !showBrush);
        propCrop.classList.toggle("hidden", !cropping);
        propOrder.classList.toggle("hidden", !obj || cropping);
        propTransform.classList.toggle("hidden", !obj || cropping);

        placeArrangeSection(obj ? obj.type : null);

        if (obj) updateRotationUI(obj);

        const cropReady = !!crop && crop.width >= 2 && crop.height >= 2;
        cropApply.disabled = !cropReady;
        cropSize.textContent = cropReady
            ? Math.round(crop.width) + " × " + Math.round(crop.height) + " px"
            : "";

        if (obj && obj.type === "text") {
            textContent.value = obj.text;
            setFontSelectValue(obj.fontFamily);
            updateTextSizeUI(obj);
            textSize.disabled = !!obj.autoFit;
            textAutoFit.checked = !!obj.autoFit;
            textMaxSize.value = round2(obj.maxFontSize);
            textMaxSize.disabled = !obj.autoFit;
            textColor.value = obj.color;
            textOutlineEnabled.checked = !!obj.outlineEnabled;
            textOutlineColor.value = obj.outlineColor;
            textOutlineWidth.value = obj.outlineWidth;
            textOutlineValue.textContent = obj.outlineWidth;
            textAlignEl.querySelectorAll("button").forEach((b) => {
                b.classList.toggle("active", b.dataset.align === obj.align);
            });
            const dir = obj.direction || DEFAULT_TEXT_DIRECTION;
            textContent.setAttribute("dir", dir === "ltr" ? "ltr" : "rtl");
            textContent.style.textAlign = obj.align;
            textDirectionEl.querySelectorAll("button").forEach((b) => {
                b.classList.toggle("active", (b.dataset.dir || DEFAULT_TEXT_DIRECTION) === dir);
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

            const croppingImage = !!(imageCrop && imageCrop.objectId === obj.id);
            imageCropStartField.classList.toggle("hidden", croppingImage);
            imageCropControls.classList.toggle("hidden", !croppingImage);
            if (croppingImage) {
                const r = imageCrop.rect;
                const ready = !!r && r.width >= 2 && r.height >= 2;
                imageCropApply.disabled = !ready;
                imageCropSize.textContent = ready
                    ? Math.round(r.width) + " × " + Math.round(r.height) + " px"
                    : "";
            }
        }

        if (obj && (obj.type === "rect" || obj.type === "ellipse")) {
            shapeFill.value = obj.fill;
            const mode = obj.mode || "fill";
            shapeModeEl.querySelectorAll("button").forEach((b) => {
                b.classList.toggle("active", (b.dataset.mode || "fill") === mode);
            });
            shapeFillField.classList.toggle("hidden", mode !== "fill");
            const special = mode === "blur";
            shapeBlurField.classList.toggle("hidden", !special);
            if (special) {
                const br = obj.blurRadius == null ? DEFAULT_BLUR_RADIUS : obj.blurRadius;
                shapeBlur.value = br;
                shapeBlurValue.textContent = Math.round(br);
            }
            const isRect = obj.type === "rect";
            shapeRadiusField.classList.toggle("hidden", !isRect || special);
            if (isRect && !special) {
                const r = obj.radius == null ? DEFAULT_RECT_RADIUS : obj.radius;
                shapeRadius.value = r;
                shapeRadiusValue.textContent = Math.round(r);
            }
        }

        updateEmptyState();
        refreshRangeFills();
        syncCustomSelects();
        syncCustomColors();
    }

    // ---------------------------------------------------------------------
    // Pointer interaction
    // ---------------------------------------------------------------------

    function onPointerDown(event) {
        if (event.button !== 0) return;
        const p = getDocPoint(event);
        const tool = state.activeTool;
        guideState = null;

        if (eyedropperActive) {
            const hex = colorAt(p);
            if (!hex) return;
            const apply = eyedropperApply;
            stopEyedropper();
            if (apply) apply(hex);
            toast("Picked " + hex);
            return;
        }

        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (err) {
            /* pointer capture is best-effort */
        }

        // Cropping an image layer takes priority while it is active.
        if (imageCrop) {
            const target = state.objects.find((o) => o.id === imageCrop.objectId);
            if (target) {
                const local = toLocalPoint(target, p);
                const b = getObjectBounds(target);
                const inside =
                    local.x >= b.x &&
                    local.x <= b.x + b.width &&
                    local.y >= b.y &&
                    local.y <= b.y + b.height;
                if (inside) {
                    state.selectedObjectId = target.id;
                    imageCrop.rect = { x: local.x, y: local.y, width: 0, height: 0 };
                    interaction = { kind: "imagecrop", object: target, start: local };
                    render();
                    syncUI();
                }
            }
            return;
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
                mode: state.brush.mode,
                blurRadius: state.brush.blurRadius
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
                radius: DEFAULT_RECT_RADIUS,
                mode: state.currentShapeMode,
                blurRadius: state.currentShapeBlur
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
            if (hitRotateHandle(selected, p)) {
                const c = getObjectCenter(selected);
                interaction = {
                    kind: "rotate",
                    object: selected,
                    center: c,
                    startAngle: (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI,
                    startRotation: selected.rotation || 0
                };
                return;
            }
            const handle = hitHandle(selected, p);
            if (handle) {
                // Resizing an auto-fit text switches it to manual sizing, so the
                // box follows the cursor linearly instead of re-fitting to the
                // document width and jittering around.
                if (selected.type === "text" && selected.autoFit) {
                    selected.fontSize = getEffectiveFontSize(selected);
                    selected.autoFit = false;
                    selected.scaleY = 1;
                }
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
            return {
                baseWidth: m.width || 1,
                baseHeight: m.height || 1,
                fontSize: obj.fontSize,
                maxFontSize: obj.maxFontSize,
                scaleX: obj.scaleX == null ? 1 : obj.scaleX,
                scaleY: obj.scaleY == null ? 1 : obj.scaleY
            };
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
            // Fold the vertical scaling into the real font size so the size
            // value always reflects what is actually rendered. Any remaining
            // horizontal difference becomes a horizontal stretch (scaleX).
            const tY = nh / baseH;
            if (obj.autoFit) {
                const startMax = inter.original.maxFontSize || obj.maxFontSize || obj.fontSize;
                obj.maxFontSize = clamp(round2(startMax * tY), 8, 400);
            } else {
                const startSize = inter.original.fontSize || obj.fontSize;
                obj.fontSize = clamp(round2(startSize * tY), 8, 400);
            }
            obj.scaleY = 1;
            obj.scaleX = clamp(nw / (baseW * tY), 0.05, 50);
            if (obj.align === "left") obj.x = left;
            else if (obj.align === "right") obj.x = right;
            else obj.x = left + nw / 2;
            obj.y = top + nh / 2;
            updateTextSizeUI(obj);
        } else {
            obj.x = left;
            obj.y = top;
            obj.width = nw;
            obj.height = nh;
        }
    }

    function updateHoverCursor(event) {
        if (eyedropperActive) {
            canvas.style.cursor = "crosshair";
            return;
        }
        if (imageCrop) {
            canvas.style.cursor = "crosshair";
            return;
        }
        if (state.activeTool !== "select") return;
        const p = getDocPoint(event);
        const selected = getSelectedObject();
        if (selected) {
            if (hitRotateHandle(selected, p)) {
                canvas.style.cursor = "grab";
                return;
            }
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
        // Any live edit can change the content a blur object samples from.
        contentRev++;

        if (interaction.kind === "brush") {
            interaction.object.points.push({ x: p.x, y: p.y });
            requestRender();
            return;
        }

        if (interaction.kind === "imagecrop") {
            const target = interaction.object;
            const b = getObjectBounds(target);
            const local = toLocalPoint(target, p);
            const s = interaction.start;
            const x0 = clamp(Math.min(s.x, local.x), b.x, b.x + b.width);
            const y0 = clamp(Math.min(s.y, local.y), b.y, b.y + b.height);
            const x1 = clamp(Math.max(s.x, local.x), b.x, b.x + b.width);
            const y1 = clamp(Math.max(s.y, local.y), b.y, b.y + b.height);
            imageCrop.rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
            syncUI();
            render();
            return;
        }

        if (interaction.kind === "crop") {
            crop = clampCropRect(interaction.start, p);
            render();
            return;
        }

        if (interaction.kind === "create") {
            const o = interaction.object;
            const s = interaction.start;
            o.x = Math.min(s.x, p.x);
            o.y = Math.min(s.y, p.y);
            o.width = Math.abs(p.x - s.x);
            o.height = Math.abs(p.y - s.y);
            render();
            return;
        }

        if (interaction.kind === "drag") {
            const o = interaction.object;
            const snap = computeSnappedPosition(o, p.x - interaction.dx, p.y - interaction.dy);
            o.x = snap.x;
            o.y = snap.y;
            guideState = { allV: snap.allV, allH: snap.allH, v: snap.v, h: snap.h };
            interaction.moved = true;
            render();
            return;
        }

        if (interaction.kind === "rotate") {
            const c = interaction.center;
            const ang = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
            let rot = interaction.startRotation + (ang - interaction.startAngle);
            if (event.shiftKey) rot = Math.round(rot / 15) * 15;
            interaction.object.rotation = normalizeAngle(rot);
            updateRotationUI(interaction.object);
            render();
            return;
        }

        if (interaction.kind === "resize") {
            let pp = p;
            const rot = interaction.object.rotation || 0;
            if (rot) {
                const b = interaction.bounds;
                const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
                pp = rotatePoint(p, c, -rot);
            }
            applyResize(interaction, pp);
            render();
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
        } else if (kind === "imagecrop") {
            if (!imageCrop.rect || imageCrop.rect.width < 2 || imageCrop.rect.height < 2) {
                imageCrop.rect = null;
            }
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
        } else if (kind === "rotate") {
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
        // Make sure the Text section is visible in the (scrollable) panel,
        // then focus the content field so typing starts immediately.
        textContent.scrollIntoView({ block: "nearest" });
        textContent.focus();
        textContent.select();
        // Defer once more so a canvas pointer event can't steal focus back.
        requestAnimationFrame(function () {
            textContent.focus();
            textContent.select();
        });
    }

    // Read the rendered pixel under a document-space point. Returns a #rrggbb
    // string, or null when the point is outside the document.
    function colorAt(p) {
        const size = computeDocumentSize();
        const x = Math.floor(p.x);
        const y = Math.floor(p.y);
        if (x < 0 || y < 0 || x >= size.width || y >= size.height) return null;
        const ctx = getCtx();
        const px = clamp(Math.floor(p.x * renderScale), 0, canvas.width - 1);
        const py = clamp(Math.floor(p.y * renderScale), 0, canvas.height - 1);
        const data = ctx.getImageData(px, py, 1, 1).data;
        return rgbToHex(data[0], data[1], data[2]);
    }

    // Start sampling a colour from the canvas. `apply` receives the picked hex
    // value once the user clicks.
    function startEyedropper(apply) {
        eyedropperActive = true;
        eyedropperApply = apply;
        canvas.style.cursor = "crosshair";
        closeAllColorPickers();
        closeAllDropdowns();
        toast("Click the canvas to pick a color");
    }

    function stopEyedropper() {
        eyedropperActive = false;
        eyedropperApply = null;
        canvas.style.cursor = CURSORS[state.activeTool] || "default";
    }

    function pickIntoColorInput(input, hex) {
        const st = customColors.get(input);
        if (st) {
            st.applyHex(hex, false);
            return;
        }
        input.value = hex;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // ---------------------------------------------------------------------
    // Text presets
    // ---------------------------------------------------------------------

    // ---------------------------------------------------------------------
    // Preferences
    // ---------------------------------------------------------------------
    //
    // User choices are persisted to a JSON config file next to the app (via the
    // Go backend) so they survive relaunches. When the page runs in a plain
    // browser the same blob is kept in localStorage instead.

    function defaultPreferences() {
        return {
            version: PREFERENCES_VERSION,
            textPresets: [],
            defaultPresetId: null,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            background: DEFAULT_BACKGROUND,
            brush: { mode: "draw", color: "#000000", size: 10, blurRadius: DEFAULT_BLUR_RADIUS },
            currentColor: "#000000",
            currentShapeFill: DEFAULT_BACKGROUND,
            currentShapeMode: "fill",
            currentShapeBlur: DEFAULT_BLUR_RADIUS,
            logo: null,
            startCanvas: { width: DEFAULT_CANVAS.width, height: DEFAULT_CANVAS.height, background: DEFAULT_BACKGROUND }
        };
    }

    function collectPreferences() {
        return {
            version: PREFERENCES_VERSION,
            textPresets: state.textPresets,
            defaultPresetId: state.defaultPresetId,
            padding: { top: state.padding.top, right: state.padding.right, bottom: state.padding.bottom, left: state.padding.left },
            background: state.background,
            brush: { mode: state.brush.mode, color: state.brush.color, size: state.brush.size, blurRadius: state.brush.blurRadius },
            currentColor: state.currentColor,
            currentShapeFill: state.currentShapeFill,
            currentShapeMode: state.currentShapeMode,
            currentShapeBlur: state.currentShapeBlur,
            logo: state.logoDataURL || null,
            startCanvas: {
                width: clamp(parseInt(startWidth.value, 10) || state.startCanvas.width, 1, 10000),
                height: clamp(parseInt(startHeight.value, 10) || state.startCanvas.height, 1, 10000),
                background: startBg.value || state.startCanvas.background
            }
        };
    }

    function loadPreferences() {
        const local = loadLocalPreferences();
        const mergeLocal = function (remote) {
            if (!remote || typeof remote !== "object") remote = {};
            const remotePresets = Array.isArray(remote.textPresets) ? remote.textPresets : [];
            // Bring over presets saved by an older localStorage-only release.
            if (!remotePresets.length && Array.isArray(local.textPresets) && local.textPresets.length) {
                remote.textPresets = local.textPresets;
                if (!remote.defaultPresetId) remote.defaultPresetId = local.defaultPresetId || null;
            }
            return remote;
        };
        if (hasBackend()) {
            return window.go.main.App.LoadPreferences()
                .then(function (raw) {
                    return mergeLocal(raw ? JSON.parse(raw) : {});
                })
                .catch(function () {
                    return local;
                });
        }
        return Promise.resolve(local);
    }

    function loadLocalPreferences() {
        try {
            const raw = localStorage.getItem(PREF_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") return parsed;
            }
        } catch (err) {}
        // Migrate presets saved by older versions that only used localStorage.
        try {
            const presets = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || "[]");
            if (Array.isArray(presets) && presets.length) {
                return {
                    textPresets: presets,
                    defaultPresetId: localStorage.getItem(DEFAULT_PRESET_STORAGE_KEY) || null
                };
            }
        } catch (err) {}
        return {};
    }

    function applyPreferences(prefs) {
        const d = defaultPreferences();
        if (!prefs || typeof prefs !== "object") prefs = {};

        state.textPresets = Array.isArray(prefs.textPresets) ? prefs.textPresets.filter((p) => p && p.id) : [];
        state.defaultPresetId = prefs.defaultPresetId || null;
        if (state.defaultPresetId && !state.textPresets.some((p) => p.id === state.defaultPresetId)) {
            state.defaultPresetId = null;
        }

        if (prefs.padding && typeof prefs.padding === "object") {
            state.padding = {
                top: clamp(parseFloat(prefs.padding.top) || 0, 0, 200),
                right: clamp(parseFloat(prefs.padding.right) || 0, 0, 200),
                bottom: clamp(parseFloat(prefs.padding.bottom) || 0, 0, 200),
                left: clamp(parseFloat(prefs.padding.left) || 0, 0, 200)
            };
        }

        if (hexToRgb(prefs.background)) state.background = prefs.background;

        if (prefs.brush && typeof prefs.brush === "object") {
            state.brush = {
                mode: prefs.brush.mode || d.brush.mode,
                color: hexToRgb(prefs.brush.color) ? prefs.brush.color : d.brush.color,
                size: clamp(parseInt(prefs.brush.size, 10) || d.brush.size, 1, 120),
                blurRadius: clamp(parseInt(prefs.brush.blurRadius, 10) || d.brush.blurRadius, 1, 150)
            };
        }

        if (hexToRgb(prefs.currentColor)) state.currentColor = prefs.currentColor;
        if (hexToRgb(prefs.currentShapeFill)) state.currentShapeFill = prefs.currentShapeFill;
        if (prefs.currentShapeMode === "blur" || prefs.currentShapeMode === "fill") {
            state.currentShapeMode = prefs.currentShapeMode;
        }
        if (prefs.currentShapeBlur) {
            state.currentShapeBlur = clamp(parseInt(prefs.currentShapeBlur, 10) || d.currentShapeBlur, 1, 150);
        }

        if (typeof prefs.logo === "string" && prefs.logo.indexOf("data:image/") === 0) {
            state.logoDataURL = prefs.logo;
        }

        if (prefs.startCanvas && typeof prefs.startCanvas === "object") {
            state.startCanvas = {
                width: clamp(parseInt(prefs.startCanvas.width, 10) || d.startCanvas.width, 1, 10000),
                height: clamp(parseInt(prefs.startCanvas.height, 10) || d.startCanvas.height, 1, 10000),
                background: hexToRgb(prefs.startCanvas.background) ? prefs.startCanvas.background : d.startCanvas.background
            };
        }
    }

    // Push the restored preferences into the UI controls.
    function applyPreferenceUI() {
        padTop.value = state.padding.top;
        padRight.value = state.padding.right;
        padBottom.value = state.padding.bottom;
        padLeft.value = state.padding.left;

        bgColor.value = state.background;

        brushMode.value = state.brush.mode;
        brushColor.value = state.brush.color;
        brushSize.value = state.brush.size;
        brushSizeValue.textContent = state.brush.size;
        brushBlur.value = state.brush.blurRadius;
        brushBlurValue.textContent = state.brush.blurRadius;
        brushBlurField.classList.toggle("hidden", state.brush.mode !== "blur");

        shapeFill.value = state.currentShapeFill;
        shapeBlur.value = state.currentShapeBlur;
        shapeBlurValue.textContent = Math.round(state.currentShapeBlur);

        startWidth.value = state.startCanvas.width;
        startHeight.value = state.startCanvas.height;
        startBg.value = state.startCanvas.background;

        syncCustomColors();
        syncCustomSelects();
        refreshRangeFills();
    }

    function restoreLogo() {
        if (!state.logoDataURL) return;
        const img = new Image();
        img.onload = function () {
            state.logoImage = img;
        };
        img.src = state.logoDataURL;
    }

    // Debounced write so dragging a slider doesn't hammer the disk.
    function schedulePersistPreferences() {
        if (!preferencesLoaded) return;
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(persistPreferencesNow, 350);
    }

    function persistPreferencesNow() {
        persistTimer = null;
        if (!preferencesLoaded) return;
        const json = JSON.stringify(collectPreferences());
        if (hasBackend()) {
            window.go.main.App.SavePreferences(json).catch(function () {});
        } else {
            try {
                localStorage.setItem(PREF_STORAGE_KEY, json);
            } catch (err) {}
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
            opt.textContent = p.id === state.defaultPresetId ? p.name + " (default)" : p.name;
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
            direction: obj.direction || DEFAULT_TEXT_DIRECTION,
            color: obj.color,
            outlineColor: obj.outlineColor,
            outlineWidth: obj.outlineWidth,
            outlineEnabled: obj.outlineEnabled
        };
        state.textPresets.push(preset);
        if (!state.defaultPresetId) {
            state.defaultPresetId = preset.id;
        }
        schedulePersistPreferences();
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
        applyTextPreset(obj, preset);
        commit();
        render();
        syncUI();
        toast('Applied "' + preset.name + '"');
    }

    function setDefaultPreset() {
        const preset = state.textPresets.find((p) => p.id === presetSelect.value);
        if (!preset) {
            toast("No preset selected", "error");
            return;
        }
        state.defaultPresetId = preset.id;
        schedulePersistPreferences();
        renderPresetOptions();
        presetSelect.value = preset.id;
        toast('"' + preset.name + '" is now the default for new text');
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
        schedulePersistPreferences();
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
        if (state.defaultPresetId === preset.id) {
            state.defaultPresetId = null;
        }
        schedulePersistPreferences();
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
        // Export renders synchronously on an offscreen canvas, so use the
        // in-JS blur there; the Go blur is for the interactive preview.
        exporting = true;
        try {
            renderDocument(octx);
        } finally {
            exporting = false;
        }

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
    // Image layer crop
    // ---------------------------------------------------------------------

    function sourceSize(src) {
        return {
            width: src.naturalWidth || src.width || 0,
            height: src.naturalHeight || src.height || 0
        };
    }

    function startImageCrop() {
        const obj = getSelectedObject();
        if (!obj || obj.type !== "image") return;
        imageCrop = { objectId: obj.id, rect: null };
        toast("Drag over the image to choose the area to keep");
        render();
        syncUI();
    }

    function cancelImageCrop() {
        imageCrop = null;
        render();
        syncUI();
    }

    function applyImageCrop() {
        const target = imageCrop && state.objects.find((o) => o.id === imageCrop.objectId);
        const r = imageCrop && imageCrop.rect;
        if (!target || !r || r.width < 2 || r.height < 2) {
            toast("Select a crop area first", "error");
            return;
        }
        const b = getObjectBounds(target);
        const src = sourceSize(target.source);
        const scaleX = src.width / b.width;
        const scaleY = src.height / b.height;
        const sx = clamp(Math.round((r.x - b.x) * scaleX), 0, src.width - 1);
        const sy = clamp(Math.round((r.y - b.y) * scaleY), 0, src.height - 1);
        const sw = clamp(Math.round(r.width * scaleX), 1, src.width - sx);
        const sh = clamp(Math.round(r.height * scaleY), 1, src.height - sy);

        const off = document.createElement("canvas");
        off.width = sw;
        off.height = sh;
        off.getContext("2d").drawImage(target.source, sx, sy, sw, sh, 0, 0, sw, sh);

        target.source = off;
        target.x = r.x;
        target.y = r.y;
        target.width = r.width;
        target.height = r.height;

        imageCrop = null;
        commit();
        render();
        syncUI();
        toast("Image cropped to " + sw + " × " + sh);
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
            brushBlurField.classList.toggle("hidden", state.brush.mode !== "blur");
            schedulePersistPreferences();
        });
        brushColor.addEventListener("input", function () {
            state.brush.color = brushColor.value;
            state.currentColor = brushColor.value;
            schedulePersistPreferences();
        });
        brushSize.addEventListener("input", function () {
            state.brush.size = parseInt(brushSize.value, 10) || 1;
            brushSizeValue.textContent = state.brush.size;
            schedulePersistPreferences();
        });
        brushBlur.addEventListener("input", function () {
            state.brush.blurRadius = parseInt(brushBlur.value, 10) || DEFAULT_BLUR_RADIUS;
            brushBlurValue.textContent = state.brush.blurRadius;
            schedulePersistPreferences();
        });
        btnCoverBg.addEventListener("click", function () {
            state.brush.color = state.background;
            state.currentColor = state.background;
            brushColor.value = state.background;
            schedulePersistPreferences();
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
                schedulePersistPreferences();
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
            const old = state.background;
            state.background = bgColor.value;
            if (state.currentShapeFill === old || !state.currentShapeFill) {
                state.currentShapeFill = bgColor.value;
            }
            requestRender();
        });
        bgColor.addEventListener("change", function () {
            const old = state.background;
            state.background = bgColor.value;
            if (state.currentShapeFill === old || !state.currentShapeFill) {
                state.currentShapeFill = bgColor.value;
            }
            commit();
            render();
            schedulePersistPreferences();
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
            const size = parseInt(textSize.value, 10) || 8;
            if (obj.autoFit) {
                obj.maxFontSize = clamp(size, 8, 400);
            } else {
                obj.fontSize = clamp(size, 8, 400);
                obj.scaleY = 1;
            }
            updateTextSizeUI(obj);
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
            obj.maxFontSize = clamp(round2(parseFloat(textMaxSize.value) || obj.fontSize), 8, 400);
            commit();
            render();
            syncUI();
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
        textDirectionEl.addEventListener("click", function (event) {
            const btn = event.target.closest("button");
            if (!btn) return;
            const obj = selectedTextObject();
            if (!obj) return;
            obj.direction = btn.dataset.dir === "ltr" ? "ltr" : "rtl";
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
        presetSetDefault.addEventListener("click", setDefaultPreset);

        // Rotation
        rotationRange.addEventListener("input", function () {
            setSelectedRotation(parseFloat(rotationRange.value) || 0);
        });
        rotationRange.addEventListener("change", function () {
            if (getSelectedObject()) {
                commit();
                render();
            }
        });
        rotationInput.addEventListener("change", function () {
            if (!getSelectedObject()) return;
            setSelectedRotation(parseFloat(rotationInput.value) || 0);
            commit();
            render();
        });
        rotationReset.addEventListener("click", function () {
            if (!getSelectedObject()) return;
            setSelectedRotation(0);
            commit();
            render();
        });

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
            schedulePersistPreferences();
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
        shapeModeEl.addEventListener("click", function (event) {
            const btn = event.target.closest("button");
            if (!btn) return;
            const mode = btn.dataset.mode || "fill";
            state.currentShapeMode = mode;
            schedulePersistPreferences();
            const obj = getSelectedObject();
            if (obj && (obj.type === "rect" || obj.type === "ellipse")) {
                obj.mode = mode;
                commit();
                render();
            }
            syncUI();
        });
        shapeBlur.addEventListener("input", function () {
            const radius = parseInt(shapeBlur.value, 10) || DEFAULT_BLUR_RADIUS;
            state.currentShapeBlur = radius;
            shapeBlurValue.textContent = radius;
            schedulePersistPreferences();
            const obj = getSelectedObject();
            if (obj && (obj.type === "rect" || obj.type === "ellipse")) {
                obj.blurRadius = radius;
                requestRender();
            }
        });
        shapeBlur.addEventListener("change", function () {
            const obj = getSelectedObject();
            if (obj && (obj.type === "rect" || obj.type === "ellipse")) commit();
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

        // Logo quick access
        logoPlace.addEventListener("click", placeLogo);
        logoChange.addEventListener("click", function () {
            pendingLogoPlace = false;
            logoInput.click();
        });
        logoInput.addEventListener("change", function (e) {
            const file = e.target.files[0];
            const place = pendingLogoPlace;
            pendingLogoPlace = false;
            setLogoFromFile(file, place);
            e.target.value = "";
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

        // Image layer crop
        imageCropStart.addEventListener("click", startImageCrop);
        imageCropApply.addEventListener("click", applyImageCrop);
        imageCropCancel.addEventListener("click", cancelImageCrop);

        // File inputs
        btnOpen.addEventListener("click", () => fileInput.click());
        emptyOpen.addEventListener("click", () => fileInput.click());
        btnReplace.addEventListener("click", () => replaceInput.click());
        btnSave.addEventListener("click", exportImage);
        btnUndo.addEventListener("click", undo);
        btnRedo.addEventListener("click", redo);

        // Start screen
        startOpen.addEventListener("click", () => fileInput.click());
        startEmpty.addEventListener("click", startEmptyCanvas);
        [startWidth, startHeight].forEach(function (input) {
            input.addEventListener("change", schedulePersistPreferences);
        });
        startBg.addEventListener("change", schedulePersistPreferences);

        // Restart + confirmation dialog
        btnRestart.addEventListener("click", function () {
            showConfirm(
                "Restart project?",
                "This discards your image and every edit, and returns to the start screen. This cannot be undone.",
                "Restart",
                resetProject
            );
        });
        confirmCancel.addEventListener("click", closeConfirm);
        confirmYes.addEventListener("click", function () {
            const fn = confirmAction;
            closeConfirm();
            if (fn) fn();
        });
        confirmOverlay.addEventListener("click", function (e) {
            if (e.target === confirmOverlay) closeConfirm();
        });

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
            if (!state.started) return;
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
                if (!confirmOverlay.classList.contains("hidden")) {
                    closeConfirm();
                    return;
                }
                if (eyedropperActive) {
                    stopEyedropper();
                    return;
                }
                if (imageCrop) cancelImageCrop();
                else if (state.activeTool === "crop") cancelCrop();
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
                case "i": {
                    const target = lastColorInput || brushColor;
                    startEyedropper(function (picked) {
                        pickIntoColorInput(target, picked);
                    });
                    break;
                }
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
        schedulePersistPreferences();
    }

    function readPaddingInputs() {
        state.padding.top = clamp(parseFloat(padTop.value) || 0, 0, 200);
        state.padding.right = clamp(parseFloat(padRight.value) || 0, 0, 200);
        state.padding.bottom = clamp(parseFloat(padBottom.value) || 0, 0, 200);
        state.padding.left = clamp(parseFloat(padLeft.value) || 0, 0, 200);
    }

    function setBackground(color) {
        const old = state.background;
        state.background = color;
        // New shapes default to the background color unless the user has
        // already picked a custom shape fill.
        if (state.currentShapeFill === old || !state.currentShapeFill) {
            state.currentShapeFill = color;
        }
        bgColor.value = color;
        commit();
        render();
    }

    // ---------------------------------------------------------------------
    // Input polish (themed range sliders + number steppers)
    // ---------------------------------------------------------------------

    function updateRangeFill(input) {
        const min = parseFloat(input.min);
        const max = parseFloat(input.max);
        const v = parseFloat(input.value);
        const lo = isNaN(min) ? 0 : min;
        const hi = isNaN(max) ? 100 : max;
        const pct = hi > lo ? ((v - lo) / (hi - lo)) * 100 : 0;
        input.style.setProperty("--range-progress", clamp(pct, 0, 100) + "%");
    }

    function refreshRangeFills() {
        document.querySelectorAll('input[type="range"]').forEach(updateRangeFill);
    }

    function enhanceRanges() {
        document.querySelectorAll('input[type="range"]').forEach(function (input) {
            if (input.dataset.rangeEnhanced) return;
            input.dataset.rangeEnhanced = "1";
            updateRangeFill(input);
            input.addEventListener("input", function () {
                updateRangeFill(input);
            });
        });
    }

    function enhanceNumberInputs() {
        document.querySelectorAll('input[type="number"]').forEach(function (input) {
            if (input.dataset.stepped) return;
            input.dataset.stepped = "1";

            const wrap = document.createElement("div");
            wrap.className = "num-input";
            input.parentNode.insertBefore(wrap, input);

            const dec = document.createElement("button");
            dec.type = "button";
            dec.className = "num-btn";
            dec.tabIndex = -1;
            dec.setAttribute("aria-label", "Decrease");
            dec.textContent = "−";

            const inc = document.createElement("button");
            inc.type = "button";
            inc.className = "num-btn";
            inc.tabIndex = -1;
            inc.setAttribute("aria-label", "Increase");
            inc.textContent = "+";

            wrap.appendChild(dec);
            wrap.appendChild(input);
            wrap.appendChild(inc);

            const stepBy = function (dir) {
                const step = parseFloat(input.step) || 1;
                const min = input.min !== "" ? parseFloat(input.min) : -Infinity;
                const max = input.max !== "" ? parseFloat(input.max) : Infinity;
                let v = parseFloat(input.value);
                if (isNaN(v)) v = 0;
                v = clamp(v + dir * step, min, max);
                input.value = String(v);
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
            };
            dec.addEventListener("click", function () {
                stepBy(-1);
            });
            inc.addEventListener("click", function () {
                stepBy(1);
            });
        });
    }

    // ---------------------------------------------------------------------
    // Custom text input (contenteditable)
    // ---------------------------------------------------------------------
    //
    // A native <textarea> lays mixed Farsi/English text out with the document
    // base direction, so what you see while typing does not match the canvas.
    // This editable field keeps plain text only (no rich markup), follows the
    // selected object's writing direction, and exposes a textarea-like API
    // (value / focus / select) so the rest of the code can treat it the same.

    function createRichTextInput(el) {
        if (!el || el.dataset.richText) return;
        el.dataset.richText = "1";
        el.setAttribute("contenteditable", "true");
        if (!el.hasAttribute("dir")) el.setAttribute("dir", DEFAULT_TEXT_DIRECTION);

        let changedSinceFocus = false;

        const updateEmpty = function () {
            el.classList.toggle("is-empty", el.textContent.length === 0);
        };

        // Insert plain text at the caret, keeping newlines as "\n" characters
        // (rendered thanks to `white-space: pre-wrap`) instead of <br>/<div>.
        // We do this by hand rather than with execCommand so the DOM stays a
        // single run of text nodes, which makes the value getter reliable.
        const insertPlainText = function (text) {
            if (!text) return;
            const selection = window.getSelection();
            let range;
            if (selection && selection.rangeCount && el.contains(selection.anchorNode)) {
                range = selection.getRangeAt(0);
            } else {
                range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
            }
            range.deleteContents();
            const node = document.createTextNode(text);
            range.insertNode(node);
            range.setStart(node, text.length);
            range.collapse(true);
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
            }
            changedSinceFocus = true;
            updateEmpty();
            el.dispatchEvent(new Event("input", { bubbles: true }));
        };

        Object.defineProperty(el, "value", {
            configurable: true,
            get: function () {
                return el.textContent.replace(/\r\n?/g, "\n");
            },
            set: function (v) {
                const next = v == null ? "" : String(v);
                // Guard against clobbering the caret while the user types.
                if (el.textContent === next) {
                    updateEmpty();
                    return;
                }
                el.textContent = next;
                updateEmpty();
            }
        });

        // Textarea parity: select() exists on <input>/<textarea> but not on a
        // contenteditable element.
        el.select = function () {
            const range = document.createRange();
            range.selectNodeContents(el);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        };

        el.addEventListener("input", function () {
            changedSinceFocus = true;
            updateEmpty();
        });

        el.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                insertPlainText("\n");
            }
        });

        // Paste is always plain text so pasted styling can never leak in.
        el.addEventListener("paste", function (e) {
            e.preventDefault();
            const data = e.clipboardData || window.clipboardData;
            insertPlainText(data ? data.getData("text") : "");
        });

        el.addEventListener("blur", function () {
            updateEmpty();
            if (changedSinceFocus) {
                changedSinceFocus = false;
                el.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });

        updateEmpty();
    }

    // ---------------------------------------------------------------------
    // Custom dropdown (native <option> lists can't be themed)
    // ---------------------------------------------------------------------

    const customSelects = new Map();

    function closeAllDropdowns() {
        customSelects.forEach(function (state) {
            state.wrap.classList.remove("open");
        });
    }

    function syncDropdown(select) {
        const state = customSelects.get(select);
        if (!state) return;
        const opt = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
        state.label.textContent = opt ? opt.textContent : "";
        state.label.title = opt ? opt.textContent : "";
        state.toggle.disabled = select.disabled;
        state.wrap.classList.toggle("disabled", select.disabled);
        Array.prototype.forEach.call(state.menu.children, function (item) {
            item.classList.toggle("selected", item.dataset.value === select.value);
        });
    }

    function syncCustomSelects() {
        customSelects.forEach(function (state, select) {
            syncDropdown(select);
        });
    }

    function enhanceSelect(select) {
        if (customSelects.has(select)) return;

        const wrap = document.createElement("div");
        wrap.className = "dropdown";
        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
        select.classList.add("dropdown-native");

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "dropdown-toggle";
        const label = document.createElement("span");
        label.className = "dropdown-label";
        const chevron = document.createElement("span");
        chevron.className = "dropdown-chevron";
        toggle.appendChild(label);
        toggle.appendChild(chevron);

        const menu = document.createElement("div");
        menu.className = "dropdown-menu";
        wrap.appendChild(toggle);
        wrap.appendChild(menu);

        const state = { wrap: wrap, toggle: toggle, menu: menu, label: label };
        customSelects.set(select, state);

        function rebuild() {
            menu.innerHTML = "";
            const isFont = select.id === "text-font";
            Array.prototype.forEach.call(select.options, function (opt) {
                const item = document.createElement("button");
                item.type = "button";
                item.className = "dropdown-option";
                item.textContent = opt.textContent;
                item.dataset.value = opt.value;
                if (isFont) {
                    item.style.fontFamily = '"' + String(opt.value).replace(/"/g, "") + '", ' + FONT_FALLBACK;
                }
                if (opt.value === select.value) item.classList.add("selected");
                item.addEventListener("click", function (ev) {
                    ev.stopPropagation();
                    select.value = opt.value;
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                    syncDropdown(select);
                    closeAllDropdowns();
                });
                menu.appendChild(item);
            });
        }

        function positionMenu() {
            const r = toggle.getBoundingClientRect();
            menu.style.left = r.left + "px";
            menu.style.width = r.width + "px";
            menu.style.top = r.bottom + 6 + "px";
            const h = menu.offsetHeight;
            if (r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 0) {
                menu.style.top = r.top - 6 - h + "px";
            }
        }

        toggle.addEventListener("click", function (ev) {
            ev.stopPropagation();
            const isOpen = wrap.classList.contains("open");
            closeAllDropdowns();
            if (isOpen) return;
            rebuild();
            positionMenu();
            wrap.classList.add("open");
        });

        state.rebuild = rebuild;
        state.position = positionMenu;
        syncDropdown(select);
    }

    function enhanceSelects() {
        document.querySelectorAll("select").forEach(enhanceSelect);
    }

    // ---------------------------------------------------------------------
    // Custom color picker (native <input type=color> dialog can't be themed)
    // ---------------------------------------------------------------------

    const customColors = new Map();

    function hsvToRgb(h, s, v) {
        h = ((h % 360) + 360) % 360;
        const c = v * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = v - c;
        let r = 0;
        let g = 0;
        let b = 0;
        if (h < 60) {
            r = c;
            g = x;
        } else if (h < 120) {
            r = x;
            g = c;
        } else if (h < 180) {
            g = c;
            b = x;
        } else if (h < 240) {
            g = x;
            b = c;
        } else if (h < 300) {
            r = x;
            b = c;
        } else {
            r = c;
            b = x;
        }
        return {
            r: Math.round((r + m) * 255),
            g: Math.round((g + m) * 255),
            b: Math.round((b + m) * 255)
        };
    }

    function rgbToHsv(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d) {
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return { h: h, s: max === 0 ? 0 : d / max, v: max };
    }

    function hexToRgb(hex) {
        if (!hex) return null;
        let s = String(hex).trim().replace(/^#/, "");
        if (s.length === 3) {
            s = s
                .split("")
                .map(function (c) {
                    return c + c;
                })
                .join("");
        }
        if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
        return {
            r: parseInt(s.slice(0, 2), 16),
            g: parseInt(s.slice(2, 4), 16),
            b: parseInt(s.slice(4, 6), 16)
        };
    }

    function closeAllColorPickers() {
        customColors.forEach(function (st) {
            st.field.classList.remove("open");
        });
    }

    function renderColorPopover(st) {
        const h = st.hsv.h;
        st.sv.style.background =
            "linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(" +
            h +
            ", 100%, 50%))";
        st.svCursor.style.left = st.hsv.s * 100 + "%";
        st.svCursor.style.top = (1 - st.hsv.v) * 100 + "%";
        st.hueThumb.style.left = (h / 360) * 100 + "%";
        st.hex.value = rgbToHex(st.rgb.r, st.rgb.g, st.rgb.b);
        Array.prototype.forEach.call(st.swatches.children, function (btn) {
            btn.classList.toggle(
                "active",
                btn.dataset.color.toLowerCase() === rgbToHex(st.rgb.r, st.rgb.g, st.rgb.b).toLowerCase()
            );
        });
    }

    function syncColorField(input) {
        const st = customColors.get(input);
        if (!st) return;
        const rgb = hexToRgb(input.value) || { r: 0, g: 0, b: 0 };
        st.rgb = rgb;
        st.hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
        st.swatch.style.background = hex;
        st.swatch.title = hex;
        renderColorPopover(st);
    }

    function syncCustomColors() {
        customColors.forEach(function (st, input) {
            syncColorField(input);
        });
    }

    function enhanceColorInput(input) {
        if (customColors.has(input)) return;

        const field = document.createElement("div");
        field.className = "color-field";
        input.parentNode.insertBefore(field, input);

        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "color-swatch";

        const pop = document.createElement("div");
        pop.className = "color-popover";

        const sv = document.createElement("div");
        sv.className = "cp-sv";
        const svCursor = document.createElement("div");
        svCursor.className = "cp-cursor";
        sv.appendChild(svCursor);

        const hue = document.createElement("div");
        hue.className = "cp-hue";
        const hueThumb = document.createElement("div");
        hueThumb.className = "cp-hue-thumb";
        hue.appendChild(hueThumb);

        const row = document.createElement("div");
        row.className = "cp-row";
        const hex = document.createElement("input");
        hex.type = "text";
        hex.className = "cp-hex";
        hex.maxLength = 7;
        hex.spellcheck = false;
        row.appendChild(hex);

        const eyedrop = document.createElement("button");
        eyedrop.type = "button";
        eyedrop.className = "cp-eyedropper";
        eyedrop.title = "Pick a color from the canvas";
        eyedrop.setAttribute("aria-label", "Pick a color from the canvas");
        eyedrop.innerHTML =
            '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/>' +
            '<path d="m15 6 3-3a2.1 2.1 0 0 1 3 3l-3 3"/><path d="m11 10 4 4"/></svg>';
        eyedrop.addEventListener("click", function (ev) {
            ev.stopPropagation();
            startEyedropper(function (picked) {
                applyHex(picked, false);
            });
        });
        row.appendChild(eyedrop);

        const swatches = document.createElement("div");
        swatches.className = "cp-swatches";
        ["#ffffff", "#000000", "#ff0000", "#ff8c00", "#ffd400", "#22c55e", "#0ea5e9", "#6c8cff", "#a855f7", "#ec4899"].forEach(
            function (c) {
                const b = document.createElement("button");
                b.type = "button";
                b.className = "cp-swatch";
                b.dataset.color = c;
                b.style.background = c;
                b.addEventListener("click", function (ev) {
                    ev.stopPropagation();
                    applyHex(c, false);
                });
                swatches.appendChild(b);
            }
        );

        pop.appendChild(sv);
        pop.appendChild(hue);
        pop.appendChild(row);
        pop.appendChild(swatches);

        field.appendChild(swatch);
        field.appendChild(input);
        field.appendChild(pop);
        input.classList.add("color-native");

        const st = {
            input: input,
            field: field,
            swatch: swatch,
            pop: pop,
            sv: sv,
            svCursor: svCursor,
            hue: hue,
            hueThumb: hueThumb,
            hex: hex,
            swatches: swatches,
            hsv: { h: 0, s: 0, v: 1 },
            rgb: { r: 0, g: 0, b: 0 }
        };
        customColors.set(input, st);

        function emit(live) {
            input.value = rgbToHex(st.rgb.r, st.rgb.g, st.rgb.b);
            swatch.style.background = input.value;
            swatch.title = input.value;
            renderColorPopover(st);
            // Always fire "input" so the app applies the colour, then "change"
            // to commit it to history when the interaction finishes.
            input.dispatchEvent(new Event("input", { bubbles: true }));
            if (!live) {
                input.dispatchEvent(new Event("change", { bubbles: true }));
            }
        }

        function applyHsv(live) {
            st.rgb = hsvToRgb(st.hsv.h, st.hsv.s, st.hsv.v);
            emit(live);
        }

        function applyHex(value, live) {
            const rgb = hexToRgb(value);
            if (!rgb) return;
            st.rgb = rgb;
            st.hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
            emit(live);
        }

        st.applyHex = applyHex;

        hex.addEventListener("input", function () {
            const rgb = hexToRgb(hex.value);
            if (!rgb) return;
            st.rgb = rgb;
            st.hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
            input.value = rgbToHex(rgb.r, rgb.g, rgb.b);
            swatch.style.background = input.value;
            renderColorPopover(st);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        hex.addEventListener("change", function () {
            applyHex(hex.value, false);
        });

        function drag(el, onMove, onDone) {
            el.addEventListener("pointerdown", function (e) {
                e.stopPropagation();
                try {
                    el.setPointerCapture(e.pointerId);
                } catch (err) {
                    /* best effort */
                }
                onMove(e);
                applyHsv(true);
                const move = function (ev) {
                    onMove(ev);
                    applyHsv(true);
                };
                const up = function () {
                    el.removeEventListener("pointermove", move);
                    el.removeEventListener("pointerup", up);
                    el.removeEventListener("pointercancel", up);
                    applyHsv(false);
                    if (onDone) onDone();
                };
                el.addEventListener("pointermove", move);
                el.addEventListener("pointerup", up);
                el.addEventListener("pointercancel", up);
            });
        }

        drag(sv, function (e) {
            const r = sv.getBoundingClientRect();
            st.hsv.s = clamp((e.clientX - r.left) / r.width, 0, 1);
            st.hsv.v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
        });
        drag(hue, function (e) {
            const r = hue.getBoundingClientRect();
            st.hsv.h = clamp((e.clientX - r.left) / r.width, 0, 1) * 360;
        });

        pop.addEventListener("wheel", function (e) {
            e.stopPropagation();
        });

        swatch.addEventListener("click", function (e) {
            e.stopPropagation();
            const open = field.classList.contains("open");
            closeAllColorPickers();
            closeAllDropdowns();
            if (open) return;
            lastColorInput = input;
            syncColorField(input);
            positionColorPopover(st);
            field.classList.add("open");
        });

        syncColorField(input);
    }

    function positionColorPopover(st) {
        const r = st.swatch.getBoundingClientRect();
        const pop = st.pop;
        pop.style.left = clamp(r.left, 8, window.innerWidth - 240) + "px";
        pop.style.top = r.bottom + 8 + "px";
        const h = pop.offsetHeight;
        if (r.bottom + 8 + h > window.innerHeight && r.top - 8 - h > 0) {
            pop.style.top = r.top - 8 - h + "px";
        }
    }

    function enhanceColorInputs() {
        document.querySelectorAll('input[type="color"]').forEach(enhanceColorInput);
    }

    // ---------------------------------------------------------------------
    // Boot
    // ---------------------------------------------------------------------

    function bootUI() {
        readPaddingInputs();
        commit();
        updateHistoryButtons();
        render();
        syncUI();
    }

    function init() {
        bindEvents();
        enhanceRanges();
        enhanceNumberInputs();
        enhanceSelects();
        enhanceColorInputs();
        createRichTextInput(textContent);
        document.addEventListener("click", function (e) {
            const t = e.target;
            if (!t || !t.closest) {
                closeAllDropdowns();
                closeAllColorPickers();
                return;
            }
            if (!t.closest(".dropdown")) closeAllDropdowns();
            if (!t.closest(".color-field")) closeAllColorPickers();
        });
        // Close popovers on scroll, but never when the scroll happens inside a
        // popover itself (that would make the dropdown impossible to scroll).
        window.addEventListener(
            "scroll",
            function (e) {
                const t = e.target;
                if (t && t.closest && (t.closest(".dropdown-menu") || t.closest(".color-popover"))) {
                    return;
                }
                closeAllDropdowns();
                closeAllColorPickers();
            },
            true
        );
        window.addEventListener("resize", function () {
            customSelects.forEach(function (state) {
                if (state.wrap.classList.contains("open") && state.position) state.position();
            });
            customColors.forEach(function (state) {
                if (state.field.classList.contains("open")) positionColorPopover(state);
            });
        });
        // Flush any pending preference write when the window is closing.
        window.addEventListener("beforeunload", function () {
            if (persistTimer) {
                clearTimeout(persistTimer);
                persistTimer = null;
            }
            if (preferencesLoaded) persistPreferencesNow();
        });
        setActiveTool("select");

        // Restore saved preferences before drawing anything, so the first
        // frame already reflects the user's previous choices.
        loadPreferences()
            .then(function (prefs) {
                applyPreferences(prefs);
                renderPresetOptions();
                applyPreferenceUI();
                restoreLogo();
                preferencesLoaded = true;
                bootUI();
                // Make sure the config file exists from the first launch.
                persistPreferencesNow();
            })
            .catch(function () {
                preferencesLoaded = true;
                bootUI();
            })
            .then(function () {
                // Everything stays locked until a project is started.
                if (!state.started) setAppLocked(true);
                initFonts();
                if (document.fonts && document.fonts.ready) {
                    document.fonts.ready.then(function () {
                        render();
                    });
                }
            });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
