import React from "react";

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-apple border border-dashed border-apple-border bg-white px-6 py-12 text-center">
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-apple-fill-secondary text-apple-text-tertiary">
          {icon}
        </div>
      )}
      <h3 className="text-apple-lg font-semibold text-apple-text">{title}</h3>
      {description && <p className="mt-1 max-w-md text-apple-sm text-apple-text-secondary">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
