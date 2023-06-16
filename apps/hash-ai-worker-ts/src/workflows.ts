import {
  AllOf,
  Array as TypeSystemArray,
  Object as TypeSystemObject,
  OneOf,
  PropertyType,
  PropertyTypeReference,
  PropertyValues,
  ValueOrArray,
  VersionedUrl,
  BaseUrl,
} from "@blockprotocol/type-system";
import { typedEntries } from "@local/advanced-types/typed-entries";
import { proxyActivities, sleep } from "@temporalio/workflow";

import * as activities from "./activities";
import { createGraphActivities } from "./activities";
import {
  getPropertyTypeByVertexId,
  getRoots,
} from "@local/hash-subgraph/stdlib";
import {
  OntologyTypeRevisionId,
  OntologyTypeVertexId,
} from "@local/hash-subgraph/.";

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
  printTerminal,
} = proxyActivities<ReturnType<typeof createGraphActivities>>({
  startToCloseTimeout: "20 second",
  retry: {
    maximumAttempts: 1,
  },
});

type PartialDataType = {
  title: string;
  description?: string;
  type: string;
};
type PartialDataTypeMap = { [id: VersionedUrl]: PartialDataType };
const partialDataTypeCache: PartialDataTypeMap = {};

type PartialPropertyValues =
  | PartialDataType
  | TypeSystemObject<ValueOrArray<PartialPropertyType>>
  | TypeSystemArray<OneOf<PartialPropertyValues>>;
type PartialPropertyType = OneOf<PartialPropertyValues> & {
  title: string;
  description?: string;
};

type PartialPropertyTypeMap = { [id: VersionedUrl]: PartialPropertyType };
const partialPropertyTypeCache: PartialPropertyTypeMap = {};

interface PartialEntityType
  extends AllOf<PartialEntityType>,
    TypeSystemObject<ValueOrArray<PartialPropertyType>> {
  title: string;
  description?: string;
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
  object: TypeSystemObject<ValueOrArray<PropertyTypeReference>>,
): Promise<TypeSystemObject<ValueOrArray<PartialPropertyType>>> => {
  return {
    type: "object",
    properties: Object.fromEntries(
      await Promise.all(
        Object.entries(object.properties).map(async (entry) => {
          return await convertProperties(entry[0], entry[1]);
        }),
      ),
    ),
    required: object.required,
  };
};

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
    return await convertPropertyObject(values);
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

//   async createEntitiesFor(params: {
//     entityTypeId: VersionedUrl;
//     graphResolveDepths?: Partial<GraphResolveDepths>;
//   }): Promise<Subgraph<EntityTypeRootType>> {

//     const dataTypes = ontologyTypesToPartialSchemaMap(getDataTypes(subgraph));
//     const propertyTypes = ontologyTypesToPartialSchemaMap(
//       getPropertyTypes(subgraph),
//     );
//     const entityTypes = ontologyTypesToPartialSchemaMap(
//       getEntityTypes(subgraph),
//     );

//     const processedPropertyTypes: { [id: VersionedUrl]: any } = {};
//     const processedEntityTypes: { [id: VersionedUrl]: any } = {};

//     const processPropertyType = (
//       id: VersionedUrl,
//       propertyType: PartialOntologyType<PropertyType>,
//     ) => {
//       if (id in processedPropertyTypes) {
//         return;
//       }

//       processedPropertyTypes[id] = propertyType;
//       for (const [index, oneOf] of propertyType.oneOf.entries()) {
//         if ("$ref" in oneOf) {
//           if (oneOf.$ref in dataTypes) {
//             processedPropertyTypes[id]["oneOf"]![index] = dataTypes[oneOf.$ref];
//           }
//         } else if ("properties" in oneOf) {
//           for (const [propertyId, property] of Object.entries(
//             oneOf.properties,
//           )) {
//             processPropertyType(property.$ref, propertyTypes[property.$ref]);

//             processedPropertyTypes[id]["oneOf"][index]["properties"][
//               processedPropertyTypes[property.$ref].title
//             ] = processedPropertyTypes[property.$ref];
//             delete processedPropertyTypes[id]["oneOf"][index]["properties"][
//               propertyId
//             ];
//           }
//         } else if ("items" in oneOf) {
//           if ("$ref" in oneOf.items) {
//             processPropertyType(
//               oneOf.items.$ref,
//               propertyTypes[oneOf.items.$ref],
//             );
//             processedPropertyTypes[id]["oneOf"][index]["items"] =
//               processedPropertyTypes[oneOf.items.$ref];
//           }
//         }
//       }
//     };

