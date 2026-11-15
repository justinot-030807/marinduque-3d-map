# Marinduque 3D — Interactive Terrain & Travel Atlas

A mobile-first interactive 3D topographic and tourist guide map of **Marinduque, Philippines**, built as a pure static site with **Vite + Three.js + GSAP**.

The island's silhouette and relief come from real elevation data—30 stitched zoom-12 **AWS Terrain Tiles** (Mapzen Terrarium PNGs)—rather than traced shapes or synthetic noise.

## Features

- **Real 3D Terrain Mesh**: Displaced `512 × 512` mesh decoded from a 16-bit grayscale heightmap (`public/marinduque-heightmap.png`, peaking at 1,173 m around Mt. Malindig) with a live **1.0×–6.0× Relief Exaggeration** slider.
- **Animated Tropical Sea**: Custom WebGL water shader blending deep sapphire sea, shoreline coastal turquoise reef glow, wave ripples, Fresnel sky reflection, and distance horizon fog.
- **Surface-Projected Tourist Pins**: All spots convert `(lat, lon)` using the exact same Web Mercator bounds (`src/geo.js`) as the terrain generator and sit directly on the live exaggerated terrain elevation, with glowing gold markers for featured spots, screen-space overlap decluttering, and `>= 48 × 48 px` mobile tap targets.
- **Responsive Info Card**: Tapping any pin triggers a GSAP camera flight (`flyTo`) framed clear of an animated **bottom sheet** on mobile (with swipe-down to dismiss) or a **right-hand side panel** on desktop.
- **Top Picks Tour & Filters**: Category filter chips (`All`, `Beaches & Islands`, `Peaks & Nature`, `Heritage & Events`), toggleable municipality labels, an opening aerial sweep, and a guided **Top Picks Tour** across featured island gems.
- **Mobile Performance**: Pixel ratio capped at `2`, compressed local `.webp`/`.svg` imagery, and single-chunk Three.js/GSAP static build.

## Local Development

```bash
npm install
npm run dev
```

To regenerate `public/marinduque-heightmap.png` and `public/marinduque-terrain.json` from AWS Open Data Terrain Tiles (Python 3 + `numpy` + `Pillow` required):

```bash
npm run fetch-terrain
```

To create a production static bundle in `dist/`:

```bash
npm run build
npm run preview
```

## How to Add or Edit Tourist Spots

All tourist locations live in [`src/data/spots.json`](src/data/spots.json). To add a new place, append an object matching this schema:

```json
{
  "id": "unique-kebab-slug",
  "name": "Spot Display Name",
  "municipality": "Boac",
  "category": "Beaches & Islands",
  "lat": 13.44857,
  "lon": 121.84163,
  "featured": false,
  "description": "Short factual summary of the spot.",
  "howToGetThere": "Transport route from port or town proper.",
  "bestTime": "Recommended months, tides, or hours.",
  "photo": "./photos/your-spot-photo.webp",
  "photoCredit": "Optional photo attribution or license"
}
```

### Guidelines for Adding Spots

1. **Categories**: Use one of the existing filter categories (`"Beaches & Islands"`, `"Peaks & Nature"`, or `"Heritage & Events"`), or add a matching `<button class="filter-chip" data-filter="...">` inside `index.html`.
2. **Coordinates**: Provide standard WGS84 decimal degrees (`lat`, `lon`). Spots inside `[13.154°N..13.582°N, 121.776°E..122.215°E]` project automatically onto the exact 3D elevation surface via `src/geo.js`.
3. **Featured Spots**: Setting `"featured": true` gives the pin a warm gold glow and includes it in the **Top Picks Tour** sequence (ordered by appearance in `spots.json`).
4. **Event Pins**: Adding `"isEvent": true` renders an event emblem on the pin and labels its card badge as `Cultural Event`.
5. **Local Photos**: Drop crisp landscape images (`16:9`, e.g., `800×450`) into `public/photos/` and reference them with `./photos/<filename>` so the app works reliably with zero external hotlink breakage.
6. **Uncertain Details**: Prefix unverified GPS points, seasonal dates, or changing port/guide fees with `TODO:`—the UI highlights `TODO:` notes cleanly for easy verification.

## Deploying to Vercel or Netlify

Because this is a pure static Vite application with no backend or environment secrets:

### Vercel

1. Push your repository to GitHub, GitLab, or Bitbucket.
2. Import the repository in [Vercel](https://vercel.com/new).
3. Keep the auto-detected **Vite** preset settings:
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Click **Deploy**. Or deploy directly from CLI:
   ```bash
   npx vercel --prod
   ```

### Netlify

1. Push your repository or connect it in [Netlify](https://app.netlify.com/).
2. Configure build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
3. Deploy via the dashboard or CLI:
   ```bash
   npx netlify deploy --prod --dir=dist
   ```

## Data & Media Credits

- **Elevation Data**: [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen Terrarium format · SRTM / GMTED2010).
- **Photography**: Local curated spot photography sourced from Wikimedia Commons under Creative Commons Attribution-ShareAlike licenses (credited per destination inside `spots.json`), alongside bespoke vector/editorial coastal previews where field photos are still marked `TODO`.
