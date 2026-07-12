import { tmpdir } from "node:os";
import path from "node:path";
import { Context, Layer } from "effect";

/**
 * Process-wide backend settings. Provide via {@link BackendConfig.layer}
 * (or {@link BackendConfig.Default} for the temp-dir default).
 */
export class BackendConfig extends Context.Tag("@winnie/backend/BackendConfig")<
  BackendConfig,
  {
    readonly dataDirectory: string;
  }
>() {
  static readonly defaultDataDirectory = path.join(tmpdir(), "winnie-backend");

  static layer = (dataDirectory: string = BackendConfig.defaultDataDirectory) =>
    Layer.succeed(BackendConfig, { dataDirectory });

  static Default = BackendConfig.layer();
}
