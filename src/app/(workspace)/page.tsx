// In normal flow, middleware redirects "/" → "/dashboard" (signed in) or "/auth/sign-in" (signed out).
// This stub exists so the route compiles and renders something sane if the middleware ever short-circuits.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function Home() {
  redirect("/arkives");
}
