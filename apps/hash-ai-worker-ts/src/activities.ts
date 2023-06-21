import {
  createGraphClient,
  currentTimeInstantTemporalAxes,
  ImpureGraphContext,
  zeroedGraphResolveDepths,
} from "@apps/hash-api/src/graph";
import {
  getDataTypeById,
  getDataTypeSubgraphById,
} from "@apps/hash-api/src/graph/ontology/primitive/data-type";
import {
  getEntityTypeById,
  getEntityTypeSubgraphById,
} from "@apps/hash-api/src/graph/ontology/primitive/entity-type";
import {
  getPropertyTypeById,
  getPropertyTypeSubgraphById,
} from "@apps/hash-api/src/graph/ontology/primitive/property-type";
import { StorageType } from "@apps/hash-api/src/storage";
import { VersionedUrl } from "@blockprotocol/type-system";
import { getRequiredEnv } from "@local/hash-backend-utils/environment";
import { Logger } from "@local/hash-backend-utils/logger";
import {
  AccountId,
  DataTypeRootType,
  DataTypeWithMetadata,
  EntityTypeRootType,
  EntityTypeWithMetadata,
  GraphResolveDepths,
  PropertyTypeRootType,
  PropertyTypeWithMetadata,
  Subgraph,
} from "@local/hash-subgraph";
import { Configuration, OpenAIApi } from "openai";

import { PartialEntityType } from "./workflows";

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

const dataTypeCache: { [id: VersionedUrl]: DataTypeWithMetadata } = {};
const propertyTypeCache: { [id: VersionedUrl]: PropertyTypeWithMetadata } = {};
const entityTypeCache: { [id: VersionedUrl]: EntityTypeWithMetadata } = {};

