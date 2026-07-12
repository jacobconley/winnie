export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
}

export const defineCommand = (command: CommandDefinition): CommandDefinition => command;
