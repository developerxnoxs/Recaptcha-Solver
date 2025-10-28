# 🤖 reCAPTCHA v2 AI Solver - CLI Tool

> 🚀 Solusi otomatis untuk menyelesaikan reCAPTCHA v2 menggunakan kekuatan AI!

CLI tool canggih yang menggunakan Google Gemini AI untuk menyelesaikan reCAPTCHA v2 secara otomatis. Anda bisa memantau seluruh proses secara real-time melalui browser yang terbuka atau VNC GUI.

---

## ✨ Fitur Unggulan

| Fitur | Deskripsi |
|-------|-----------|
| 🎯 **Dual Mode** | Pilih antara mode **normal** (langsung solve di halaman asli) atau **inject** (inject fake page) |
| 🤖 **AI-Powered** | Menggunakan Google Gemini 2.5 Flash untuk analisis visual yang akurat |
| 👁️ **Visual Monitoring** | Browser tampil (non-headless) sehingga Anda bisa menonton prosesnya secara langsung |
| 📸 **Screenshot Opsional** | Simpan screenshot otomatis di setiap tahap atau nonaktifkan untuk performa lebih cepat |
| 📊 **Live Statistics** | Tracking success rate, average time, dan total attempts secara real-time |
| ✅ **Auto Verification** | Token yang didapat otomatis diverifikasi dan siap pakai |
| 🎨 **User-Friendly CLI** | Interface bersih dengan progress indicator dan emoji yang informatif |
| ⚡ **Fast & Efficient** | Menggunakan Puppeteer Stealth untuk bypass detection |

## 📋 Prerequisites

Sebelum memulai, pastikan Anda sudah memiliki:

