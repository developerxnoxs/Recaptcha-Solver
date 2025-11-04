/**
 * Data Models untuk hCaptcha Challenges
 * Terinspirasi dari QIN2DIM/hcaptcha-challenger models.py
 */

class CaptchaTask {
    constructor({
        taskType = null,
        promptText = null,
        requestion = null,
        choices = [],
        isDynamic = false,
        gridSize = null,
        metadata = {}
    } = {}) {
        this.taskType = taskType;  // image_label_binary, image_label_area_select, image_drag_drop, etc
        this.promptText = promptText;
        this.requestion = requestion;  // Cleaned prompt without "Click verify" suffix
        this.choices = choices;
        this.isDynamic = isDynamic;
        this.gridSize = gridSize;
        this.metadata = metadata;
    }
}

class ImageDragDropChallenge {
    constructor({
        promptText = null,
        sourceElements = [],
        targetPositions = [],
        inferredRule = null,  // Logical pattern (e.g., "Match holes count", "Complete pattern")
        spatialType = 'jigsaw',  // 'jigsaw', 'slider', 'shape_matching', 'pattern_completion'
        metadata = {}
    } = {}) {
        this.promptText = promptText;
        this.sourceElements = sourceElements;  // Elements to drag
        this.targetPositions = targetPositions;  // Where they should go
        this.inferredRule = inferredRule;
        this.spatialType = spatialType;
        this.metadata = metadata;
    }
}

class BoundingBoxChallenge {
    constructor({
        promptText = null,
        canvasSize = { width: 0, height: 0 },
        targetObjects = [],
        systematicScan = null,  // Grid scan results
        clickPoints = [],
        confidence = 'medium',
        metadata = {}
    } = {}) {
        this.promptText = promptText;
        this.canvasSize = canvasSize;
        this.targetObjects = targetObjects;  // Objects to click on
        this.systematicScan = systematicScan;
        this.clickPoints = clickPoints;
        this.confidence = confidence;
        this.metadata = metadata;
    }
}

class GridBasedChallenge {
    constructor({
        promptText = null,
        requestion = null,
        gridType = '3x3',
        tiles = [],
        isDynamic = false,
        targetObject = null,
        metadata = {}
    } = {}) {
        this.promptText = promptText;
        this.requestion = requestion;
        this.gridType = gridType;
        this.tiles = tiles;
        this.isDynamic = isDynamic;
        this.targetObject = targetObject;
        this.metadata = metadata;
    }
}

class SpatialReasoningResult {
    constructor({
        confidence = 'low',
        reasoning = null,
        solution = null,
        thinkingProcess = null,  // Chain-of-thought steps
        visualEvidence = null,
        metadata = {}
    } = {}) {
        this.confidence = confidence;  // 'high', 'medium', 'low'
        this.reasoning = reasoning;
        this.solution = solution;
        this.thinkingProcess = thinkingProcess;
        this.visualEvidence = visualEvidence;
        this.metadata = metadata;
    }
}

// Task type constants
const TASK_TYPES = {
    IMAGE_LABEL_BINARY: 'image_label_binary',
    IMAGE_LABEL_AREA_SELECT_POINT: 'image_label_area_select:point',
    IMAGE_LABEL_AREA_SELECT_BBOX: 'image_label_area_select:bounding_box',
    IMAGE_LABEL_MULTIPLE_CHOICE: 'image_label_multiple_choice',
    IMAGE_DRAG_DROP: 'image_drag_drop',
};

// Spatial reasoning types
const SPATIAL_TYPES = {
    JIGSAW: 'jigsaw',
    SLIDER: 'slider',
    SHAPE_MATCHING: 'shape_matching',
    PATTERN_COMPLETION: 'pattern_completion',
    DRAG_DROP_HOLES: 'drag_drop_holes',  // Match shapes by hole count
    DRAG_DROP_SIMILARITY: 'drag_drop_similarity',  // Match similar shapes
    DRAG_DROP_POSITION: 'drag_drop_position',  // Complete position in pattern
};

module.exports = {
    CaptchaTask,
    ImageDragDropChallenge,
    BoundingBoxChallenge,
    GridBasedChallenge,
    SpatialReasoningResult,
    TASK_TYPES,
    SPATIAL_TYPES
};
