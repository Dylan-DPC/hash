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
    John Smith from 33659 Bielefeld, Germany, Milky way, a hardworking middle-aged man, finds himself in an unusual love triangle with two remarkable women, Sarah Johnson and Emily Williams. John's heart is torn between these two strong-willed and intelligent individuals, leading to a complex and emotionally charged relationship dynamic.

Sarah Johnson, a successful businesswoman, is a confident and independent woman who brings a sense of adventure to John's life. They met during a business conference and were instantly drawn to each other's charismatic personalities. Sarah's ambition and drive match John's own determination, creating a passionate and intense connection between them.

On the other hand, Emily Williams, a compassionate artist, captures John's heart with her gentle and nurturing nature. They met at an art gallery where Emily's captivating paintings left John mesmerized. Emily's creativity and free spirit awaken a sense of vulnerability in John, leading to a deep emotional bond between them.

As the story unfolds, the intricate relationship dynamics between John, Sarah, and Emily become more pronounced. Each person brings a unique set of qualities and experiences, challenging and inspiring one another in different ways. The complexity of their intertwined lives unfolds as they navigate the joys and hardships of love, commitment, and self-discovery`;

    const schema = {
      type: "object",
      properties: {
        persons: {
          type: "array",
          items: {
            kind: "entityType",
            title: "Person",
            type: "object",
            description:
              "An extremely simplified representation of a person or human being.",
            properties: {
              entity_id: {
                description: "The unique identifier of the entity.",
                type: "number",
              },
              name: {
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
              age: {
                description: "The age of an entity.",
                oneOf: [
                  {
                    type: "number",
                  },
                ],
                title: "Gender",
              },
              gender: {
                description: "The gender of a person.",
                oneOf: [
                  {
                    title: "Text",
                    description: "An ordered sequence of characters",
                    type: "string",
                  },
                ],
                title: "Gender",
              },
              e_mail: {
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
            required: ["entity_id", "name"],
          },
        },
        professions: {
          type: "array",
          items: {
            type: "object",
            description: "The profession of a person or human being.",
            properties: {
              entity_id: {
                description: "The unique identifier of the entity.",
                type: "number",
              },
              name: {
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
            required: ["entity_id", "name"],
          },
        },
        address: {
          type: "array",
          items: {
            type: "object",
            description:
              "Information required to identify a specific location on the planet associated with a postal address.",
            properties: {
              entity_id: {
                description: "The unique identifier of the entity.",
                type: "number",
              },
              street_address_line_1: {
                description:
                  'The first line of street information of an address. \n\nConforms to the "address-line1" field of the "WHATWG Autocomplete Specification".\n\nSee: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fe-autocomplete-address-level1',
                oneOf: [
                  {
                    type: "string",
                  },
                ],
              },
              address_level_1: {
                description:
                  'The broadest administrative level in the address, i.e. the province within which the locality is found; for example, in the US, this would be the state; in Switzerland it would be the canton; in the UK, the post town.\n\nCorresponds to the "address-level1" field of the "WHATWG Autocomplete Specification".\n\nSee: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fe-autocomplete-address-level1',
                oneOf: [
                  {
                    type: "string",
                  },
                ],
              },
              postal_code: {
                description:
                  'The postal code of an address.\n\nThis should conform to the standards of the area the code is from, for example\n\n- a UK postcode might look like: "SW1A 1AA"\n\n- a US ZIP code might look like: "20500"',
                oneOf: [
                  {
                    type: "string",
                  },
                ],
              },
              alpha_2_country_code: {
                description:
                  "The short-form of a country's name.\n\nConforms to the ISO 3166 alpha-2 country code specification.\n\nSee: https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2",
                oneOf: [
                  {
                    type: "string",
                  },
                ],
              },
            },
            required: ["entity_id", "name"],
          },
        },
        has_profession: {
          type: "array",
          items: {
            type: "object",
            description: "A relationship between a person and a profession.",
            properties: {
              entity_id: {
                description: "The unique identifier of this link entity.",
                type: "number",
              },
              source_entity: {
                description: "The source entity of this link entity.",
                type: "number",
              },
              target_entity: {
                description: "The target entity of this link entity.",
                type: "number",
              },
            },
            required: ["entity_id", "source_entity", "target_entity"],
          },
        },
        has_relation_ship: {
          type: "array",
          items: {
            type: "object",
            description:
              "A relationship between two persons, e.g. married, parent, child, etc.",
            properties: {
              entity_id: {
                description: "The unique identifier of this link entity.",
                type: "number",
              },
              source_entity: {
                description: "The source entity of this link entity.",
                type: "number",
              },
              target_entity: {
                description: "The target entity of this link entity.",
                type: "number",
              },
              name: {
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
            required: ["entity_id", "source_entity", "target_entity"],
          },
        },
        lives_at: {
          type: "array",
          items: {
            type: "object",
            description: "The location where a person lives.",
            properties: {
              entity_id: {
                description: "The unique identifier of this link entity.",
                type: "number",
              },
              source_entity: {
                description: "The source entity of this link entity.",
                type: "number",
              },
              target_entity: {
                description: "The target entity of this link entity.",
                type: "number",
              },
              name: {
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
            required: ["entity_id", "source_entity", "target_entity"],
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
          name: `create_entities_from_property_list`,
          description:
            "Creates a list of entities from the provided list of properties",
          parameters: schema,
        },
      ],
      function_call: { name: "create_entities_from_property_list" },
      messages: [
        {
          role: "system",
          content: `In an environment of a general knowledge store, entities are stored as JSON object consisting of various properties. To create entity types, information shall be extracted from unstructured data.
          
          Each entity is created by calling 'create_entity_type' by passing in a list of properties.
          
          You are responsible to extract the information and return the appropriated parameters to call this function.

          If an information is missing don't make new information up, the provided data is the only source of truth.
          If information is not provided it's not available.
          If information is not strictly required it's optional.
          If information is not explicitly stated it must not be assumed.
          Each entity is associated with a unique id. This id is used to reference the entity in the knowledge store. Two entities can never have the same id - even if they are of different types.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    console.log(response.data.choices[0]!.message!.function_call?.arguments);
    console.log(response.data.usage);
    return response.data.choices[0]!.message!.function_call?.arguments;
  },
});
