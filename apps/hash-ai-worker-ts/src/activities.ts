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
