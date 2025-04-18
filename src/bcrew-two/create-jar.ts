import { WebsiteJar, CookieData } from "./expand-jar";
import { RULE_ID_START_BCREW } from "../constants";
import { Logger } from "../logger/logger";
import { isInSW } from "../utils/utils";
import { sendMessageToBackground } from "../utils/messaging-helpers";

function generateCookieHash(cookie: CookieData): number {
  const str = `${cookie.name}${cookie.value}${cookie.domain}${cookie.path}${cookie.isWhisper ? "whisper" : "normal"}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function generateRuleId(cookie: CookieData): number {
  const hash = generateCookieHash(cookie);
  return RULE_ID_START_BCREW + (hash % 1000000);
}

export async function removeJarRulesForCookies(
  cookies: CookieData[],
): Promise<void> {
  const ruleIds = cookies.map((cookie) => generateRuleId(cookie));
  return new Promise(async (resolve) => {
    if (!(await isInSW())) {
      let response = await sendMessageToBackground({
        intent: "removeJarRulesForCookies",
        cookies: cookies,
      });
      resolve(response);
    } else {
      chrome.declarativeNetRequest.updateSessionRules(
        {
          removeRuleIds: ruleIds,
          addRules: [],
        },
        () => {
          if (chrome.runtime.lastError) {
            Logger.error(
              "Error removing specific cookie rules:",
              chrome.runtime.lastError,
            );
          } else {
            Logger.log(
              `Successfully removed ${ruleIds.length} specific cookie rules`,
            );
          }
          resolve();
        },
      );
    }
  });
}

export async function createJar(jarData: WebsiteJar): Promise<number[]> {
  return new Promise(async (resolve) => {
    if (!(await isInSW())) {
      Logger.log("[createJar] : Sending message to background");
      let response = await sendMessageToBackground({
        intent: "createJar",
        jarData: jarData,
      });
      resolve(response);
    } else {
      let filterHttpOnly = false;
      if (jarData.filterHttpOnly) {
        filterHttpOnly = jarData.filterHttpOnly;
      }
      const httpOnlyCookies = filterHttpOnly
        ? jarData.cookies.filter((cookie) => !cookie.httpOnly)
        : jarData.cookies;
      const rules: chrome.declarativeNetRequest.Rule[] = httpOnlyCookies.map(
        (cookie, index) => {
          let resourceTypes = ["sub_frame"];
          if (cookie.resourceTypes) {
            resourceTypes = cookie.resourceTypes;
          }

          const ruleId = generateRuleId(cookie);

          let cookieStr = `${cookie.name}=${cookie.value}; Path=${cookie.path}; Domain=${cookie.domain}`;

          if (cookie.secure) cookieStr += "; Secure";
          if (cookie.httpOnly) cookieStr += "; HttpOnly";

          if (cookie.sameSite && cookie.sameSite !== "unspecified") {
            cookieStr += `; SameSite=${cookie.sameSite}`;
          } else {
            if (cookie.optionalDefaultValue) {
              cookieStr += `; ${cookie.optionalDefaultValue}`;
            }
            if (cookie.secure) {
              cookieStr += "; SameSite=None";
            }
          }

          if (!cookie.session && cookie.expirationDate) {
            const expirationDate = new Date(cookie.expirationDate * 1000);
            cookieStr += `; Expires=${expirationDate.toUTCString()}`;
          }

          return {
            id: ruleId,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              ...(cookie.isWhisper
                ? {
                    requestHeaders: [
                      {
                        header: "Cookie",
                        operation:
                          chrome.declarativeNetRequest.HeaderOperation.SET,
                        value: cookieStr,
                      },
                    ],
                  }
                : {
                    responseHeaders: [
                      {
                        header: "Set-Cookie",
                        operation:
                          chrome.declarativeNetRequest.HeaderOperation.APPEND,
                        value: cookieStr,
                      },
                    ],
                  }),
            },
            condition: {
              urlFilter: `||${cookie.domain}`,
              resourceTypes: resourceTypes,
            },
          } as chrome.declarativeNetRequest.Rule;
        },
      );

      // Get rule IDs for removal/tracking
      const ruleIds = rules.map((rule) => rule.id);

      // Output the rules for debugging
      Logger.log("Creating rules:", JSON.stringify(rules, null, 2));

      // Update Session rules
      chrome.declarativeNetRequest.updateSessionRules(
        {
          removeRuleIds: ruleIds,
          addRules: rules,
        },
        () => {
          if (chrome.runtime.lastError) {
            Logger.error(
              "Error setting cookie rules:",
              chrome.runtime.lastError,
            );
            resolve([]);
          } else {
            Logger.log("Cookie rules successfully set");
            resolve(ruleIds);
          }
        },
      );
    }
  });
}

export function removeJarRules(ruleIds: number[]): void {
  chrome.declarativeNetRequest.updateSessionRules(
    {
      removeRuleIds: ruleIds,
      addRules: [],
    },
    () => {
      if (chrome.runtime.lastError) {
        Logger.error("Error removing cookie rules:", chrome.runtime.lastError);
      } else {
        Logger.log("Cookie rules successfully removed");
      }
    },
  );
}