export const createGraphActivities = (createInfo: {
  graphContext: ImpureGraphContext;
  actorId: AccountId;
}) => ({
  createEntities: async (params: {
    entityTypeSchemas: PartialEntityType[];
    prompt: string;
  }): Promise<object> => {
    const schema = {
      type: "object",
      $defs: {
        entity_id: {
          description: "The unique identifier of the entity.",
          type: "number",
        },
      },
      properties: Object.fromEntries(
        params.entityTypeSchemas.map((entityTypeSchema) => {
          const entitySchema: object = {
            type: "array",
            items: {
              title: "Entity",
              type: "object",
              properties: {
                entityId: {
                  $ref: "#/$defs/entity_id",
                },
                entityProperties: entityTypeSchema,
              },
            },
          };

          if (entityTypeSchema.allOf[0]?.title === "Link") {
            entitySchema.items.properties.sourceEntityId = {
              $ref: "#/$defs/entity_id",
            };
            entitySchema.items.properties.targetEntityId = {
              $ref: "#/$defs/entity_id",
            };
          }

          delete entitySchema.items.properties.entityProperties.allOf;

          return [entityTypeSchema.$id, entitySchema];
        }),
      ),
    };

    console.log(JSON.stringify({ schema }, null, 2));

    const apiKey = getRequiredEnv("OPENAI_API_KEY");
    const configuration = new Configuration({
      apiKey,
    });
    const openai = new OpenAIApi(configuration);
    const response = await openai.createChatCompletion({
      model: "gpt-4-0613",
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
          content: params.prompt,
        },
      ],
    });

    return response.data.choices[0]!.message!.function_call?.arguments;
    // console.log(response.data.choices[0]!.message!.function_call?.arguments);
    // console.log(response.data.usage);
    // return response.data.choices[0]!.message!.function_call?.arguments;
    // const schema = {
    //   type: "object",
    //   $defs: {
    //     entity_id: {
    //       description: "The unique identifier of the entity.",
    //       type: "number",
    //     },
    //   properties: {
    //     persons: {
    //       type: "array",
    //       items: {
    //         title: "Person",
    //         type: "object",
    //         description:
    //           "An extremely simplified representation of a person or human being.",
    //         properties: {
    //           entity_id: {
    //             $ref: "#/$defs/entity_id",
    //           },
    //           name: {
    //             $ref: "#/$defs/property_types/name",
    //           },
    //           e_mail: {
    //             $ref: "#/$defs/property_types/e_mail",
    //           },
    //         },
    //         required: ["name"],
    //       },
    //     },
    //     professions: {
    //       type: "array",
    //       items: {
    //         type: "object",
    //         description: "The profession of a person or human being.",
    //         properties: {
    //           entity_id: {
    //             $ref: "#/$defs/entity_id",
    //           },
    //           name: {
    //             $ref: "#/$defs/property_types/name",
    //           },
    //         },
    //         required: ["entity_id", "name"],
    //       },
    //     },
    //     address: {
    //       type: "array",
    //       items: {
    //         type: "object",
    //         description:
    //           "Information required to identify a specific location on the planet associated with a postal address.",
    //         properties: {
    //           entity_id: {
    //             $ref: "#/$defs/entity_id",
    //           },
    //           street_address_line_1: {
    //             $ref: "#/$defs/property_types/street_address_line_1",
    //           },
    //           address_level_1: {
    //             $ref: "#/$defs/property_types/address_level_1",
    //           },
    //           postal_code: {
    //             $ref: "#/$defs/property_types/postal_code",
    //           },
    //           alpha_2_country_code: {
    //             $ref: "#/$defs/property_types/alpha_2_country_code",
    //           },
    //           mapbox_full_address: {
    //             $ref: "#/$defs/property_types/mapbox_full_address",
    //           },
    //         },
    //       },
    //     },
    //     has_profession: {
    //       type: "array",
    //       items: {
    //         type: "object",
    //         description: "A relationship between a person and a profession.",
    //         properties: {
    //           entity_id: {
    //             $ref: "#/$defs/entity_id",
    //           },
    //           source_entity: {
    //             $ref: "#/$defs/entity_id",
    //           },
    //           target_entity: {
    //             $ref: "#/$defs/entity_id",
    //           },
    //         },
    //         required: ["entity_id", "source_entity", "target_entity"],
    //       },
    //     },
    //     has_relation_ship: {
    //       type: "array",
    //       items: {
    //         type: "object",
    //         description:
    //           "A relationship between two persons, e.g. married, parent, child, etc.",
    //         properties: {
    //           entity_id: {
    //             $ref: "#/$defs/entity_id",
    //           },
    //           source_entity: {
    //             $ref: "#/$defs/entity_id",
    //           },
    //           target_entity: {
    //             $ref: "#/$defs/entity_id",
    //           },
    //           name: {
    //             $ref: "#/$defs/property_types/name",
    //           },
    //         },
    //         required: ["entity_id", "source_entity", "target_entity"],
    //       },
    //     },
    //     has_associated_location: {
    //       type: "array",
    //       items: {
    //         type: "object",
    //         description: "The location which is associated with a person.",
    //         properties: {
    //           entity_id: {
    //             $ref: "#/$defs/entity_id",
    //           },
    //           source_entity: {
    //             $ref: "#/$defs/entity_id",
    //           },
    //           target_entity: {
    //             $ref: "#/$defs/entity_id",
    //           },
    //           name: {
    //             $ref: "#/$defs/property_types/name",
    //           },
    //         },
    //         required: ["entity_id", "source_entity", "target_entity"],
    //       },
    //     },
    //   },
    // };
  },

  async getDataType(params: {
    dataTypeId: VersionedUrl;
  }): Promise<DataTypeWithMetadata> {
    if (!(params.dataTypeId in dataTypeCache)) {
      dataTypeCache[params.dataTypeId] = await getDataTypeById(
        createInfo.graphContext,
        {
          dataTypeId: params.dataTypeId,
        },
      );
    }

    return dataTypeCache[params.dataTypeId]!;
  },

  async getDataTypeSubgraph(params: {
    dataTypeId: VersionedUrl;
    graphResolveDepths?: Partial<GraphResolveDepths>;
  }): Promise<Subgraph<DataTypeRootType>> {
    return await getDataTypeSubgraphById(createInfo.graphContext, {
      dataTypeId: params.dataTypeId,
      graphResolveDepths: {
        ...zeroedGraphResolveDepths,
        ...params.graphResolveDepths,
      },
      temporalAxes: currentTimeInstantTemporalAxes,
      actorId: createInfo.actorId,
    });
  },

  async getPropertyType(params: {
    propertyTypeId: VersionedUrl;
  }): Promise<PropertyTypeWithMetadata> {
    if (!(params.propertyTypeId in propertyTypeCache)) {
      propertyTypeCache[params.propertyTypeId] = await getPropertyTypeById(
        createInfo.graphContext,
        {
          propertyTypeId: params.propertyTypeId,
        },
      );
    }

    return propertyTypeCache[params.propertyTypeId]!;
  },

  async getPropertyTypeSubgraph(params: {
    propertyTypeId: VersionedUrl;
    graphResolveDepths?: Partial<GraphResolveDepths>;
  }): Promise<Subgraph<PropertyTypeRootType>> {
    return await getPropertyTypeSubgraphById(createInfo.graphContext, {
      propertyTypeId: params.propertyTypeId,
      graphResolveDepths: {
        ...zeroedGraphResolveDepths,
        ...params.graphResolveDepths,
      },
      temporalAxes: currentTimeInstantTemporalAxes,
      actorId: createInfo.actorId,
    });
  },

  async getEntityType(params: {
    entityTypeId: VersionedUrl;
  }): Promise<EntityTypeWithMetadata> {
    if (!(params.entityTypeId in entityTypeCache)) {
      entityTypeCache[params.entityTypeId] = await getEntityTypeById(
        createInfo.graphContext,
        {
          entityTypeId: params.entityTypeId,
        },
      );
    }

    return entityTypeCache[params.entityTypeId]!;
  },

  async getEntityTypeSubgraph(params: {
    entityTypeId: VersionedUrl;
    graphResolveDepths?: Partial<GraphResolveDepths>;
  }): Promise<Subgraph<EntityTypeRootType>> {
    return await getEntityTypeSubgraphById(createInfo.graphContext, {
      entityTypeId: params.entityTypeId,
      graphResolveDepths: {
        ...zeroedGraphResolveDepths,
        ...params.graphResolveDepths,
      },
      temporalAxes: currentTimeInstantTemporalAxes,
      actorId: createInfo.actorId,
    });
  },
});
