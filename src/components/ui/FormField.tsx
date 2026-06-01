import type { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
}

export function FormField({ label, error, required, children, htmlFor }: FormFieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-500 mb-1">
        {label}
        {required ? <span className="text-red-500 ml-0.5">*</span> : null}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export function inputClassName(hasError?: boolean): string {
  return `w-full px-3 py-2 bg-[#f5f5f3] border rounded-lg text-sm focus:outline-none focus:ring-2 transition-colors ${
    hasError
      ? "border-red-300 focus:ring-red-500/20 focus:border-red-500"
      : "border-gray-200 focus:ring-emerald-500/20 focus:border-emerald-500"
  }`;
}
