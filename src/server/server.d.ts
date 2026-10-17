/**
 * Type definitions for the voice-simulator HTTP API (Node.js only).
 */

import type { Server } from 'node:http';
import type { SynthesizeOptions } from '../index.d.ts';

export declare class HttpError extends Error {
  constructor(status: number, message: string);
  status: number;
}

/** Create the HTTP server (call `.listen(port)` to start it). */
export declare function createVoiceServer(options?: {
  version?: string;
  /** HTML served at "/". */
  index?: string;
}): Server;

/** Validate synthesis parameters from a query string or JSON body. */
export declare function synthesisOptions(params: Record<string, unknown>): {
  text: string;
  options: SynthesizeOptions;
};

/** Minimal HTML page with a form that plays /api/stream. */
export declare const INDEX_PAGE: string;
