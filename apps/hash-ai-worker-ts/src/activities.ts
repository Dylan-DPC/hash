import {
  createGraphClient,
  currentTimeInstantTemporalAxes,
  ImpureGraphContext,
  zeroedGraphResolveDepths,
} from "@apps/hash-api/src/graph";
import { getEntityTypeSubgraphById } from "@apps/hash-api/src/graph/ontology/primitive/entity-type";
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
    const subgraph = await getEntityTypeSubgraphById(createInfo.graphContext, {
      entityTypeId: params.entityTypeId,
      graphResolveDepths: {
        ...zeroedGraphResolveDepths,
        ...params.graphResolveDepths,
        constrainsPropertiesOn: { outgoing: 1 },
      },
      temporalAxes: currentTimeInstantTemporalAxes,
      actorId: createInfo.actorId,
    });

    const roots = getRoots(subgraph);
    if (roots.length !== 1) {
      throw new Error(
        `Expected exactly one root entity, but found ${roots.length} roots.`,
      );
    }
    const root = roots[0]!;

    const title = root.schema.title;
    const description = root.schema.description;

    const rootEdges =
      subgraph.edges[root.metadata.recordId.baseUrl]?.[
        root.metadata.recordId.version.toString() as OntologyTypeRevisionId
      ];

    const rootPropertyTypes = rootEdges
      ?.filter(({ kind }) => kind === "CONSTRAINS_PROPERTIES_ON")
      .map(({ rightEndpoint }) => {
        return getPropertyTypeByVertexId(
          subgraph,
          rightEndpoint as OntologyTypeVertexId,
        )!;
      });

    const apiKey = getRequiredEnv("OPENAI_API_KEY");

    const configuration = new Configuration({
      apiKey,
    });
    const openai = new OpenAIApi(configuration);

    const prompt = `
    Character 1: Amelia Hartley
    Address: 452 Willow Lane, Evergreen Heights
    
    Amelia Hartley, a vivacious young artist with a passion for vibrant colors, resides at 452 Willow Lane in the charming neighborhood of Evergreen Heights. Her cozy address is adorned with blooming flowers and adorned windows, reflecting her imaginative spirit. Within the walls of her quaint cottage, Amelia creates breathtaking paintings that transport viewers to dreamlike realms.
    
    Character 2: Jackson Bennett
    Address: 725 Oakwood Avenue, Ravenwood Manor
    
    At 725 Oakwood Avenue, nestled within the enigmatic Ravenwood Manor, resides Jackson Bennett—a brooding writer known for his mesmerizing tales of mystery and suspense. Shadows dance across the imposing manor's ivy-clad facade, hinting at the secrets concealed within. Jackson's study overlooks the sprawling gardens, providing him with inspiration as he weaves intricate plots that captivate readers worldwide.
    
    Character 3: Lily Chen
    Address: 317 Cherry Blossom Lane, Serenity Meadows
    
    In the idyllic neighborhood of Serenity Meadows, a tranquil abode awaits at 317 Cherry Blossom Lane, the residence of Lily Chen. Her home is a serene sanctuary, surrounded by fragrant cherry blossom trees that paint the landscape with delicate hues. Lily, a dedicated yoga instructor, opens her doors to students seeking balance and mindfulness. The gentle ambiance of her address serves as a testament to her calming presence.
    
    Character 4: Max Cooper
    Address: 912 Harborview Terrace, Ocean's Edge
    
    Perched on the edge of a picturesque seaside cliff, Max Cooper's address at 912 Harborview Terrace provides a breathtaking view of the vast ocean expanse. His modern beachfront retreat in Ocean's Edge is a testament to his adventurous spirit and love for the sea. Max, an avid marine biologist, spends his days exploring the depths, unraveling the mysteries of the ocean's inhabitants, and returning home to his address that resonates with the soothing sound of crashing waves.
    `;

    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      temperature: 0,
      max_tokens: 1500,
      messages: [
        {
          role: "system",
          content: `You are a helper AI to generate entities given a specified entity type. "user" will you provide a text and you
            shall fill out the fields of the entities mentioned in the text. Don't use other sources to provide
            information than the provided text "user" will give you. If the text does not match the description use denote it as "null".`,
        },
        {
          role: "user",
          content: `
            Title: Person
            Description: Represents an individual human being. It encapsulates the attributes and characteristics that define a person's identity, including their name, age, and gender.
            Properties: 
             - Title: Name
               Id: https://blockprotocol.org/@blockprotocol/types/property-type/name/v/1
               Description: The full name of a person.
             - Title: Age
               Id: https://blockprotocol.org/@blockprotocol/types/property-type/age/v/4
               Description: The age of a person.
             - Title: Gender
               Id: https://hash.org/@alice/types/property-type/gender/v/2
               Description: The gender of a person.
            Text: Albert Einstein; 14 March 1879 – 18 April 1955) was a German-born theoretical physicist. Best known for developing the theory of relativity, he also made important contributions to the development of the theory of quantum mechanics, and thus to modern physics. His mass–energy equivalence formula E = mc2, which arises from relativity theory, has been dubbed "the world's most famous equation". His work is also known for its influence on the philosophy of science. He received the 1921 Nobel Prize in Physics "for his services to theoretical physics, and especially for his discovery of the law of the photoelectric effect", a pivotal step in the development of quantum theory.Einsteinium, one of the synthetic elements in the periodic table, was named in his honor.
          `,
        },
        {
          role: "assistant",
          content: `[
            {
              "https://blockprotocol.org/@blockprotocol/types/property-type/name/" : "Albert Einstein",
              "https://blockprotocol.org/@blockprotocol/types/property-type/age/" : 76,
              "https://hash.org/@alice/types/property-type/gender/": "male"
            }
          ]`,
        },
        {
          role: "user",
          content: `
            Title: ${title}
            Description: ${description!}
            Properties: 
            ${rootPropertyTypes!
              .map(
                (propertyType) => `
              - Title: ${propertyType.schema.title}
                Id: ${propertyType.schema.$id}
                Description: ${propertyType.schema.description!}
            `,
              )
              .join("\n")}
            Text: ${prompt}
          `,
        },
      ],
    });

    return response.data.choices[0]!.message!.content;
  },
});
