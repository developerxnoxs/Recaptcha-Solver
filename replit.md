# hCaptcha AI Solver - CLI Tool & API

## Overview

This is a command-line tool and API service that automatically solves hCaptcha challenges using Google's Gemini AI for visual recognition. The tool can operate in two modes:

1. **CLI Mode**: Command-line interface for direct solving with real-time monitoring
2. **API Mode**: HTTP REST API server for programmatic access

The system uses browser automation to interact with hCaptcha challenges, captures screenshots at various stages, and employs AI to identify and select correct challenge images. In non-headless mode, users can watch the solving process in real-time.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Browser Automation Layer

**Problem**: Need to interact with hCaptcha challenges in a way that mimics human behavior and avoids detection.

**Solution**: Uses Puppeteer Extra with Stealth Plugin to launch and control a Chromium browser instance.

**Design Decisions**:
- **Stealth Plugin**: Masks automation signals that hCaptcha uses to detect bots. This includes hiding WebDriver properties and other automation indicators.
- **Non-headless Mode by Default**: Browser is visible to allow users to monitor the solving process in real-time ("watch relay" feature).
- **System Chromium Preference**: Attempts to use system-installed Chromium first before falling back to bundled version for better compatibility.
- **Single Process Mode**: Reduces resource usage and potential detection vectors.

**Browser Configuration**:
- Disables automation flags
- Enables WebGL for proper hCaptcha rendering
- Sets English language to ensure consistent challenge text
- Uses large viewport (1920x1080) for better image capture

### AI Vision Processing

**Problem**: Need to identify and select correct images from hCaptcha visual challenges (e.g., "Select all images with traffic lights").

**Solution**: Integrates Google Gemini AI for visual recognition of challenge images.

**Design Decisions**:
- Uses `@google/genai` SDK for accessing Gemini's vision capabilities
- API key configured via environment variable (`GEMINI_API_KEY`)
- Processes challenge images to determine which tiles match the requested object

### Challenge Detection & Monitoring

**Problem**: Need to detect when hCaptcha challenges appear, change, or complete, without constant polling that could trigger detection.

**Solution**: Implements a CaptchaWatcher class that monitors the page state through timed polling with callbacks.

**Architecture**:
- **Event-driven Design**: Uses callback pattern for different challenge states (onChallengeOpen, onCaptchaReady, onChallengeChange, onTilesReady, onTokenFound)
- **State Tracking**: Maintains current state of challenge frames, images, and text to detect changes
- **Frame Management**: Tracks both the main captcha frame and challenge frame separately for proper interaction

**Polling Strategy**: Uses separate polling loops for different aspects:
- Captcha checkbox ready state
- Challenge frame appearance
- Token generation completion

### Results Tracking & Analytics

**Problem**: Users need visibility into solver performance and success rates over time.

**Solution**: ResultTracker class that maintains statistics on solving attempts.

**Features**:
- Tracks success/failure of each attempt with timestamps
- Calculates success rate percentage
- Computes average time per successful token
- Maintains sliding window of last 500 results to prevent memory growth
- Provides real-time statistics display

### Logging System

**Problem**: Need configurable logging for debugging and monitoring without cluttering output.

**Solution**: Winston-based logging with multiple levels and formatted output.

**Design Decisions**:
- Timestamp and colorized output for readability
- Configurable log levels (info/debug) via CLI flag
- Centralized logger creation allows consistent formatting across modules

### CLI Interface

**Problem**: Tool needs to be easy to use from command line with proper validation and help.

**Solution**: Commander.js-based CLI with required and optional parameters.

**CLI Parameters**:
- `--sitekey`: The reCAPTCHA site key to solve (required in CLI mode)
- `--url`: Target domain where the captcha should be solved (required in CLI mode)
- `--mode`: Operation mode (default: `normal`) - determines how the page is prepared
  - `normal`: Visits the domain and solves the existing reCAPTCHA on the page
  - `inject`: Clears the original page content and injects a fake page with only reCAPTCHA widget
- `--screenshot`: Enable screenshot capture (default: `false`) - when enabled, saves all challenge screenshots to disk
- `--headless`: Allows running in headless mode when monitoring isn't needed
- `--debug`: Enables verbose logging for troubleshooting
- `--api`: Run as API server on port 5000 (overrides all other options)

### API Server

**Problem**: Need programmatic access to CAPTCHA solving for integration with other applications.

**Solution**: Express.js-based REST API server with JSON request/response format.

**API Configuration**:
- **Port**: 5000 (default, configurable via PORT environment variable)
- **Mode**: Automatically uses inject mode and non-headless for all API requests
- **CORS**: Enabled for cross-origin requests

**Endpoints**:

