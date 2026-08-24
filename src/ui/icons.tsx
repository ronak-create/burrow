import {
  ArrowLeft,
  ArrowUp,
  Brain,
  Check,
  Circle,
  Eraser,
  ExternalLink,
  FileText,
  Frame,
  Image as ImageIcon,
  Maximize2,
  Mic,
  Minus,
  MousePointer2,
  MoveRight,
  PanelRight,
  Pencil,
  Plus,
  Search,
  Settings,
  Square,
  StickyNote,
  Table,
  Trash2,
  Type,
  Undo2,
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
  panel: PanelRight,
  search: Search,
  check: Check,
  external: ExternalLink,
  trash: Trash2,
  logo: Brain,
  add: Plus,

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
