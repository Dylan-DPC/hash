import { VersionedUrl } from "@blockprotocol/type-system";
import { proxyActivities, sleep } from "@temporalio/workflow";

import * as activities from "./activities";
import { createGraphActivities } from "./activities";

const { complete } = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 seconds",
});

export const DemoWorkflow = async (prompt: string): Promise<string> => {
  // Demonstrate sleeping, obviously we don't want this here in real workflows
  await sleep(50);

  // Call the activity
  return await complete(prompt);
};

const { getEntityTypeSubgraph } = proxyActivities<
  ReturnType<typeof createGraphActivities>
>({
  startToCloseTimeout: "20 second",
  retry: {
    maximumAttempts: 1,
  },
});

export async function getEntityType(params: {
  entityTypeId: VersionedUrl;
}): Promise<any> {
  return await getEntityTypeSubgraph({
    entityTypeId: params.entityTypeId,
    graphResolveDepths: {
      // inheritsFrom: { outgoing: 255 },
      // constrainsLinksOn: { outgoing: 255 },
      // constrainsLinkDestinationsOn: { outgoing: 255 },
      // constrainsPropertiesOn: { outgoing: 255 },
      // constrainsValuesOn: { outgoing: 255 },
    },
  });
}
