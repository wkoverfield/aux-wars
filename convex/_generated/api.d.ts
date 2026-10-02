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
import type * as concurrency from "../concurrency.js";
import type * as crons from "../crons.js";
import type * as dailyMetrics from "../dailyMetrics.js";
import type * as feedback from "../feedback.js";
import type * as game_contentFilter from "../game/contentFilter.js";
import type * as game_flow from "../game/flow.js";
import type * as game_promptPacks from "../game/promptPacks.js";
import type * as game_publicRooms from "../game/publicRooms.js";
import type * as game_quickPlayRules from "../game/quickPlayRules.js";
import type * as game_roomOps from "../game/roomOps.js";
import type * as game_rooms from "../game/rooms.js";
import type * as game_scheduler from "../game/scheduler.js";
import type * as http from "../http.js";
import type * as metricsRollup from "../metricsRollup.js";
import type * as news from "../news.js";
import type * as presence from "../presence.js";
import type * as quickPlay from "../quickPlay.js";
import type * as siteStats from "../siteStats.js";
import type * as stats from "../stats.js";
import type * as stripe from "../stripe.js";
import type * as youtube from "../youtube.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  concurrency: typeof concurrency;
  crons: typeof crons;
  dailyMetrics: typeof dailyMetrics;
  feedback: typeof feedback;
  "game/contentFilter": typeof game_contentFilter;
  "game/flow": typeof game_flow;
  "game/promptPacks": typeof game_promptPacks;
  "game/publicRooms": typeof game_publicRooms;
  "game/quickPlayRules": typeof game_quickPlayRules;
  "game/roomOps": typeof game_roomOps;
  "game/rooms": typeof game_rooms;
  "game/scheduler": typeof game_scheduler;
  http: typeof http;
  metricsRollup: typeof metricsRollup;
  news: typeof news;
  presence: typeof presence;
  quickPlay: typeof quickPlay;
  siteStats: typeof siteStats;
  stats: typeof stats;
  stripe: typeof stripe;
  youtube: typeof youtube;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
};
