/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as crons from "../crons.js";
import type * as feedback from "../feedback.js";
import type * as game_flow from "../game/flow.js";
import type * as game_rooms from "../game/rooms.js";
import type * as game_scheduler from "../game/scheduler.js";
import type * as http from "../http.js";
import type * as stripe from "../stripe.js";
import type * as youtube from "../youtube.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  crons: typeof crons;
  feedback: typeof feedback;
  "game/flow": typeof game_flow;
  "game/rooms": typeof game_rooms;
  "game/scheduler": typeof game_scheduler;
  http: typeof http;
  stripe: typeof stripe;
  youtube: typeof youtube;
}>;
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {};
