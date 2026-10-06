# Meme Editor — Implementation Plan

## 1. Goal

Build a modern, client-side meme editor using plain:

- HTML
- CSS
- JavaScript
- HTML5 Canvas APIs

No framework and no backend are required.

The application must allow a user to:

1. Drag/drop or paste an image into the editor.
2. Drag/drop or paste additional images that stack on top of the base image (for example, a logo).
3. Add and edit text.
4. Move text freely around the canvas to change its placement.
5. Add basic colored shapes.
6. Draw with a simple solid brush, including covering/removing parts of the image.
7. Sample colors from the canvas with an eyedropper.
8. Add white/black padding around the original image.
9. Use predefined meme padding presets.
10. Save and reuse text presets (font, max size, alignment, outline, colors).
11. Replace the base meme image while keeping logos, texts, shapes, and strokes in place.
12. Export the final composition as an image.

The editor should feel like a small, modern image editor rather than a form-based utility.

---

# 2. Technical Direction

## 2.1 Rendering

Use a single HTML5 `<canvas>` as the document renderer.

Do NOT create the final meme by stacking HTML elements over the image.

The application should maintain an internal document model and redraw the entire canvas whenever state changes.

Conceptually:

```text
User action
    ↓
Update document state
    ↓
Render document
    ↓
Canvas
```

This makes export, undo/redo, object manipulation, and resizing significantly easier.

## 2.2 No Backend

Everything must happen locally in the browser.

Do not upload images anywhere.

Do not add authentication.

Do not add analytics.

Do not add external APIs.

## 2.3 Dependencies

Prefer zero dependencies.

External libraries should NOT be introduced unless there is a strong technical reason and the dependency is genuinely necessary.

The default implementation should use browser APIs.

---

# 3. Suggested Project Structure

```text
meme-editor/
├── index.html
├── style.css
├── app.js
├── plan.md
└── assets/
    └── fonts/
        └── Zain-Bold.ttf
```

Keep the initial project simple.

Do not introduce a bundler, npm, TypeScript, React, Vue, or another framework unless explicitly requested.

---

# 4. Document Model

Create a central editor state.

A reasonable starting structure:

```js
const state = {
    // The replaceable meme photo. Kept separate from overlay objects so it can
    // be swapped while logos, texts, shapes, and strokes remain in place.
    baseImage: {
        source: null,
        width: 0,
        height: 0
    },

    padding: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
    },

    background: "#ffffff",

    // Overlays drawn on top of the base image. May include "image", "text",
    // "rect", "ellipse", and "brush" objects.
    objects: [],

    selectedObjectId: null,

    activeTool: "select",

    brush: {
        mode: "draw",       // "draw" | "cover"
        color: "#000000",
        size: 10
    },

    currentColor: "#000000",

    // Reusable text styles the user can save and re-apply.
    textPresets: []
};
```

Image objects are stored in `objects` so additional dropped images stack above
the base image and participate in normal selection, ordering, and deletion.

Objects should have stable IDs.

Example text object:

```js
{
    id: "...",
    type: "text",

    x: 500,
    y: 100,

    text: "Example",

    fontFamily: "Zain Bold",
    fontSize: 64,

    color: "#ffffff",

    outlineColor: "#000000",
    outlineWidth: 4,

    align: "center"
}
```

Example text preset (saved and reusable):

```js
{
    id: "...",
    name: "Preset 1",

    fontFamily: "Zain Bold",
    maxFontSize: 24,     // cap used when auto-fitting text

    align: "center",

    color: "#ffffff",

    outlineColor: "#000000",
    outlineWidth: 4,
    outlineEnabled: true
}
```

Presets should be persisted (e.g. `localStorage`) so they survive reloads.

Example rectangle:

```js
{
    id: "...",
    type: "rect",

    x: 100,
    y: 100,
    width: 300,
    height: 150,

    fill: "#ff0000"
}
```

Example ellipse:

```js
{
    id: "...",
    type: "ellipse",

    x: 100,
    y: 100,
    width: 300,
    height: 150,

    fill: "#ff0000"
}
```

