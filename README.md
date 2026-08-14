# Project XIX — Virtual Estate Experience

**Developer:** Mixta Africa  
**Site:** Lakowe, Ibeju-Lekki, Lagos State  
**Deployed:** GitHub Pages (zero-cost static hosting)

---

## Architecture

Modular ES module codebase — no build step, no bundler required.

```
index.html          ← Single-page app: landing + masterplan + 3D overlay
css/styles.css      ← Full design system (tokens, layout, components)
js/
  data.js           ← All estate data: zones, viewpoints, unit schedule
  scene.js          ← Three.js 3D scene: all geometry, materials, lighting
  controls.js       ← Free-walk, pointer lock, touch joystick, WebXR VR
  ui.js             ← Minimap, loading, viewpoint strip, audio, zone panel
  app.js            ← Orchestration: boot, cinematic intro, 3D entry, nav
assets/
  plan-2d.png       ← Masterplan (used as clickable hotspot layer + minimap)
  clubhouse.png     ← Clubhouse render
  villa-3-bedroom.png
  loft-terrace.png
  apartment-block.png
  horse-stables.png
```

## Estate Orientation (confirmed)
- Polo field long axis = **East–West** (horizontal)
- Lake = **North** of field
- Clubhouse = **South** of field
- Training Field = **South-west**
- Stables = **South-west** equestrian compound
- Origin (0,0,0) = centre of polo field
- North = −Z, South = +Z, East = +X, West = −X

## GitHub Pages Deployment

1. Create a new GitHub repository (public or private with Pages enabled)
2. Copy the entire contents of this folder to the repository root
3. Push to `main` branch
4. Go to **Settings → Pages → Source: Deploy from branch → main → / (root)**
5. GitHub Pages will deploy automatically. No npm, no build step.

## Device Support
- **Desktop:** Mouse drag to look, WASD / arrow keys to walk, Shift to sprint
- **Mobile:** Left-half joystick to move, right-half drag to look, gyroscope auto-detected
- **Tablet:** Same as mobile
- **WebXR VR (Quest/Oculus):** Click VR button in world topbar (shown automatically when WebXR is available)

## Adding Future Assets

### Phase 2 — Building interiors
Add new viewpoints to `js/data.js` (VIEWPOINTS object) and new geometry functions to `js/scene.js`.

### Phase 3 — GLB/GLTF models
Replace procedural box geometry with `THREE.GLTFLoader`. Import pattern in `scene.js`:
```js
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
```

### Updating zone copy
All zone text lives in `js/data.js` — `ZONES` object. Edit descriptions there; no HTML changes required.

### Adding a new 3D zone (e.g. villa interior)
1. Add a viewpoint to `VIEWPOINTS` in `data.js`
2. Add geometry to `scene.js`
3. Add the zone's building card to `ZONES` in `data.js`
4. The viewpoint strip and masterplan hotspot update automatically

## Contacts
- **Products & Strategy:** Timi Olasunkanmi — o.olasunkanmi@mixtafrica.com
- **Project XIX:** Mixta Africa — Lakowe, Ibeju-Lekki, Lagos State
