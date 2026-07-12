import { AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Consistent loading spinner used across all panels.
 * Replaces ad-hoc text-only loading states.
 */
export function LoadingState({
  message = "Loading…",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm", className)}>
      <Loader2 className="h-4 w-4 animate-spin text-primary/60" />
      <span>{message}</span>
    </div>
  );
}

/**
 * Error state with retry button.
 * Shows a clear message and lets the user retry the failed query.
 */
export function ErrorState({
  message = "Something went wrong.",
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-10 gap-3 text-sm", className)}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <AlertCircle className="h-4 w-4 text-red-400/80" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <RefreshCw className="h-3 w-3" />
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Empty state with an action button.
 * More helpful than a blank space — tells users what to do next.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  onAction,
  className,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 gap-2 text-center", className)}>
      {icon && <span className="text-3xl mb-1">{icon}</span>}
      <p className="text-sm font-medium text-foreground/80">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">{description}</p>
      )}
      {action && onAction && (
        <button
          onClick={onAction}
          className="mt-2 text-xs text-primary hover:underline"
        >
          {action}
        </button>
      )}
    </div>
  );
}
