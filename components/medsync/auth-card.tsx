import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface AuthCardProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * The auth surface (ADR 0099): from 640px a bordered card (border-subtle, card
 * radius, 32px padding); on phones full width with no border. The title is sans
 * 28/36 semibold — the auth pages are a product surface, not the marketing site.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  className,
  ...props
}: AuthCardProps) {
  return (
    <div
      className={cn(
        "text-card-foreground flex flex-col gap-6",
        "sm:bg-card sm:border-gray-150 sm:rounded-lg sm:border sm:p-8",
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-foreground text-[28px] leading-9 font-semibold tracking-[-0.02em]">
          {title}
        </h1>
        {subtitle ? <div className="text-body-m text-muted-foreground">{subtitle}</div> : null}
      </div>
      {children}
      {footer ? <div className="border-gray-150 border-t pt-5">{footer}</div> : null}
    </div>
  );
}

interface FieldErrorProps {
  message?: string;
}

export function FieldError({ message }: FieldErrorProps) {
  if (!message) return null;
  return <p className="text-status-critical-fg text-caption">{message}</p>;
}

interface FormErrorProps {
  message?: string;
}

export function FormError({ message }: FormErrorProps) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="bg-alert-bg border-alert-border text-alert-fg text-body-s rounded-sm border px-3 py-2"
    >
      {message}
    </div>
  );
}