Example stacked image (e.g. a logo dropped on top of the base image):

```js
{
    id: "...",
    type: "image",

    source: <HTMLImageElement>,

    x: 100,
    y: 100,
    width: 200,
    height: 80,

    opacity: 1
}
```

Image objects can be dragged, resized, reordered, and deleted like any other
object. They must never replace or mutate the base image.

Brush strokes can be represented as point collections:

```js
{
    id: "...",
    type: "brush",

    points: [
        { x: 10, y: 20 },
        { x: 12, y: 22 }
    ],

    color: "#000000",
    size: 10
}
```

---

# 5. Coordinate System

The document should have a logical coordinate system based on the final exported canvas dimensions.

Do not base object positions on CSS pixels.

The canvas may be displayed smaller than its actual resolution.

Example:

```text
Document: 1920 × 1280

Browser display:
960 × 640

Scale factor:
0.5
```

Mouse coordinates must be converted from screen coordinates into document coordinates.

Use:

```js
const scaleX = canvas.width / rect.width;
const scaleY = canvas.height / rect.height;
```

and transform pointer coordinates accordingly.

This is important for accurate text/object placement and export.

---

# 6. Image Input

Support all of the following:

## 6.1 Drag and Drop

Dragging an image file over the application should show a visual drop state.

Dropping the image loads it into the editor.

Only image files should be accepted.

## 6.2 Clipboard Paste

If the clipboard contains an image:

```text
Ctrl+V
```

should load it.

Text paste must still work when the user is editing a text field.

Do not intercept normal text clipboard operations inside `<input>`, `<textarea>`, or content-editable controls.

## 6.3 Optional File Picker

Provide a normal "Open Image" button as a fallback.

## 6.4 Additional Images (Stacking)

The first image loaded becomes the base image.

Any image loaded afterwards (via drag/drop, paste, or file picker) must be added
as an `"image"` object that stacks on top of the base image.

Primary use case: dropping a logo onto the meme.

Rules:

- Additional images are added to `state.objects`, centered on the canvas by default.
- They can be moved, resized, reordered, and deleted like any other object.
- They must use the native image resolution as their initial size.
- Loading an additional image must NOT change the canvas dimensions.
- Only changing the base image (section 21) may change canvas dimensions.

---

# 7. Image and Canvas Dimensions

When an image is loaded:

```text
final canvas width =
    image width
    + left padding
    + right padding

final canvas height =
    image height
    + top padding
    + bottom padding
```

Padding is relative to the original image dimensions.

For example:

```text
image = 1000 × 800

modern preset:
top    = 20% → 160px
left   = 5%  → 50px
right  = 5%  → 50px
bottom = 5%  → 40px

final canvas:
1100 × 1000
```

Round calculated pixel values to integers.

---

# 8. Padding Presets

Provide quick buttons.

## Classic Meme

```text
Top:    20%
Right:  0%
Bottom: 0%
Left:   0%
```

## Modern Meme

```text
Top:    20%
Right:  5%
Bottom: 5%
Left:   5%
```

These presets should replace the current padding values.

Also provide manual controls for:

- Top
- Right
- Bottom
- Left

The manual controls can initially use percentages.

The user must be able to set them back to zero.

---

# 9. Background

The padding area must use a selectable background color.

Initial options:

- White
- Black

UI can be two buttons/toggles:

```text
Background

[ White ] [ Black ]
```

The underlying state should still store an actual color string so custom colors can be supported later without rewriting the renderer.

---

# 10. Text Tool

Text is one of the primary editor features.

## 10.1 Creating Text

Clicking the Text tool and then clicking the canvas should create a new text object.

Immediately allow the user to type/edit the text.

Pasting text should work.

The default font must be:

```text
Zain Bold
```

Bundle the font locally if the font file is available.

Do not depend on an external font CDN.

Load the font using `@font-face`.

Example:

```css
@font-face {
    font-family: "Zain Bold";
    src: url("./assets/fonts/Zain-Bold.ttf") format("truetype");
}
```

The implementation should wait for `document.fonts.ready` / appropriate font loading before relying on accurate text measurements.

---

