/**
 * Arkive logo. References the SVG assets shipped under /public/brand/.
 *
 * - <ArkiveLogo /> — full lockup (mark + wordmark). The brand spec says: never
 *   CSS-filter the dark logo onto a light background; use the dedicated file.
 *   Defaults to the dark variant (dark mode is the brand's natural state). Pass
 *   variant="light" on light backgrounds.
 *
 * - <ArkiveMark /> — icon-only. Use in collapsed nav, favicons, or anywhere
 *   under ~32px wide where the wordmark would become illegible. The SVG file
 *   already contains its own background plate; never wrap it in a border,
 *   card, or shadow.
 */

import Image from "next/image";

type LogoProps = {
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  variant?: "dark" | "light";
};

export function ArkiveLogo({
  className,
  width = 140,
  height = 41,
  priority,
  variant = "dark",
}: LogoProps) {
  const src = variant === "light" ? "/brand/logo-full-light.svg" : "/brand/logo-full-dark.svg";
  return (
    <Image
      src={src}
      alt="Arkive"
      width={width}
      height={height}
      priority={priority}
      className={className}
    />
  );
}

export function ArkiveMark({
  className,
  size = 32,
  priority,
}: {
  className?: string;
  size?: number;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/logo-icon.svg"
      alt="Arkive"
      width={size}
      height={size}
      priority={priority}
      className={className}
    />
  );
}
