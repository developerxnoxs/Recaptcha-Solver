console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║        🤖 reCAPTCHA v2 AI Solver - CLI Tool                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

This is a CLI tool to solve reCAPTCHA v2 using AI.

📖 Usage:
   node index.js --sitekey <SITEKEY> --url <URL>

📋 Options:
   -s, --sitekey <sitekey>  reCAPTCHA site key (required)
   -u, --url <url>          Target URL (required)
   --headless               Run browser in headless mode
   --debug                  Enable debug logging

📝 Example:
   node index.js --sitekey 6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ- --url https://www.google.com/recaptcha/api2/demo

🔑 API Key: ${process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ Not set'}

💡 Cara Kerja:
   1. Navigasi ke domain target
   2. Hapus konten HTML asli
   3. Inject fake page dengan reCAPTCHA saja
   4. AI akan menyelesaikan challenge
   5. Token akan ditampilkan

⚠️  Note: Jalankan command di atas untuk memulai solving CAPTCHA
`);
