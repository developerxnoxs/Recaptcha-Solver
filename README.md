# 🤖 reCAPTCHA v2 AI Solver - CLI Tool

CLI tool untuk menyelesaikan reCAPTCHA v2 secara otomatis menggunakan Gemini AI dengan visual monitoring langsung.

## ✨ Fitur

- ✅ **CLI Interface** - Command-line tool yang mudah digunakan
- 🤖 **AI-Powered** - Menggunakan Google Gemini untuk visual recognition
- 👁️ **Non-Headless Mode** - Browser terbuka sehingga Anda bisa memantau prosesnya langsung (watch relay)
- 📸 **Auto Screenshots** - Menyimpan screenshot otomatis di setiap tahap
- 📊 **Live Stats** - Real-time monitoring status dan progress
- ✅ **Token Verification** - Memverifikasi token yang berhasil didapatkan

## 📋 Prerequisites

1. Node.js (v16 atau lebih baru)
2. Google Chrome/Chromium browser
3. Gemini API Key ([Dapatkan di sini](https://makersuite.google.com/app/apikey))

## 🚀 Installation

1. Clone atau download project ini
2. Install dependencies:
```bash
npm install
```

3. Set environment variable untuk Gemini API Key:
```bash
export GEMINI_API_KEY="your-gemini-api-key-here"
```

## 📖 Usage

### Run CLI Tool

Jalankan CLI tool dengan sitekey dan target URL. Tool ini akan:
1. Mengunjungi domain yang ditentukan
2. Menghapus konten HTML asli
3. Inject fake page dengan hanya reCAPTCHA saja

```bash
node index.js --sitekey YOUR_SITEKEY --url TARGET_URL
```

#### Options:

- `-s, --sitekey <sitekey>` - **Required** - reCAPTCHA site key
- `-u, --url <url>` - **Required** - Target URL (domain yang sebenarnya)
- `--headless` - Run browser dalam headless mode (default: false)
- `--debug` - Enable debug logging

#### Contoh Penggunaan:

```bash
# Menggunakan Google demo sitekey dengan demo page
node index.js --sitekey 6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ- --url https://www.google.com/recaptcha/api2/demo

# Dengan custom sitekey dan domain
node index.js --sitekey YOUR_SITEKEY --url https://example.com

# Dengan headless mode untuk production
node index.js --sitekey YOUR_SITEKEY --url https://example.com --headless

# Dengan debug mode untuk troubleshooting
node index.js --sitekey YOUR_SITEKEY --url https://example.com --debug
```

## 📸 Screenshots

Screenshots akan otomatis tersimpan di folder `screenshots/` dengan format:
- `challenge_<timestamp>.png` - Screenshot dari setiap challenge yang dianalisis

## 🎯 Cara Kerja

1. **Browser Launch** - Puppeteer membuka browser (non-headless untuk monitoring)
2. **Navigate to Target** - Browser membuka URL target yang sebenarnya
3. **Clear Original Content** - Menghapus semua konten HTML asli dari halaman
4. **Inject Fake Page** - Inject halaman baru dengan hanya reCAPTCHA widget
5. **reCAPTCHA Load** - reCAPTCHA widget di-render dengan sitekey pada domain target
6. **Checkbox Click** - Tool mengklik checkbox reCAPTCHA
7. **Challenge Detection** - CaptchaWatcher mendeteksi challenge yang muncul
8. **AI Analysis** - Gemini menganalisis gambar dan menentukan tiles yang harus diklik
9. **Tile Clicking** - Tool mengklik tiles yang diidentifikasi oleh AI
10. **Verification** - Mengklik tombol verify
11. **Token Extraction** - Token berhasil didapatkan!

## 📊 Output Example

```
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║        🤖 reCAPTCHA v2 AI Solver - CLI Tool                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

📋 Configuration:
   Sitekey: 6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-
   Domain: localhost
   Port: 8000
   Headless: false
   Screenshots: /path/to/screenshots

✓ Gemini API key loaded

🚀 Starting browser...
✓ Browser launched

🌐 Opening fakepage: http://localhost:8000/fakepage.html?sitekey=...

⏳ Loading page...
✓ Page loaded successfully

═══════════════════════════════════════════════════════════
🎯 Starting CAPTCHA solving process...
═══════════════════════════════════════════════════════════

✅ Captcha Ready
🖱️  Clicked reCAPTCHA checkbox
🎯 Challenge Detected: Select all images with traffic lights
📋 Dynamic: true
📸 Screenshot saved: screenshots/challenge_1234567890.png (1/4)
🔍 Analyzing: traffic lights
✓ Found 3 tiles to click: [1,2], [2,3], [3,1]
🖱️  Clicking tiles...
✓ Finished clicking tiles
✓ Clicked verify button
✅ Verification successful - token received

═══════════════════════════════════════════════════════════
🎉 SUCCESS! Token berhasil didapatkan

⏱️  Time taken: 15.32s

🎫 Token:
03AGdBq27x... [token lengkap]

✅ Token has been verified and is ready to use!
═══════════════════════════════════════════════════════════

📸 Screenshots tersimpan di: screenshots/
```

## 🛠️ Project Structure

```
.
├── index.js                 # CLI entry point
├── info.js                 # Usage information display
├── lib/
│   ├── captcha-solver.js  # Main solver logic
│   ├── captcha-watcher.js # Real-time monitoring
│   └── result-tracker.js  # Statistics tracking
├── utils/
│   └── logger.js         # Logging utility
└── screenshots/          # Auto-generated screenshots
```

## ⚙️ Configuration

### Environment Variables

- `GEMINI_API_KEY` - **Required** - Your Google Gemini API key

### Browser Settings

Tool menggunakan Puppeteer dengan stealth plugin untuk menghindari deteksi bot. Browser configuration:
- Non-headless mode (default) untuk visual monitoring
- Stealth plugin untuk bypass anti-bot detection
- Custom user agent

## 🔧 Troubleshooting

### "GEMINI_API_KEY not set"
Set environment variable:
```bash
export GEMINI_API_KEY="your-api-key"
```

### "Browser not found"
Install Google Chrome atau set executable path di `lib/captcha-solver.js`

## 📝 Notes

- Tool ini untuk **educational purposes** dan testing
- Success rate tergantung pada kompleksitas challenge
- Beberapa sitekey mungkin memiliki security lebih ketat
- Non-headless mode memungkinkan Anda memantau prosesnya secara real-time

## 📄 License

ISC

## 🤝 Contributing

Contributions welcome! Feel free to submit issues or pull requests.
