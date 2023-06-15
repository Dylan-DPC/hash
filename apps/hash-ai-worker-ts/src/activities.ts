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
    Amelia Hartley, a vivacious young artist with a passion for vibrant colors, resides at 452 Willow Lane in the charming neighborhood of Evergreen Heights. Her cozy address is adorned with blooming flowers and adorned windows, reflecting her imaginative spirit. Within the walls of her quaint cottage, Amelia creates breathtaking paintings that transport viewers to dreamlike realms.
    At 725 Oakwood Avenue, nestled within the enigmatic Ravenwood Manor, resides Jackson Bennett—a brooding writer known for his mesmerizing tales of mystery and suspense. Shadows dance across the imposing manor's ivy-clad facade, hinting at the secrets concealed within. Jackson's study overlooks the sprawling gardens, providing him with inspiration as he weaves intricate plots that captivate readers worldwide.
    In the idyllic neighborhood of Serenity Meadows, a tranquil abode awaits at 317 Cherry Blossom Lane, the residence of Lily Chen. Her home is a serene sanctuary, surrounded by fragrant cherry blossom trees that paint the landscape with delicate hues. Lily, a dedicated yoga instructor, opens her doors to students seeking balance and mindfulness. The gentle ambiance of her address serves as a testament to her calming presence.
    Perched on the edge of a picturesque seaside cliff, Max Cooper's address at 912 Harborview Terrace provides a breathtaking view of the vast ocean expanse. His modern beachfront retreat in Ocean's Edge is a testament to his adventurous spirit and love for the sea. Max, an avid marine biologist, spends his days exploring the depths, unraveling the mysteries of the ocean's inhabitants, and returning home to his address that resonates with the soothing sound of crashing waves.
    `;

    const schema = {
      type: "object",
      properties: {
        address_list: {
          type: "array",
          items: {
            type: "object",
            title: "Address",
            description:
              "Information required to identify a specific location on the planet associated with a postal address.",
            properties: {
              "https://blockprotocol.org/@blockprotocol/types/property-type/street-address-line-1/":
                {
                  title: "Street Address Line 1",
                  description:
                    "The first line of street information of an address. \n\nConforms to the “address-line1” field of the “WHATWG Autocomplete Specification”.\n\nSee: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fe-autocomplete-address-level1",
                  oneOf: [
                    {
                      title: "Text",
                      description: "An ordered sequence of characters",
                      type: "string",
                    },
                  ],
                },
              "https://blockprotocol.org/@blockprotocol/types/property-type/address-level-1/":
                {
                  title: "Address Level 1",
                  description:
                    "The broadest administrative level in the address, i.e. the province within which the locality is found; for example, in the US, this would be the state; in Switzerland it would be the canton; in the UK, the post town.\n\nCorresponds to the “address-level1” field of the “WHATWG Autocomplete Specification”.\n\nSee: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fe-autocomplete-address-level1",
                  oneOf: [
                    {
                      title: "Text",
                      description: "An ordered sequence of characters",
                      type: "string",
                    },
                  ],
                },
              "https://blockprotocol.org/@blockprotocol/types/property-type/postal-code/":
                {
                  title: "Postal Code",
                  description:
                    "The postal code of an address.\n\nThis should conform to the standards of the area the code is from, for example\n\n- a UK postcode might look like: “SW1A 1AA”\n\n- a US ZIP code might look like: “20500”",
                  oneOf: [
                    {
                      title: "Text",
                      description: "An ordered sequence of characters",
                      type: "string",
                    },
                  ],
                },
              "https://blockprotocol.org/@blockprotocol/types/property-type/alpha-2-country-code/":
                {
                  title: "Alpha-2 Country Code",
                  description:
                    "The short-form of a country’s name.\n\nConforms to the ISO 3166 alpha-2 country code specification.\n\nSee: https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2",
                  oneOf: [
                    {
                      title: "Text",
                      description: "An ordered sequence of characters",
                      type: "string",
                    },
                  ],
                },
              "https://blockprotocol.org/@blockprotocol/types/property-type/mapbox-full-address/":
                {
                  title: "Mapbox Full Address",
                  description:
                    "A complete address as a string.\n\nConforms to the “full_address” output of the Mapbox Autofill API.\n\nSee: https://docs.mapbox.com/mapbox-search-js/api/core/autofill/#autofillsuggestion#full_address",
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
              "https://blockprotocol.org/@blockprotocol/types/property-type/street-address-line-1/",
              "https://blockprotocol.org/@blockprotocol/types/property-type/address-level-1/",
              "https://blockprotocol.org/@blockprotocol/types/property-type/alpha-2-country-code/",
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
        // {
        //   role: "user",
        //   content: `Homer Simpson is a fictional character from the animated television series "The Simpsons," and his address within the show is 742 Evergreen Terrace, Springfield. However, it's important to note that "The Simpsons" is a work of fiction, and Springfield is a fictional town, so the address does not correspond to a real location.`,
        // },
        // {
        //   role: "assistant",
        //   content: `[
        //     {
        //       "https://blockprotocol.org/@blockprotocol/types/property-type/street-address-line-1/": "742 Evergreen Terrace",
        //       "https://blockprotocol.org/@blockprotocol/types/property-type/address-level-1/": "Springfield",
        //       "https://blockprotocol.org/@blockprotocol/types/property-type/mapbox-full-address/": "742 Evergreen Terrace, Springfield"
        //     }
        //   ]`,
        // },
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
