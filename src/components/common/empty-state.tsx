import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick?: () => void; href?: string };
}) {
  const content = (
    <Button variant="outline" onClick={action?.onClick}>
      {action?.label}
    </Button>
  );

  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed bg-background p-8 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-5">{action.href ? <a href={action.href}>{content}</a> : content}</div> : null}
    </div>
  );
}
