// Design tree (intermediate representation).
// Every input format (Figma today; Penpot, screenshots later) is parsed into this,
// and every generator (Flutter today; React Native next) reads only this.

export type Sizing = 'fixed' | 'hug' | 'fill';
export type MainAlign = 'start' | 'center' | 'end' | 'spaceBetween';
export type CrossAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';

export interface RGBA { r: number; g: number; b: number; a: number } // 0..1

export interface GradientStop { color: RGBA; position: number }

export type Paint =
  | { kind: 'solid'; color: RGBA; token?: string }
  | { kind: 'linear'; from: [number, number]; to: [number, number]; stops: GradientStop[] }
  | { kind: 'radial'; center: [number, number]; radius: number; stops: GradientStop[] }
  | { kind: 'image'; ref: string; fit: 'cover' | 'contain' | 'fill' | 'tile' };

export interface Stroke {
  color: RGBA;
  width: number;
  align: 'inside' | 'center' | 'outside';
  token?: string;
}

export interface Shadow {
  inner: boolean;
  color: RGBA;
  x: number;
  y: number;
  blur: number;   // Figma blur radius (CSS-like)
  spread: number;
}

export interface Box { x: number; y: number; width: number; height: number }

export interface Layout {
  mode: 'row' | 'column' | 'none';
  gap: number;
  padding: { top: number; right: number; bottom: number; left: number };
  mainAlign: MainAlign;
  crossAlign: CrossAlign;
  wrap: boolean;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  lineHeightPx?: number;      // undefined = font's natural line height
  letterSpacingPx: number;
  color: RGBA;
  align: 'left' | 'center' | 'right' | 'justify';
  decoration: 'none' | 'underline' | 'lineThrough';
  token?: string;             // named text style
  colorToken?: string;
}

export type Constraint = 'start' | 'end' | 'both' | 'center' | 'scale';

export type NodeKind = 'frame' | 'text' | 'vector' | 'ellipse';

export interface IRNode {
  id: string;
  name: string;
  kind: NodeKind;
  box: Box;                    // absolute position from Figma
  width: Sizing;
  height: Sizing;
  absolute: boolean;           // positioned in a Stack instead of the flex flow
  constraints: { h: Constraint; v: Constraint };
  layout: Layout;
  fills: Paint[];
  stroke?: Stroke;
  radius: [number, number, number, number]; // tl, tr, br, bl
  shadows: Shadow[];
  backgroundBlur?: number; // Gaussian sigma (frosted glass behind the layer)
  layerBlur?: number;      // Gaussian sigma (the layer itself is blurred)
  opacity: number;
  clip: boolean;
  rotation: number;
  text?: { characters: string; style: TextStyle };
  asset?: { format: 'svg' | 'png'; file: string }; // exported as an image
  component?: { key: string; name: string; instance: boolean };
  children: IRNode[];
  warnings: string[];
}

export interface ColorToken { name: string; color: RGBA }
export interface TextToken { name: string; style: TextStyle }

export interface DesignDoc {
  fileKey: string;
  root: IRNode;
  colors: ColorToken[];
  textStyles: TextToken[];
  assets: { nodeId: string; file: string; format: 'svg' | 'png'; imageRef?: string }[];
  fonts: string[];
  omitted: string[]; // system UI layers left out (status bar, home indicator)
}