| Requirement | Version | Link |
|-------------|---------|------|
| 📦 **Node.js** | v16+ | [Download](https://nodejs.org/) |
| 🌐 **Chrome/Chromium** | Latest | [Download](https://www.google.com/chrome/) |
| 🔑 **Gemini API Key** | - | [Get Free Key](https://makersuite.google.com/app/apikey) |

> **💡 Tips**: API Key Gemini gratis dengan kuota yang cukup untuk testing!

---

## 🚀 Installation

### Step 1: Clone/Download Project
```bash
# Clone repository (jika ada)
git clone <repository-url>

# Atau download dan extract zip file
```

### Step 2: Install Dependencies
```bash
cd recaptcha-solver-cli
npm install
```

**Dependencies yang akan terinstall:**
- `@google/genai` - SDK untuk Gemini AI
- `puppeteer` - Browser automation
- `puppeteer-extra` + `puppeteer-extra-plugin-stealth` - Anti-detection
- `commander` - CLI framework
- `winston` - Logging system

### Step 3: Setup API Key

Ada 2 cara untuk set API key:

**Cara 1: Environment Variable (Recommended)**
```bash
# Linux/Mac
export GEMINI_API_KEY="your-api-key-here"

# Windows (PowerShell)
$env:GEMINI_API_KEY="your-api-key-here"

# Windows (CMD)
set GEMINI_API_KEY=your-api-key-here
```

**Cara 2: .env File (untuk Replit)**
File `.env` sudah otomatis tersedia di Replit Secrets.

### Step 4: Verify Installation
```bash
node index.js --help
```

Jika muncul help menu, berarti instalasi berhasil! ✅

---

## 📖 Usage Guide

### 🎯 Basic Command

```bash
node index.js --sitekey <SITEKEY> --url <URL>
```

### 📝 Parameter Lengkap

| Parameter | Alias | Type | Required | Default | Deskripsi |
|-----------|-------|------|----------|---------|-----------|
| `--sitekey` | `-s` | string | ✅ Yes | - | reCAPTCHA site key yang akan di-solve |
| `--url` | `-u` | string | ✅ Yes | - | Target URL domain (e.g., `https://example.com`) |
| `--mode` | `-m` | string | ❌ No | `normal` | Mode operasi: `normal` atau `inject` |
| `--screenshot` | - | boolean | ❌ No | `false` | Enable screenshot capture |
| `--headless` | - | boolean | ❌ No | `false` | Run browser tanpa tampilan GUI |
| `--debug` | - | boolean | ❌ No | `false` | Enable verbose logging |

---

### 🎭 Perbedaan Mode Normal vs Inject

#### 📌 Mode Normal (Default)
**Kapan digunakan:** Ketika halaman sudah memiliki reCAPTCHA dan Anda ingin solve di halaman aslinya.

**Cara kerja:**
1. ✅ Browser membuka URL target
2. ✅ Mendeteksi reCAPTCHA yang sudah ada di halaman
3. ✅ Langsung solve tanpa modifikasi halaman
4. ✅ Cocok untuk testing website yang sudah jadi

**Kelebihan:**
- Tidak merusak layout halaman asli
- Lebih natural dan sesuai kondisi real
- Cocok untuk testing integrasi reCAPTCHA

```bash
# Mode normal (default)
node index.js -s 6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ- -u https://www.google.com/recaptcha/api2/demo
```

#### 💉 Mode Inject
**Kapan digunakan:** Ketika Anda ingin testing reCAPTCHA di environment yang bersih tanpa gangguan elemen lain.

**Cara kerja:**
1. ✅ Browser membuka URL target (untuk domain verification)
2. ✅ Menghapus semua konten HTML asli
3. ✅ Inject halaman baru dengan hanya reCAPTCHA widget
4. ✅ Cocok untuk isolated testing

**Kelebihan:**
- Fokus hanya ke reCAPTCHA
- Tidak ada gangguan dari elemen lain
- Load time lebih cepat

```bash
# Mode inject
node index.js -s 6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ- -u https://www.google.com/recaptcha/api2/demo --mode inject
```

---

### 📸 Opsi Screenshot

Screenshot akan capture setiap challenge image yang dianalisis AI.

**Dengan Screenshot (untuk debugging/dokumentasi):**
```bash
node index.js -s YOUR_SITEKEY -u YOUR_URL --screenshot
```
- ✅ Semua screenshot disimpan di folder `screenshots/`
- ✅ Format: `challenge_<timestamp>.png`
- ✅ Berguna untuk debugging dan melihat apa yang AI lihat

**Tanpa Screenshot (untuk performa maksimal - DEFAULT):**
```bash
node index.js -s YOUR_SITEKEY -u YOUR_URL
```
- ⚡ Screenshot tetap diambil untuk AI, tapi langsung dihapus setelah analisis
- ⚡ Menghemat disk space
- ⚡ Performa lebih cepat

---

### 💡 Contoh Penggunaan Real

#### 🧪 Testing dengan Google Demo (Recommended untuk pemula)
```bash
# Basic - mode normal
node index.js \
  --sitekey 6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ- \
  --url https://www.google.com/recaptcha/api2/demo

# Mode inject dengan screenshot
node index.js \
  --sitekey 6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ- \
  --url https://www.google.com/recaptcha/api2/demo \
  --mode inject \
  --screenshot
```

#### 🌐 Production Website
```bash
# Normal mode untuk website real
node index.js \
  --sitekey YOUR_WEBSITE_SITEKEY \
  --url https://yourwebsite.com

# Dengan screenshot dan debug logging
node index.js \
  --sitekey YOUR_WEBSITE_SITEKEY \
  --url https://yourwebsite.com \
  --screenshot \
  --debug
```

#### 🤖 Headless Mode (untuk automation/server)
```bash
# Tanpa GUI browser
node index.js \
  --sitekey YOUR_SITEKEY \
  --url https://example.com \
  --headless

# Full automation: headless + no screenshot
node index.js \
  --sitekey YOUR_SITEKEY \
  --url https://example.com \
  --headless
```

#### 🔍 Debug Mode (untuk troubleshooting)
```bash
# Lihat detail log untuk debugging
node index.js \
  --sitekey YOUR_SITEKEY \
  --url https://example.com \
  --debug \
  --screenshot
```

---

## 🎯 Cara Kerja Sistem

Tool ini menggunakan pendekatan multi-layer untuk menyelesaikan reCAPTCHA dengan tingkat keberhasilan tinggi:

```
┌─────────────────────────────────────────────────────────┐
│  1. BROWSER LAUNCH                                      │
│  • Puppeteer + Stealth Plugin                          │
│  • Bypass automation detection                         │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  2. PAGE PREPARATION                                    │
│  • Mode Normal: Use existing reCAPTCHA                 │
│  • Mode Inject: Clean page + inject widget            │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  3. RECAPTCHA DETECTION                                 │
│  • Wait for reCAPTCHA iframe                           │
│  • Find checkbox element                               │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  4. CLICK CHECKBOX                                      │
│  • Human-like click with random delay                  │
│  • Monitor for challenge or instant token              │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  5. AI VISUAL ANALYSIS (jika ada challenge)            │
│  • Capture challenge image                             │
│  • Send to Gemini AI for analysis                     │
│  • Get tile coordinates to click                      │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  6. CLICK TILES                                         │
│  • Click identified tiles                              │
│  • Random delay between clicks                         │
│  • Handle dynamic challenges (new images)              │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  7. VERIFY & GET TOKEN                                  │
│  • Click verify button                                 │
│  • Extract token from response                         │
│  • Return success token                                │
└─────────────────────────────────────────────────────────┘
```

---

## 📊 Output Example

```
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║        🤖 reCAPTCHA v2 AI Solver - CLI Tool                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

📋 Configuration:
   Sitekey: 6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-
   Target URL: https://www.google.com/recaptcha/api2/demo
   Mode: normal
   Headless: false
   Screenshot: disabled
   
✓ Gemini API key loaded

🚀 Starting browser...
✓ Browser launched

🌐 Navigating to target URL: https://www.google.com/recaptcha/api2/demo
✓ Target page loaded
🔍 Mode normal: menggunakan reCAPTCHA yang ada di halaman...
⏳ Waiting for reCAPTCHA to render...
✓ reCAPTCHA rendered successfully

═══════════════════════════════════════════════════════════
🎯 Starting CAPTCHA solving process...
═══════════════════════════════════════════════════════════

✅ Captcha Ready
🖱️  Clicked reCAPTCHA checkbox
🎯 Challenge Detected: Select all images with traffic lights
📋 Dynamic: true
🔍 Analyzing: traffic lights
✓ Found 3 tiles to click: [1,2], [2,3], [3,1]
🖱️  Clicking tiles...
✓ Finished clicking tiles
🔍 Analyzing: traffic lights (new tiles loaded)
✓ Found 2 tiles to click: [1,1], [3,2]
🖱️  Clicking tiles...
✓ Finished clicking tiles
🔍 Analyzing: traffic lights
✓ Found 0 tiles to click
✓ No matching tiles found - proceeding to verify
✓ Clicked verify button
✅ Verification successful - token received
🎉 Challenge solved successfully!

═══════════════════════════════════════════════════════════
🎉 SUCCESS! Token berhasil didapatkan

⏱️  Time taken: 25.47s

🎫 Token:
03AGdBq27xKjEMd3XlK84SIo6L_K2p-xk7Tu-pUHNotM6JXmW2nurgR...

📊 Stats: Success Rate: 100.00% | Avg Time/Token: 25.47s | Total Attempts: 1 | Successful Tokens: 1

✅ Token has been verified and is ready to use!
═══════════════════════════════════════════════════════════

Press Ctrl+C to close browser and exit...
```

---

## 🛠️ Project Structure

```
recaptcha-solver-cli/
├── 📄 index.js                    # Entry point & CLI configuration
├── 📁 lib/
│   ├── captcha-solver.js         # Core solving logic + AI integration
│   ├── captcha-watcher.js        # Real-time reCAPTCHA monitoring
│   └── result-tracker.js         # Statistics & success tracking
├── 📁 utils/
│   └── logger.js                 # Winston-based logging system
├── 📁 screenshots/               # Auto-generated screenshots (optional)
├── 📄 package.json               # Dependencies & project metadata
└── 📄 README.md                  # This file
```

---

## 🔧 Troubleshooting

### ❌ Error: "GEMINI_API_KEY environment variable not set!"

**Penyebab:** API key belum dikonfigurasi

**Solusi:**
```bash
# Set environment variable
export GEMINI_API_KEY="your-api-key-here"

# Atau untuk Replit, tambahkan di Secrets
```

### ❌ Error: "Cannot find module 'puppeteer'"

**Penyebab:** Dependencies belum diinstall

**Solusi:**
```bash
npm install
```

### ❌ Error: "Browser not found"

**Penyebab:** Chromium tidak terinstall atau tidak ditemukan

**Solusi:**
```bash
# Install Chrome/Chromium di system Anda
# Atau install via npm (bundled version)
npx puppeteer browsers install chrome
```

### ❌ Challenge Failed After Multiple Attempts

**Penyebab:** AI kesulitan mengidentifikasi object di challenge

**Solusi:**
```bash
# Enable debug mode untuk lihat detail error
node index.js --sitekey YOUR_KEY --url YOUR_URL --debug --screenshot

# Check screenshot di folder screenshots/ untuk lihat apa yang AI lihat
```

### ⚠️ Token Berhasil Tapi Invalid

**Penyebab:** Token mungkin sudah expired atau sitekey tidak match

**Solusi:**
- Pastikan sitekey yang digunakan sesuai dengan domain
- Token reCAPTCHA biasanya valid beberapa menit saja
- Gunakan token segera setelah didapat

### 🐌 Proses Lambat

**Solusi untuk meningkatkan kecepatan:**
```bash
# Disable screenshot untuk performa lebih cepat
node index.js --sitekey KEY --url URL

# Gunakan headless mode
node index.js --sitekey KEY --url URL --headless
```

---

## 💡 Tips & Best Practices

### ✅ Untuk Mendapatkan Success Rate Tinggi:

1. **Gunakan Mode yang Tepat**
   - Mode **normal** untuk testing website real
   - Mode **inject** untuk isolated testing

2. **Monitor Process**
   - Jangan gunakan `--headless` saat development untuk monitor proses
   - Gunakan VNC GUI di Replit untuk visual monitoring

3. **Enable Screenshot untuk Debugging**
   ```bash
   node index.js -s KEY -u URL --screenshot --debug
   ```

4. **Testing Bertahap**
   - Start dengan Google demo sitekey dulu
   - Setelah berhasil, baru test dengan sitekey sendiri

### ⚡ Untuk Performa Maksimal:

1. **Production Mode**
   ```bash
   node index.js -s KEY -u URL --headless
   ```

2. **Disable Screenshot**
   - Screenshot tetap diambil untuk AI tapi langsung dihapus
   - Menghemat disk space dan sedikit lebih cepat

3. **Minimize Logging**
   - Jangan gunakan `--debug` di production

---

## 🎓 FAQ (Frequently Asked Questions)

### Q: Apakah tool ini legal?
**A:** Tool ini dibuat untuk **educational purposes** dan testing. Pastikan Anda menggunakannya sesuai dengan Terms of Service website yang bersangkutan.

### Q: Berapa success rate-nya?
**A:** Success rate bervariasi tergantung kompleksitas challenge, biasanya 70-90% untuk challenge standar.

### Q: Apakah bisa digunakan untuk automation?
**A:** Ya, gunakan mode `--headless` untuk automation tanpa GUI.

### Q: Kenapa kadang gagal?
**A:** Beberapa faktor:
- Challenge terlalu kompleks (object kecil/blur)
- Sitekey memiliki security lebih ketat
- Network latency tinggi
- AI salah mengidentifikasi object

### Q: Apakah perlu API key berbayar?
**A:** Tidak! Gemini API memiliki free tier yang cukup untuk testing dan development.

### Q: Bisa solve reCAPTCHA v3?
**A:** Tidak, tool ini khusus untuk reCAPTCHA v2 (yang ada checkbox & image challenge).

### Q: Screenshot disimpan dimana?
**A:** Di folder `screenshots/` relative terhadap lokasi script. Gunakan flag `--screenshot` untuk enable.

---

## ⚙️ Advanced Configuration

### Custom Browser Path

Edit `lib/captcha-solver.js` jika ingin menggunakan Chrome custom:
```javascript
const browser = await puppeteerExtra.launch({
    executablePath: '/path/to/your/chrome',
    // ...
});
```

### Adjust AI Prompt

Edit di `lib/captcha-solver.js` function `analyzeWithGemini()` untuk customize prompt yang dikirim ke AI.

### Timeout Configuration

Adjust timeout sesuai kebutuhan di `lib/captcha-watcher.js`:
```javascript
const timeout = 15000; // 15 seconds
```

---

## 📊 Statistics & Monitoring

Tool ini menyediakan real-time statistics:

- **Success Rate**: Persentase keberhasilan
- **Average Time**: Rata-rata waktu per token
- **Total Attempts**: Jumlah total percobaan
- **Successful Tokens**: Jumlah token berhasil didapat

Stats ditampilkan otomatis setelah selesai solving.

---

## 🎯 Use Cases

### 1. Development & Testing
Test integrasi reCAPTCHA di aplikasi Anda sebelum production.

### 2. QA Automation
Automated testing untuk flow yang memerlukan reCAPTCHA.

### 3. Research & Education
Pelajari cara kerja reCAPTCHA dan AI visual recognition.

### 4. Accessibility Testing
Test apakah reCAPTCHA di website Anda solve-able.

---

## 📝 Notes & Disclaimers

- ⚠️ Tool ini untuk **educational purposes** dan testing
- 📈 Success rate tergantung pada kompleksitas challenge
- 🔒 Beberapa sitekey mungkin memiliki security lebih ketat
- 👁️ Non-headless mode memungkinkan Anda memantau proses real-time
- 🚀 Gunakan secara bertanggung jawab dan ethical

---

## 📄 License

ISC License - Lihat file LICENSE untuk detail.

---

## 🤝 Contributing

Contributions welcome! Silakan:
1. Fork repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

---

## 🙏 Acknowledgments

- **Google Gemini AI** - For powerful vision recognition
- **Puppeteer Team** - For amazing browser automation
- **Puppeteer-Extra** - For stealth plugin
- **Community** - For feedback and contributions

---

<p align="center">
Made with ❤️ and ☕
</p>

<p align="center">
⭐ Star this repo if you find it helpful!
</p>
