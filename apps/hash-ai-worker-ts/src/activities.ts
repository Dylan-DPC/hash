import {
  createGraphClient,
  currentTimeInstantTemporalAxes,
  ImpureGraphContext,
  zeroedGraphResolveDepths,
} from "@apps/hash-api/src/graph";
import { getEntityTypeSubgraphById } from "@apps/hash-api/src/graph/ontology/primitive/entity-type";
import { logger } from "@apps/hash-api/src/logger";
import { StorageType } from "@apps/hash-api/src/storage";
import { VersionedUrl } from "@blockprotocol/type-system";
import { getRequiredEnv } from "@local/hash-backend-utils/environment";
import { Logger } from "@local/hash-backend-utils/logger";
import {
  AccountId,
  GraphResolveDepths,
  OntologyTypeRevisionId,
  OntologyTypeVertexId,
} from "@local/hash-subgraph";
import {
  getPropertyTypeByVertexId,
  getRoots,
} from "@local/hash-subgraph/stdlib";
import { Configuration, OpenAIApi } from "openai";

export const complete = async (prompt: string): Promise<string> => {
  const apiKey = getRequiredEnv("OPENAI_API_KEY");

  const configuration = new Configuration({
    apiKey,
  });
  const openai = new OpenAIApi(configuration);

  const response = await openai.createCompletion({
    model: "text-ada-001",
    prompt,
    temperature: 0,
    max_tokens: 500,
  });

  const responseMessage = response.data.choices[0]?.text;

  if (responseMessage === undefined) {
    throw new Error("No message found in openai response");
  }

  return responseMessage;
};

export const createImpureGraphContext = (): ImpureGraphContext => {
  const logger = new Logger({
    mode: "dev",
    level: "debug",
    serviceName: "temporal-worker",
  });

  const graphApiHost = getRequiredEnv("HASH_GRAPH_API_HOST");
  const graphApiPort = parseInt(getRequiredEnv("HASH_GRAPH_API_PORT"), 10);

  const graphApi = createGraphClient(logger, {
    host: graphApiHost,
    port: graphApiPort,
  });

  logger.info("Created graph context");
  logger.info(JSON.stringify({ graphApi }, null, 2));

  return {
    graphApi,
    uploadProvider: {
      getFileEntityStorageKey: (_params: any) => {
        throw new Error(
          "File fetching not implemented yet for temporal worker",
        );
      },
      presignDownload: (_params: any) => {
        throw new Error(
          "File presign download not implemented yet for temporal worker.",
        );
      },
      presignUpload: (_params: any) => {
        throw new Error(
          "File presign upload not implemented yet for temporal worker.",
        );
      },
      storageType: StorageType.LocalFileSystem,
    },
  };
};