# 11. Text Controls

When a text object is selected, show controls for:

## Content

A textarea/input for the text.

## Font

At minimum:

```text
Zain Bold
```

The architecture should make adding additional fonts easy later.

## Font Size

Numeric input or slider.

Use document pixels, not CSS pixels.

## Alignment

Support:

- Left
- Center
- Right

Use Canvas `textAlign`.

## Text Color

Color picker.

## Outline Color

Color picker.

## Outline Width

Numeric input or slider.

The renderer should draw:

```js
strokeText(...)
fillText(...)
```

when an outline is enabled.

Do not make the outline mandatory.

## 11.1 Text Presets

The user edits many memes per day and repeatedly reuses the same text styling.
Provide named text presets.

A preset stores:

- Name (e.g. `Preset 1`)
- Font family (e.g. `Zain Bold`)
- Max font size (e.g. `24`)
- Alignment (e.g. `center`)
- Outline enabled
- Outline color
- Outline width
- Text color

Behavior:

- A "Save as preset" action captures the current selected text's styling.
- A preset list lets the user apply a preset to the selected text object.
- Applying a preset updates only text styling, not position or content.
- Presets can be renamed and deleted.
- Presets persist across reloads (e.g. `localStorage`).
- When creating new text, the most recently used preset may be applied by default.

---

# 12. Text Positioning

Selected text must be draggable.

The user should be able to:

1. Click/select text.
2. Drag it around the canvas.
3. Edit its properties.
4. Delete it.

Hit testing should use measured text bounds.

The text object's `x` coordinate should represent its alignment anchor.

For example:

```text
left:
x = left edge

center:
x = center

right:
x = right edge
```

This avoids inconsistent positioning when alignment changes.

---

# 13. Shapes

Provide a basic shape tool.

Minimum supported shapes:

- Rectangle
- Circle / ellipse

A shape should support:

- Position
- Size
- Fill color

The shape must be draggable after creation.

A selected shape should expose its color.

Do not implement complex vector editing in the first version.

---

# 14. Color Picker

Provide a standard HTML color input:

```html
<input type="color">
```

Use it for:

- Text color
- Outline color
- Shape fill
- Brush color
- Background/custom color

Keep a single reusable color-picker mechanism where practical.

---

# 15. Eyedropper / Probe

Implement an eyedropper tool.

When the tool is active:

1. User clicks the canvas.
2. Read the pixel color at that document coordinate.
3. Set the current color to the sampled RGB value.
4. Update the visible color picker.

Canvas API:

```js
ctx.getImageData(x, y, 1, 1)
```

Take device pixel ratio and canvas/document scaling into account.

Do not sample using CSS coordinates directly.

If supported by the browser, native `EyeDropper` may be considered as an enhancement, but the canvas sampler should remain available because it works specifically against the editor image.

---

# 16. Brush

Implement a freehand brush.

Behavior:

```text
pointerdown → start stroke
pointermove → append points
pointerup   → finish stroke
```

Properties:

- Mode (`draw` or `cover`)
- Color
- Brush size

Use rounded line caps and joins.

The brush should feel smooth.

Avoid creating a separate canvas permanently for every stroke.

Store strokes in the document model and render them during the normal render pass.

A later optimization can introduce a cached raster layer if performance becomes an issue.

## 16.1 Cover / Removal Mode

Besides drawing, the brush must be usable to remove parts of the image.

In `cover` mode the brush paints fully opaque, solid color over whatever is
beneath it. This lets the user "erase" unwanted details by covering them with a
matching solid color.

Requirements:

- The brush is a simple solid brush; no partial opacity or soft edges.
- The active color is used as the covering color (often the background color).
- Cover strokes are stored and rendered exactly like normal brush strokes.
- A quick way to reuse the current background color as the brush color is desirable.

---

# 17. Selection

Implement a simple selection system.

The Select tool should allow selecting:

- Text
- Shapes
- Image layers (e.g. logos) if practical
- Brush strokes if practical

For the first version, brush strokes may be treated as immutable after creation.

Selected objects should have a visible bounding box/outline.

The selection UI should make it obvious which object is active.

