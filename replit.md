# hCaptcha AI Solver - CLI Tool & API

## Overview
This project provides a command-line interface (CLI) tool and an API service designed to automatically solve hCaptcha challenges. It utilizes Google's Gemini AI for visual recognition and browser automation to interact with challenges. The tool supports both direct CLI usage for real-time solving and an HTTP REST API for programmatic integration, aiming to provide an efficient solution for bypassing hCaptcha challenges with minimal manual intervention. The core ambition is to offer a reliable, human-like automation solution for hCaptcha.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The system operates in a non-headless browser mode by default, allowing visual monitoring of the solving process. Logging is configurable with timestamped and colorized output for enhanced readability, and a `ResultTracker` provides real-time statistics on solver performance.

### Technical Implementations
- **Browser Automation**: Leverages Puppeteer Extra with a Stealth Plugin to control a Chromium browser, mimicking human behavior and evading detection. It prioritizes system Chromium and uses a single process.
- **AI Vision Processing**: Integrates Google Gemini AI (via `@google/genai` SDK) for visual recognition tasks within hCaptcha challenges, identifying and selecting correct elements based on prompts. This includes advanced spatial reasoning inspired by established methods.
- **Challenge Detection**: A `CaptchaWatcher` class monitors the page state for hCaptcha challenges, using an event-driven design with callbacks and precise iframe management. Keyword-based detection is used for identifying drag-type challenges.
- **Iframe Coordinate Handling**: All interaction operations properly account for iframe positioning and scroll offsets, ensuring pixel-perfect accuracy across all challenge types.
- **Results Tracking**: A `ResultTracker` class maintains statistics on solving attempts, including success rates and average token generation time, utilizing a sliding window for memory efficiency.
- **Logging**: A Winston-based logging system provides configurable and structured output for debugging and monitoring.
- **Precision Enhancement**: Includes a post-drag verification system using Gemini Vision, intelligent micro-adjustments for small offsets, and visual debugging (screenshots) to achieve high solving precision for jigsaw and drag-drop challenges.
- **Spatial Reasoning**: Implements a 6-step chain-of-thought spatial analysis method using Gemini AI for complex pattern types (e.g., hole matching, shape similarity, pattern completion).

### Feature Specifications
- **CLI Mode**: Offers direct interaction with parameters for site key, URL, operation mode (`normal` or `inject`), screenshot capture, headless operation, debug logging, and API server activation.
- **API Mode**: An Express.js-based REST API server provides a `/solve` endpoint on port 5000 for programmatic hCaptcha resolution, returning a token upon success. CORS is enabled.

### System Design Choices
- **Stealth and Realism**: Incorporates extensive measures for human-like browser automation, including stealth plugins, virtual cursor movement with Bezier curves and micro-jitter, realistic click durations, and varied delays.
- **Precision**: Features ultra-precise coordinate system analysis, utilizing a grid-based approach for Gemini AI to accurately identify and interact with challenge elements, reducing false clicks and improving success rates.
- **Robustness**: Includes extended timeouts for verification, comprehensive error handling, and robust challenge type detection and routing to manage multiple challenge iterations effectively.
- **Configurability**: Key parameters like API keys and operational modes are configurable via environment variables or CLI flags.

## External Dependencies

### AI/ML Services
- **Google Gemini AI**: Used for image recognition and spatial reasoning, accessed via `@google/genai` SDK v1.27.0. Utilizes `gemini-2.0-flash` for general tasks and `gemini-2.5-pro` for advanced spatial reasoning. Requires `GEMINI_API_KEY`.

### Browser Automation
- **Puppeteer**: Core browser automation library.
- **Puppeteer Extra**: Plugin framework for Puppeteer.
- **Puppeteer Stealth Plugin**: Used for evading automation detection.

### CLI & Utilities
- **Commander**: For CLI argument parsing.
- **Winston**: For structured logging.
- **Express.js**: For the API server.

### Runtime Requirements
- **Node.js**: Version 16 or newer.
- **Chromium Browser**: Either system-installed or bundled with Puppeteer.

### Environment Variables
- `GEMINI_API_KEY`: Essential for Google Gemini AI integration.