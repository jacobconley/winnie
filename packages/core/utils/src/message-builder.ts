export interface Renderable {
  readonly render: () => string;
}

const isRenderable = (value: unknown): value is Renderable =>
  typeof value === "object" &&
  value !== null &&
  "render" in value &&
  typeof (value as Renderable).render === "function";

export class MessageBuilder {
  private constructor(
    private readonly lineValues: readonly string[],
    private readonly indentLevel: number,
    private readonly indentUnit: string,
  ) {}

  static readonly empty = new MessageBuilder([], 0, "  ");

  static build = (fn: (builder: MessageBuilder) => MessageBuilder): MessageBuilder =>
    fn(MessageBuilder.empty);

  private get prefix(): string {
    return this.indentUnit.repeat(this.indentLevel);
  }

  line(...text: string[]): MessageBuilder {
    const prefix = this.prefix;
    const next = text
      .join(" ")
      .split("\n")
      .map((subLine) => `${prefix}${subLine}`);
    return new MessageBuilder([...this.lineValues, ...next], this.indentLevel, this.indentUnit);
  }

  lines(lines: readonly string[]): MessageBuilder {
    return lines.reduce((builder, value) => builder.line(value), this as MessageBuilder);
  }

  indent(fn: (builder: MessageBuilder) => MessageBuilder): MessageBuilder {
    const nested = fn(new MessageBuilder(this.lineValues, this.indentLevel + 1, this.indentUnit));
    return new MessageBuilder(nested.lineValues, this.indentLevel, this.indentUnit);
  }

  cause(err: unknown, args?: { readonly stack?: boolean }): MessageBuilder {
    if (isRenderable(err)) {
      return this.line(err.render());
    }

    if (err instanceof Error) {
      let next = this.line(err.message || err.name);
      if (args?.stack && err.stack) {
        next = next.indent((builder) =>
          builder.lines(
            err.stack
              ?.split("\n")
              .slice(1)
              .map((frame) => frame.trim()) ?? [],
          ),
        );
      }
      return next;
    }

    return this.line(String(err));
  }

  toString(): string {
    return this.lineValues.join("\n");
  }
}