---

# 18. Object Ordering

Objects should be rendered in array order.

Later objects appear above earlier objects.

The base image is always drawn first, beneath every object, so image layers
(logos), text, shapes, and strokes stay above it.

For the first version, support at minimum:

- Delete selected object
- Bring forward
- Send backward

Keyboard shortcuts are desirable:

```text
Delete / Backspace → delete selected object
Ctrl+Z             → undo
Ctrl+Shift+Z       → redo
```

---

# 19. Undo / Redo

Implement a basic history system.

Every meaningful document mutation should create a history snapshot or reversible operation.

At minimum:

- Add object
- Delete object
- Move object
- Change text
- Change text properties
- Change shape properties
- Draw brush stroke
- Change padding
- Change background

Keyboard:

```text
Ctrl+Z
Ctrl+Shift+Z
```

Do not add history entries for every mousemove if that makes the history unusable.

A drag should ideally produce one history entry when the drag finishes.

---

# 20. Rendering Pipeline

Create one main render function:

```js
function render() {
    resizeCanvasIfNeeded();

    drawBackground();
    drawImage();
    drawObjects();
    drawSelection();
}
```

Conceptually:

```text
Background
    ↓
Padding
    ↓
Base Image
    ↓
Objects in z-order (image layers, text, shapes, brush)
    ↓
Selection UI
```

Selection UI must NOT be included in exported images.

Do not draw editor-only handles into the actual exported document.

---

# 21. Image Placement

The base image should remain at its native resolution.

For the initial version:

```text
image x = left padding
image y = top padding
image width = base image width
image height = base image height
```

Do not resize the base image unless explicitly necessary.

This ensures export quality remains tied to the source image.

Additional stacked images are positioned like normal objects and do not affect
the canvas dimensions.

## 21.1 Replacing the Base Image


A common workflow is editing many memes per day: the overlays (logos, texts,
shapes, strokes) should be reusable while the underlying meme photo changes.

Provide a "Replace Image" action that swaps `state.baseImage` and nothing else.

Requirements:

- Overlay objects (image layers, text, shapes, brush) remain in `state.objects`
  and stay on the canvas after the swap.
- The user can delete any remaining overlay individually at any time.
- The new base image is placed using the current padding, following the rules above.
- Canvas dimensions are recalculated from the new base image plus padding.
- The editor must not silently discard overlays when dimensions change.
- If the new base image produces different dimensions, overlays keep their
  document coordinates; optionally offer to keep them relative to the canvas.
- Replacing the base image is a single undoable history action.
- Dragging/dropping or pasting an image while a base image already exists adds a
  layer (section 6.4) rather than replacing the base; replacing is explicit.

---

# 22. Responsive UI

The application should work on desktop browsers first.

Minimum target:

```text
1280px+ desktop viewport
```

The editor layout should still behave reasonably on smaller screens.

Use CSS layout rather than hardcoded absolute positions for the application UI.

The canvas itself may scale visually to fit the available editor area.

Important:

```text
CSS canvas size != canvas internal resolution
```

Do not accidentally lower export resolution by changing the CSS width/height.

---

# 23. UI Layout

Suggested layout:

```text
┌──────────────────────────────────────────────────────────────────┐
│ Logo / Title             [Open] [Replace Image] [Save Image]      │
├──────────────┬────────────────────────────────┬──────────────────┤
│              │                                │                  │
│   Toolbar    │           Canvas               │ Properties       │
│              │                                │                  │
│ Select       │                                │ Text options     │
│ Text         │                                │  + Presets       │
│ Image (logo) │                                │                  │
│ Rectangle    │                                │ Image options    │
│ Ellipse      │                                │                  │
│ Brush        │                                │ Brush options    │
│  draw/cover  │                                │  draw / cover    │
│ Eyedropper   │                                │                  │
│              │                                │                  │
│ Padding      │                                │                  │
│ [Classic]    │                                │                  │
│ [Modern]     │                                │                  │
│              │                                │                  │
│ Background   │                                │                  │
│ White Black  │                                │                  │
└──────────────┴────────────────────────────────┴──────────────────┘
```

