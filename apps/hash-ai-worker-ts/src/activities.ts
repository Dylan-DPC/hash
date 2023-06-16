import {
  createGraphClient,
  currentTimeInstantTemporalAxes,
  ImpureGraphContext,
  zeroedGraphResolveDepths,
} from "@apps/hash-api/src/graph";
import {
  getEntityTypeSubgraphById,
  getEntityTypeById,
} from "@apps/hash-api/src/graph/ontology/primitive/entity-type";
import {
  getDataTypeById,
  getDataTypeSubgraphById,
} from "@apps/hash-api/src/graph/ontology/primitive/data-type";
import {
  getPropertyTypeById,
  getPropertyTypeSubgraphById,
} from "@apps/hash-api/src/graph/ontology/primitive/property-type";
import { logger } from "@apps/hash-api/src/logger";
import { StorageType } from "@apps/hash-api/src/storage";
import {
  DataType,
  PropertyType,
  EntityType,
  VersionedUrl,
  BaseUrl,
  Object,
  ValueOrArray,
  Array,
  OneOf,
  AllOf,
} from "@blockprotocol/type-system";
import { getRequiredEnv } from "@local/hash-backend-utils/environment";
import { Logger } from "@local/hash-backend-utils/logger";
import {
  AccountId,
  DataTypeRootType,
  DataTypeWithMetadata,
  EntityTypeRootType,
  EntityTypeWithMetadata,
  GraphResolveDepths,
  isEntityVertexId,
  isOntologyTypeVertexId,
  OntologyTypeRevisionId,
  OntologyTypeVertexId,
  PropertyTypeRootType,
  PropertyTypeWithMetadata,
  Subgraph,
} from "@local/hash-subgraph";
import {
  getDataTypes,
  getPropertyTypes,
  getEntityTypes,
  getPropertyTypeByVertexId,
  getRoots,
  getPropertyTypeById,
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

type OntologyType = DataType | PropertyType | EntityType;
type OntologyTypeWithMetadata =
  | DataTypeWithMetadata
  | PropertyTypeWithMetadata
  | EntityTypeWithMetadata;

type PartialOntologyType<O extends OntologyType> = Omit<
  O,
  "$id" | "$schema" | "kind"
>;
type PartialOntologyTypeMap<O extends OntologyType> = {
  [id: VersionedUrl]: PartialOntologyType<O>;
};

const ontologyTypesToPartialSchemaMap = <O extends OntologyTypeWithMetadata>(
  ontologyTypes: O[],
): PartialOntologyTypeMap<O["schema"]> =>
  ontologyTypes.reduce(
    (map: PartialOntologyTypeMap<O["schema"]>, ontologyType: O) => {
      const schema: O["schema"] = ontologyType.schema;
      const { $id, $schema: _, kind: __, ...partialOntologyType } = schema;

      // eslint-disable-next-line no-param-reassign
      map[$id] = partialOntologyType;
      return map;
    },
    {},
  );

type PartialDataType = {
  title: string;
  description?: string;
  type: string;
};
type PartialDataTypeMap = { [id: VersionedUrl]: PartialDataType };

type PartialPropertyValues =
  | PartialDataType
  | Object<ValueOrArray<PartialPropertyType>>
  | Array<OneOf<PartialPropertyValues>>;
interface PartialPropertyType extends OneOf<PartialPropertyValues> {
  $id: VersionedUrl;
  title: string;
  description?: string;
}
type PartialPropertyTypeMap = { [id: VersionedUrl]: PartialPropertyType };

interface PartialEntityType
  extends AllOf<PartialEntityType>,
    Object<ValueOrArray<PartialPropertyType>> {
  title: string;
  description?: string;
}
type PartialEntityTypeMap = { [id: VersionedUrl]: PartialEntityType };

const dataTypesToPartialSchemaMap = (
  dataTypes: DataTypeWithMetadata[],
): PartialDataTypeMap =>
  dataTypes.reduce((map: PartialDataTypeMap, dataType) => {
    // eslint-disable-next-line no-param-reassign
    map[dataType.schema.$id] = {
      title: dataType.schema.title,
      description: dataType.schema.description,
      type: dataType.schema.type,
    };
    return map;
  }, {});

const processedPropertyTypes: PartialPropertyTypeMap = {};

const processPropertyType = (
  id: VersionedUrl,
  propertyType: PropertyType,
): PartialPropertyType => {
  if (id in processedPropertyTypes) {
    return processedPropertyTypes[id]!;
  }

  processedPropertyTypes[id] = propertyType;
  for (const [index, oneOf] of propertyType.oneOf.entries()) {
    if ("$ref" in oneOf) {
      processedPropertyTypes[id]["oneOf"]![index] = dataTypes[oneOf.$ref];
    } else if ("properties" in oneOf) {
      for (const [propertyId, property] of Object.entries(oneOf.properties)) {
        processPropertyType(property.$ref, propertyTypes[property.$ref]);

        processedPropertyTypes[id]["oneOf"][index]["properties"][
          processedPropertyTypes[property.$ref].title
        ] = processedPropertyTypes[property.$ref];
        delete processedPropertyTypes[id]["oneOf"][index]["properties"][
          propertyId
        ];
      }
    } else if ("items" in oneOf) {
      if ("$ref" in oneOf.items) {
        processPropertyType(oneOf.items.$ref, propertyTypes[oneOf.items.$ref]);
        processedPropertyTypes[id]["oneOf"][index]["items"] =
          processedPropertyTypes[oneOf.items.$ref];
      }
    }
  }
};

const propertyTypesToPartialSchemaMap = (
  propertyTypes: PropertyTypeWithMetadata[],
): PartialPropertyTypeMap =>
  propertyTypes.reduce((map: PartialPropertyTypeMap, propertyType) => {
    if (propertyType.schema.$id in processedPropertyTypes) {
      return map;
    }

    // eslint-disable-next-line no-param-reassign
    map[propertyType.schema.$id] = {
      title: propertyType.schema.title,
      description: propertyType.schema.description,
      oneOf,
    };
    return map;
  }, {});

const dataTypeCache: { [id: VersionedUrl]: DataTypeWithMetadata } = {};
const propertyTypeCache: { [id: VersionedUrl]: PropertyTypeWithMetadata } = {};
const entityTypeCache: { [id: VersionedUrl]: EntityTypeWithMetadata } = {};

export const createGraphActivities = (createInfo: {
  graphContext: ImpureGraphContext;
  actorId: AccountId;
}) => ({
  async printTerminal(...args: any[]) {
    console.log(...args);
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
