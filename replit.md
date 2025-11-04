# hCaptcha AI Solver - CLI Tool & API

## Overview

This project provides a command-line tool and an API service designed to automatically solve hCaptcha challenges. It leverages Google's Gemini AI for visual recognition and browser automation to interact with challenges. The tool supports both direct CLI usage for real-time solving and an HTTP REST API for programmatic integration, offering capabilities to bypass hCaptcha challenges effectively. The core ambition is to provide a reliable and efficient solution for hCaptcha solving, minimizing manual intervention.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

### November 2025 - Spatial Reasoning Implementation (Python Repo Adaptation)
**Major Enhancement:** Implemented advanced spatial reasoning inspired by [QIN2DIM/hcaptcha-challenger](https://github.com/QIN2DIM/hcaptcha-challenger) Python repository, while maintaining Gemini AI as the vision model.

**New Capabilities:**
1. **Structured Data Models** (`lib/models.js`):
   - `CaptchaTask`, `ImageDragDropChallenge`, `BoundingBoxChallenge`, `GridBasedChallenge`
   - `SpatialReasoningResult` with confidence levels and reasoning chains
   - Task type and spatial type constants for systematic classification

2. **Chain-of-Thought Spatial Reasoning** (`lib/spatial-reasoning.js`):
   - 6-step systematic analysis method:
     1. Goal Analysis - understand the challenge objective
     2. Source Identification - analyze draggable elements
     3. Destination Identification - identify target positions
     4. **Rule Inference** - determine the logical pattern (e.g., "match by hole count")
     5. Verification - validate the inferred rule
     6. Solution Determination - generate source→target mappings
   - Support for complex pattern types:
     - Hole matching (shapes with same number of holes)
     - Shape similarity (geometric structure matching)
     - Pattern completion (complete visual sequences)
     - Position logic (missing positions in grids)

3. **Intelligent Challenge Routing** (`lib/jigsaw-solver.js`):
   - Automatic detection of complex vs simple drag-drop challenges
   - Complex patterns use spatial reasoning with chain-of-thought
   - Simple jigsaw/sliders use legacy offset solver
   - Seamless fallback mechanisms for robustness

4. **Execution Layer with Coordinate Translation**:
   - `executeSpatialDragOperations()` converts reasoning solutions to actual drag operations
   - **Critical iframe coordinate translation**: iframe-relative → page coordinates
   - Multi-drag support with human-like movements
   - Comprehensive logging for debugging (iframe coords + page coords)

**Technical Approach:**
- Unlike Python repo's ONNX models, this uses pure Gemini Vision AI with advanced prompts
- Maintains the same systematic reasoning approach and logical flow
- Chain-of-thought prompts guide Gemini through step-by-step spatial analysis
- Solution format: `{ source_id, target_id, explanation }` for each mapping

**Example Reasoning Output:**
```
Inferred Rule: "Match draggable shapes to target shapes based on NUMBER OF HOLES"
Solution:
  - Source 1 (Circle with 2 holes) → Target A (Square with 2 holes)
  - Source 2 (Triangle with 0 holes) → Target B (Pentagon with 0 holes)
Confidence: high
```

### November 2025 - Gemini API Integration Fixes
Fixed critical Gemini API compatibility issues with `@google/genai` v1.27.0:

1. **Model Version Updates**: Migrated from unavailable gemini-1.5-* models to stable versions:
   - `gemini-2.0-flash` for canvas analysis, bounding box, jigsaw, and multiple choice challenges
   - `gemini-2.5-pro` for advanced spatial reasoning tasks
   - Resolved 404 "model not found" errors with v1beta API

2. **JSON Response Parsing**: Added robust handling for Gemini's markdown-wrapped JSON responses:
   - Detects and strips ```json code blocks from responses
   - Prevents "Unexpected token" parsing errors
   - Supports both wrapped and plain JSON formats

3. **Response Structure Handling**: Implemented flexible response parsing for multiple Gemini API formats:
   - `result.response.text()` (async function)
   - `result.text` (property)
   - `result.response.candidates[0].content.parts[0].text` (structured format)
   - Comprehensive error logging for debugging

4. **Test File Fixes**: Corrected parameter passing in test-canvas-solver.js to match function signatures

### November 2025 - Critical Coordinate Fixes
Fixed critical iframe coordinate issues affecting all challenge types:

1. **Bounding Box Challenge Fix**: Added iframe offset calculation with scroll compensation. Coordinates now properly account for iframe position on the page, using `frameElement.evaluate()` with `getBoundingClientRect()` + scroll offsets. Float precision maintained (no premature rounding), jitter reduced to ±0.15px for accuracy.

2. **Grid Challenge Fix**: Applied same iframe offset fix to grid tile clicking. Tiles now clicked at correct absolute page coordinates instead of iframe-relative positions.

3. **Jigsaw/Drag Challenge Fix**: Changed from `cursor.moveTo()` to `page.mouse.move()` for drag operations. Added `clickCount: 1` to mouse events. Smooth multi-step drag with variable timing and minimal jitter for natural movement.

4. **Challenge Detection Fix**: Added keyword detection for drag-type challenges. Challenges with "drag", "slide", "move", or "position" in prompt now correctly identified as JIGSAW_SLIDER instead of BOUNDING_BOX.

## System Architecture

### UI/UX Decisions
The system defaults to a non-headless browser mode, allowing users to monitor the solving process visually. Logging is configurable with timestamped and colorized output for readability, and a ResultTracker provides real-time statistics on solver performance.

### Technical Implementations
The core functionality relies on:
- **Browser Automation**: Puppeteer Extra with Stealth Plugin is used to control a Chromium browser, mimicking human behavior and evading detection. It prioritizes system Chromium and uses a single process.
- **AI Vision Processing**: Google Gemini AI (via `@google/genai` SDK) is integrated for visual recognition tasks within hCaptcha challenges, identifying and selecting correct images based on prompts.
- **Challenge Detection**: A `CaptchaWatcher` class monitors the page state for hCaptcha challenges, employing an event-driven design with callbacks for different challenge states and precise frame management. Enhanced with keyword-based detection for drag-type challenges.
- **Iframe Coordinate Handling**: All click operations now properly account for iframe positioning and scroll offsets, ensuring pixel-perfect accuracy across all challenge types.
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
- **Google Gemini AI**: Used for image recognition, accessed via `@google/genai` SDK v1.27.0. Models: `gemini-2.0-flash` (general), `gemini-2.5-pro` (spatial reasoning). Requires `GEMINI_API_KEY`.

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