export const createGraphActivities = (createInfo: {
  graphContext: ImpureGraphContext;
  actorId: AccountId;
}) => ({
  async getEntityTypeSubgraph(params: {
    entityTypeId: VersionedUrl;
    graphResolveDepths?: Partial<GraphResolveDepths>;
  }): Promise<any> {
    // const subgraph = await getEntityTypeSubgraphById(createInfo.graphContext, {
    //   entityTypeId: params.entityTypeId,
    //   graphResolveDepths: {
    //     ...zeroedGraphResolveDepths,
    //     ...params.graphResolveDepths,
    //     constrainsPropertiesOn: { outgoing: 1 },
    //   },
    //   temporalAxes: currentTimeInstantTemporalAxes,
    //   actorId: createInfo.actorId,
    // });

    // const roots = getRoots(subgraph);
    // if (roots.length !== 1) {
    //   throw new Error(
    //     `Expected exactly one root entity, but found ${roots.length} roots.`,
    //   );
    // }
    // const root = roots[0]!;

    // const title = root.schema.title;
    // const description = root.schema.description;

    // const rootEdges =
    //   subgraph.edges[root.metadata.recordId.baseUrl]?.[
    //     root.metadata.recordId.version.toString() as OntologyTypeRevisionId
    //   ];

    // const rootPropertyTypes = rootEdges
    //   ?.filter(({ kind }) => kind === "CONSTRAINS_PROPERTIES_ON")
    //   .map(({ rightEndpoint }) => {
    //     return getPropertyTypeByVertexId(
    //       subgraph,
    //       rightEndpoint as OntologyTypeVertexId,
    //     )!;
    //   });

    const apiKey = getRequiredEnv("OPENAI_API_KEY");

    const configuration = new Configuration({
      apiKey,
    });
    const openai = new OpenAIApi(configuration);

    const prompt = `
    John Smith, a hardworking middle-aged man, finds himself in an unusual love triangle with two remarkable women, Sarah Johnson and Emily Williams. John's heart is torn between these two strong-willed and intelligent individuals, leading to a complex and emotionally charged relationship dynamic.

Sarah Johnson, a successful businesswoman, is a confident and independent woman who brings a sense of adventure to John's life. They met during a business conference and were instantly drawn to each other's charismatic personalities. Sarah's ambition and drive match John's own determination, creating a passionate and intense connection between them.

On the other hand, Emily Williams, a compassionate artist, captures John's heart with her gentle and nurturing nature. They met at an art gallery where Emily's captivating paintings left John mesmerized. Emily's creativity and free spirit awaken a sense of vulnerability in John, leading to a deep emotional bond between them.

As the story unfolds, the intricate relationship dynamics between John, Sarah, and Emily become more pronounced. Each person brings a unique set of qualities and experiences, challenging and inspiring one another in different ways. The complexity of their intertwined lives unfolds as they navigate the joys and hardships of love, commitment, and self-discovery`;

    const schema = {
      type: "object",
      properties: {
        "https://blockprotocol.org/@examples/types/entity-type/person/v/1": {
          type: "array",
          items: {
            $schema:
              "https://blockprotocol.org/types/modules/graph/0.3/schema/entity-type",
            $id: "https://blockprotocol.org/@examples/types/entity-type/person/v/1",
            kind: "entityType",
            title: "Person",
            type: "object",
            description:
              "An extremely simplified representation of a person or human being.",
            examples: [],
            links: {
              "https://blockprotocol.org/@examples/types/entity-type/employed-by/v/1":
                {
                  type: "array",
                  minItems: 0,
                  ordered: false,
                  items: {
                    oneOf: [
                      {
                        $ref: "https://blockprotocol.org/@examples/types/entity-type/company/v/1",
                      },
                    ],
                  },
                },
            },
            properties: {
              entity_id: {
                description: "The unique identifier of the entity.",
                type: "number",
              },
              "https://blockprotocol.org/@blockprotocol/types/property-type/name/":
                {
                  description:
                    "A word or set of words by which something is known, addressed, or referred to.",
                  oneOf: [
                    {
                      title: "Text",
                      description: "An ordered sequence of characters",
                      type: "string",
                    },
                  ],
                  title: "Name",
                },
              "https://blockprotocol.org/@examples/types/property-type/e-mail/":
                {
                  description: "An e-mail address.",
                  oneOf: [
                    {
                      title: "Text",
                      description: "An ordered sequence of characters",
                      type: "string",
                    },
                  ],
                },
            },
            required: [
              "id",
              "https://blockprotocol.org/@blockprotocol/types/property-type/name/",
            ],
          },
        },
        "https://example.org/@examples/types/entity-type/profession/v/1": {
          type: "array",
          items: {
            $schema:
              "https://blockprotocol.org/types/modules/graph/0.3/schema/entity-type",
            $id: "https://blockprotocol.org/@examples/types/entity-type/person/v/1",
            kind: "entityType",
            title: "Profession",
            type: "object",
            description: "The profession of a person or human being.",
            examples: [],
            properties: {
              entity_id: {
                description: "The unique identifier of the entity.",
                type: "number",
              },
              "https://blockprotocol.org/@blockprotocol/types/property-type/name/":
                {
                  description:
                    "A word or set of words by which something is known, addressed, or referred to.",
                  oneOf: [
                    {
                      title: "Text",
                      description: "An ordered sequence of characters",
                      type: "string",
                    },
                  ],
                  title: "Name",
                },
            },
            required: [
              "id",
              "https://blockprotocol.org/@blockprotocol/types/property-type/name/",
            ],
          },
        },
      },
    };

    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo-0613",
      temperature: 0,
      max_tokens: 1500,
      functions: [
        {
          name: `create_entity_types`,
          description:
            "Creates entity types from a list containing the provided parameters",
          parameters: schema,
        },
      ],
      function_call: { name: "create_entity_types" },
      messages: [
        {
          role: "system",
          content: `In an environment of a general knowledge store, entities are stored as JSON object consisting of various properties. You should help extracting information from unstructured text to be able to create entities from this text.
          As an LLM you are good for extracting the information and provide the structured data from it. The entities' shape is defined in the list elements of the function parameter. Extract the information and return the appropriated parameters to call these functions.
          If an information is missing don't ask further questions, just return the function call with the missing parameters. Return an error, if a required parameter is missing.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    console.log(response.data.choices[0]!.message!.function_call?.arguments);
    return response.data.choices[0]!.message!.function_call?.arguments;
  },
});
