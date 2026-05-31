import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Hard-bounds a promise so the UI never spins forever when Supabase queries
// stall (token-refresh races, transient network drops, RLS slow paths).
// On timeout, the returned promise rejects — callers should already have a
// try/finally that releases their loading state.
export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms = 15000,
  label = 'operation'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
