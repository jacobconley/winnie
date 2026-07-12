/**
 * Conditionally builds an array of strings, filtering out falsy values.
 *
 * Used for building process arguments ergnonomically.
 */
export const compactArgs = (args: readonly (string | false | undefined)[]): string[] =>
  args.filter((arg): arg is string => typeof arg === "string");
