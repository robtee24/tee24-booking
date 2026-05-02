import React from "react";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
};

export function Card({ padded = true, className = "", ...rest }: CardProps) {
  return (
    <div
      className={[
        "rounded-apple bg-white shadow-apple",
        padded ? "p-5" : "",
        className,
      ].join(" ")}
      {...rest}
    />
  );
}

type CardHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
};

export function CardHeader({ title, subtitle, action, className = "", children, ...rest }: CardHeaderProps) {
  return (
    <div className={["flex items-start justify-between gap-4", className].join(" ")} {...rest}>
      <div className="min-w-0 flex-1">
        {title && <h2 className="text-apple-lg font-semibold text-apple-text">{title}</h2>}
        {subtitle && <p className="mt-1 text-apple-sm text-apple-text-secondary">{subtitle}</p>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["mt-4", className].join(" ")} {...rest} />;
}

export function CardFooter({ className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["mt-4 flex items-center justify-end gap-2 border-t border-apple-divider pt-4", className].join(" ")} {...rest} />;
}
