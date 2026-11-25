import { cva } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const variants = cva('inline-flex items-center justify-center', {
  variants: { variant: { default: 'primary', outline: 'bg-white' } },
  defaultVariants: { variant: 'outline' },
});

export function Button({ variant, className, type = 'button', ...props }) {
  return <button type={type} className={twMerge(clsx(variants({ variant }), className))} {...props} />;
}