Do not overpopulate the UI.

Contextual properties should only appear when relevant.

---

# 24. Save Image

Provide a prominent:

```text
Save Image
```

button.

Export using:

```js
canvas.toBlob(...)
```

Prefer PNG.

The exported image must:

- Include the base image.
- Include stacked image layers (e.g. logos).
- Include padding.
- Include text.
- Include shapes.
- Include brush strokes (draw and cover).
- Include the selected background color.
- NOT include selection handles.
- NOT include editor UI.

Trigger a browser download.

Suggested filename:

```text
meme.png
```

---

# 25. Keyboard Shortcuts

Implement:

```text
Ctrl/Cmd + Z           Undo
Ctrl/Cmd + Shift + Z   Redo
Delete / Backspace     Delete selected object
Ctrl/Cmd + S           Save image
V                      Select tool
T                      Text tool
B                      Brush tool
R                      Rectangle tool
E                      Ellipse tool
I                      Eyedropper tool
```

Do not override browser shortcuts while typing inside a text input/textarea.

`Ctrl/Cmd + S` should save the image instead of opening the browser save page.

---

# 26. Drag and Drop UX

When an image is dragged over the application:

- Show a visible drop zone/state.
- Do not allow the browser to navigate away from the application.
- Prevent default browser drop behavior.

Invalid files should produce a small non-blocking error message.

Do not use alert dialogs for normal validation errors.

---

# 27. Error Handling

Handle:

- Unsupported file type
- Corrupt/unreadable image
- Empty clipboard
- Clipboard without an image
- Extremely large images where browser limitations may occur

Errors should be displayed in the UI.

Do not silently fail.

---

# 28. Performance Requirements

The editor should remain responsive for normal meme images.

Do not introduce unnecessary rendering loops.

Use:

```js
requestAnimationFrame
```

when appropriate for pointer-drag interactions.

Avoid repeatedly resizing the canvas during every pointer movement unless dimensions actually changed.

Do not repeatedly decode the source image.

Keep the base image (and each stacked image layer) as an `HTMLImageElement` / bitmap-like source and draw them during rendering.

---

# 29. Security / Privacy

All processing must remain local.

Do not:

- upload images
- send images to a server
- store images remotely
- use third-party image processing APIs

Local browser APIs are sufficient.

---

# 30. Implementation Milestones

Implement in this order.

## Milestone 1 — Application Shell

Tasks:

- Create `index.html`.
- Create `style.css`.
- Create `app.js`.
- Create the basic three-column editor layout.
- Add toolbar.
- Add canvas.
- Add properties panel.
- Add Save button.
- Make the UI visually polished.

Acceptance criteria:

- Page loads without errors.
- No framework/build step is required.
- Layout is usable at desktop resolution.

---

## Milestone 2 — Base Image Loading

Tasks:

- File picker.
- Drag/drop.
- Clipboard image paste.
- Image decoding.
- Canvas sizing.
- Correct base image placement.
- First loaded image becomes the base image.

Additional stacked images are introduced in Milestone 11.

Acceptance criteria:

- User can drag an image into the editor.
- User can paste an image.
- Image is displayed at native resolution.
- No image upload occurs.
- Save produces the same image when no edits are made.

---

## Milestone 3 — Padding

Tasks:

- White/black background.
- Four padding values.
- Classic preset.
- Modern preset.
- Recalculate canvas dimensions.
- Preserve image position.

Acceptance criteria:

Classic:

```text
top 20%
left 0%
right 0%
bottom 0%
```

Modern:

```text
top 20%
left 5%
right 5%
bottom 5%
```

Export must include the padding.

---

## Milestone 4 — Text

Tasks:

- Zain Bold font.
- Text creation.
- Text editing.
- Font size.
- Alignment.
- Text color.
- Outline color.
- Outline width.
- Dragging / repositioning text anywhere on the canvas.
- Selection.
- Delete.
- Text presets (save, apply, rename, delete, persist).

Acceptance criteria:

