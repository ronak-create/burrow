import {
  ArrowLeft,
  ArrowUp,
  Check,
  Circle,
  Eraser,
  ExternalLink,
  FileText,
  Frame,
  Image as ImageIcon,
  Info,
  Maximize2,
  Mic,
  Minus,
  MousePointer2,
  MoveRight,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Square,
  StickyNote,
  Table,
  Trash2,
  Type,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * One place for every icon in the app.
 *
 * Emoji were the first attempt and were wrong: they render as full-colour glyphs
 * that differ per platform and font, they cannot inherit text colour, and they
 * sit on the baseline rather than optically centred. Line icons at a single
 * stroke weight read as one system and tint with `currentColor`.
 */

export type { LucideIcon };

export const Icons = {
  // chrome
  back: ArrowLeft,
  close: X,
  settings: Settings,
  pin: Pin,
  pinOff: PinOff,
  panel: PanelRight,
  search: Search,
  check: Check,
  external: ExternalLink,
  trash: Trash2,
  add: Plus,
  info: Info,
  upload: Upload,

  // canvas controls
  undo: Undo2,
  zoomIn: Plus,
  zoomOut: Minus,
  fit: Maximize2,

  // modes
  select: MousePointer2,
  draw: Pencil,
  erase: Eraser,

  // block kinds
  note: StickyNote,
  table: Table,
  diagram: Workflow,
  doc: FileText,
  image: ImageIcon,
  frame: Frame,

  // shapes
  rectangle: Square,
  ellipse: Circle,
  arrow: MoveRight,
  text: Type,

  // assistant
  mic: Mic,
  speakerOn: Volume2,
  speakerOff: VolumeX,
  send: ArrowUp,
} as const;

export type IconName = keyof typeof Icons;


/**
 * Renders an icon at a size that stays crisp: lucide draws on a 24px grid, so
 * whole-number sizes avoid half-pixel strokes.
 */
export function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: React.CSSProperties;
}) {
  const Cmp = Icons[name];
  return <Cmp size={size} strokeWidth={strokeWidth} style={{ display: "block", ...style }} />;
}

/**
 * The app mark: a tunnel mouth receding into the ground, three nested arches at
 * decreasing lightness so it still reads as "depth" at small sizes. Same artwork
 * as `src-tauri/icons/burrow.svg`, including its own purple ground square — the
 * arches need that fixed dark backdrop for contrast, so this draws its own
 * background rather than sitting on the theme's accent colour, which can be
 * near-white and washes the whole mark out.
 */
export function BurrowMark({ size = 19, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} style={{ display: "block", ...style }}>
      <defs>
        <linearGradient id="burrow-mark-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b6dff" />
          <stop offset="100%" stopColor="#5b3fd1" />
        </linearGradient>
        <linearGradient id="burrow-mark-depth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a1b6b" />
          <stop offset="100%" stopColor="#120b33" />
        </linearGradient>
      </defs>
      <rect width={512} height={512} rx={114} fill="url(#burrow-mark-ground)" />
      <path d="M136 396 V268 a120 120 0 0 1 240 0 V396 Z" fill="#ffffff" opacity={0.94} />
      <path d="M176 396 V276 a80 80 0 0 1 160 0 V396 Z" fill="#a48cff" opacity={0.85} />
      <path d="M214 396 V284 a42 42 0 0 1 84 0 V396 Z" fill="url(#burrow-mark-depth)" />
    </svg>
  );
}
