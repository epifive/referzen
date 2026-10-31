// Minimal types for ua-parser-js v1 (MIT; the package ships none). Only what src/lib/tracking.ts uses.
declare module "ua-parser-js" {
  export interface UAResult {
    browser: { name?: string; version?: string; major?: string };
    os: { name?: string; version?: string };
    device: { type?: string; vendor?: string; model?: string };
  }
  export class UAParser {
    constructor(ua?: string);
    getResult(): UAResult;
    getDevice(): UAResult["device"];
  }
}