//     const processEntityType = (
//       id: VersionedUrl,
//       entityType: PartialOntologyType<EntityType>,
//     ) => {
//       if (id in processedPropertyTypes) {
//         return;
//       }

//       processedEntityTypes[id] = entityType;
//       for (const [propertyTypeBaseId, propertyType] of Object.entries(
//         entityType.properties,
//       )) {
//         if ("$ref" in propertyType) {
//           if (propertyType.$ref in processedEntityTypes) {
//             processedEntityTypes[propertyType.$ref].propertyTypeBaseId =
//               dataTypes[oneOf.$ref];
//           }
//         } else if ("properties" in oneOf) {
//           for (const [propertyId, property] of Object.entries(
//             oneOf.properties,
//           )) {
//             processPropertyType(property.$ref, propertyTypes[property.$ref]);

//             processedPropertyTypes[id]["oneOf"][index]["properties"][
//               processedPropertyTypes[property.$ref].title
//             ] = processedPropertyTypes[property.$ref];
//             delete processedPropertyTypes[id]["oneOf"][index]["properties"][
//               propertyId
//             ];
//           }
//         } else if ("items" in oneOf) {
//           if ("$ref" in oneOf.items) {
//             processPropertyType(
//               oneOf.items.$ref,
//               propertyTypes[oneOf.items.$ref],
//             );
//             processedPropertyTypes[id]["oneOf"][index]["items"] =
//               processedPropertyTypes[oneOf.items.$ref];
//           }
//         }
//       }
//     };

//     for (const [id, propertyType] of Object.entries(propertyTypes)) {
//       processPropertyType(id as VersionedUrl, propertyType);
//     }

//     console.log(JSON.stringify(processedPropertyTypes, null, 2));
//     return processedPropertyTypes;

//     // const roots = getRoots(subgraph);
//     // if (roots.length !== 1) {
//     //   throw new Error(
//     //     `Expected exactly one root entity, but found ${roots.length} roots.`,
//     //   );
//     // }
//     // const root = roots[0]!;

//     // const title = root.schema.title;
//     // const description = root.schema.description;

//     // const rootEdges =
//     //   subgraph.edges[root.metadata.recordId.baseUrl]?.[
//     //     root.metadata.recordId.version.toString() as OntologyTypeRevisionId
//     //   ];

//     // const rootPropertyTypes = rootEdges
//     //   ?.filter(({ kind }) => kind === "CONSTRAINS_PROPERTIES_ON")
//     //   .map(({ rightEndpoint }) => {
//     //     return getPropertyTypeByVertexId(
//     //       subgraph,
//     //       rightEndpoint as OntologyTypeVertexId,
//     //     )!;
//     //   });

//     const apiKey = getRequiredEnv("OPENAI_API_KEY");

//     const configuration = new Configuration({
//       apiKey,
//     });
//     const openai = new OpenAIApi(configuration);

//     const prompt = `
//     John Smith from 33333 Bielefeld, Germany, Milky way, a hardworking middle-aged man, finds himself in an unusual love triangle with two remarkable women, Sarah Johnson and Emily Williams. John's heart is torn between these two strong-willed and intelligent individuals, leading to a complex and emotionally charged relationship dynamic.

// Sarah Johnson, a successful businesswoman, is a confident and independent woman who brings a sense of adventure to John's life. They met during a business conference and were instantly drawn to each other's charismatic personalities. Sarah's ambition and drive match John's own determination, creating a passionate and intense connection between them.

// On the other hand, Emily Williams, a compassionate artist, captures John's heart with her gentle and nurturing nature. They met at an art gallery where Emily's captivating paintings left John mesmerized. Emily's creativity and free spirit awaken a sense of vulnerability in John, leading to a deep emotional bond between them.

// As the story unfolds, the intricate relationship dynamics between John, Sarah, and Emily become more pronounced. Each person brings a unique set of qualities and experiences, challenging and inspiring one another in different ways. The complexity of their intertwined lives unfolds as they navigate the joys and hardships of love, commitment, and self-discovery`;

