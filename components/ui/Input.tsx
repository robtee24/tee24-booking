"use client";

import React from "react";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix" | "suffix"> & {
  label?: string;
  hint?: string;
  error?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, prefix, suffix, className = "", id, ...rest },
  ref
) {
  const inputId = id ?? React.useId();
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">
          {label}
        </label>
      )}
      <div className={[
        "flex items-center rounded-apple-sm border bg-white transition-colors",
        error ? "border-apple-red" : "border-apple-border focus-within:border-apple-blue",
        "focus-within:ring-4 focus-within:ring-apple-blue/30",
      ].join(" ")}>
        {prefix && <span className="pl-3 text-apple-text-tertiary">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          className={[
            "w-full bg-transparent px-3 py-2.5 text-apple-sm text-apple-text outline-none placeholder:text-apple-text-tertiary",
            className,
          ].join(" ")}
          {...rest}
        />
        {suffix && <span className="pr-3 text-apple-text-tertiary">{suffix}</span>}
      </div>
      {(error || hint) && (
        <p className={["mt-1 text-apple-xs", error ? "text-apple-red" : "text-apple-text-tertiary"].join(" ")}>
          {error || hint}
        </p>
      )}
    </div>
  );
});

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className = "", id, ...rest },
  ref
) {
  const textareaId = id ?? React.useId();
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={textareaId} className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        className={[
          "w-full rounded-apple-sm border bg-white px-3 py-2.5 text-apple-sm text-apple-text outline-none transition-colors",
          "placeholder:text-apple-text-tertiary",
          "focus:ring-4 focus:ring-apple-blue/30",
          error ? "border-apple-red focus:border-apple-red" : "border-apple-border focus:border-apple-blue",
          className,
        ].join(" ")}
        {...rest}
      />
      {(error || hint) && (
        <p className={["mt-1 text-apple-xs", error ? "text-apple-red" : "text-apple-text-tertiary"].join(" ")}>
          {error || hint}
        </p>
      )}
    </div>
  );
});

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className = "", id, children, ...rest },
  ref
) {
  const selectId = id ?? React.useId();
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        className={[
          "w-full rounded-apple-sm border bg-white px-3 py-2.5 text-apple-sm text-apple-text outline-none transition-colors",
          "focus:ring-4 focus:ring-apple-blue/30",
          error ? "border-apple-red focus:border-apple-red" : "border-apple-border focus:border-apple-blue",
          className,
        ].join(" ")}
        {...rest}
      >
        {children}
      </select>
      {(error || hint) && (
        <p className={["mt-1 text-apple-xs", error ? "text-apple-red" : "text-apple-text-tertiary"].join(" ")}>
          {error || hint}
        </p>
      )}
    </div>
  );
});
