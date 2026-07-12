declare const brand: unique symbol;

export type Brand<Value, Name extends string> = Value & {
  readonly [brand]: Name;
};

export const Brand = {
  /**
   * Nominal brand constructor. The `name` is documentation-only at runtime.
   */
  make:
    <Name extends string>(_name: Name) =>
    <Value>(value: Value): Brand<Value, Name> =>
      value as Brand<Value, Name>,
} as const;