//     const schema = {
//       type: "object",
//       $defs: {
//         entity_id: {
//           description: "The unique identifier of the entity.",
//           type: "number",
//         },
//         property_types: {
//           name: {
//             title: "Name",
//             description:
//               "A word or set of words by which something is known, addressed, or referred to.",
//             oneOf: [trimOntologyType(textDataType)],
//           },
//           e_mail: {
//             title: "E-Mail",
//             description: "An e-mail address.",
//             oneOf: [trimOntologyType(textDataType)],
//           },
//           street_address_line_1: {
//             title: "Street Address Line 1",
//             description:
//               "The first line of street information of an address. \n\nConforms to the “address-line1” field of the “WHATWG Autocomplete Specification”.\n\nSee: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fe-autocomplete-address-level1",
//             oneOf: [trimOntologyType(textDataType)],
//           },
//           address_level_1: {
//             title: "Address Level 1",
//             description:
//               "The broadest administrative level in the address, i.e. the province within which the locality is found; for example, in the US, this would be the state; in Switzerland it would be the canton; in the UK, the post town.\n\nCorresponds to the “address-level1” field of the “WHATWG Autocomplete Specification”.\n\nSee: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fe-autocomplete-address-level1",
//             oneOf: [trimOntologyType(textDataType)],
//           },
//           postal_code: {
//             title: "Postal Code",
//             description:
//               "The postal code of an address.\n\nThis should conform to the standards of the area the code is from, for example\n\n- a UK postcode might look like: “SW1A 1AA”\n\n- a US ZIP code might look like: “20500”",
//             oneOf: [trimOntologyType(numberDataType)],
//           },
//           alpha_2_country_code: {
//             title: "Alpha-2 Country Code",
//             description:
//               "The short-form of a country’s name.\n\nConforms to the ISO 3166 alpha-2 country code specification.\n\nSee: https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2",
//             oneOf: [trimOntologyType(textDataType)],
//           },
//           mapbox_full_address: {
//             title: "Mapbox Full Address",
//             description:
//               "A complete address as a string.\n\nConforms to the “full_address” output of the Mapbox Autofill API.\n\nSee: https://docs.mapbox.com/mapbox-search-js/api/core/autofill/#autofillsuggestion#full_address",
//             oneOf: [trimOntologyType(textDataType)],
//           },
//         },
//       },
//       properties: {
//         persons: {
//           type: "array",
//           items: {
//             title: "Person",
//             type: "object",
//             description:
//               "An extremely simplified representation of a person or human being.",
//             properties: {
//               entity_id: {
//                 $ref: "#/$defs/entity_id",
//               },
//               name: {
//                 $ref: "#/$defs/property_types/name",
//               },
//               e_mail: {
//                 $ref: "#/$defs/property_types/e_mail",
//               },
//             },
//             required: ["name"],
//           },
//         },
//         professions: {
//           type: "array",
//           items: {
//             type: "object",
//             description: "The profession of a person or human being.",
//             properties: {
//               entity_id: {
//                 $ref: "#/$defs/entity_id",
//               },
//               name: {
//                 $ref: "#/$defs/property_types/name",
//               },
//             },
//             required: ["entity_id", "name"],
//           },
//         },
//         address: {
//           type: "array",
//           items: {
//             type: "object",
//             description:
//               "Information required to identify a specific location on the planet associated with a postal address.",
//             properties: {
//               entity_id: {
//                 $ref: "#/$defs/entity_id",
//               },
//               street_address_line_1: {
//                 $ref: "#/$defs/property_types/street_address_line_1",
//               },
//               address_level_1: {
//                 $ref: "#/$defs/property_types/address_level_1",
//               },
//               postal_code: {
//                 $ref: "#/$defs/property_types/postal_code",
//               },
//               alpha_2_country_code: {
//                 $ref: "#/$defs/property_types/alpha_2_country_code",
//               },
//               mapbox_full_address: {
//                 $ref: "#/$defs/property_types/mapbox_full_address",
//               },
//             },
//           },
//         },
//         has_profession: {
//           type: "array",
//           items: {
//             type: "object",
//             description: "A relationship between a person and a profession.",
//             properties: {
//               entity_id: {
//                 $ref: "#/$defs/entity_id",
//               },
//               source_entity: {
//                 $ref: "#/$defs/entity_id",
//               },
//               target_entity: {
//                 $ref: "#/$defs/entity_id",
//               },
//             },
//             required: ["entity_id", "source_entity", "target_entity"],
//           },
//         },
//         has_relation_ship: {
//           type: "array",
//           items: {
//             type: "object",
//             description:
//               "A relationship between two persons, e.g. married, parent, child, etc.",
//             properties: {
//               entity_id: {
//                 $ref: "#/$defs/entity_id",
//               },
//               source_entity: {
//                 $ref: "#/$defs/entity_id",
//               },
//               target_entity: {
//                 $ref: "#/$defs/entity_id",
//               },
//               name: {
//                 $ref: "#/$defs/property_types/name",
//               },
//             },
//             required: ["entity_id", "source_entity", "target_entity"],
//           },
//         },
//         has_associated_location: {
//           type: "array",
//           items: {
//             type: "object",
//             description: "The location which is associated with a person.",
//             properties: {
//               entity_id: {
//                 $ref: "#/$defs/entity_id",
//               },
//               source_entity: {
//                 $ref: "#/$defs/entity_id",
//               },
//               target_entity: {
//                 $ref: "#/$defs/entity_id",
//               },
//               name: {
//                 $ref: "#/$defs/property_types/name",
//               },
//             },
//             required: ["entity_id", "source_entity", "target_entity"],
//           },
//         },
//       },
//     };

