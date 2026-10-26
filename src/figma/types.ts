// Subset of the Figma REST API node schema that pixelproof reads.
// Reference: https://www.figma.com/developers/api#node-types

export interface FColor { r: number; g: number; b: number; a: number }
export interface FVector { x: number; y: number }

export interface FPaint {
  type: 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND' | 'IMAGE' | 'EMOJI' | 'VIDEO';
  visible?: boolean;
  opacity?: number;
  color?: FColor;
  gradientHandlePositions?: FVector[];
  gradientStops?: { color: FColor; position: number }[];
  imageRef?: string;
  scaleMode?: 'FILL' | 'FIT' | 'TILE' | 'STRETCH';
}

export interface FEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  visible?: boolean;
  color?: FColor;
  offset?: FVector;
  radius: number;
  spread?: number;
}

export interface FTypeStyle {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  italic?: boolean;
  lineHeightPx?: number;
  lineHeightUnit?: 'PIXELS' | 'FONT_SIZE_%' | 'INTRINSIC_%';
  letterSpacing?: number; // px in REST responses
  textAlignHorizontal?: 'LEFT' | 'RIGHT' | 'CENTER' | 'JUSTIFIED';
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS';
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
}

export type FSizing = 'FIXED' | 'HUG' | 'FILL';

export interface FNode {
  id: string;
  name: string;
  type: 'DOCUMENT' | 'CANVAS' | 'FRAME' | 'GROUP' | 'SECTION' | 'COMPONENT' | 'COMPONENT_SET' | 'INSTANCE'
    | 'TEXT' | 'RECTANGLE' | 'ELLIPSE' | 'VECTOR' | 'LINE' | 'STAR' | 'REGULAR_POLYGON' | 'BOOLEAN_OPERATION';
  visible?: boolean;
  children?: FNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  constraints?: { vertical: string; horizontal: string };
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  layoutSizingHorizontal?: FSizing;
  layoutSizingVertical?: FSizing;
  layoutGrow?: number;        // legacy fill on main axis
  layoutAlign?: 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
  itemSpacing?: number;
  paddingLeft?: number; paddingRight?: number; paddingTop?: number; paddingBottom?: number;
  fills?: FPaint[];
  strokes?: FPaint[];
  strokeWeight?: number;
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  effects?: FEffect[];
  opacity?: number;
  clipsContent?: boolean;
  rotation?: number;
  characters?: string;
  style?: FTypeStyle;
  textAutoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE';
  styles?: Record<string, string>; // e.g. { fill: "S:abc", text: "S:def" }
  componentId?: string;
  exportSettings?: { format: 'PNG' | 'SVG' | 'JPG' | 'PDF' }[];
  isMask?: boolean;
}

export interface FStyleMeta { key: string; name: string; styleType: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID' }
export interface FComponentMeta { key: string; name: string; componentSetId?: string }

/** Shape of GET /v1/files/:key/nodes?ids=... */
export interface FNodesResponse {
  name: string;
  version?: string;
  nodes: Record<string, {
    document: FNode;
    styles?: Record<string, FStyleMeta>;
    components?: Record<string, FComponentMeta>;
  } | null>;
}
