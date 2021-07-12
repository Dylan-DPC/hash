import { genEntityId } from "../../../util";
import { DbPage } from "../../../types/dbTypes";
import {
  MutationCreatePageArgs,
  Resolver,
} from "../../autoGeneratedTypes";
import { GraphQLContext } from "../../context";
import { createEntity } from "../entity";

export const createPage: Resolver<
  Promise<DbPage>,
  {},
  GraphQLContext,
  MutationCreatePageArgs
> = async (_, { namespaceId, properties }, { dataSources }, info) => {
  const createdById = genEntityId(); // TODO

  // Convenience wrapper
  const _createEntity = async (type: string, properties: any) => {
    return await createEntity(
      {},
      { namespaceId, createdById, type, properties },
      { dataSources },
      info
    );
  };

  const newHeaderEntity = await _createEntity(
    "Text",
    { texts: [{ text: properties.title, bold: true }] }
  );

  const newHeaderBlock = await _createEntity(
    "Block",
    {
      componentId: "https://block.blockprotocol.org/header",
      entityType: "Header",
      entityId: newHeaderEntity.id,
    },
  );

  const newParaEntity = await _createEntity(
    "Text",
    { texts: [] },
  );

  const newParaBlock = await _createEntity(
    "Block",
    {
      componentId: "https://block.blockprotocol.org/paragraph",
      entityType: "Text",
      entityId: newParaEntity.id,
    },
  );

  const page = await _createEntity(
    "Page",
    {
      title: properties.title,
      contents: [
        {
          entityId: newHeaderBlock.id,
          namespaceId,
        },
        {
          entityId: newParaBlock.id,
          namespaceId,
        }
      ]
    }
  );

  return page as DbPage;
};