import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";

export function PlaceholderPage({ title, description, icon }: { title: string; description: string; icon: LucideIcon }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState icon={icon} title={`${title} is prepared`} description="This route is intentionally placeholder-only in Phase 1." />
    </>
  );
}
