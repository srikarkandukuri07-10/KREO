// ─── KREO core object model ────────────────────────────────────────────────

export type ShapeType =
  | 'rect'
  | 'diamond'
  | 'triangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'text'
  | 'image';

export type ToolId =
  | 'select'
  | 'hand'
  | 'rect'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'text'
  | 'image'
  | 'eraser';

export interface Pt {
  x: number;
  y: number;
}

interface Base {
  id: string;
  type: ShapeType;
  /** top-left for box shapes; start-point for line/arrow; bbox min for pen */
  x: number;
  y: number;
  /** size; for line/arrow this is the delta vector (dx, dy) */
  w: number;
  h: number;
  rotation: number; // degrees
  stroke: string;
  fill: string; // 'transparent' means none
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  opacity: number; // 0-100
  roughness: number; // 0 (clean) .. 3 (sketchy)
  roundness: number; // 0-1 corner radius factor for rect
  locked: boolean;
  groupId: string | null;
  /**
   * Attachment: id of the shape this element sits on.
   * Attached children select/move independently when clicked directly,
   * but always follow their parent's moves (unlike symmetric groups).
   */
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RectEl extends Base {
  type: 'rect';
}
export interface DiamondEl extends Base {
  type: 'diamond';
}
export interface TriangleEl extends Base {
  type: 'triangle';
  /** 3 corner points in world coords (kept in sync with x/y/w/h bbox) */
  pts: Pt[];
}
export interface EllipseEl extends Base {
  type: 'ellipse';
}
export interface LineEl extends Base {
  type: 'line';
}
export interface ArrowEl extends Base {
  type: 'arrow';
  startArrow: boolean;
  endArrow: boolean;
}
export interface PenEl extends Base {
  type: 'pen';
  points: Pt[]; // world coords (absolute)
  pressure?: number[];
  closed?: boolean;
}
export interface TextEl extends Base {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
}
export interface ImageEl extends Base {
  type: 'image';
  src: string; // data URL
  naturalW: number;
  naturalH: number;
}

export type KreoElement =
  | RectEl
  | DiamondEl
  | TriangleEl
  | EllipseEl
  | LineEl
  | ArrowEl
  | PenEl
  | TextEl
  | ImageEl;

export interface BoardView {
  x: number; // camera offset (world->screen translation)
  y: number;
  zoom: number; // 0.1 .. 4
}

export interface ShareConfig {
  mode: 'private' | 'public';
  permission: 'view' | 'edit';
}

export interface Board {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  elements: KreoElement[];
  view: BoardView;
  share: ShareConfig;
  background: string;
  grid: boolean;
  snap: boolean;
}

export interface AppSettings {
  theme: 'light' | 'dark';
  canvasBackground: string;
  grid: boolean;
  snap: boolean;
  gridSize: number;
  defaultStroke: string;
  defaultFill: string;
  defaultStrokeWidth: number;
  defaultRoughness: number;
  defaultFont: string;
  autosave: boolean;
  /** snap freehand pen strokes into clean shapes (circle/rect/triangle/line/arrow) */
  autoCorrect: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  canvasBackground: '#FAF9F6',
  grid: false,
  snap: false,
  gridSize: 24,
  defaultStroke: '#1a1a1a',
  defaultFill: 'transparent',
  defaultStrokeWidth: 2,
  defaultRoughness: 1,
  defaultFont: 'Inter, system-ui, sans-serif',
  autosave: true,
  autoCorrect: true,
};

export const PALETTE = [
  '#1a1a1a',
  '#4b5563',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ffffff',
];

export const SHORTCUTS: Record<string, string> = {
  select: 'V',
  hand: 'H',
  rect: 'R',
  diamond: 'D',
  ellipse: 'O',
  line: 'L',
  arrow: 'A',
  pen: 'P',
  text: 'T',
  image: 'I',
  eraser: 'E',
};