1. **GET /** - API information and health check
   - Returns server status, version, and available endpoints
   
2. **POST /solve** - Solve reCAPTCHA challenge
   - **Request Body**:
     ```json
     {
       "sitekey": "6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-",
       "pageurl": "https://www.google.com/recaptcha/api2/demo"
     }
     ```
   - **Success Response (200)**:
     ```json
     {
       "success": true,
       "token": "03AGdBq24PBCbwiDRaS9a...",
       "duration": 12.45,
       "sitekey": "6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-",
       "pageurl": "https://www.google.com/recaptcha/api2/demo"
     }
     ```
   - **Error Response (400/500)**:
     ```json
     {
       "success": false,
       "error": "Error type",
       "message": "Detailed error message"
     }
     ```

**API Usage Example**:
```bash
# Start API server
node index.js --api

# Make a solve request
curl -X POST http://localhost:5000/solve \
  -H "Content-Type: application/json" \
  -d '{
    "sitekey": "6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-",
    "pageurl": "https://www.google.com/recaptcha/api2/demo"
  }'
```

**Recent Changes** (November 3, 2025):
- **MAJOR IMPROVEMENT: Virtual Cursor Movement Logic** ⭐:
  - **Problem**: Virtual cursor tidak benar-benar bergerak sesuai koordinat yang ditentukan Gemini
    - Bounding box: Menggunakan cursor.moveTo() tapi klik dengan page.mouse.down/up langsung
    - Jigsaw/Slider: Hanya cursor.moveTo() ke awal, drag menggunakan page.mouse.move() langsung
    - Multiple choice: Tidak ada cursor movement sama sekali, langsung JavaScript click
  - **Solution**: Implementasi ghost-cursor penuh untuk semua operasi
    - **Bounding Box**: Sekarang menggunakan `cursor.click()` setelah moveTo untuk klik yang lebih natural
    - **Jigsaw/Slider**: Menggunakan `cursor.moveTo()` untuk SETIAP langkah dalam drag operation (20-35 steps)
      - Cursor sekarang benar-benar terlihat bergerak smooth dari start ke target position
      - Setiap langkah menggunakan ghost-cursor dengan bezier curves
      - Progress logging setiap 5 steps untuk monitoring
    - **Multiple Choice**: Menambahkan cursor movement ke posisi button sebelum klik
      - Mengambil koordinat center dari button element
      - Menggunakan cursor.moveTo() dengan hesitate dan moveDelay untuk natural movement
      - Menggunakan cursor.click() untuk klik yang realistic
  - **Benefits**:
    - ✅ Cursor movements terlihat 100% natural dan human-like
    - ✅ Drag operations smooth dengan bezier curve paths
    - ✅ Koordinat dari Gemini AI digunakan dengan presisi penuh
    - ✅ Mengurangi risiko deteksi bot karena gerakan lebih realistic
  - **Result**: Virtual cursor sekarang benar-benar bergerak sesuai koordinat yang ditentukan Gemini untuk semua jenis operasi (klik, drag & drop, multiple choice)

**Previous Changes** (November 2, 2025):
- **Enhanced Detection & Cursor Realism for Bounding Box and Jigsaw Challenges**:
  - **Bounding Box Multi-Target Detection Fix**:
    - Completely rewrote Gemini prompt to emphasize finding ALL matching objects
    - Added explicit step-by-step counting methodology: COUNT ALL → IDENTIFY MATCHES → DOUBLE-CHECK
    - Introduced mandatory object counting in response format (total_objects_seen, matching_objects_count)
    - Added comprehensive object recognition guide with visual differentiation tips
    - Enhanced warning system to prevent common mistakes (missing corners, stopping early, confusion between similar objects)
    - **Result**: Solver now correctly identifies and clicks ALL targets when multiple objects need to be marked (e.g., 2 cats, 3 cars)
  
  - **Jigsaw/Slider Drag Functionality Improvements**:
    - Improved drag movement with more realistic human-like behavior
    - Increased drag steps from 15-25 to 20-35 for smoother motion
    - Added micro-jitter every 3 steps to simulate natural hand tremor
    - Implemented mid-drag pause (50-100ms) for more realistic movement
    - Enhanced logging to show offset values and drag progress
    - Better error handling with bounding box validation
    - **Result**: Drag challenges now work correctly with realistic cursor movement that appears human
  
  - **Cursor Movement Realism Enhancements**:
    - Added ±3px random jitter to click positions for natural variation
    - Implemented explicit mouse down/up with 50-120ms hold time (realistic click duration)
    - Increased hesitate time to 75-225ms and move delay to 600-1600ms for more human-like cursor paths
    - Extended delays between clicks from 400-800ms to 500-1000ms
    - All movements now use ghost-cursor for bezier curve paths
    - **Result**: Cursor movements now appear more realistic and human-like, reducing detection risk

- **Major Accuracy Improvements for All Challenge Types** (Previous Update):
  - **Jigsaw/Slider Solver Enhancements**:
    - Completely rewritten Gemini prompts with ultra-precise analysis instructions
    - Added step-by-step coordinate measurement methodology
    - Implemented multi-attempt retry logic (up to 2 attempts with adjustments)
    - Enhanced drag movement with smooth multi-step transitions (15-25 steps)
    - Added post-solution validation to verify puzzle was solved
    - Optimized Gemini parameters (temperature: 0.05, topP: 0.9, topK: 20)
  - **Multiple Choice Solver Enhancements**:
    - Comprehensive visual analysis framework with 5-step systematic evaluation
    - Added detailed object/scene/action recognition guidelines
    - Included distinction guides for common confusions (cat vs dog, car vs truck, etc.)
    - Enhanced elimination process with scoring system
    - Better confidence assessment and decision strategy
    - Optimized Gemini parameters for more accurate predictions
  - **Bounding Box Solver Enhancements**:
    - Complete object inventory system with grid-based scanning (3x3 sections)
    - Precise coordinate calculation method with boundary identification
    - Better task type classification (find all, find different, find largest)
    - Comprehensive object recognition reference library
    - Enhanced verification checklist with 6-point validation
    - Increased maxOutputTokens to 1536 for detailed responses
  - **Grid Solver Improvements**:
    - Optimized Gemini parameters across all grid challenges
    - Temperature reduced from 0.1 to 0.05 for more consistent results
    - Increased maxOutputTokens to 2048 for better analysis
  - **Result**: Dramatically improved accuracy for jigsaw, multiple choice, and bounding box challenges through better AI prompts, retry logic, and validation

- **Critical Bug Fixes for Multi-Challenge Support** (October 28, 2025):
  - Fixed null pointer exception in `captcha-watcher.js` (line 268): Added null check for `table` element before accessing `className` property
    - Issue: Non-grid challenges (BOUNDING_BOX, JIGSAW, etc.) don't have table element, causing crash
    - Solution: Changed `gridType: table.className` to `gridType: table ? table.className : 'unknown'`
  - Fixed challenge type routing in `captcha-solver.js` verifyChallenge function:
    - Issue: After verification, new challenges were always processed with grid solver regardless of actual type
    - Solution: Added automatic challenge type detection for new challenges and proper routing to appropriate solver (BOUNDING_BOX, JIGSAW_SLIDER, MULTIPLE_CHOICE, or GRID)
  - **Result**: Solver now successfully handles multiple challenge iterations with different types (e.g., BOUNDING_BOX → DRAG → BOUNDING_BOX)

**Previous Changes** (October 28, 2025):
- **API Mode Added**: New `--api` flag to run as HTTP REST API server
  - Listens on port 5000 with CORS enabled
  - POST /solve endpoint accepts `sitekey` and `pageurl` parameters
  - Automatically uses inject mode and non-headless for API requests
  - Returns JSON response with token, duration, and status
  - Created "API Server" workflow for easy testing
- Added `--mode` option with two modes: `normal` (default) and `inject`
  - Normal mode: Solves hCaptcha on the existing page without modification
  - Inject mode: Replaces page content with clean hCaptcha widget
- Added `--screenshot` option (default: false) for optional screenshot capture
  - When disabled (default): Screenshots taken for AI analysis are automatically deleted after processing
  - When enabled: All screenshots saved to `screenshots/` folder for debugging and documentation
- Created separate workflows with VNC GUI for visual monitoring of both modes
- Updated documentation with comprehensive API usage guide and examples

### Screenshot Management

**Problem**: Need to capture visual evidence of solving process for debugging and verification.

**Solution**: Automatic screenshot capture at key stages, stored in organized directory structure.

**Location**: Screenshots saved to `./screenshots` directory relative to project root

## External Dependencies

### AI/ML Services
- **Google Gemini AI**: Vision API for image recognition in reCAPTCHA challenges. Requires API key via `GEMINI_API_KEY` environment variable. Accessed through `@google/genai` SDK (v1.27.0).

### Browser Automation
- **Puppeteer** (v24.26.1): Core browser automation library
- **Puppeteer Extra** (v3.3.6): Plugin framework for Puppeteer
- **Puppeteer Stealth Plugin** (v2.11.2): Evasion of automation detection

### CLI & Utilities
- **Commander** (v14.0.2): CLI argument parsing and command structure
- **Winston** (v3.18.3): Structured logging with multiple transports and formatting

### Runtime Requirements
- **Node.js**: v16 or newer required
- **Chromium Browser**: Either system-installed or bundled with Puppeteer
- **File System Access**: For screenshot storage and reading

### Environment Variables
- `GEMINI_API_KEY`: Required for AI image recognition functionality