import {
  AllOf,
  Array as TypeSystemArray,
  BaseUrl,
  Object as TypeSystemObject,
  OneOf,
  PropertyTypeReference,
  PropertyValues,
  ValueOrArray,
  VersionedUrl,
} from "@blockprotocol/type-system";
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

export const {
  getDataType,
  getDataTypeSubgraph,
  getPropertyType,
  getPropertyTypeSubgraph,
  getEntityType,
  getEntityTypeSubgraph,
  getEntityTypeIds,
  createEntities,
} = proxyActivities<ReturnType<typeof createGraphActivities>>({
  startToCloseTimeout: "180 second",
  retry: {
    maximumAttempts: 1,
  },
});

export type PartialDataType = {
  title: string;
  description?: string;
  type: string;
};
type PartialDataTypeMap = { [id: VersionedUrl]: PartialDataType };
const partialDataTypeCache: PartialDataTypeMap = {};

export type PartialPropertyValues =
  | PartialDataType
  | TypeSystemObject<ValueOrArray<PartialPropertyType>>
  | TypeSystemArray<OneOf<PartialPropertyValues>>;
type PartialPropertyType = OneOf<PartialPropertyValues> & {
  title: string;
  description?: string;
};

type PartialPropertyTypeMap = { [id: VersionedUrl]: PartialPropertyType };
const partialPropertyTypeCache: PartialPropertyTypeMap = {};

export interface PartialEntityType
  extends AllOf<PartialEntityType>,
    TypeSystemObject<ValueOrArray<PartialPropertyType>> {
  title: string;
  description?: string;
  $id: VersionedUrl;
  additionalProperties: false;
}
type PartialEntityTypeMap = { [id: VersionedUrl]: PartialEntityType };
const partialEntityTypeCache: PartialEntityTypeMap = {};

const getPartialDataType = async (
  dataTypeId: VersionedUrl,
): Promise<PartialDataType> => {
  if (!(dataTypeId in partialDataTypeCache)) {
    const data_type = await getDataType({ dataTypeId });
    partialDataTypeCache[dataTypeId] = {
      title: data_type.schema.title,
      description: data_type.schema.description,
      type: data_type.schema.type,
    };
  }

  return partialDataTypeCache[dataTypeId]!;
};

const convertProperties = async (
  key: BaseUrl,
  valueOrArray: ValueOrArray<PropertyTypeReference>,
): Promise<[BaseUrl, ValueOrArray<PartialPropertyType>]> => {
  if ("items" in valueOrArray) {
    return [
      key,
      {
        type: "array",
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        items: await getPartialPropertyType(valueOrArray.items.$ref),
        minItems: valueOrArray.minItems,
        maxItems: valueOrArray.maxItems,
      },
    ];
  } else {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return [key, await getPartialPropertyType(valueOrArray.$ref)];
  }
};

const convertPropertyObject = async (
  properties: Record<BaseUrl, ValueOrArray<PropertyTypeReference>>,
): Promise<Record<BaseUrl, ValueOrArray<PartialPropertyType>>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(properties).map(async (entry) => {
        return await convertProperties(entry[0], entry[1]);
      }),
    ),
  );

const convertOneOfValues = async (
  oneOf: OneOf<PropertyValues>["oneOf"],
): Promise<OneOf<PartialPropertyValues>["oneOf"]> =>
  (await Promise.all(
    oneOf.map(async (value) => {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      return await convertPropertyValues(value);
    }),
  )) as OneOf<PartialPropertyValues>["oneOf"];

const convertPropertyValues = async (
  values: PropertyValues,
): Promise<PartialPropertyValues> => {
  if ("$ref" in values) {
    return await getPartialDataType(values.$ref);
  } else if ("items" in values) {
    return {
      type: "array",
      items: {
        oneOf: await convertOneOfValues(values.items.oneOf),
      },
      minItems: values.minItems,
      maxItems: values.maxItems,
    };
  } else {
    return {
      type: "object",
      properties: await convertPropertyObject(values.properties),
      required: values.required,
    };
  }
};

const getPartialPropertyType = async (
  propertyTypeId: VersionedUrl,
): Promise<PartialPropertyType> => {
  if (!(propertyTypeId in partialPropertyTypeCache)) {
    const propertyType = await getPropertyType({ propertyTypeId });
    partialPropertyTypeCache[propertyTypeId] = {
      title: propertyType.schema.title,
      description: propertyType.schema.description,
      oneOf: await convertOneOfValues(propertyType.schema.oneOf),
    };
  }

  return partialPropertyTypeCache[propertyTypeId]!;
};

const getPartialEntityType = async (
  entityTypeId: VersionedUrl,
): Promise<PartialEntityType> => {
  if (!(entityTypeId in partialEntityTypeCache)) {
    const entityType = await getEntityType({ entityTypeId });
    partialEntityTypeCache[entityTypeId] = {
      title: entityType.schema.title,
      description: entityType.schema.description,
      $id: entityType.schema.$id,
      type: "object",
      allOf: entityType.schema.allOf
        ? await Promise.all(
            entityType.schema.allOf.map(async (value) => {
              return await getPartialEntityType(value.$ref);
            }),
          )
        : [],
      properties: await convertPropertyObject(entityType.schema.properties),
      additionalProperties: false,
    };
  }

  return partialEntityTypeCache[entityTypeId]!;
};

export async function createEntitiesForEntityTypes(params: {
  entityTypeIds: VersionedUrl[];
  prompt: string;
  depth: number;
}): Promise<any> {
  const allEntityTypeIds = await Promise.all(
    params.entityTypeIds.map(
      async (entityTypeId) =>
        await getEntityTypeIds({
          entityTypeId,
          graphResolveDepths: {
            constrainsLinksOn: { outgoing: params.depth },
            constrainsLinkDestinationsOn: { outgoing: params.depth },
          },
        }),
    ),
  ).then((entityTypeIds) => entityTypeIds.flat());

  console.log(allEntityTypeIds);

  const entityTypeSchemas = await Promise.all(
    allEntityTypeIds.map(async (id) => await getPartialEntityType(id)),
  );
  console.log(JSON.stringify({ entityTypeSchemas }, null, 2));

  const entities = await createEntities({
    entityTypeSchemas,
    prompt: params.prompt,
  });

  console.log(entities);

  return entities;
}
