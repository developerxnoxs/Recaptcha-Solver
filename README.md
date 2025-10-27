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

### 1. Start Server (Terminal 1)

Server diperlukan untuk serve fakepage.html yang akan load reCAPTCHA:

```bash
npm run server
```

Server akan running di `http://localhost:8000`

### 2. Run CLI Tool (Terminal 2)

Jalankan CLI tool dengan sitekey dan domain:

```bash
node index.js --sitekey YOUR_SITEKEY
```

#### Options:

- `-s, --sitekey <sitekey>` - **Required** - reCAPTCHA site key
- `-d, --domain <domain>` - Domain untuk testing (default: localhost)
- `-p, --port <port>` - Port untuk fakepage server (default: 8000)
- `--headless` - Run browser dalam headless mode (default: false)
- `--debug` - Enable debug logging

#### Contoh Penggunaan:

```bash
# Menggunakan Google demo sitekey
node index.js --sitekey 6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-

# Dengan custom domain dan port
node index.js --sitekey YOUR_SITEKEY --domain example.com --port 3000

# Dengan debug mode
node index.js --sitekey YOUR_SITEKEY --debug
```

## 📸 Screenshots

Screenshots akan otomatis tersimpan di folder `screenshots/` dengan format:
- `challenge_<timestamp>.png` - Screenshot dari setiap challenge yang dianalisis

## 🎯 Cara Kerja

1. **Server Start** - HTTP server menyediakan fakepage.html
2. **Browser Launch** - Puppeteer membuka browser (non-headless untuk monitoring)
3. **Load reCAPTCHA** - Fakepage load reCAPTCHA dengan sitekey yang diberikan
4. **Checkbox Click** - Tool mengklik checkbox reCAPTCHA
5. **Challenge Detection** - CaptchaWatcher mendeteksi challenge yang muncul
6. **AI Analysis** - Gemini menganalisis gambar dan menentukan tiles yang harus diklik
7. **Tile Clicking** - Tool mengklik tiles yang diidentifikasi oleh AI
8. **Verification** - Mengklik tombol verify
9. **Token Extraction** - Token berhasil didapatkan!

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
├── server.js               # HTTP server untuk fakepage
├── fakepage.html          # Template HTML untuk load reCAPTCHA
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

### "Cannot connect to server"
Pastikan server running di terminal lain:
```bash
npm run server
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
