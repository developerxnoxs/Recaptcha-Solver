# hCaptcha AI Solver - CLI Tool & API

## Overview

This project provides a command-line tool and an API service designed to automatically solve hCaptcha challenges. It leverages Google's Gemini AI for visual recognition and browser automation to interact with challenges. The tool supports both direct CLI usage for real-time solving and an HTTP REST API for programmatic integration, offering capabilities to bypass hCaptcha challenges effectively. The core ambition is to provide a reliable and efficient solution for hCaptcha solving, minimizing manual intervention.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The system defaults to a non-headless browser mode, allowing users to monitor the solving process visually. Logging is configurable with timestamped and colorized output for readability, and a ResultTracker provides real-time statistics on solver performance.

### Technical Implementations
The core functionality relies on:
- **Browser Automation**: Puppeteer Extra with Stealth Plugin is used to control a Chromium browser, mimicking human behavior and evading detection. It prioritizes system Chromium and uses a single process.
- **AI Vision Processing**: Google Gemini AI (via `@google/genai` SDK) is integrated for visual recognition tasks within hCaptcha challenges, identifying and selecting correct images based on prompts.
- **Challenge Detection**: A `CaptchaWatcher` class monitors the page state for hCaptcha challenges, employing an event-driven design with callbacks for different challenge states and precise frame management.
- **Results Tracking**: A `ResultTracker` class maintains statistics on solving attempts, including success rates and average token generation time, with a sliding window for efficient memory use.
- **Logging**: A Winston-based logging system provides configurable and structured output for debugging and monitoring.

### Feature Specifications
- **CLI Mode**: Offers direct interaction with parameters for site key, URL, operation mode (`normal` or `inject`), screenshot capture (`--screenshot`), headless operation (`--headless`), debug logging (`--debug`), and API server activation (`--api`).
- **API Mode**: An Express.js-based REST API server provides a `/solve` endpoint for programmatic hCaptcha resolution, returning a token upon success. It runs on port 5000 and has CORS enabled.

### System Design Choices
- **Stealth and Realism**: Extensive measures are taken to ensure browser automation appears human-like, including a stealth plugin, virtual cursor movement logic with bezier curves and micro-jitter, realistic click durations, and varied delays.
- **Precision**: Ultra-precise coordinate system analysis is implemented, utilizing a grid-based approach for Gemini AI to accurately identify and interact with challenge elements, reducing false clicks and improving success rates, especially for bounding box and jigsaw challenges.
- **Robustness**: The system incorporates extended timeouts for verification, comprehensive error handling, and robust challenge type detection and routing to handle multiple challenge iterations effectively.
- **Configurability**: Key parameters like API keys and operational modes are configurable via environment variables or CLI flags.

## External Dependencies

### AI/ML Services
- **Google Gemini AI**: Used for image recognition, accessed via `@google/genai` SDK. Requires `GEMINI_API_KEY`.

### Browser Automation
- **Puppeteer**: Core browser automation library.
- **Puppeteer Extra**: Plugin framework for Puppeteer.
- **Puppeteer Stealth Plugin**: Used for evading automation detection.

### CLI & Utilities
- **Commander**: For CLI argument parsing.
- **Winston**: For structured logging.

### Runtime Requirements
- **Node.js**: Version 16 or newer.
- **Chromium Browser**: Either system-installed or bundled with Puppeteer.

### Environment Variables
- `GEMINI_API_KEY`: Essential for Google Gemini AI integration.