import { cn } from "@/lib/utils";

export function Badge({ className, ...props }) {
  return <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium capitalize", className)} {...props} />;
}
