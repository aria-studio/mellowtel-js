import { tellToDeleteIframe } from "./message-background";
import { getIdentifier } from "../utils/identity-helpers";
import { Logger } from "../logger/logger";
import { htmlVisualizer } from "../htmlVisualizer/htmlVisualizer";
import { sendMessageToBackground } from "../utils/messaging-helpers";

let htmlVisualizerTimedOut: boolean = true;

export function checkThroughFilters(
  url: string,
  second_document_string: string,
  orgId: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const endpointFilters =
        "https://5xpb4fkh75h5s4vngnzy6oowcy0cgahe.lambda-url.us-east-1.on.aws/";
      fetch(endpointFilters, {
        method: "POST",
        body: JSON.stringify({
          url: url,
          htmlContent: second_document_string,
          orgId: orgId,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(
              "[checkThroughFilters]: Network response was not ok",
            );
          }
          return response.json();
        })
        .then((data) => {
          Logger.log("[checkThroughFilters]: Response from server:", data);
          resolve(data.valid);
        })
        .catch((error) => {
          Logger.error("[checkThroughFilters]: Error:", error);
          resolve(true);
        });
    } catch (error) {
      Logger.error(error);
      resolve(true);
    }
  });
}

async function getS3SignedUrls(recordID: string): Promise<{
  uploadURL_htmlVisualizer: string;
  uploadURL_html: string;
  uploadURL_markDown: string;
}> {
  return new Promise((resolve) => {
    fetch(
      "https://5xub3rkd3rqg6ebumgrvkjrm6u0jgqnw.lambda-url.us-east-1.on.aws/?recordID=" +
        recordID,
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error("[getS3SignedUrl]: Network response was not ok");
        }
        return response.json();
      })
      .then((data) => {
        Logger.log("[getS3SignedUrl]: Response from server:", data);
        resolve({
          uploadURL_htmlVisualizer: data.uploadURL_htmlVisualizer,
          uploadURL_html: data.uploadURL_html,
          uploadURL_markDown: data.uploadURL_markDown,
        });
      });
  });
}

async function updateDynamo(
  recordID: string,
  url: string,
  htmlTransformer: string,
  orgId: string,
  htmlKey: string = "--",
  markdownKey: string = "--",
  htmlVisualizerKey: string = "--",
) {
  Logger.log("📋  updateDynamo - Saving Crawl 📋");
  Logger.log("RecordID:", recordID);
  Logger.log("URL:", url);
  Logger.log("HTML Transformer:", htmlTransformer);
  Logger.log("OrgID:", orgId);
  Logger.log("HTML Key:", htmlKey);
  Logger.log("Markdown Key:", markdownKey);
  Logger.log("HTML Visualizer Key:", htmlVisualizerKey);
  const endpoint: string =
    "https://zuaq4uywadlj75qqkfns3bmoom0xpaiz.lambda-url.us-east-1.on.aws/";

  getIdentifier().then((node_identifier: string) => {
    Logger.log("Node Identifier:", node_identifier);
    const bodyData = {
      recordID: recordID,
      url: url,
      htmlTransformer: htmlTransformer,
      orgId: orgId,
      node_identifier: node_identifier,
      final_url: window.location.href,
      htmlFileName: htmlKey,
      markdownFileName: markdownKey,
      htmlVisualizerFileName: htmlVisualizerKey,
    };

    const requestOptions = {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(bodyData),
    };

    Logger.log("[updateDynamo]: Sending data to server =>");
    Logger.log(bodyData);

    fetch(endpoint, requestOptions)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        return response.json();
      })
      .then((data) => {
        Logger.log("Response from server:", data);
        return tellToDeleteIframe(recordID, false);
      })
      .catch((error) => {
        Logger.error("Error:", error);
        return tellToDeleteIframe(recordID, false);
      });
  });
}

export async function saveWithVisualizer(
  recordID: string,
  content: string,
  markDown: string,
  url: string,
  htmlTransformer: string,
  orgId: string,
  second_document_string: string,
) {
  Logger.log("📋  saveWithVisualizer - Saving Crawl 📋");
  Logger.log("RecordID:", recordID);
  // first pass through filters
  let isValid = await checkThroughFilters(url, second_document_string, orgId);
  if (!isValid) {
    Logger.log("URL did not pass through filters");
    return tellToDeleteIframe(recordID, false);
  }
  let signedUrls = await getS3SignedUrls(recordID);
  let htmlVisualizerURL = signedUrls.uploadURL_htmlVisualizer;
  let htmlURL = signedUrls.uploadURL_html;
  let markDownURL = signedUrls.uploadURL_markDown;

  await sendMessageToBackground({
    intent: "putHTMLToSigned",
    htmlURL_signed: htmlURL,
    content: content,
  });
  await sendMessageToBackground({
    intent: "putMarkdownToSigned",
    markdownURL_signed: markDownURL,
    markDown: markDown,
  });

  setTimeout(async () => {
    if (htmlVisualizerTimedOut) {
      Logger.error("HTML Visualizer Timed Out");
      // still save what savable
      await updateDynamo(
        recordID,
        url,
        htmlTransformer,
        orgId,
        "text_" + recordID + ".txt",
        "markDown_" + recordID + ".txt",
      );
      return tellToDeleteIframe(recordID, false);
    } else {
      Logger.log("HTML Visualizer Completed Correctly");
      htmlVisualizerTimedOut = true;
    }
  }, 20000);

  // after that, attempt to visualize the HTML
  Logger.log("Attempting to visualize HTML...");

  await sendMessageToBackground({
    intent: "fixImageRenderHTMLVisualizer",
  });
  window.scrollTo(0, 0);
  let base64image = await htmlVisualizer(document.body, {
    useCORS: true,
    // allowTaint: true,
    logging: false,
  })
    .then(function (canvas: HTMLCanvasElement | null) {
      Logger.log("IMAGE IS HERE");
      if (!canvas) return "";
      return canvas.toDataURL("image/png");
    })
    .catch(async function (error: any) {
      // here retry by allowingTaint to be false
      Logger.error("[SCRIPT IS] : ERROR => ", error);
    });
  Logger.log(base64image);

  await sendMessageToBackground({
    intent: "putHTMLVisualizerToSigned",
    htmlVisualizerURL_signed: htmlVisualizerURL,
    base64image: base64image,
  });
  await sendMessageToBackground({
    intent: "resetImageRenderHTMLVisualizer",
  });
  await updateDynamo(
    recordID,
    url,
    htmlTransformer,
    orgId,
    "text_" + recordID + ".txt",
    "markDown_" + recordID + ".txt",
    "image_" + recordID + ".png",
  );
  htmlVisualizerTimedOut = false;
}
