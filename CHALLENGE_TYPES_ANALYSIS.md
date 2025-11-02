# 🔍 Analisis Struktur Challenge hCaptcha

Berdasarkan debugging langsung pada halaman hCaptcha, ditemukan beberapa tipe challenge:

## 📊 Tipe-Tipe Challenge

### 1. **GRID_BASED** (Sudah Diimplementasi ✅)
**Deskripsi**: Challenge berupa grid 3x3 atau 4x4 gambar
- **Selector Utama**: `.task-image`, `.challenge-image`, `.image-task`
- **Container**: `.task-grid`, `.challenge-view`
- **Grid Size**: 9 tiles (3x3) atau 16 tiles (4x4)
- **Implementasi**: Sudah ada di `lib/captcha-solver.js`

**Struktur DOM**:
```html
<div class="challenge-view">
  <div class="task-grid">
    <div class="task-image">
      <img src="..." />
    </div>
    <!-- 8 atau 15 tiles lainnya -->
  </div>
</div>
```

---

### 2. **BOUNDING_BOX / ICON CLICK** (Terdeteksi ⚠️)
**Deskripsi**: Click pada icon/objek spesifik di canvas
- **Selector Utama**: `canvas` element
- **Ukuran Canvas**: 1000x860 pixels
- **Class Markers**: `bounding-box-example`, `challenge-view`
- **Prompt**: "Please click on the two icons that are different from the others"

**Struktur DOM**:
```html
<div class="challenge-view">
  <div class="challenge-prompt">
    <h2 class="prompt-text">Please click on...</h2>
  </div>
  <canvas width="1000" height="860"></canvas>
  <div class="button-submit button">Verify</div>
</div>
```

**Cara Kerja**:
1. Canvas menampilkan beberapa icon/objek
2. User harus klik pada koordinat X,Y di canvas
3. Tidak ada tiles individual, hanya 1 canvas besar

---

### 3. **JIGSAW_SLIDER / PUZZLE** (Belum Terdeteksi 🔍)
**Deskripsi**: Geser potongan puzzle ke tempatnya
- **Expected Selectors**:
  - `[draggable="true"]`
  - `[class*="slider"]`
  - `[class*="puzzle"]`
  - `[class*="piece"]`
  - `[role="slider"]`
  - `input[type="range"]`

**Expected Struktur**:
```html
<div class="puzzle-container">
  <div class="puzzle-piece" draggable="true" style="transform: translateX(...)">
    <img src="puzzle-piece.png" />
  </div>
  <div class="puzzle-target">
    <!-- target area -->
  </div>
</div>
```

---

## 🎯 Challenge Detection Strategy

```javascript
async function detectChallengeType(frame) {
    const analysis = await frame.evaluate(() => {
        // 1. Check for GRID_BASED
        const gridTiles = document.querySelectorAll('.task-image, .challenge-image');
        if (gridTiles.length > 0) {
            return {
                type: 'GRID_BASED',
                count: gridTiles.length,
                size: gridTiles.length === 9 ? '3x3' : '4x4'
            };
        }
        
        // 2. Check for JIGSAW_SLIDER
        const draggable = document.querySelector('[draggable="true"], [class*="slider"], [class*="puzzle"]');
        if (draggable) {
            return {
                type: 'JIGSAW_SLIDER',
                element: draggable.className
            };
        }
        
        // 3. Check for BOUNDING_BOX (canvas-based)
        const canvas = document.querySelector('canvas');
        if (canvas) {
            return {
                type: 'BOUNDING_BOX',
                width: canvas.width,
                height: canvas.height
            };
        }
        
        return { type: 'unknown' };
    });
    
    return analysis;
}
```

---

## 🧩 Implementation Priority

1. ✅ **GRID_BASED** - Sudah terimplementasi dengan baik
2. ⚠️ **BOUNDING_BOX** - Perlu implementasi baru (terdeteksi di production)
3. 🔍 **JIGSAW_SLIDER** - Perlu investigasi lebih lanjut (belum terdeteksi)

---

## 📝 Element Selectors Terverifikasi

### Common Elements (Semua Tipe):
- **Prompt Text**: `.prompt-text`, `.challenge-prompt`, `.task-prompt`
- **Verify Button**: `.button-submit`
- **Skip Button**: `.skip`
- **Container**: `.challenge-container`, `.challenge-view`

### Type-Specific:
- **Grid**: `.task-image`, `.task-grid`
- **Bounding Box**: `canvas`, `.bounding-box-example`
- **Jigsaw**: `[draggable="true"]`, `.puzzle-piece`, `.slider`

---

## 🎨 Canvas Challenge Specifics

Untuk BOUNDING_BOX type yang menggunakan canvas:

1. **Ambil Screenshot Canvas**
2. **Kirim ke Gemini dengan prompt**:
   ```
   "Analyze this image. Find and return the EXACT pixel coordinates (x, y) 
   of the objects that match: [prompt text]. 
   Canvas size is 1000x860 pixels.
   Return JSON: { "clicks": [{"x": 123, "y": 456}, ...] }"
   ```
3. **Click pada koordinat** yang dikembalikan Gemini
4. **Verify**

---

## 🔧 Recommended Implementation Approach

```javascript
async function solveCaptchaUniversal(page, apiKey) {
    const challengeType = await detectChallengeType(challengeFrame);
    
    switch(challengeType.type) {
        case 'GRID_BASED':
            return await solveGridChallenge(...);  // Already implemented
            
        case 'BOUNDING_BOX':
            return await solveBoundingBoxChallenge(...);  // NEW
            
        case 'JIGSAW_SLIDER':
            return await solveJigsawChallenge(...);  // NEW
            
        default:
            logger.warn('Unknown challenge type');
            return null;
    }
}
```