- User can create multiple text objects.
- Text can be moved freely to change its placement.
- Text remains correctly positioned after export.
- Outline renders correctly.
- Font measurement is accurate.
- A saved preset can be applied to another text object and reproduces its styling.

---

## Milestone 5 — Shapes

Tasks:

- Rectangle.
- Ellipse.
- Color.
- Creation.
- Selection.
- Dragging.
- Delete.

Acceptance criteria:

- Shapes render correctly.
- Shapes are included in export.
- Shapes can overlap the image and text.

---

## Milestone 6 — Brush

Tasks:

- Brush tool.
- Draw mode.
- Cover/removal mode (solid opaque paint).
- Color.
- Size.
- Pointer drawing.
- Stroke storage.
- Rendering.

Acceptance criteria:

- User can draw naturally.
- User can cover/remove unwanted parts with a solid color.
- Brush strokes appear in export.
- Brush color and size work correctly.
- Switch between draw and cover modes without losing stroke data.

---

## Milestone 7 — Eyedropper

Tasks:

- Canvas pixel sampling.
- Update current color.
- Apply sampled color to active color controls.

Acceptance criteria:

- Clicking a known pixel returns the expected approximate RGB value.
- Sampling works when the canvas is displayed at a different CSS size.

---

## Milestone 8 — Undo / Redo

Tasks:

- History stack.
- Redo stack.
- Keyboard shortcuts.
- Group drag operations into one history action.

Acceptance criteria:

- Undo reverses normal editing operations.
- Redo restores them.
- Typing into an input does not trigger editor shortcuts incorrectly.

---

## Milestone 9 — Export

Tasks:

- PNG export.
- `toBlob`.
- Download.
- Filename.
- Exclude selection UI.

Acceptance criteria:

- Exported image exactly represents the document.
- Export resolution equals the actual canvas resolution.
- No editor UI appears in the exported image.

---

## Milestone 10 — Polish

Tasks:

- Improve spacing.
- Improve typography.
- Hover states.
- Selected tool states.
- Empty-state UI.
- Drop-zone animation.
- Toast notifications.
- Loading states.
- Disable irrelevant controls.
- Keyboard shortcut hints.

Acceptance criteria:

- The application looks like a finished small product rather than a prototype.
- No console errors during normal usage.

---

## Milestone 11 — Layers, Presets & Base Image Swap

This milestone covers the high-throughput meme workflow: reusable overlays and
swappable photos.

Tasks:

- Stack additional dropped/pasted images as `"image"` objects (e.g. logos).
- Select, move, resize, reorder, and delete image layers.
- "Replace Image" action that swaps only the base image.
- Preserve all overlay objects when the base image changes.
- Recalculate canvas dimensions after swapping the base image.
- Persist and manage text presets (`localStorage`).
- Apply a preset to the selected text object.

Acceptance criteria:

- Dropping a logo over an existing meme stacks it instead of replacing the base.
- The logo can be moved and deleted.
- Replacing the base image keeps logos, texts, shapes, and strokes on the canvas.
- Overlays can still be deleted individually after a swap.
- Text presets survive a page reload.
- Export includes stacked image layers.

---

# 31. Testing Checklist

Manually test all of the following.

## Image

- [ ] Drag PNG
- [ ] Drag JPG/JPEG
- [ ] Paste image
- [ ] Open image with file picker
- [ ] Invalid file
- [ ] Large image
- [ ] Portrait image
- [ ] Landscape image
- [ ] Square image

## Image Layers

- [ ] Drop a second image stacks it above the base image
- [ ] Drop a logo onto an existing meme
- [ ] Pasted image becomes a layer
- [ ] Additional image does not change canvas dimensions
- [ ] Select a layer
- [ ] Move a layer
- [ ] Resize a layer
- [ ] Reorder layers
- [ ] Delete a layer
- [ ] Layers appear in export

## Base Image Swap

- [ ] Replace base image keeps logos
- [ ] Replace base image keeps texts
- [ ] Replace base image keeps shapes
- [ ] Replace base image keeps brush strokes
- [ ] Replace base image recalculates canvas dimensions
- [ ] Replace base image is undoable
- [ ] Delete remaining overlays after a swap

## Padding

