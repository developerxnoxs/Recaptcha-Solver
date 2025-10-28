# reCAPTCHA v2 AI Solver - CLI Tool & API

## Overview

This is a command-line tool and API service that automatically solves reCAPTCHA v2 challenges using Google's Gemini AI for visual recognition. The tool can operate in two modes:

1. **CLI Mode**: Command-line interface for direct solving with real-time monitoring
2. **API Mode**: HTTP REST API server for programmatic access

The system uses browser automation to interact with reCAPTCHA challenges, captures screenshots at various stages, and employs AI to identify and select correct challenge images. In non-headless mode, users can watch the solving process in real-time.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Browser Automation Layer

**Problem**: Need to interact with reCAPTCHA challenges in a way that mimics human behavior and avoids detection.

**Solution**: Uses Puppeteer Extra with Stealth Plugin to launch and control a Chromium browser instance.

**Design Decisions**:
- **Stealth Plugin**: Masks automation signals that reCAPTCHA uses to detect bots. This includes hiding WebDriver properties and other automation indicators.
- **Non-headless Mode by Default**: Browser is visible to allow users to monitor the solving process in real-time ("watch relay" feature).
- **System Chromium Preference**: Attempts to use system-installed Chromium first before falling back to bundled version for better compatibility.
- **Single Process Mode**: Reduces resource usage and potential detection vectors.

**Browser Configuration**:
- Disables automation flags
- Enables WebGL for proper reCAPTCHA rendering
- Sets English language to ensure consistent challenge text
- Uses large viewport (1920x1080) for better image capture

### AI Vision Processing

**Problem**: Need to identify and select correct images from reCAPTCHA visual challenges (e.g., "Select all images with traffic lights").

**Solution**: Integrates Google Gemini AI for visual recognition of challenge images.

**Design Decisions**:
- Uses `@google/genai` SDK for accessing Gemini's vision capabilities
- API key configured via environment variable (`GEMINI_API_KEY`)
- Processes challenge images to determine which tiles match the requested object

### Challenge Detection & Monitoring

**Problem**: Need to detect when reCAPTCHA challenges appear, change, or complete, without constant polling that could trigger detection.

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

**Recent Changes** (October 28, 2025):
- **API Mode Added**: New `--api` flag to run as HTTP REST API server
  - Listens on port 5000 with CORS enabled
  - POST /solve endpoint accepts `sitekey` and `pageurl` parameters
  - Automatically uses inject mode and non-headless for API requests
  - Returns JSON response with token, duration, and status
  - Created "API Server" workflow for easy testing
- Added `--mode` option with two modes: `normal` (default) and `inject`
  - Normal mode: Solves reCAPTCHA on the existing page without modification
  - Inject mode: Replaces page content with clean reCAPTCHA widget
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