//     const response = await openai.createChatCompletion({
//       model: "gpt-4-0613",
//       temperature: 0,
//       max_tokens: 1500,
//       functions: [
//         {
//           name: `create_entities_from_property_list`,
//           description:
//             "Creates a list of entities from the provided list of properties",
//           parameters: schema,
//         },
//       ],
//       function_call: { name: "create_entities_from_property_list" },
//       messages: [
//         {
//           role: "system",
//           content: `In an environment of a general knowledge store, entities are stored as JSON object consisting of various properties. To create entity types, information shall be extracted from unstructured data.

//           Each entity is created by calling 'create_entity_type' by passing in a list of properties.

//           You are responsible to extract the information and return the appropriated parameters to call this function.

//           If an information is missing don't make new information up, the provided data is the only source of truth.
//           If information is not provided it's not available.
//           If information is not strictly required it's optional.
//           If information is not explicitly stated it must not be assumed.
//           Each entity is associated with a unique id. This id is used to reference the entity in the knowledge store. Two entities can never have the same id - even if they are of different types.`,
//         },
//         {
//           role: "user",
//           content: prompt,
//         },
//       ],
//     });

//     console.log(response.data.choices[0]!.message!.function_call?.arguments);
//     console.log(response.data.usage);
//     return response.data.choices[0]!.message!.function_call?.arguments;
//   },

export async function createEntitiesForEntityTypes(params: {
  entityTypeIds: VersionedUrl[];
  prompt: string;
}): Promise<any> {
  for (const entityTypeId of params.entityTypeIds) {
    const subgraph = await getEntityTypeSubgraph({
      entityTypeId,
      graphResolveDepths: {
        constrainsPropertiesOn: { outgoing: 1 },
        // inheritsFrom: { outgoing: 255 },
        // constrainsLinksOn: { outgoing: 255 },
        // constrainsLinkDestinationsOn: { outgoing: 255 },
        // constrainsPropertiesOn: { outgoing: 255 },
        // constrainsValuesOn: { outgoing: 255 },
      },
    });
    // const roots = getRoots(subgraph);

    console.log(subgraph);
    //   const root = roots[0]!;
    //   const rootEdges =
    //     subgraph.edges[root.metadata.recordId.baseUrl]?.[
    //       root.metadata.recordId.version.toString() as OntologyTypeRevisionId
    //     ];
    //   const rootPropertyTypes = rootEdges
    //     ?.filter(({ kind }) => kind === "CONSTRAINS_PROPERTIES_ON")
    //     .map(({ rightEndpoint }) => {
    //       return getPropertyTypeByVertexId(
    //         subgraph,
    //         rightEndpoint as OntologyTypeVertexId,
    //       )!;
    //     });
    //   for (const propertyType of rootPropertyTypes!) {
    //     // await printTerminal(propertyType.schema.title);
    //     // await printTerminal(
    //     return await getPartialPropertyType(propertyType.schema.$id);
    //     // );
    //   }
  }
}
