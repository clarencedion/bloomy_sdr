import { redirect } from "next/navigation";

/**
 * The old metrics dashboard has been replaced by Home (what do you want
 * meetings for?) and the campaign overview. Kept as a redirect so existing
 * links and bookmarks keep working.
 */
export default function Page() {
  redirect("/app/home");
}
