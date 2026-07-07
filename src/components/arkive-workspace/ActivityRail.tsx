"use client";

import { LogoMark } from "./LogoMark";
import { ThemeAvatarMenu } from "./ThemeAvatarMenu";

export function ActivityRail() {
  return (
    <div className="relative hidden h-screen w-12 shrink-0 flex-col items-center justify-between border-r border-border-subtle bg-panel py-2.5 md:flex">
      <div className="flex flex-col items-center">
        <div className="mb-3 grid h-12 w-12 place-items-center text-foreground -mt-2">
          <LogoMark size={40} />
        </div>
      </div>
      <ThemeAvatarMenu />
    </div>
  );
}
