import { redirect } from "next/navigation";

/** Calendar was a placeholder; meetings are the real outcome surface. */
export default function Page() {
  redirect("/app/meetings");
}
