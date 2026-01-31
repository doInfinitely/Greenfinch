import { useEffect, useRef, useState } from 'react';

/**
 * A hook that debounces a value, returning the debounced value after a specified delay.
 * Useful for search inputs and filter values that trigger API calls.
 * 
 * @param value - The value to debounce
 * @param delay - The debounce delay in milliseconds (default: 300ms)
 * @returns The debounced value
 * 
 * @example
 * const [searchQuery, setSearchQuery] = useState('');
 * const debouncedQuery = useDebounce(searchQuery, 300);
 * 
 * useEffect(() => {
 *   if (debouncedQuery) {
 *     fetchResults(debouncedQuery);
 *   }
 * }, [debouncedQuery]);
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear the previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set a new timeout
    timeoutRef.current = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Cleanup function to clear timeout on unmount or when value/delay changes
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * A hook that debounces a callback function, returning a debounced version of it.
 * Useful for debouncing API calls or expensive operations triggered by user input.
 * 
 * @param callback - The callback function to debounce
 * @param delay - The debounce delay in milliseconds (default: 300ms)
 * @returns A debounced version of the callback function with the same signature
 * 
 * @example
 * const handleSearch = useCallback(async (query: string) => {
 *   const results = await fetch(`/api/search?q=${query}`);
 *   setResults(results);
 * }, []);
 * 
 * const debouncedSearch = useDebounceCallback(handleSearch, 300);
 * 
 * return (
 *   <input 
 *     onChange={(e) => debouncedSearch(e.target.value)}
 *   />
 * );
 */
export function useDebounceCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 300
): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callbackRef = useRef(callback);

  // Update the callback ref when it changes
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Return a debounced version of the callback
  const debouncedCallback = ((...args: any[]) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }) as T;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}
