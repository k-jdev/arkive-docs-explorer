import { Suspense } from "react";
import { ArkiveWorkspace } from "@/components/arkive-workspace/ArkiveWorkspace";

export const dynamic = "force-dynamic";

export default function ArkivesPage() {
  return (
    <Suspense>
      <ArkiveWorkspace />
    </Suspense>
  );
}
