import { cn } from "@/lib/utils";

export function Card({ className, ...props }) {
  return <div className={cn("crafted-card rounded-lg border border-border bg-surface", className)} {...props} />;
}