- [ ] Zero padding
- [ ] Classic preset
- [ ] Modern preset
- [ ] Manual padding
- [ ] White background
- [ ] Black background

## Text

- [ ] Create text
- [ ] Edit text
- [ ] Paste text
- [ ] Zain Bold renders
- [ ] Change font size
- [ ] Left alignment
- [ ] Center alignment
- [ ] Right alignment
- [ ] Text color
- [ ] Outline color
- [ ] Outline width
- [ ] Move text
- [ ] Reposition text to a new placement
- [ ] Delete text
- [ ] Multiple text objects
- [ ] Save text preset
- [ ] Apply text preset to another text
- [ ] Rename text preset
- [ ] Delete text preset
- [ ] Presets persist after reload

## Shapes

- [ ] Rectangle
- [ ] Ellipse
- [ ] Change color
- [ ] Move
- [ ] Delete
- [ ] Multiple shapes

## Brush

- [ ] Draw
- [ ] Change color
- [ ] Change size
- [ ] Multiple strokes
- [ ] Export strokes
- [ ] Switch to cover mode
- [ ] Cover/remove part of the image with solid color
- [ ] Cover strokes appear in export

## Eyedropper

- [ ] Sample image color
- [ ] Sample padding color
- [ ] Sample drawn color
- [ ] Canvas displayed smaller than document

## History

- [ ] Undo text
- [ ] Redo text
- [ ] Undo movement
- [ ] Redo movement
- [ ] Undo shape
- [ ] Undo brush stroke

## Export

- [ ] PNG export
- [ ] Correct dimensions
- [ ] Correct padding
- [ ] Correct text
- [ ] Correct shapes
- [ ] Correct brush
- [ ] No selection UI

---

# 32. Code Quality Requirements

The implementation should remain understandable to a developer.

Prefer small modules/functions such as:

```js
loadImage()
resizeCanvas()
render()
renderImage()
renderText()
renderShape()
renderBrushStroke()
hitTestObject()
selectObject()
createText()
createShape()
deleteSelectedObject()
undo()
redo()
exportImage()
```

Avoid putting the entire application inside one enormous event handler.

Keep state changes explicit.

Avoid global mutable variables where practical.

Do not add abstractions simply for the sake of abstraction.

---

# 33. Important Agent Constraints

When implementing this project:

1. Do not change the product requirements without asking.
2. Do not introduce a framework.
3. Do not introduce a backend.
4. Do not upload user images.
5. Do not add unnecessary dependencies.
6. Do not replace Canvas with DOM-based image composition.
7. Do not lower the original image resolution for export.
8. Do not render selection handles into exported images.
9. Do not break clipboard text editing while implementing image paste.
10. Do not intercept keyboard shortcuts inside text inputs.
11. Keep the application runnable by simply opening `index.html`.
12. Prefer browser-native APIs.
13. Keep UI and document state separate.
14. Keep rendering deterministic from the document state.
15. Run basic manual/browser checks after each milestone.
16. Do not discard overlay objects when replacing the base image.
17. Do not mutate the base image when adding stacked image layers.
18. Do not silently drop or rewrite user text presets; persist them locally.

---

# 34. Definition of Done

The project is complete when a user can:

1. Open the HTML file.
2. Drag or paste a meme image.
3. Drag or paste additional images (e.g. a logo) that stack on top.
4. Choose Classic or Modern meme padding.
5. Choose white or black background.
6. Add Persian or English text using Zain Bold.
7. Change text size, alignment, color, outline color, and outline width.
8. Move text around the canvas to change its placement.
9. Save and re-apply text presets.
10. Add rectangles and circles.
11. Change their colors.
12. Draw with a brush.
13. Switch the brush to cover mode and remove unwanted parts with solid color.
14. Sample colors using the eyedropper.
15. Replace the base meme image while keeping logos, texts, shapes, and strokes.
16. Delete any overlay individually after replacing the base image.
17. Undo and redo edits.
18. Save the final result as a PNG.
19. Open the resulting PNG and see exactly the composition shown in the editor.

The application must work entirely offline after the project files and font are available.
