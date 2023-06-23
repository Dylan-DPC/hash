import { promises as fs } from "node:fs";

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
import { EntityType, VersionedUrl } from "@blockprotocol/type-system";
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
import { getEntityTypes, getRoots } from "@local/hash-subgraph/stdlib";
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

const extractProperties = (
  entityType: PartialEntityType,
): { title: string; description?: string; required: boolean }[] => {
  return Object.entries(entityType.properties).map(([propertyId, property]) => {
    return {
      required: entityType.required
        ? entityType.required.includes(propertyId)
        : false,
      title: property.title,
      description: property.description,
    };
  });
};

export const createGraphActivities = (createInfo: {
  graphContext: ImpureGraphContext;
  actorId: AccountId;
}) => ({
  collectEntityInformation: async (params: {
    entityType: PartialEntityType;
    prompt: string;
    links?: Array<[EntityType, Array<EntityType>]>;
  }): Promise<string> => {
    const system_prompt = `The user will provide a text, which may or may not contain entities of interest. It might be possible, that the text contains multiple entities as well. 

We are interested in all entities of the type "${
      params.entityType.title
    }". The type itself is described as
\`\`\`
${params.entityType.description}
\`\`\`

In the summary, these properties should be taken into account:
${extractProperties(params.entityType)
  .map(
    (property) =>
      `- ${property.title} (${property.required ? "required" : "optional"}): ${
        property.description
      }`,
  )
  .join("\n")}

Extract all entities available in the text but only provide the above information. Order the entities by their relevance. Separate each distinct entity in the list by a "---" separator.
If the text does not contain any entities of the type "Person", use "N/A" to denote.`;

    console.log(system_prompt);

    // return JSON.stringify(createUserPrompt(params.entityType));
    const apiKey = getRequiredEnv("OPENAI_API_KEY");
    const configuration = new Configuration({
      apiKey,
    });
    const openai = new OpenAIApi(configuration);
    try {
      const response = await openai.createChatCompletion({
        // model: "gpt-4-0613",
        model: "gpt-3.5-turbo-0613",
        temperature: 0,
        max_tokens: 1500,
        // functions: [
        //   {
        //     name: `create_entity`,
        //     description:
        //       "Converts a list of properties into a list of entities.",
        //     parameters: {
        //       type: "object",
        //       properties: {
        //         entities: {
        //           type: "array",
        //           description: "The list of properties.",
        //           items: {
        //             type: "object",
        //             properties: {
        //               propertyName: {
        //                 type: "string",
        //               },
        //               property: {
        //                 type: "string",
        //               },
        //             },
        //           },
        //         },
        //       },
        //     },
        //   },
        // ],
        // function_call: { name: "create_entity" },
        messages: [
          {
            role: "system",
            content: system_prompt,
          },
          {
            role: "user",
            content: params.prompt,
            // content: createUserPrompt(params.entityType),
          },
        ],
      });
      return response.data.choices[0]!.message!.content!;
      // response.data.choices[0]!.message!.function_call!.arguments!,
    } catch (error) {
      if (error.response) {
        console.log(error.response.status);
        console.log(error.response.data);
      } else {
        console.log(error.message);
      }
    }
  },

  createEntitiesActivity: async (params: {
    entityTypeSchemas: PartialEntityType[];
    promptPath: string;
    model: string;
  }): Promise<object> => {
    const prompt = await fs.readFile(params.promptPath, "utf-8");
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
          const entitySchema = {
            type: "array",
            items: {
              title: "Entity",
              type: "object",
              properties: {
                entityId: {
                  $ref: "#/$defs/entity_id",
                },
              },
            },
          };

          const entityTypeId = entityTypeSchema.$id;
          delete entityTypeSchema.$id;

          if (
            entityTypeSchema.allOf &&
            entityTypeSchema.allOf[0]?.title === "Link"
          ) {
            entitySchema.items.properties.sourceEntityId = {
              $ref: "#/$defs/entity_id",
            };
            entitySchema.items.properties.targetEntityId = {
              $ref: "#/$defs/entity_id",
            };
          }

          if (Object.keys(entityTypeSchema.properties).length !== 0) {
            entitySchema.items.properties.entityProperties = entityTypeSchema;
            delete entitySchema.items.properties.entityProperties.allOf;
          }

          return [entityTypeId, entitySchema];
        }),
      ),
    };

    function removeMeta(obj: object) {
      // Recursivly remove `$id`, `$schema` and `kind` from the object.
      for (const key in obj) {
        if (key === "$id" || key === "$schema" || key === "kind") {
          delete obj[key];
        } else if (typeof obj[key] === "object") {
          removeMeta(obj[key]);
        }
      }
    }
    removeMeta(schema);

    console.log(JSON.stringify({ schema }, null, 2));
    const apiKey = getRequiredEnv("OPENAI_API_KEY");
    const configuration = new Configuration({
      apiKey,
    });
    const openai = new OpenAIApi(configuration);
    const response = await openai.createChatCompletion({
      model: params.model,
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

    const usage = response.data.usage;
    console.log({ usage });

    return response.data.choices[0]!.message!.function_call?.arguments;
  },

  createEntitiesActivityUntagged: async (params: {
    entityTypeSchemas: PartialEntityType[];
    promptPath: string;
    model: string;
  }): Promise<object> => {
    const prompt = await fs.readFile(params.promptPath, "utf-8");
    const schema = {
      type: "object",
      properties: Object.fromEntries(
        params.entityTypeSchemas.map((entityTypeSchema) => {
          const entitySchema = {
            type: "array",
            items: entityTypeSchema,
          };

          if (
            entityTypeSchema.allOf &&
            entityTypeSchema.allOf[0]?.title === "Link"
          ) {
            entitySchema.items.sourceEntityId = {
              type: string,
            };
            entitySchema.items.properties.targetEntityId = {
              type: string,
            };
          }

          return [entityTypeSchema.$id, entitySchema];
        }),
      ),
    };

    function removeMeta(obj: object) {
      // Recursivly remove `$id`, `$schema` and `kind` from the object.
      for (const key in obj) {
        if (key === "$id" || key === "$schema" || key === "kind") {
          delete obj[key];
        } else if (typeof obj[key] === "object") {
          removeMeta(obj[key]);
        }
      }
    }
    removeMeta(schema);

    console.log(JSON.stringify({ schema }, null, 2));
    const apiKey = getRequiredEnv("OPENAI_API_KEY");
    const configuration = new Configuration({
      apiKey,
    });
    const openai = new OpenAIApi(configuration);
    const response = await openai.createChatCompletion({
      model: params.model,
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

    const usage = response.data.usage;
    console.log({ usage });

    return response.data.choices[0]!.message!.function_call?.arguments;
  },

  async getDataType(params: {
    dataTypeId: VersionedUrl;
  }): Promise<DataTypeWithMetadata> {
    if (!(params.dataTypeId in dataTypeCache)) {
      const [dataType] = await getDataTypeSubgraphById(
        createInfo.graphContext,
        {
          dataTypeId: params.dataTypeId,
          graphResolveDepths: zeroedGraphResolveDepths,
          temporalAxes: currentTimeInstantTemporalAxes,
          actorId: createInfo.actorId,
        },
      ).then(getRoots);

      if (!dataType) {
        throw new Error(`Data type with ID ${params.dataTypeId} not found.`);
      }

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
      const [propertyType] = await getPropertyTypeSubgraphById(
        createInfo.graphContext,
        {
          propertyTypeId: params.propertyTypeId,
          graphResolveDepths: zeroedGraphResolveDepths,
          temporalAxes: currentTimeInstantTemporalAxes,
          actorId: createInfo.actorId,
        },
      ).then(getRoots);

      if (!propertyType) {
        throw new Error(
          `Property type with ID ${params.propertyTypeId} not found.`,
        );
      }

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
      const [entityType] = await getEntityTypeSubgraphById(
        createInfo.graphContext,
        {
          entityTypeId: params.entityTypeId,
          graphResolveDepths: zeroedGraphResolveDepths,
          temporalAxes: currentTimeInstantTemporalAxes,
          actorId: createInfo.actorId,
        },
      ).then(getRoots);

      if (!entityType) {
        throw new Error(`No entity type found for ${params.entityTypeId}`);
      }

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

  async getEntityTypeIds(params: {
    entityTypeId: VersionedUrl;
    graphResolveDepths?: Partial<GraphResolveDepths>;
  }): Promise<VersionedUrl[]> {
    return await getEntityTypeSubgraphById(createInfo.graphContext, {
      entityTypeId: params.entityTypeId,
      graphResolveDepths: {
        ...zeroedGraphResolveDepths,
        ...params.graphResolveDepths,
      },
      temporalAxes: currentTimeInstantTemporalAxes,
      actorId: createInfo.actorId,
    }).then((subgraph) =>
      getEntityTypes(subgraph).map((entity_type) => entity_type.schema.$id),
    );
  },
});
