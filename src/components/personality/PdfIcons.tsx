// Lucide-style icons rendered as @react-pdf SVGs.
// We keep stroke widths and viewBox identical to the on-screen Lucide icons
// so the visual treatment matches the dashboard.

import { Svg, Path, Circle } from '@react-pdf/renderer';

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const strokeProps = (color: string, strokeWidth = 2) => ({
  stroke: color,
  strokeWidth,
  fill: 'none' as const,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function PdfRocket({ size = 16, color = '#ffffff', strokeWidth }: IconProps) {
  const s = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" {...s} />
      <Path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" {...s} />
      <Path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" {...s} />
      <Path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" {...s} />
    </Svg>
  );
}

export function PdfPuzzle({ size = 16, color = '#ffffff', strokeWidth }: IconProps) {
  const s = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z" {...s} />
    </Svg>
  );
}

export function PdfPalette({ size = 16, color = '#ffffff', strokeWidth }: IconProps) {
  const s = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="13.5" cy="6.5" r="0.5" fill={color} stroke="none" />
      <Circle cx="17.5" cy="10.5" r="0.5" fill={color} stroke="none" />
      <Circle cx="8.5" cy="7.5" r="0.5" fill={color} stroke="none" />
      <Circle cx="6.5" cy="12.5" r="0.5" fill={color} stroke="none" />
      <Path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" {...s} />
    </Svg>
  );
}

export function PdfSparkles({ size = 16, color = '#ffffff', strokeWidth }: IconProps) {
  const s = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" {...s} />
      <Path d="M20 3v4" {...s} />
      <Path d="M22 5h-4" {...s} />
      <Path d="M4 17v2" {...s} />
      <Path d="M5 18H3" {...s} />
    </Svg>
  );
}

export function PdfAlertTriangle({ size = 16, color = '#ffffff', strokeWidth }: IconProps) {
  const s = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" {...s} />
      <Path d="M12 9v4" {...s} />
      <Path d="M12 17h.01" {...s} />
    </Svg>
  );
}

export function PdfTarget({ size = 16, color = '#ffffff', strokeWidth }: IconProps) {
  const s = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="10" {...s} />
      <Circle cx="12" cy="12" r="6" {...s} />
      <Circle cx="12" cy="12" r="2" {...s} />
    </Svg>
  );
}

export function PdfMessagesSquare({ size = 16, color = '#ffffff', strokeWidth }: IconProps) {
  const s = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z" {...s} />
      <Path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" {...s} />
    </Svg>
  );
}
